#!/usr/bin/env node
// Non-Linear Dynamics Calibration Test Suite
//
// Tests whether non-linear mathematical signatures in EDGAR financial data
// can predict investment outcomes. 5 tests: metabolic scaling, Benford maturity
// gradient, critical slowing down, S-curve inflection, Zipf rank dynamics.
//
// Usage:
//   node scripts/nonlinear-calibration.js [options]
//
// Options:
//   --test N          Run only test N (1-5)
//   --dry-run         Use cached EDGAR data only
//   --refresh         Re-fetch EDGAR data even if cached
//   --fetch-only      Only fetch and cache EDGAR data
//   --ticker AAPL     Single-ticker diagnostic
//   --verbose         Print per-company detail
//   --output FILE     JSON output path

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers, groupByOutcome } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, extractionSummary, getRevenueAtDate, buildRollingWindows } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, scalingTrajectory, maturityBand, ordersOfMagnitude,
  companyCSD, revenueDerivatives, estimateCAGR,
  zipfExponent, rankVelocity, effortAdjustedVelocity, buildSectorRankings, trackRankHistory,
} from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median } from './lib/statistics.js';
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
const FETCH_ONLY = hasFlag('fetch-only');
const SINGLE_TICKER = getArg('ticker');
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

// ============================================
// DATA LOADING
// ============================================
async function loadData() {
  console.log('Loading calibration cases...');
  let cases = loadCalibrationCases();
  console.log(`  ${cases.length} cases, ${getUniqueTickers(cases).length} unique tickers`);

  if (SINGLE_TICKER) {
    cases = cases.filter(c => c.ticker === SINGLE_TICKER.toUpperCase());
    if (cases.length === 0) {
      cases = [{ ticker: SINGLE_TICKER.toUpperCase(), company: SINGLE_TICKER, outcome: 'unknown', entry_date: '2024-01-01', sector: 'Unknown', tier: 0 }];
    }
  }

  console.log('Ensuring CIK cache...');
  await ensureCikCache();

  const tickers = getUniqueTickers(cases);
  console.log(`Fetching EDGAR data for ${tickers.length} tickers...`);

  const companyData = {}; // ticker → { facts, quarterlyMetrics, numbers, summary }
  let loaded = 0, failed = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);

    if (DRY_RUN && cik && !hasCachedFacts(cik)) { failed++; continue; }

    const result = await fetchFactsForTicker(ticker, { refresh: REFRESH });
    if (result.error || !result.facts) { failed++; continue; }

    const quarterlyMetrics = extractQuarterlyMetrics(result.facts);
    const numbers = extractUsdNumbers(result.facts);
    const summary = extractionSummary(result.facts);

    if (quarterlyMetrics.length < 4) { failed++; continue; }

    companyData[ticker] = { facts: result.facts, quarterlyMetrics, numbers, summary, cik: result.cik };
    loaded++;

    if (VERBOSE) console.log(`  ${ticker}: ${quarterlyMetrics.length}Q, rev=${quarterlyMetrics.filter(q => q.revenue).length}Q`);
    if (!VERBOSE && (i + 1) % 20 === 0) process.stdout.write(`  ${i + 1}/${tickers.length}...\r`);
  }

  console.log(`\n  Loaded: ${loaded} companies, ${failed} failed/skipped`);
  return { cases, companyData };
}

