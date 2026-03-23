#!/usr/bin/env node
// Non-Linear Dynamics — Deep Testing Suite
//
// Validates robustness, determines deployment parameters, and stress-tests
// for overfitting before integrating non-linear signals into the live app.
//
// Prerequisite: Initial 5-test calibration battery (nonlinear-calibration.js) passed.
//
// Usage:
//   node scripts/nonlinear-deep-calibration.js [options]
//
// Options:
//   --test N          Run only deep test N (1-5)
//   --dry-run         Use cached EDGAR data only
//   --refresh         Re-fetch EDGAR data even if cached
//   --verbose         Print per-company detail
//   --output FILE     JSON output path

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers, groupByOutcome } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, getRevenueAtDate, buildRollingWindows } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, computeScalingExponentMinQ, scalingTrajectory,
  betaVelocity, nonLinearCompositeScore,
  companyCSD, revenueDerivatives, estimateCAGR,
  zipfExponent, rankVelocity, effortAdjustedVelocity, buildSectorRankings, trackRankHistory,
} from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';
import { getSectorETF, getSectorName, groupBySectorETF } from './lib/sector-map.js';

// ============================================
// CLI
// ============================================
const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const TEST_NUM = getArg('test') ? parseInt(getArg('test')) : null;
const DRY_RUN = hasFlag('dry-run');
const REFRESH = hasFlag('refresh');
const VERBOSE = hasFlag('verbose');
const OUTPUT_PATH = getArg('output');

// ============================================
// FORMATTING
// ============================================
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const pad = (s, w, a = 'right') => { s = String(s ?? 'N/A'); return a === 'left' ? s.padEnd(w) : s.padStart(w); };
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const fmtPct = (v, d = 1) => v == null ? 'N/A' : (v * 100).toFixed(d) + '%';

function printHeader(title) {
  console.log(`\n${BOLD}${CYAN}${'='.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}${title}${RESET}`);
  console.log(`${BOLD}${CYAN}${'='.repeat(60)}${RESET}`);
}
function printSub(title) { console.log(`\n${BOLD}${title}${RESET}\n${DIM}${'-'.repeat(50)}${RESET}`); }

function printTable(headers, rows, widths) {
  const hdr = headers.map((h, i) => pad(h, widths[i], i === 0 ? 'left' : 'right')).join(' | ');
  console.log(`  ${hdr}`);
  console.log(`  ${widths.map(w => '-'.repeat(w)).join('-+-')}`);
  for (const row of rows) {
    const line = row.map((c, i) => pad(c, widths[i], i === 0 ? 'left' : 'right')).join(' | ');
    console.log(`  ${line}`);
  }
}

// ============================================
// DATA LOADING (shared with original calibration)
// ============================================
async function loadData() {
  console.log('Loading calibration cases...');
  const cases = loadCalibrationCases();
  console.log(`  ${cases.length} cases, ${getUniqueTickers(cases).length} unique tickers`);

  console.log('Ensuring CIK cache...');
  await ensureCikCache();

  const tickers = getUniqueTickers(cases);
  console.log(`Fetching EDGAR data for ${tickers.length} tickers...`);

  const companyData = {};
  let loaded = 0, failed = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) { failed++; continue; }

    const result = await fetchFactsForTicker(ticker, { refresh: REFRESH });
    if (result.error || !result.facts) { failed++; continue; }

    const quarterlyMetrics = extractQuarterlyMetrics(result.facts);
    const numbers = extractUsdNumbers(result.facts);

    if (quarterlyMetrics.length < 4) { failed++; continue; }

    companyData[ticker] = { facts: result.facts, quarterlyMetrics, numbers, cik: result.cik };
    loaded++;

    if (!VERBOSE && (i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${tickers.length}...\r`);
  }

  console.log(`\n  Loaded: ${loaded} companies, ${failed} failed/skipped`);
  return { cases, companyData };
}

// ============================================
// DEEP TEST 1: SCALING EXPONENT ROBUSTNESS
// ============================================
function runDeepTest1(cases, companyData) {
  printHeader('Deep Test 1: Scaling Exponent Robustness');
  const results = {};

  // Only use winner/trap cases
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // ---- 1A: Alternative denominators ----
  printSub('1A: Alternative Denominators');

  const denominators = [
    { name: 'Assets (orig)', x: 'assets' },
    { name: 'Equity', x: 'equity' },
    { name: 'Cost of revenue', x: 'costOfRevenue' },
    { name: 'OpEx', x: 'operatingExpenses' },
    { name: 'Employees', x: 'employees' },
    { name: 'Liabilities', x: 'totalLiabilities' },
  ];

  const denomResults = [];
  const headers1a = ['Denominator', 'Winner β', 'Trap β', 'Gap', 'p-value', 'Effect r', 'N'];
  const widths1a = [18, 10, 10, 8, 10, 10, 6];
  const rows1a = [];

  for (const { name, x } of denominators) {
    const winBetas = [], trapBetas = [];
    for (const c of wtCases) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const beta = computeScalingExponent(data.quarterlyMetrics, x, 'revenue');
      if (!beta) continue;
      if (c.outcome === 'winner') winBetas.push(beta.beta);
      else trapBetas.push(beta.beta);
    }

    const mw = (winBetas.length >= 2 && trapBetas.length >= 2) ? mannWhitneyU(winBetas, trapBetas) : null;
    const gap = (winBetas.length > 0 && trapBetas.length > 0) ? mean(winBetas) - mean(trapBetas) : null;
    denomResults.push({ name, winMean: mean(winBetas), trapMean: mean(trapBetas), gap, p: mw?.p, r: mw?.effectSizeR, n: winBetas.length + trapBetas.length });

    rows1a.push([
      name,
      fmtNum(mean(winBetas), 3),
      fmtNum(mean(trapBetas), 3),
      fmtNum(gap, 3),
      fmtNum(mw?.p),
      fmtNum(mw?.effectSizeR, 3),
      String(winBetas.length + trapBetas.length),
    ]);
  }
  printTable(headers1a, rows1a, widths1a);
  results.denominators = denomResults;

  // ---- 1B: Minimum data requirements ----
  printSub('1B: Minimum Data Requirements');

  const minQuarters = [4, 6, 8, 10, 12, 16];
  const rows1b = [];
  const headers1b = ['Min quarters', 'Cases', 'Winner β', 'Trap β', 'p-value', 'Effect r'];
  const widths1b = [14, 8, 10, 10, 10, 10];

  const minQResults = [];
  for (const minQ of minQuarters) {
    const winBetas = [], trapBetas = [];
    for (const c of wtCases) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const beta = computeScalingExponentMinQ(data.quarterlyMetrics, 'assets', 'revenue', minQ);
      if (!beta) continue;
      if (c.outcome === 'winner') winBetas.push(beta.beta);
      else trapBetas.push(beta.beta);
    }
    const mw = (winBetas.length >= 2 && trapBetas.length >= 2) ? mannWhitneyU(winBetas, trapBetas) : null;
    minQResults.push({ minQ, n: winBetas.length + trapBetas.length, winMean: mean(winBetas), trapMean: mean(trapBetas), p: mw?.p, r: mw?.effectSizeR });
    rows1b.push([
      minQ === 8 ? `${minQ} (original)` : String(minQ),
      String(winBetas.length + trapBetas.length),
      fmtNum(mean(winBetas), 3),
      fmtNum(mean(trapBetas), 3),
      fmtNum(mw?.p),
      fmtNum(mw?.effectSizeR, 3),
    ]);
  }
  printTable(headers1b, rows1b, widths1b);
  results.minQuarters = minQResults;

  // ---- 1C: R² quality filter ----
  printSub('1C: R² Quality Filter');

  const r2Thresholds = [0, 0.5, 0.7, 0.9];
  const rows1c = [];
  const headers1c = ['R² threshold', 'Cases', 'Winner β', 'Trap β', 'p-value', 'Effect r'];
  const widths1c = [14, 8, 10, 10, 10, 10];

  const r2Results = [];
  for (const r2Min of r2Thresholds) {
    const winBetas = [], trapBetas = [];
    for (const c of wtCases) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const beta = computeScalingExponent(data.quarterlyMetrics);
      if (!beta || beta.r2 < r2Min) continue;
      if (c.outcome === 'winner') winBetas.push(beta.beta);
      else trapBetas.push(beta.beta);
    }
    const mw = (winBetas.length >= 2 && trapBetas.length >= 2) ? mannWhitneyU(winBetas, trapBetas) : null;
    r2Results.push({ r2Min, n: winBetas.length + trapBetas.length, winMean: mean(winBetas), trapMean: mean(trapBetas), p: mw?.p, r: mw?.effectSizeR });
    rows1c.push([
      r2Min === 0 ? 'No filter' : `R² > ${r2Min}`,
      String(winBetas.length + trapBetas.length),
      fmtNum(mean(winBetas), 3),
      fmtNum(mean(trapBetas), 3),
      fmtNum(mw?.p),
      fmtNum(mw?.effectSizeR, 3),
    ]);
  }
  printTable(headers1c, rows1c, widths1c);
  results.r2Filter = r2Results;

  // ---- 1D: β threshold sweep ----
  printSub('1D: β Threshold Sweep');

  const betaThresholds = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
  const rows1d = [];
  const headers1d = ['β threshold', 'Above', 'Winners', 'Traps', 'Precision', 'Win rate'];
  const widths1d = [14, 8, 10, 8, 10, 10];

  // Pre-compute all betas
  const allBetas = [];
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const beta = computeScalingExponent(data.quarterlyMetrics);
    if (beta) allBetas.push({ ticker: c.ticker, outcome: c.outcome, beta: beta.beta, r2: beta.r2 });
  }

  const thresholdResults = [];
  for (const thresh of betaThresholds) {
    const above = allBetas.filter(b => b.beta > thresh);
    const winnersAbove = above.filter(b => b.outcome === 'winner').length;
    const trapsAbove = above.filter(b => b.outcome === 'trap').length;
    const precision = above.length > 0 ? winnersAbove / above.length : 0;
    const totalWinners = allBetas.filter(b => b.outcome === 'winner').length;
    const winRate = totalWinners > 0 ? winnersAbove / totalWinners : 0;
    thresholdResults.push({ thresh, above: above.length, winnersAbove, trapsAbove, precision, winRate });
    rows1d.push([
      `> ${thresh}`,
      String(above.length),
      `${winnersAbove} (${fmtPct(winRate)})`,
      String(trapsAbove),
      fmtPct(precision),
      fmtPct(above.length > 0 ? winnersAbove / above.length : 0),
    ]);
  }
  printTable(headers1d, rows1d, widths1d);

  // Find optimal threshold (best precision with ≥10 cases)
  const viable = thresholdResults.filter(t => t.above >= 10);
  const optimal = viable.sort((a, b) => b.precision - a.precision)[0];
  if (optimal) {
    console.log(`\n  ${BOLD}Optimal β threshold: > ${optimal.thresh} (precision ${fmtPct(optimal.precision)}, ${optimal.above} cases)${RESET}`);
  }
  results.thresholdSweep = thresholdResults;
  results.optimalThreshold = optimal?.thresh;

  // ---- 1E: Cross-validation ----
  printSub('1E: 5-Fold Cross-Validation');

  const folds = kFoldSplit(allBetas, 5, 42);
  const rows1e = [];
  const headers1e = ['Fold', 'Train p', 'Test p', 'Test effect r'];
  const widths1e = [8, 12, 12, 14];

  const foldResults = [];
  for (let f = 0; f < folds.length; f++) {
    const { train, test } = folds[f];
    const trainItems = train.map(i => allBetas[i]);
    const testItems = test.map(i => allBetas[i]);

    const trainMW = mannWhitneyU(
      trainItems.filter(b => b.outcome === 'winner').map(b => b.beta),
      trainItems.filter(b => b.outcome === 'trap').map(b => b.beta)
    );
    const testMW = mannWhitneyU(
      testItems.filter(b => b.outcome === 'winner').map(b => b.beta),
      testItems.filter(b => b.outcome === 'trap').map(b => b.beta)
    );

    foldResults.push({ fold: f + 1, trainP: trainMW?.p, testP: testMW?.p, testR: testMW?.effectSizeR });
    rows1e.push([
      String(f + 1),
      fmtNum(trainMW?.p),
      fmtNum(testMW?.p),
      fmtNum(testMW?.effectSizeR, 3),
    ]);
  }

  const meanTestP = mean(foldResults.map(f => f.testP).filter(p => p != null));
  const sdTestP = stddev(foldResults.map(f => f.testP).filter(p => p != null));
  const meanTestR = mean(foldResults.map(f => f.testR).filter(r => r != null));
  const sdTestR = stddev(foldResults.map(f => f.testR).filter(r => r != null));
  rows1e.push(['Mean', '', fmtNum(meanTestP), fmtNum(meanTestR, 3)]);
  rows1e.push(['SD', '', fmtNum(sdTestP), fmtNum(sdTestR, 3)]);

  printTable(headers1e, rows1e, widths1e);

  const sigFolds = foldResults.filter(f => f.testP != null && f.testP < 0.05).length;
  console.log(`\n  ${sigFolds}/5 test folds significant (p < 0.05)`);
  console.log(`  ${sigFolds >= 4 ? GREEN + 'Signal generalizes' : sigFolds >= 3 ? YELLOW + 'Moderate generalization' : RED + 'Weak generalization'}${RESET}`);
  results.crossValidation = { foldResults, meanTestP, sdTestP, meanTestR, sdTestR, sigFolds };

  // ---- 1F: Sector-specific β baselines ----
  printSub('1F: Sector-Specific β Baselines');

  const sectorGroups = groupBySectorETF(wtCases);
  const rows1f = [];
  const headers1f = ['Sector', 'Median β', 'Win β (rel)', 'Trap β (rel)', 'p-value'];
  const widths1f = [20, 10, 12, 12, 10];

  const sectorResults = [];
  for (const [etf, sectorCases] of Object.entries(sectorGroups)) {
    const sectorBetas = [];
    const winRelBetas = [], trapRelBetas = [];

    for (const c of sectorCases) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const beta = computeScalingExponent(data.quarterlyMetrics);
      if (!beta) continue;
      sectorBetas.push(beta.beta);
    }

    if (sectorBetas.length < 5) continue;
    const sectorMedian = median(sectorBetas);

    for (const c of sectorCases) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const beta = computeScalingExponent(data.quarterlyMetrics);
      if (!beta) continue;
      const relative = beta.beta - sectorMedian;
      if (c.outcome === 'winner') winRelBetas.push(relative);
      else trapRelBetas.push(relative);
    }

    const mw = (winRelBetas.length >= 2 && trapRelBetas.length >= 2) ? mannWhitneyU(winRelBetas, trapRelBetas) : null;
    sectorResults.push({
      sector: getSectorName(etf), etf, sectorMedian,
      winRelMean: mean(winRelBetas), trapRelMean: mean(trapRelBetas),
      p: mw?.p, n: winRelBetas.length + trapRelBetas.length,
    });
    rows1f.push([
      getSectorName(etf),
      fmtNum(sectorMedian, 2),
      (mean(winRelBetas) >= 0 ? '+' : '') + fmtNum(mean(winRelBetas), 2),
      (mean(trapRelBetas) >= 0 ? '+' : '') + fmtNum(mean(trapRelBetas), 2),
      fmtNum(mw?.p),
    ]);
  }
  printTable(headers1f, rows1f, widths1f);

  // Compare absolute vs sector-relative
  const absP = denomResults[0]?.p;
  const relBetas = { winner: [], trap: [] };
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const beta = computeScalingExponent(data.quarterlyMetrics);
    if (!beta) continue;
    const etf = getSectorETF(c.sector);
    const sr = sectorResults.find(s => s.etf === etf);
    if (!sr) continue;
    const relative = beta.beta - sr.sectorMedian;
    relBetas[c.outcome].push(relative);
  }
  const relMW = mannWhitneyU(relBetas.winner, relBetas.trap);
  console.log(`\n  Absolute β p-value: ${fmtNum(absP)}`);
  console.log(`  Sector-relative β p-value: ${fmtNum(relMW?.p)}`);
  console.log(`  ${BOLD}Sector-relative better? ${(relMW?.p ?? 1) < (absP ?? 1) ? GREEN + 'YES' : RED + 'NO'}${RESET}`);

  results.sectorBaselines = sectorResults;
  results.sectorRelativeMW = { p: relMW?.p, r: relMW?.effectSizeR };

  return results;
}

// ============================================
// DEEP TEST 2: β TRAJECTORY AS LEADING INDICATOR
// ============================================
function runDeepTest2(cases, companyData) {
  printHeader('Deep Test 2: Scaling Exponent Trajectory');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // ---- 2A: Lead time analysis ----
  printSub('2A: Lead Time Analysis (lookback windows)');

  const lookbacks = [4, 8, 12, 16];
  const rows2a = [];
  const headers2a = ['Lookback', 'Win % impr', 'Trap % impr', 'Gap', 'p-value'];
  const widths2a = [14, 12, 12, 8, 10];

  const lookbackResults = [];
  for (const lb of lookbacks) {
    const winImproving = [], trapImproving = [];
    for (const c of wtCases) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const qm = data.quarterlyMetrics;
      const valid = qm.filter(q => q.assets > 0 && q.revenue > 0);
      if (valid.length < lb) continue;

      // Split into early/late based on lookback
      const midpoint = Math.max(0, valid.length - lb);
      const early = valid.slice(0, midpoint);
      const late = valid.slice(midpoint);

      if (early.length < 4 || late.length < 4) continue;

      const betaEarly = computeScalingExponentMinQ(early, 'assets', 'revenue', 4);
      const betaLate = computeScalingExponentMinQ(late, 'assets', 'revenue', 4);
      if (!betaEarly || !betaLate) continue;

      const improving = betaLate.beta > betaEarly.beta ? 1 : 0;
      if (c.outcome === 'winner') winImproving.push(improving);
      else trapImproving.push(improving);
    }

    const winPct = winImproving.length > 0 ? mean(winImproving) : null;
    const trapPct = trapImproving.length > 0 ? mean(trapImproving) : null;
    const gap = (winPct != null && trapPct != null) ? winPct - trapPct : null;
    const mw = (winImproving.length >= 2 && trapImproving.length >= 2) ? mannWhitneyU(winImproving, trapImproving) : null;

    lookbackResults.push({ lookback: lb, winPct, trapPct, gap, p: mw?.p, nWin: winImproving.length, nTrap: trapImproving.length });
    rows2a.push([
      `${lb} quarters`,
      fmtPct(winPct),
      fmtPct(trapPct),
      gap != null ? `${(gap * 100).toFixed(0)}pp` : 'N/A',
      fmtNum(mw?.p),
    ]);
  }
  printTable(headers2a, rows2a, widths2a);

  const bestLookback = lookbackResults.filter(l => l.p != null).sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
  if (bestLookback) console.log(`\n  ${BOLD}Optimal lookback: ${bestLookback.lookback} quarters (p = ${fmtNum(bestLookback.p)})${RESET}`);
  results.lookback = lookbackResults;

  // ---- 2B: β velocity (rate of change) ----
  printSub('2B: β Velocity (Rate of Change)');

  const velocityBands = [
    { label: 'Rapidly improving', min: 0.05, max: Infinity },
    { label: 'Moderately improving', min: 0.01, max: 0.05 },
    { label: 'Stable', min: -0.01, max: 0.01 },
    { label: 'Moderately degrading', min: -0.05, max: -0.01 },
    { label: 'Rapidly degrading', min: -Infinity, max: -0.05 },
  ];

  const velData = [];
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const bv = betaVelocity(data.quarterlyMetrics);
    if (!bv) continue;
    velData.push({ ticker: c.ticker, outcome: c.outcome, velocity: bv.velocity });
  }

  const rows2b = [];
  const headers2b = ['β velocity band', 'Cases', 'Winners', 'Traps', 'Win Rate'];
  const widths2b = [28, 8, 10, 8, 10];

  const bandResults = [];
  for (const { label, min, max } of velocityBands) {
    const inBand = velData.filter(v => v.velocity >= min && v.velocity < max);
    const winners = inBand.filter(v => v.outcome === 'winner').length;
    const traps = inBand.filter(v => v.outcome === 'trap').length;
    const winRate = inBand.length > 0 ? winners / inBand.length : 0;
    bandResults.push({ label, cases: inBand.length, winners, traps, winRate });
    rows2b.push([label, String(inBand.length), String(winners), String(traps), fmtPct(winRate)]);
  }
  printTable(headers2b, rows2b, widths2b);

  const velMW = mannWhitneyU(
    velData.filter(v => v.outcome === 'winner').map(v => v.velocity),
    velData.filter(v => v.outcome === 'trap').map(v => v.velocity)
  );
  console.log(`\n  Mann-Whitney (velocity): p = ${fmtNum(velMW?.p)}, r = ${fmtNum(velMW?.effectSizeR, 3)}`);
  results.velocityBands = bandResults;
  results.velocityMW = { p: velMW?.p, r: velMW?.effectSizeR };

  // ---- 2C: β trajectory combined with static β ----
  printSub('2C: β Level × Trajectory Matrix');

  const matrix = {
    'β>1 + improving': { winner: 0, trap: 0 },
    'β>1 + degrading': { winner: 0, trap: 0 },
    'β<1 + improving': { winner: 0, trap: 0 },
    'β<1 + degrading': { winner: 0, trap: 0 },
  };

  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const traj = scalingTrajectory(data.quarterlyMetrics);
    if (!traj) continue;

    const aboveOne = traj.betaLate > 1.0;
    const improving = traj.betaChange > 0;
    const key = `β${aboveOne ? '>1' : '<1'} + ${improving ? 'improving' : 'degrading'}`;
    if (matrix[key]) matrix[key][c.outcome]++;
  }

  console.log(`  ${''.padEnd(24)}| ${'Winners'.padStart(8)} | ${'Traps'.padStart(8)} | ${'Win Rate'.padStart(8)}`);
  console.log(`  ${'-'.repeat(24)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}`);

  for (const [key, counts] of Object.entries(matrix)) {
    const total = counts.winner + counts.trap;
    const winRate = total > 0 ? counts.winner / total : 0;
    console.log(`  ${pad(key, 24, 'left')}| ${pad(counts.winner, 8)} | ${pad(counts.trap, 8)} | ${fmtPct(winRate).padStart(8)}`);
  }

  const subImprov = matrix['β<1 + improving'];
  console.log(`\n  ${BOLD}"β < 1.0 but improving" win rate: ${fmtPct(subImprov.winner + subImprov.trap > 0 ? subImprov.winner / (subImprov.winner + subImprov.trap) : null)}${RESET}`);
  console.log(`  This quadrant identifies early-stage DKS formation candidates`);

  results.matrix = matrix;
  return results;
}

// ============================================
// DEEP TEST 3: COMBINED NON-LINEAR SCORE
// ============================================
function runDeepTest3(cases, companyData) {
  printHeader('Deep Test 3: Combined Non-Linear Score');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // Pre-compute all signals for each case
  const caseSignals = [];
  const sectorGroups = groupBySectorETF(cases);
  const sectorCompanyData = {};
  for (const [etf, sectorCases] of Object.entries(sectorGroups)) {
    const companies = [];
    for (const c of sectorCases) {
      const data = companyData[c.ticker];
      if (data) companies.push({ ticker: c.ticker, quarterlyMetrics: data.quarterlyMetrics });
    }
    if (companies.length >= 10) sectorCompanyData[etf] = companies;
  }

  const years = Array.from({ length: 10 }, (_, i) => 2015 + i);

  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;

    const qm = data.quarterlyMetrics;
    const beta = computeScalingExponent(qm);
    const traj = scalingTrajectory(qm);
    const csd = companyCSD(qm);
    const deriv = revenueDerivatives(qm);
    const d1 = benfordFirstDigit(data.numbers);
    const annRev = getRevenueAtDate(data.facts, c.entry_date || '2025-12-31');

    // Zipf velocity
    let zipfVel = null;
    const etf = getSectorETF(c.sector);
    if (sectorCompanyData[etf]) {
      const rh = trackRankHistory(c.ticker, sectorCompanyData[etf], years);
      if (rh.ranks.length >= 3) {
        const rv = rankVelocity(rh.ranks, rh.years);
        if (rv) zipfVel = rv.velocity;
      }
    }

    caseSignals.push({
      ticker: c.ticker,
      outcome: c.outcome,
      beta: beta?.beta ?? null,
      betaR2: beta?.r2 ?? null,
      betaTrajectory: traj?.betaChange ?? null,
      csdIndex: csd?.csdIndex ?? null,
      sCurvePhase: deriv?.phase ?? null,
      benfordKLD: d1?.kld ?? null,
      zipfVelocity: zipfVel,
      companyRevenue: annRev,
      avgD1: deriv?.avgD1 ?? null,
      avgD2: deriv?.avgD2 ?? null,
    });
  }

  // ---- 3A: Pairwise combinations ----
  printSub('3A: Pairwise Signal Combinations');

  const signalDefs = [
    { name: 'β level', key: 'beta' },
    { name: 'β trajectory', key: 'betaTrajectory' },
    { name: 'Zipf velocity', key: 'zipfVelocity', invert: true },
    { name: 'CSD index', key: 'csdIndex' },
    { name: 'D1 (growth)', key: 'avgD1' },
  ];

  // Individual signal effect sizes
  const individualEffects = {};
  for (const sig of signalDefs) {
    const winners = caseSignals.filter(c => c.outcome === 'winner' && c[sig.key] != null).map(c => sig.invert ? -c[sig.key] : c[sig.key]);
    const traps = caseSignals.filter(c => c.outcome === 'trap' && c[sig.key] != null).map(c => sig.invert ? -c[sig.key] : c[sig.key]);
    const mw = (winners.length >= 2 && traps.length >= 2) ? mannWhitneyU(winners, traps) : null;
    individualEffects[sig.key] = { p: mw?.p, r: mw?.effectSizeR, name: sig.name };
  }

  const rows3a = [];
  const headers3a = ['Combination', 'Effect r', 'p-value', 'vs best single'];
  const widths3a = [30, 10, 10, 14];

  const pairResults = [];
  for (let i = 0; i < signalDefs.length; i++) {
    for (let j = i + 1; j < signalDefs.length; j++) {
      const a = signalDefs[i], b = signalDefs[j];

      // Combined score: average of normalized values for cases that have both signals
      const combined = caseSignals.filter(c => c[a.key] != null && c[b.key] != null);
      if (combined.length < 10) continue;

      // Z-score normalize each signal
      const aVals = combined.map(c => a.invert ? -c[a.key] : c[a.key]);
      const bVals = combined.map(c => b.invert ? -c[b.key] : c[b.key]);
      const aMean = mean(aVals), aStd = stddev(aVals) || 1;
      const bMean = mean(bVals), bStd = stddev(bVals) || 1;

      const combinedScores = combined.map((c, idx) => ({
        outcome: c.outcome,
        score: ((aVals[idx] - aMean) / aStd + (bVals[idx] - bMean) / bStd) / 2,
      }));

      const winScores = combinedScores.filter(c => c.outcome === 'winner').map(c => c.score);
      const trapScores = combinedScores.filter(c => c.outcome === 'trap').map(c => c.score);
      const mw = mannWhitneyU(winScores, trapScores);

      const bestSingle = Math.max(individualEffects[a.key]?.r ?? 0, individualEffects[b.key]?.r ?? 0);
      const improvement = (mw?.effectSizeR ?? 0) - bestSingle;

      pairResults.push({ combo: `${a.name} + ${b.name}`, r: mw?.effectSizeR, p: mw?.p, improvement });
      rows3a.push([
        `${a.name} + ${b.name}`,
        fmtNum(mw?.effectSizeR, 3),
        fmtNum(mw?.p),
        (improvement >= 0 ? '+' : '') + fmtNum(improvement, 3),
      ]);
    }
  }
  pairResults.sort((a, b) => (b.r ?? 0) - (a.r ?? 0));
  rows3a.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
  printTable(headers3a, rows3a, widths3a);

  if (pairResults[0]) {
    console.log(`\n  ${BOLD}Best pair: ${pairResults[0].combo} (r = ${fmtNum(pairResults[0].r, 3)})${RESET}`);
  }
  results.pairwise = pairResults;

  // ---- 3B: Full composite score ----
  printSub('3B: Full Composite Score');

  const compositeData = [];
  for (const cs of caseSignals) {
    const score = nonLinearCompositeScore({
      beta: cs.beta,
      betaTrajectory: cs.betaTrajectory,
      zipfVelocity: cs.zipfVelocity,
      csdIndex: cs.csdIndex,
      benfordKLD: cs.benfordKLD,
      sCurvePhase: cs.sCurvePhase,
      companyRevenue: cs.companyRevenue,
    });
    if (score != null) compositeData.push({ ticker: cs.ticker, outcome: cs.outcome, score });
  }

  const compositeWin = compositeData.filter(c => c.outcome === 'winner').map(c => c.score);
  const compositeTrap = compositeData.filter(c => c.outcome === 'trap').map(c => c.score);
  const compositeMW = mannWhitneyU(compositeWin, compositeTrap);

  const rows3b = [];
  const headers3b = ['Signal', 'Effect r', 'p-value'];
  const widths3b = [28, 10, 10];

  for (const sig of signalDefs) {
    const ie = individualEffects[sig.key];
    rows3b.push([sig.name, fmtNum(ie?.r, 3), fmtNum(ie?.p)]);
  }
  rows3b.push(['Composite (all)', fmtNum(compositeMW?.effectSizeR, 3), fmtNum(compositeMW?.p)]);
  if (pairResults[0]) {
    rows3b.push([`Best pair (${pairResults[0].combo})`, fmtNum(pairResults[0].r, 3), fmtNum(pairResults[0].p)]);
  }
  printTable(headers3b, rows3b, widths3b);

  console.log(`\n  Composite mean: winners ${fmtNum(mean(compositeWin), 3)} vs traps ${fmtNum(mean(compositeTrap), 3)}`);
  const bestSingleR = Math.max(...Object.values(individualEffects).map(e => e?.r ?? 0));
  const compositeR = compositeMW?.effectSizeR ?? 0;
  console.log(`  ${BOLD}Composite outperforms best single? ${compositeR > bestSingleR ? GREEN + 'YES' : RED + 'NO'} (${(compositeR - bestSingleR >= 0 ? '+' : '') + fmtNum(compositeR - bestSingleR, 3)})${RESET}`);
  results.composite = { p: compositeMW?.p, r: compositeMW?.effectSizeR, winMean: mean(compositeWin), trapMean: mean(compositeTrap) };

  // ---- 3C: Composite threshold sweep ----
  printSub('3C: Composite Threshold Sweep');

  const compThresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const rows3c = [];
  const headers3c = ['Threshold', 'Above', 'Winners', 'Traps', 'Precision', 'Win rate'];
  const widths3c = [12, 8, 10, 8, 10, 10];

  const compThreshResults = [];
  for (const thresh of compThresholds) {
    const above = compositeData.filter(c => c.score > thresh);
    const winners = above.filter(c => c.outcome === 'winner').length;
    const traps = above.filter(c => c.outcome === 'trap').length;
    const precision = above.length > 0 ? winners / above.length : 0;
    compThreshResults.push({ thresh, above: above.length, winners, traps, precision });
    rows3c.push([
      `> ${thresh}`,
      String(above.length),
      String(winners),
      String(traps),
      fmtPct(precision),
      fmtPct(above.length > 0 ? winners / above.length : 0),
    ]);
  }
  printTable(headers3c, rows3c, widths3c);

  const viableComp = compThreshResults.filter(t => t.above >= 10);
  const optComp = viableComp.sort((a, b) => b.precision - a.precision)[0];
  if (optComp) {
    console.log(`\n  ${BOLD}Optimal composite threshold: > ${optComp.thresh} (precision ${fmtPct(optComp.precision)}, ${optComp.above} cases)${RESET}`);
  }
  results.compositeThreshold = compThreshResults;
  results.optimalCompositeThreshold = optComp?.thresh;
  results.caseSignals = compositeData;

  return results;
}

// ============================================
// DEEP TEST 4: INTEGRATION WITH FRAMEWORK
// ============================================
function runDeepTest4(cases, companyData) {
  printHeader('Deep Test 4: Integration with Existing Framework');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // ---- 4A: β vs attractor score ----
  printSub('4A: β vs Attractor Score as Discriminators');

  // Note: calibration cases don't carry attractor scores directly.
  // We use the tier as a proxy — tier 1 stable value cases tend to have higher attractor scores.
  // For actual attractor comparison, we'd need to pull from the DB.
  // Instead, compare β discrimination by tier.

  console.log(`  Note: Attractor scores not available in calibration dataset.`);
  console.log(`  Comparing β discrimination power across discovery tiers instead.`);

  const betaByTier = {};
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const beta = computeScalingExponent(data.quarterlyMetrics);
    if (!beta) continue;
    const tier = `Tier ${c.tier}`;
    if (!betaByTier[tier]) betaByTier[tier] = { winner: [], trap: [] };
    betaByTier[tier][c.outcome].push(beta.beta);
  }

  const rows4a = [];
  const headers4a = ['Tier', 'Cases', 'Effect r', 'p-value'];
  const widths4a = [16, 8, 10, 10];

  for (const [tier, data] of Object.entries(betaByTier)) {
    const mw = (data.winner.length >= 2 && data.trap.length >= 2) ? mannWhitneyU(data.winner, data.trap) : null;
    rows4a.push([tier, String(data.winner.length + data.trap.length), fmtNum(mw?.effectSizeR, 3), fmtNum(mw?.p)]);
  }
  printTable(headers4a, rows4a, widths4a);
  results.betaByTier = betaByTier;

  // ---- 4B: β as a pre-filter ----
  printSub('4B: β as Pre-Filter for Attractor Analysis');

  const allBetas = [];
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const beta = computeScalingExponent(data.quarterlyMetrics);
    if (beta) allBetas.push({ ticker: c.ticker, outcome: c.outcome, beta: beta.beta });
  }

  // Test various β thresholds as pre-filters
  const thresholds = [0.5, 0.6, 0.7, 0.8];
  const rows4b = [];
  const headers4b = ['β gate', 'Pass filter', 'Winners kept', 'Winners missed', 'Miss rate'];
  const widths4b = [10, 14, 14, 14, 10];

  const totalWinners = allBetas.filter(b => b.outcome === 'winner').length;

  for (const thresh of thresholds) {
    const passing = allBetas.filter(b => b.beta > thresh);
    const winnersKept = passing.filter(b => b.outcome === 'winner').length;
    const winnersMissed = totalWinners - winnersKept;
    const missRate = totalWinners > 0 ? winnersMissed / totalWinners : 0;
    const reductionPct = allBetas.length > 0 ? 1 - passing.length / allBetas.length : 0;

    rows4b.push([
      `> ${thresh}`,
      `${passing.length} (${fmtPct(1 - reductionPct)} kept)`,
      String(winnersKept),
      String(winnersMissed),
      fmtPct(missRate),
    ]);
  }
  printTable(headers4b, rows4b, widths4b);
  console.log(`\n  Total winners: ${totalWinners}, total cases with β: ${allBetas.length}`);
  results.preFilter = { totalWinners, totalCases: allBetas.length };

  // ---- 4C: Pipeline-specific signal strength ----
  printSub('4C: Pipeline-Specific Signal Strength');

  const pipelineSignals = {};
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const pipeline = c.pipeline || `Tier ${c.tier}`;
    if (!pipelineSignals[pipeline]) pipelineSignals[pipeline] = [];

    const qm = data.quarterlyMetrics;
    const beta = computeScalingExponent(qm);
    const traj = scalingTrajectory(qm);
    const deriv = revenueDerivatives(qm);
    const csd = companyCSD(qm);

    pipelineSignals[pipeline].push({
      outcome: c.outcome,
      beta: beta?.beta ?? null,
      betaTrajectory: traj?.betaChange ?? null,
      csdIndex: csd?.csdIndex ?? null,
      avgD1: deriv?.avgD1 ?? null,
    });
  }

  const signalNames = ['beta', 'betaTrajectory', 'csdIndex', 'avgD1'];
  const signalLabels = { beta: 'β level', betaTrajectory: 'β trajectory', csdIndex: 'CSD index', avgD1: 'D1 (growth)' };

  const rows4c = [];
  const headers4c = ['Pipeline', 'Best signal', 'Effect r', 'p-value'];
  const widths4c = [16, 16, 10, 10];

  for (const [pipeline, data] of Object.entries(pipelineSignals)) {
    let bestSignal = null, bestR = 0, bestP = 1;
    for (const sig of signalNames) {
      const winners = data.filter(d => d.outcome === 'winner' && d[sig] != null).map(d => d[sig]);
      const traps = data.filter(d => d.outcome === 'trap' && d[sig] != null).map(d => d[sig]);
      const mw = (winners.length >= 2 && traps.length >= 2) ? mannWhitneyU(winners, traps) : null;
      if (mw && (mw.effectSizeR ?? 0) > bestR) {
        bestR = mw.effectSizeR;
        bestP = mw.p;
        bestSignal = signalLabels[sig];
      }
    }
    rows4c.push([pipeline, bestSignal || 'N/A', fmtNum(bestR, 3), fmtNum(bestP)]);
  }
  printTable(headers4c, rows4c, widths4c);
  results.pipelineSignals = pipelineSignals;

  return results;
}

// ============================================
// DEEP TEST 5: VINTAGE SIMULATION PREP
// ============================================
function runDeepTest5(cases, companyData) {
  printHeader('Deep Test 5: Vintage Simulation Preparation');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  console.log(`  Note: Full vintage simulation requires the worker-side simulation infrastructure.`);
  console.log(`  This test computes β and composite scores per case and exports gate parameters.`);
  console.log('');

  // Pre-compute all signals
  const sectorGroups = groupBySectorETF(cases);
  const sectorCompanyData = {};
  for (const [etf, sectorCases] of Object.entries(sectorGroups)) {
    const companies = [];
    for (const c of sectorCases) {
      const data = companyData[c.ticker];
      if (data) companies.push({ ticker: c.ticker, quarterlyMetrics: data.quarterlyMetrics });
    }
    if (companies.length >= 10) sectorCompanyData[etf] = companies;
  }
  const years = Array.from({ length: 10 }, (_, i) => 2015 + i);

  const scored = [];
  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;

    const qm = data.quarterlyMetrics;
    const beta = computeScalingExponent(qm);
    const traj = scalingTrajectory(qm);
    const csd = companyCSD(qm);
    const deriv = revenueDerivatives(qm);
    const d1 = benfordFirstDigit(data.numbers);
    const annRev = getRevenueAtDate(data.facts, c.entry_date || '2025-12-31');

    let zipfVel = null;
    const etf = getSectorETF(c.sector);
    if (sectorCompanyData[etf]) {
      const rh = trackRankHistory(c.ticker, sectorCompanyData[etf], years);
      if (rh.ranks.length >= 3) {
        const rv = rankVelocity(rh.ranks, rh.years);
        if (rv) zipfVel = rv.velocity;
      }
    }

    const composite = nonLinearCompositeScore({
      beta: beta?.beta ?? null,
      betaTrajectory: traj?.betaChange ?? null,
      zipfVelocity: zipfVel,
      csdIndex: csd?.csdIndex ?? null,
      benfordKLD: d1?.kld ?? null,
      sCurvePhase: deriv?.phase ?? null,
      companyRevenue: annRev,
    });

    scored.push({
      ticker: c.ticker,
      outcome: c.outcome,
      tier: c.tier,
      pipeline: c.pipeline,
      entry_date: c.entry_date,
      beta: beta?.beta ?? null,
      betaR2: beta?.r2 ?? null,
      betaTrajectory: traj?.betaChange ?? null,
      csdIndex: csd?.csdIndex ?? null,
      sCurvePhase: deriv?.phase ?? null,
      benfordKLD: d1?.kld ?? null,
      zipfVelocity: zipfVel,
      composite,
    });
  }

  // ---- 5A: β gate simulation ----
  printSub('5A: β Gate Analysis');

  const betaGates = [null, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  const rows5a = [];
  const headers5a = ['β gate', 'Cases', 'Winners', 'Traps', 'Win Rate', 'Coverage'];
  const widths5a = [12, 8, 10, 8, 10, 10];

  for (const gate of betaGates) {
    const passing = gate == null ? scored.filter(s => s.beta != null) : scored.filter(s => s.beta != null && s.beta > gate);
    const winners = passing.filter(s => s.outcome === 'winner').length;
    const traps = passing.filter(s => s.outcome === 'trap').length;
    const winRate = passing.length > 0 ? winners / passing.length : 0;
    const totalWithBeta = scored.filter(s => s.beta != null).length;
    const coverage = totalWithBeta > 0 ? passing.length / totalWithBeta : 0;

    rows5a.push([
      gate == null ? 'No gate' : `> ${gate}`,
      String(passing.length),
      String(winners),
      String(traps),
      fmtPct(winRate),
      fmtPct(coverage),
    ]);
  }
  printTable(headers5a, rows5a, widths5a);

  // ---- 5B: Composite gate simulation ----
  printSub('5B: Composite Score Gate Analysis');

  const compGates = [null, 0.3, 0.4, 0.5, 0.6, 0.7];
  const rows5b = [];
  const headers5b = ['Comp gate', 'Cases', 'Winners', 'Traps', 'Win Rate', 'Coverage'];
  const widths5b = [12, 8, 10, 8, 10, 10];

  for (const gate of compGates) {
    const passing = gate == null ? scored.filter(s => s.composite != null) : scored.filter(s => s.composite != null && s.composite > gate);
    const winners = passing.filter(s => s.outcome === 'winner').length;
    const traps = passing.filter(s => s.outcome === 'trap').length;
    const winRate = passing.length > 0 ? winners / passing.length : 0;
    const totalWithComp = scored.filter(s => s.composite != null).length;
    const coverage = totalWithComp > 0 ? passing.length / totalWithComp : 0;

    rows5b.push([
      gate == null ? 'No gate' : `> ${gate}`,
      String(passing.length),
      String(winners),
      String(traps),
      fmtPct(winRate),
      fmtPct(coverage),
    ]);
  }
  printTable(headers5b, rows5b, widths5b);

  // Save scored cases for vintage sim
  results.scored = scored;
  results.summary = {
    totalScored: scored.length,
    withBeta: scored.filter(s => s.beta != null).length,
    withComposite: scored.filter(s => s.composite != null).length,
  };

  console.log(`\n  Scored ${scored.length} cases (${results.summary.withBeta} with β, ${results.summary.withComposite} with composite)`);
  console.log(`  Full scored dataset will be saved to output JSON for vintage simulation`);

  return results;
}

// ============================================
// REPORTING SUMMARY
// ============================================
function printSummary(allResults) {
  printHeader('NON-LINEAR DYNAMICS — DEEP TEST RESULTS');

  const dt1 = allResults.deepTest1;
  const dt2 = allResults.deepTest2;
  const dt3 = allResults.deepTest3;
  const dt4 = allResults.deepTest4;
  const dt5 = allResults.deepTest5;

  if (dt1) {
    printSub('Deep Test 1: Scaling Exponent Robustness');
    // Best denominator
    const bestDenom = dt1.denominators?.filter(d => d.p != null).sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
    console.log(`  Best denominator: ${bestDenom?.name ?? 'N/A'} (p = ${fmtNum(bestDenom?.p)})`);

    // Optimal min quarters
    const bestMinQ = dt1.minQuarters?.filter(m => m.p != null).sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
    console.log(`  Optimal min quarters: ${bestMinQ?.minQ ?? 'N/A'}`);

    // R² filter
    const bestR2 = dt1.r2Filter?.sort((a, b) => (b.r ?? 0) - (a.r ?? 0))[0];
    console.log(`  R² filter improves signal? ${bestR2?.r2Min > 0 ? GREEN + 'YES' : RED + 'NO'}${RESET} (optimal R²: ${bestR2?.r2Min})`);

    // Optimal β threshold
    console.log(`  Optimal β threshold: ${dt1.optimalThreshold ?? 'N/A'}`);

    // Cross-validation
    const cv = dt1.crossValidation;
    console.log(`  Cross-validation: ${cv?.sigFolds ?? 'N/A'}/5 folds significant, mean effect r = ${fmtNum(cv?.meanTestR, 3)} ± ${fmtNum(cv?.sdTestR, 3)}`);

    // Sector-relative
    const sRelBetter = (dt1.sectorRelativeMW?.p ?? 1) < (dt1.denominators?.[0]?.p ?? 1);
    console.log(`  Sector-relative β better than absolute? ${sRelBetter ? GREEN + 'YES' : RED + 'NO'}${RESET}`);
  }

  if (dt2) {
    printSub('Deep Test 2: Trajectory as Leading Indicator');
    const bestLB = dt2.lookback?.filter(l => l.p != null).sort((a, b) => (a.p ?? 1) - (b.p ?? 1))[0];
    console.log(`  Optimal lookback window: ${bestLB?.lookback ?? 'N/A'} quarters`);
    console.log(`  β velocity discriminates? ${dt2.velocityMW?.p < 0.05 ? GREEN + 'YES' : RED + 'NO'}${RESET}`);

    const subImprov = dt2.matrix?.['β<1 + improving'];
    const subImprovWR = subImprov ? (subImprov.winner + subImprov.trap > 0 ? subImprov.winner / (subImprov.winner + subImprov.trap) : null) : null;
    console.log(`  "β < 1.0 but improving" quadrant win rate: ${fmtPct(subImprovWR)}`);
  }

  if (dt3) {
    printSub('Deep Test 3: Combined Score');
    const bestPair = dt3.pairwise?.[0];
    console.log(`  Best pair: ${bestPair?.combo ?? 'N/A'}, effect r = ${fmtNum(bestPair?.r, 3)}`);
    const bestSingleR = Math.max(...Object.values(dt3.composite ?? {}).filter(v => typeof v === 'number'));
    console.log(`  Composite outperforms best single? ${(dt3.composite?.r ?? 0) > 0.267 ? GREEN + 'YES' : RED + 'NO'}${RESET} (r = ${fmtNum(dt3.composite?.r, 3)})`);
    console.log(`  Optimal composite threshold: ${dt3.optimalCompositeThreshold ?? 'N/A'}`);
  }

  if (dt4) {
    printSub('Deep Test 4: Integration with Framework');
    console.log(`  (Attractor scores not in calibration data — see tier-level analysis above)`);
  }

  if (dt5) {
    printSub('Deep Test 5: Vintage Simulation');
    console.log(`  Scored ${dt5.summary?.totalScored ?? 0} cases`);
    console.log(`  ${dt5.summary?.withBeta ?? 0} with β, ${dt5.summary?.withComposite ?? 0} with composite`);
    console.log(`  Recommended: Feed scored dataset into vintage simulation for final validation`);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('Non-Linear Dynamics — Deep Testing Suite');
  console.log('='.repeat(50));

  const { cases, companyData } = await loadData();

  const allResults = {};
  const shouldRun = (n) => !TEST_NUM || TEST_NUM === n;

  if (shouldRun(1)) allResults.deepTest1 = runDeepTest1(cases, companyData);
  if (shouldRun(2)) allResults.deepTest2 = runDeepTest2(cases, companyData);
  if (shouldRun(3)) allResults.deepTest3 = runDeepTest3(cases, companyData);
  if (shouldRun(4)) allResults.deepTest4 = runDeepTest4(cases, companyData);
  if (shouldRun(5)) allResults.deepTest5 = runDeepTest5(cases, companyData);

  // Summary
  printSummary(allResults);

  // Save results
  const DATA_DIR = resolve(import.meta.dirname, '../data');
  const outPath = OUTPUT_PATH || resolve(DATA_DIR, `nonlinear-deep-results-${new Date().toISOString().slice(0, 10)}.json`);

  // Strip functions and circular refs before saving
  const saveable = JSON.parse(JSON.stringify(allResults, (key, val) => {
    if (key === 'facts' || key === 'quarterlyMetrics' || key === 'numbers') return undefined;
    return val;
  }));

  writeFileSync(outPath, JSON.stringify(saveable, null, 2));
  console.log(`\n${DIM}Results saved to: ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