// ============================================
// TEST 1: METABOLIC SCALING CROSSOVER
// ============================================
function runTest1(cases, companyData) {
  printHeader('Test 1: Metabolic Scaling Crossover');

  const results = { winner: [], trap: [], underperform: [] };
  const trajectories = { winner: [], trap: [], underperform: [] };
  let withEmployees = 0;
  const empResults = { winner: [], trap: [], underperform: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!results[outcome]) continue;

    const qm = data.quarterlyMetrics;
    const beta = computeScalingExponent(qm);
    if (beta) results[outcome].push({ ticker: c.ticker, ...beta });

    const traj = scalingTrajectory(qm);
    if (traj) trajectories[outcome].push({ ticker: c.ticker, ...traj });

    // Employee-based scaling
    const betaEmp = computeScalingExponent(qm, 'employees', 'revenue');
    if (betaEmp) {
      withEmployees++;
      empResults[outcome].push({ ticker: c.ticker, ...betaEmp });
    }
  }

  // 1A: Static scaling
  printSub('1A: Static Scaling Exponent at Entry');
  const cols = ['winner', 'trap', 'underperform'];
  const betas = (group) => group.map(g => g.beta);

  console.log(`  ${''.padEnd(22)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`  ${''.padEnd(22)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(12)}`);
  console.log(`  ${'Mean β (assets)'.padEnd(22)}| ${fmtNum(mean(betas(results.winner)), 3).padStart(10)} | ${fmtNum(mean(betas(results.trap)), 3).padStart(10)} | ${fmtNum(mean(betas(results.underperform)), 3).padStart(10)}`);
  console.log(`  ${'Median β'.padEnd(22)}| ${fmtNum(median(betas(results.winner)), 3).padStart(10)} | ${fmtNum(median(betas(results.trap)), 3).padStart(10)} | ${fmtNum(median(betas(results.underperform)), 3).padStart(10)}`);

  const pctAbove = (group) => group.length > 0 ? group.filter(g => g.beta > 1.0).length / group.length : 0;
  const pctBelow = (group) => group.length > 0 ? group.filter(g => g.beta < 0.8).length / group.length : 0;
  console.log(`  ${'% with β > 1.0'.padEnd(22)}| ${fmtPct(pctAbove(results.winner)).padStart(10)} | ${fmtPct(pctAbove(results.trap)).padStart(10)} | ${fmtPct(pctAbove(results.underperform)).padStart(10)}`);
  console.log(`  ${'% with β < 0.8'.padEnd(22)}| ${fmtPct(pctBelow(results.winner)).padStart(10)} | ${fmtPct(pctBelow(results.trap)).padStart(10)} | ${fmtPct(pctBelow(results.underperform)).padStart(10)}`);

  const mw1a = mannWhitneyU(betas(results.winner), betas(results.trap));
  console.log(`\n  Mann-Whitney (winners vs traps): p = ${fmtNum(mw1a?.p)}, effect size r = ${fmtNum(mw1a?.effectSizeR, 3)}`);

  console.log(`\n  Cases with employee data: ${withEmployees}`);
  if (empResults.winner.length > 0 || empResults.trap.length > 0) {
    console.log(`  Mean β (employees)   | ${fmtNum(mean(betas(empResults.winner)), 3).padStart(10)} | ${fmtNum(mean(betas(empResults.trap)), 3).padStart(10)} | ${fmtNum(mean(betas(empResults.underperform)), 3).padStart(10)}`);
  }

  // 1B: Trajectory
  printSub('1B: Scaling Exponent Trajectory');
  const changes = (group) => group.map(g => g.betaChange);

  console.log(`  ${''.padEnd(28)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)}`);
  console.log(`  ${''.padEnd(28)}|${'-'.repeat(12)}|${'-'.repeat(12)}`);
  console.log(`  ${'Mean β change (late-early)'.padEnd(28)}| ${fmtNum(mean(changes(trajectories.winner)), 3).padStart(10)} | ${fmtNum(mean(changes(trajectories.trap)), 3).padStart(10)}`);

  const pctCrossing = (g) => g.length > 0 ? g.filter(t => t.trajectory === 'CROSSING_SUPERLINEAR').length / g.length : 0;
  const pctDegrading = (g) => g.length > 0 ? g.filter(t => t.trajectory === 'DEGRADING').length / g.length : 0;
  console.log(`  ${'% crossing above 1.0'.padEnd(28)}| ${fmtPct(pctCrossing(trajectories.winner)).padStart(10)} | ${fmtPct(pctCrossing(trajectories.trap)).padStart(10)}`);
  console.log(`  ${'% degrading (β declining)'.padEnd(28)}| ${fmtPct(pctDegrading(trajectories.winner)).padStart(10)} | ${fmtPct(pctDegrading(trajectories.trap)).padStart(10)}`);

  // Cross-tab
  printSub('Cross-tabulation');
  const cross = (group, label) => {
    const above = group.filter(g => g.betaLate > 1.0).length;
    const below = group.length - above;
    const improving = group.filter(g => g.betaChange > 0).length;
    const degrading = group.length - improving;
    return { above, below, improving, degrading };
  };
  const wCross = cross(trajectories.winner);
  const tCross = cross(trajectories.trap);

  console.log(`  ${''.padEnd(20)}| ${'Winner'.padStart(8)} | ${'Trap'.padStart(8)}`);
  console.log(`  ${'β > 1.0 at entry'.padEnd(20)}| ${pad(wCross.above, 8)} | ${pad(tCross.above, 8)}`);
  console.log(`  ${'β < 1.0 at entry'.padEnd(20)}| ${pad(wCross.below, 8)} | ${pad(tCross.below, 8)}`);
  console.log(`  ${'β improving'.padEnd(20)}| ${pad(wCross.improving, 8)} | ${pad(tCross.improving, 8)}`);
  console.log(`  ${'β degrading'.padEnd(20)}| ${pad(wCross.degrading, 8)} | ${pad(tCross.degrading, 8)}`);

  const pass = mw1a && mw1a.p < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (p = ${fmtNum(mw1a?.p)})`);

  return { results, trajectories, empResults, mw: mw1a, pass };
}

// ============================================
// TEST 2: BENFORD MATURITY GRADIENT
// ============================================
function runTest2(cases, companyData) {
  printHeader('Test 2: Benford Maturity Gradient');

  // 2A: Segment by revenue maturity band
  printSub('2A: Benford KLD slope by maturity band');

  const bands = { 'pre-scale': { winner: [], trap: [] }, 'early-scaling': { winner: [], trap: [] },
                   'late-scaling': { winner: [], trap: [] }, 'mature': { winner: [], trap: [] } };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data || !data.summary.temporalEligible) continue;
    const outcome = c.outcome;
    if (outcome !== 'winner' && outcome !== 'trap') continue;

    const annualRev = getRevenueAtDate(data.facts, c.entry_date || '2025-12-31');
    const band = maturityBand(annualRev);
    if (!band || !bands[band]) continue;

    // Compute Benford KLD slope (rolling 8-quarter windows)
    const windows = buildRollingWindows(data.facts);
    if (windows.length < 3) continue;

    const klds = [];
    for (let i = 0; i < windows.length; i++) {
      const result = benfordFirstDigit(windows[i].values);
      if (result) klds.push({ x: i, kld: result.kld });
    }
    if (klds.length < 3) continue;

    const reg = linearRegression(klds.map(k => k.x), klds.map(k => k.kld));
    if (!reg) continue;

    bands[band][outcome].push({ ticker: c.ticker, slope: reg.slope, revenue: annualRev });
  }

  console.log(`  ${'Revenue Band'.padEnd(16)}| ${'Cases'.padStart(6)} | ${'Win % impr'.padStart(11)} | ${'Trap % impr'.padStart(12)} | ${'Gap'.padStart(6)} | p-value`);
  console.log(`  ${''.padEnd(16)}|${'-'.repeat(8)}|${'-'.repeat(13)}|${'-'.repeat(14)}|${'-'.repeat(8)}|${'-'.repeat(10)}`);

  for (const [band, data] of Object.entries(bands)) {
    const wSlopes = data.winner.map(s => s.slope);
    const tSlopes = data.trap.map(s => s.slope);
    const total = wSlopes.length + tSlopes.length;
    const wPctImpr = wSlopes.length > 0 ? wSlopes.filter(s => s < 0).length / wSlopes.length : 0;
    const tPctImpr = tSlopes.length > 0 ? tSlopes.filter(s => s < 0).length / tSlopes.length : 0;
    const mw = (wSlopes.length >= 2 && tSlopes.length >= 2) ? mannWhitneyU(wSlopes, tSlopes) : null;
    const gap = ((wPctImpr - tPctImpr) * 100).toFixed(0) + 'pp';
    console.log(`  ${pad(band, 16, 'left')}| ${pad(total, 6)} | ${fmtPct(wPctImpr).padStart(11)} | ${fmtPct(tPctImpr).padStart(12)} | ${pad(gap, 6)} | ${fmtNum(mw?.p)}`);
  }

  // 2B: Orders of magnitude spanned
  printSub('2B: Orders of magnitude spanned');
  const ordersByOutcome = { winner: [], trap: [], underperform: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!ordersByOutcome[outcome]) continue;

    const orders = ordersOfMagnitude(data.numbers);
    if (orders != null) ordersByOutcome[outcome].push(orders);
  }

  console.log(`  ${''.padEnd(20)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`  ${'Mean orders'.padEnd(20)}| ${fmtNum(mean(ordersByOutcome.winner), 1).padStart(10)} | ${fmtNum(mean(ordersByOutcome.trap), 1).padStart(10)} | ${fmtNum(mean(ordersByOutcome.underperform), 1).padStart(10)}`);
  console.log(`  ${'Median orders'.padEnd(20)}| ${fmtNum(median(ordersByOutcome.winner), 1).padStart(10)} | ${fmtNum(median(ordersByOutcome.trap), 1).padStart(10)} | ${fmtNum(median(ordersByOutcome.underperform), 1).padStart(10)}`);

  // Check if early-scaling band reverses
  const esWin = bands['early-scaling'].winner.map(s => s.slope);
  const esTrap = bands['early-scaling'].trap.map(s => s.slope);
  const esWinImpr = esWin.length > 0 ? esWin.filter(s => s < 0).length / esWin.length : 0;
  const esTrapImpr = esTrap.length > 0 ? esTrap.filter(s => s < 0).length / esTrap.length : 0;
  const pass = esWinImpr > esTrapImpr && esWin.length >= 3;

  console.log(`\n  Early-scaling band ($100M-$1B): winners improving ${fmtPct(esWinImpr)} vs traps ${fmtPct(esTrapImpr)}`);
  console.log(`  ${BOLD}Signal reverses in $100M-$1B band? ${pass ? GREEN + 'YES' : RED + 'NO'}${RESET}`);

  return { bands, ordersByOutcome, pass };
}

// ============================================
// TEST 3: CRITICAL SLOWING DOWN
// ============================================
function runTest3(cases, companyData) {
  printHeader('Test 3: Critical Slowing Down');

  const csdByOutcome = { winner: [], trap: [], underperform: [] };
  const metricSlopes = {
    revenueGrowth: { winner: [], trap: [], underperform: [] },
    operatingMargin: { winner: [], trap: [], underperform: [] },
    fcfMargin: { winner: [], trap: [], underperform: [] },
  };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!csdByOutcome[outcome]) continue;

    const csd = companyCSD(data.quarterlyMetrics);
    if (!csd.hasData) continue;

    csdByOutcome[outcome].push({ ticker: c.ticker, ...csd });

    // Collect per-metric autocorrelation slopes
    for (const metric of ['revenueGrowth', 'operatingMargin', 'fcfMargin']) {
      if (csd.metrics[metric]?.autocorrSlope != null) {
        metricSlopes[metric][outcome].push(csd.metrics[metric].autocorrSlope);
      }
    }
  }

  // 3A: Autocorrelation trends per metric
  printSub('3A: Autocorrelation Trend');

  for (const [metric, data] of Object.entries(metricSlopes)) {
    console.log(`  Metric: ${metric}`);
    console.log(`  ${''.padEnd(34)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
    console.log(`  ${'Mean autocorr slope (+ = slowing)'.padEnd(34)}| ${fmtNum(mean(data.winner), 4).padStart(10)} | ${fmtNum(mean(data.trap), 4).padStart(10)} | ${fmtNum(mean(data.underperform), 4).padStart(10)}`);
    const pctPos = (arr) => arr.length > 0 ? arr.filter(v => v > 0).length / arr.length : 0;
    console.log(`  ${'% with positive slope'.padEnd(34)}| ${fmtPct(pctPos(data.winner)).padStart(10)} | ${fmtPct(pctPos(data.trap)).padStart(10)} | ${fmtPct(pctPos(data.underperform)).padStart(10)}`);
    const mw = (data.winner.length >= 2 && data.trap.length >= 2) ? mannWhitneyU(data.winner, data.trap) : null;
    console.log(`  Mann-Whitney: p = ${fmtNum(mw?.p)}`);
    console.log('');
  }

  // 3B: Variance trends
  printSub('3B: Variance Trend');
  for (const [metric, _] of Object.entries(metricSlopes)) {
    const varSlopes = { winner: [], trap: [], underperform: [] };
    for (const outcome of ['winner', 'trap', 'underperform']) {
      for (const c of csdByOutcome[outcome]) {
        if (c.metrics[metric]?.varianceSlope != null) {
          varSlopes[outcome].push(c.metrics[metric].varianceSlope);
        }
      }
    }
    console.log(`  Metric: ${metric}`);
    console.log(`  ${'Mean variance slope'.padEnd(34)}| ${fmtNum(mean(varSlopes.winner), 6).padStart(10)} | ${fmtNum(mean(varSlopes.trap), 6).padStart(10)} | ${fmtNum(mean(varSlopes.underperform), 6).padStart(10)}`);
    console.log('');
  }

  // 3C: Combined CSD index
  printSub('3C: Combined CSD Index');
  const csdIndices = {};
  for (const outcome of ['winner', 'trap', 'underperform']) {
    csdIndices[outcome] = csdByOutcome[outcome].map(c => c.csdIndex);
  }

  console.log(`  ${''.padEnd(22)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`  ${'Mean CSD index'.padEnd(22)}| ${fmtNum(mean(csdIndices.winner), 3).padStart(10)} | ${fmtNum(mean(csdIndices.trap), 3).padStart(10)} | ${fmtNum(mean(csdIndices.underperform), 3).padStart(10)}`);

  const highCSD = { winner: 0, trap: 0, underperform: 0 };
  for (const outcome of ['winner', 'trap', 'underperform']) {
    highCSD[outcome] = csdByOutcome[outcome].filter(c => c.csdIndex > 0.5).length;
  }
  console.log(`\n  Cases with CSD > 0.5 (strong signal):`);
  console.log(`    Winners: ${highCSD.winner} (${fmtPct(highCSD.winner / Math.max(csdByOutcome.winner.length, 1))})`);
  console.log(`    Traps: ${highCSD.trap} (${fmtPct(highCSD.trap / Math.max(csdByOutcome.trap.length, 1))})`);

  // CSD + Benford cross-tab
  printSub('CSD + Benford conformity cross-tabulation');
  const crossTab = { 'CSD high + Benford close': { winner: 0, trap: 0 }, 'CSD high + Benford non-conf': { winner: 0, trap: 0 },
                     'CSD low + Benford close': { winner: 0, trap: 0 }, 'CSD low + Benford non-conf': { winner: 0, trap: 0 } };

  for (const outcome of ['winner', 'trap']) {
    for (const c of csdByOutcome[outcome]) {
      const data = companyData[c.ticker];
      if (!data) continue;
      const d1 = benfordFirstDigit(data.numbers);
      const benfordGood = d1 && (d1.conformity === 'close' || d1.conformity === 'acceptable');
      const csdHigh = c.csdIndex > 0.5;

      const key = `CSD ${csdHigh ? 'high' : 'low'} + Benford ${benfordGood ? 'close' : 'non-conf'}`;
      if (crossTab[key]) crossTab[key][outcome]++;
    }
  }

  for (const [label, counts] of Object.entries(crossTab)) {
    console.log(`    ${pad(label, 34, 'left')}: ${counts.winner} winners, ${counts.trap} traps`);
  }

  const pass = highCSD.winner > 0 && highCSD.trap > 0; // Both show elevated CSD
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { csdByOutcome, metricSlopes, csdIndices, crossTab, pass };
}

// ============================================
// TEST 4: S-CURVE INFLECTION DETECTION
// ============================================
function runTest4(cases, companyData) {
  printHeader('Test 4: S-Curve Inflection Detection');

  const phaseByOutcome = { winner: [], trap: [], underperform: [] };
  const d1Values = { winner: [], trap: [] };
  const d2Values = { winner: [], trap: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!phaseByOutcome[outcome]) continue;

    const deriv = revenueDerivatives(data.quarterlyMetrics);
    if (!deriv) continue;

    phaseByOutcome[outcome].push({ ticker: c.ticker, ...deriv });
    if (d1Values[outcome]) {
      d1Values[outcome].push(deriv.avgD1);
      d2Values[outcome].push(deriv.avgD2);
    }
  }

  // 4B: Phase classification vs outcome
  printSub('4B: Phase at entry vs outcome');

  const phases = ['ACCELERATING', 'PEAK', 'INFLECTION', 'DECELERATING', 'BOTTOMING'];
  console.log(`  ${''.padEnd(16)}| ${'Winners'.padStart(8)} | ${'Traps'.padStart(8)} | ${'Underp'.padStart(8)} | ${'Total'.padStart(6)} | Win Rate`);
  console.log(`  ${''.padEnd(16)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(8)}|${'-'.repeat(10)}`);

  for (const phase of phases) {
    const w = phaseByOutcome.winner.filter(p => p.phase === phase).length;
    const t = phaseByOutcome.trap.filter(p => p.phase === phase).length;
    const u = phaseByOutcome.underperform.filter(p => p.phase === phase).length;
    const total = w + t + u;
    const winRate = total > 0 ? w / total : 0;
    console.log(`  ${pad(phase, 16, 'left')}| ${pad(w, 8)} | ${pad(t, 8)} | ${pad(u, 8)} | ${pad(total, 6)} | ${fmtPct(winRate)}`);
  }

  // 4C: D1 vs D2 comparison
  printSub('4C: D1 (growth rate) vs D2 (acceleration) as predictor');

  const mwD1 = mannWhitneyU(d1Values.winner, d1Values.trap);
  const mwD2 = mannWhitneyU(d2Values.winner, d2Values.trap);

  console.log(`  ${'Metric'.padEnd(22)}| ${'Win mean'.padStart(10)} | ${'Trap mean'.padStart(10)} | ${'M-W p'.padStart(8)} | ${'Effect r'.padStart(8)}`);
  console.log(`  ${''.padEnd(22)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(10)}|${'-'.repeat(10)}`);
  console.log(`  ${'D1 (growth rate)'.padEnd(22)}| ${fmtPct(mean(d1Values.winner)).padStart(10)} | ${fmtPct(mean(d1Values.trap)).padStart(10)} | ${fmtNum(mwD1?.p).padStart(8)} | ${fmtNum(mwD1?.effectSizeR, 3).padStart(8)}`);
  console.log(`  ${'D2 (acceleration)'.padEnd(22)}| ${fmtNum(mean(d2Values.winner)).padStart(10)} | ${fmtNum(mean(d2Values.trap)).padStart(10)} | ${fmtNum(mwD2?.p).padStart(8)} | ${fmtNum(mwD2?.effectSizeR, 3).padStart(8)}`);

  const d2Better = (mwD2?.effectSizeR ?? 0) > (mwD1?.effectSizeR ?? 0);
  console.log(`\n  D2 effect size ${d2Better ? '>' : '<'} D1 effect size: ${d2Better ? GREEN + 'D2 is more predictive' : YELLOW + 'D1 is more predictive'}${RESET}`);

  // 4D: Compare to CAGR threshold
  printSub('4D: CAGR vs D2 comparison');

  let highCAGRnegD2 = { winner: 0, trap: 0, underperform: 0 };
  let lowCAGRposD2 = { winner: 0, trap: 0, underperform: 0 };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!highCAGRnegD2[outcome] && outcome !== 'mixed') continue;

    const cagr = estimateCAGR(data.quarterlyMetrics);
    const deriv = revenueDerivatives(data.quarterlyMetrics);
    if (cagr == null || !deriv) continue;

    if (cagr >= 0.20 && deriv.avgD2 < 0) {
      if (highCAGRnegD2[outcome] != null) highCAGRnegD2[outcome]++;
    }
    if (cagr >= 0.08 && cagr < 0.20 && deriv.avgD2 > 0) {
      if (lowCAGRposD2[outcome] != null) lowCAGRposD2[outcome]++;
    }
  }

  const hTotal = highCAGRnegD2.winner + highCAGRnegD2.trap + highCAGRnegD2.underperform;
  const lTotal = lowCAGRposD2.winner + lowCAGRposD2.trap + lowCAGRposD2.underperform;
  console.log(`  CAGR ≥ 20% but D2 < 0 (decelerating): ${hTotal} cases`);
  console.log(`    Winners: ${highCAGRnegD2.winner}, Traps: ${highCAGRnegD2.trap}, Underperform: ${highCAGRnegD2.underperform}`);
  console.log(`  CAGR 8-20% but D2 > 0 (accelerating): ${lTotal} cases`);
  console.log(`    Winners: ${lowCAGRposD2.winner}, Traps: ${lowCAGRposD2.trap}, Underperform: ${lowCAGRposD2.underperform}`);

  const lowBetter = lTotal > 0 && hTotal > 0 &&
    (lowCAGRposD2.winner / lTotal) > (highCAGRnegD2.winner / hTotal);
  console.log(`\n  Low CAGR + positive D2 outperforms? ${lowBetter ? GREEN + 'YES' : RED + 'NO'}${RESET}`);

  const accelWinRate = (() => {
    const w = phaseByOutcome.winner.filter(p => p.phase === 'ACCELERATING').length;
    const total = phases.reduce((s, ph) => s + phaseByOutcome.winner.filter(p => p.phase === ph).length + phaseByOutcome.trap.filter(p => p.phase === ph).length + phaseByOutcome.underperform.filter(p => p.phase === ph).length, 0);
    const accelTotal = phaseByOutcome.winner.filter(p => p.phase === 'ACCELERATING').length + phaseByOutcome.trap.filter(p => p.phase === 'ACCELERATING').length + phaseByOutcome.underperform.filter(p => p.phase === 'ACCELERATING').length;
    return accelTotal > 0 ? w / accelTotal : 0;
  })();

  const pass = d2Better || accelWinRate > 0.5 || lowBetter;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { phaseByOutcome, d1Values, d2Values, mwD1, mwD2, highCAGRnegD2, lowCAGRposD2, d2Better, pass };
}

// ============================================
// TEST 5: ZIPF RANK DYNAMICS
// ============================================
function runTest5(cases, companyData) {
  printHeader('Test 5: Zipf Rank Dynamics');

  // Group cases by sector ETF, only use sectors with ≥ 15 companies
  const sectorGroups = groupBySectorETF(cases);
  const sectorCompanyData = {}; // etf → [{ ticker, quarterlyMetrics }]

  for (const [etf, sectorCases] of Object.entries(sectorGroups)) {
    const companies = [];
    for (const c of sectorCases) {
      const data = companyData[c.ticker];
      if (data) companies.push({ ticker: c.ticker, quarterlyMetrics: data.quarterlyMetrics });
    }
    if (companies.length >= 10) { // Use ≥10 for intra-calibration ranking
      sectorCompanyData[etf] = companies;
    }
  }

  // 5A: Sector Zipf distributions
  printSub('5A: Sector Zipf Distributions');

  const sectorZipfs = {};
  console.log(`  ${'Sector'.padEnd(24)}| ${'Companies'.padStart(10)} | ${'Zipf α'.padStart(8)} | ${'R²'.padStart(6)} | Interpretation`);
  console.log(`  ${''.padEnd(24)}|${'-'.repeat(12)}|${'-'.repeat(10)}|${'-'.repeat(8)}|${'-'.repeat(20)}`);

  for (const [etf, companies] of Object.entries(sectorCompanyData)) {
    // Use most recent year's revenues
    const revenues = [];
    for (const { ticker, quarterlyMetrics } of companies) {
      const recent = quarterlyMetrics.filter(q => q.revenue > 0).slice(-4);
      if (recent.length > 0) revenues.push(mean(recent.map(q => q.revenue)) * 4);
    }
    const z = zipfExponent(revenues);
    sectorZipfs[etf] = z;
    const interp = z ? (z.alpha > 1.5 ? 'concentrated' : z.alpha > 1.0 ? 'moderate' : 'fragmented') : 'N/A';
    console.log(`  ${pad(getSectorName(etf), 24, 'left')}| ${pad(companies.length, 10)} | ${(z ? fmtNum(z.alpha, 2) : 'N/A').padStart(8)} | ${(z ? fmtNum(z.r2, 2) : 'N/A').padStart(6)} | ${interp}`);
  }

  // 5B: Rank velocity
  printSub('5B: Rank Velocity vs Outcome');

  const velocities = { winner: [], trap: [], underperform: [] };
  const years = Array.from({ length: 10 }, (_, i) => 2015 + i); // 2015-2024

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!velocities[outcome]) continue;

    // Find this company's sector
    const etf = getSectorETF(c.sector);
    if (!sectorCompanyData[etf]) continue;

    const rankHistory = trackRankHistory(c.ticker, sectorCompanyData[etf], years);
    if (rankHistory.ranks.length < 3) continue;

    const rv = rankVelocity(rankHistory.ranks, rankHistory.years);
    if (!rv) continue;

    velocities[outcome].push({ ticker: c.ticker, etf, ...rv });
  }

  const vels = (group) => group.map(g => g.velocity);
  const climbs = (group) => group.map(g => g.ranksClimbed);

  console.log(`  Cases with rank data: ${velocities.winner.length + velocities.trap.length + velocities.underperform.length}`);
  console.log('');
  console.log(`  ${''.padEnd(28)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`  ${''.padEnd(28)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(12)}`);
  console.log(`  ${'Mean rank velocity (neg=up)'.padEnd(28)}| ${fmtNum(mean(vels(velocities.winner)), 2).padStart(10)} | ${fmtNum(mean(vels(velocities.trap)), 2).padStart(10)} | ${fmtNum(mean(vels(velocities.underperform)), 2).padStart(10)}`);
  console.log(`  ${'Mean ranks climbed'.padEnd(28)}| ${fmtNum(mean(climbs(velocities.winner)), 1).padStart(10)} | ${fmtNum(mean(climbs(velocities.trap)), 1).padStart(10)} | ${fmtNum(mean(climbs(velocities.underperform)), 1).padStart(10)}`);

  const pctClimb = (g) => g.length > 0 ? g.filter(v => v.velocity < 0).length / g.length : 0;
  console.log(`  ${'% climbing (velocity < 0)'.padEnd(28)}| ${fmtPct(pctClimb(velocities.winner)).padStart(10)} | ${fmtPct(pctClimb(velocities.trap)).padStart(10)} | ${fmtPct(pctClimb(velocities.underperform)).padStart(10)}`);

  const mw5 = mannWhitneyU(vels(velocities.winner), vels(velocities.trap));
  console.log(`\n  Mann-Whitney (velocity, winners vs traps): p = ${fmtNum(mw5?.p)}, r = ${fmtNum(mw5?.effectSizeR, 3)}`);

  // 5C: Effort-adjusted
  printSub('5C: Effort-Adjusted Velocity');
  const adjVels = { winner: [], trap: [] };
  for (const outcome of ['winner', 'trap']) {
    for (const v of velocities[outcome]) {
      const z = sectorZipfs[v.etf];
      if (z) {
        const adj = effortAdjustedVelocity(v, z.alpha);
        if (adj != null) adjVels[outcome].push(adj);
      }
    }
  }

  if (adjVels.winner.length > 0 || adjVels.trap.length > 0) {
    const mwAdj = mannWhitneyU(adjVels.winner, adjVels.trap);
    console.log(`  Mean effort-adjusted vel   | Winners: ${fmtNum(mean(adjVels.winner), 2)} | Traps: ${fmtNum(mean(adjVels.trap), 2)}`);
    console.log(`  Mann-Whitney: p = ${fmtNum(mwAdj?.p)}`);
  }

  const pass = mw5 && mw5.p < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { sectorZipfs, velocities, adjVels, mw: mw5, pass };
}

// ============================================
// SINGLE-TICKER DIAGNOSTIC
// ============================================
function runDiagnostic(ticker, companyData) {
  const data = companyData[ticker];
  if (!data) { console.log(`No data for ${ticker}`); return; }

  printHeader(`Non-Linear Diagnostic: ${ticker}`);
  const qm = data.quarterlyMetrics;
  console.log(`  Quarters: ${qm.length} | With revenue: ${qm.filter(q => q.revenue).length} | With assets: ${qm.filter(q => q.assets).length}`);
  console.log(`  Employees data: ${qm.filter(q => q.employees).length} quarters`);

  // Scaling exponent
  const beta = computeScalingExponent(qm);
  if (beta) {
    printSub('Metabolic Scaling');
    console.log(`  β (assets): ${fmtNum(beta.beta, 3)} (R²=${fmtNum(beta.r2, 3)}, n=${beta.n})`);
    console.log(`  Interpretation: ${beta.beta > 1.0 ? 'SUPERLINEAR — increasing returns' : beta.beta > 0.8 ? 'NEAR-LINEAR' : 'SUBLINEAR — diminishing returns'}`);
  }

  const traj = scalingTrajectory(qm);
  if (traj) {
    console.log(`  β early: ${fmtNum(traj.betaEarly, 3)} → β late: ${fmtNum(traj.betaLate, 3)} (Δ=${fmtNum(traj.betaChange, 3)})`);
    console.log(`  Trajectory: ${traj.trajectory}`);
  }

  // CSD
  const csd = companyCSD(qm);
  if (csd.hasData) {
    printSub('Critical Slowing Down');
    console.log(`  CSD index: ${fmtNum(csd.csdIndex, 3)} (${csd.csdIndex > 0.5 ? 'ELEVATED — transition signal' : 'normal'})`);
    for (const [metric, m] of Object.entries(csd.metrics)) {
      if (m) console.log(`    ${metric}: autocorr slope=${fmtNum(m.autocorrSlope, 4)}, var slope=${fmtNum(m.varianceSlope, 6)}`);
    }
  }

  // S-curve
  const deriv = revenueDerivatives(qm);
  if (deriv) {
    printSub('S-Curve Phase');
    console.log(`  Phase: ${BOLD}${deriv.phase}${RESET}`);
    console.log(`  Avg D1 (growth rate): ${fmtPct(deriv.avgD1)}`);
    console.log(`  Avg D2 (acceleration): ${fmtNum(deriv.avgD2)}`);
    console.log(`  D2 trend: ${fmtNum(deriv.d2Trend)} (${deriv.d2Trend > 0 ? 'accelerating faster' : 'decelerating'})`);
  }

  const cagr = estimateCAGR(qm);
  if (cagr != null) {
    console.log(`  Est. CAGR: ${fmtPct(cagr)}`);
  }

  // Revenue at entry (annualized)
  const annRev = getRevenueAtDate(data.facts, '2025-12-31');
  if (annRev) {
    console.log(`\n  Annualized revenue: $${(annRev / 1e9).toFixed(2)}B → Maturity band: ${maturityBand(annRev)}`);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('Non-Linear Dynamics Calibration Test Suite');
  console.log('='.repeat(50));

  const { cases, companyData } = await loadData();

  if (FETCH_ONLY) { console.log('\nFetch complete.'); return; }
  if (SINGLE_TICKER) { runDiagnostic(SINGLE_TICKER.toUpperCase(), companyData); return; }

  // Coverage
  const coverage = {
    total: cases.length,
    with8Q: 0, with12Q: 0, withEmployees: 0,
  };
  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const qm = data.quarterlyMetrics;
    if (qm.length >= 8) coverage.with8Q++;
    if (qm.length >= 12) coverage.with12Q++;
    if (qm.some(q => q.employees)) coverage.withEmployees++;
  }

  const allResults = { coverage };
  const shouldRun = (n) => !TEST_NUM || TEST_NUM === n;

  if (shouldRun(1)) { const r = runTest1(cases, companyData); allResults.test1 = r; allResults.test1Pass = r.pass; }
  if (shouldRun(2)) { const r = runTest2(cases, companyData); allResults.test2 = r; allResults.test2Pass = r.pass; }
  if (shouldRun(3)) { const r = runTest3(cases, companyData); allResults.test3 = r; allResults.test3Pass = r.pass; }
  if (shouldRun(4)) { const r = runTest4(cases, companyData); allResults.test4 = r; allResults.test4Pass = r.pass; }
  if (shouldRun(5)) { const r = runTest5(cases, companyData); allResults.test5 = r; allResults.test5Pass = r.pass; }

  // Summary
  printHeader('NON-LINEAR DYNAMICS CALIBRATION RESULTS');
  console.log(`  Data Coverage:`);
  console.log(`    Cases with 8+ quarters: ${coverage.with8Q} / ${coverage.total}`);
  console.log(`    Cases with 12+ quarters (CSD): ${coverage.with12Q} / ${coverage.total}`);
  console.log(`    Cases with employee data: ${coverage.withEmployees} / ${coverage.total}`);
  console.log('');

  const tests = [
    ['Test 1 — Metabolic Scaling', allResults.test1Pass],
    ['Test 2 — Benford Maturity Gradient', allResults.test2Pass],
    ['Test 3 — Critical Slowing Down', allResults.test3Pass],
    ['Test 4 — S-Curve Inflection', allResults.test4Pass],
    ['Test 5 — Zipf Rank Dynamics', allResults.test5Pass],
  ];

  for (const [name, result] of tests) {
    const status = result === true ? `${GREEN}PASS${RESET}` : result === false ? `${RED}FAIL${RESET}` : `${YELLOW}${result ?? 'NOT RUN'}${RESET}`;
    console.log(`  ${pad(name, 38, 'left')}: ${status}`);
  }

  // Save results (strip large data)
  const saveable = { ...allResults };
  for (const key of Object.keys(saveable)) {
    if (saveable[key]?.phaseByOutcome) delete saveable[key].phaseByOutcome;
    if (saveable[key]?.csdByOutcome) delete saveable[key].csdByOutcome;
  }

  const DATA_DIR = resolve(import.meta.dirname, '../data');
  const outPath = OUTPUT_PATH || resolve(DATA_DIR, `nonlinear-results-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(saveable, null, 2));
  console.log(`\n${DIM}Results saved to: ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
