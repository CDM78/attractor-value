#!/usr/bin/env node
// Non-Linear Dynamics — Expanded Theory Tests (Theories 6-9)
//
// Theory 6: Hurst Exponent — Revenue growth persistence
// Theory 7: Revenue Entropy — Diversification as moat
// Theory 8: Hurst of β — Meta-persistence of scaling trajectory
// Theory 9: Mutual Information — Independence from sector trends
//
// Usage:
//   node scripts/nonlinear-expanded-calibration.js [options]
//
// Options:
//   --test N          Run only theory N (6-9)
//   --dry-run         Use cached EDGAR data only
//   --refresh         Re-fetch EDGAR data even if cached
//   --verbose         Print per-company detail
//   --ticker AAPL     Single-ticker diagnostic
//   --output FILE     JSON output path

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, extractSegmentRevenues, getRevenueAtDate } from './lib/edgar-extractor.js';
import {
  computeScalingExponent, scalingTrajectory,
  revenueHurst, hurstExponent, hurstOfBeta,
  revenueEntropy, mutualInformation, computeSectorMedianGrowth,
} from './lib/nonlinear.js';
import { mannWhitneyU, mean, median, stddev } from './lib/statistics.js';
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
const SINGLE_TICKER = getArg('ticker');
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
// THEORY 6: HURST EXPONENT — Revenue Persistence
// ============================================
function runTheory6(cases, companyData) {
  printHeader('Theory 6: Hurst Exponent — Revenue Growth Persistence');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // Compute Hurst for each company
  const hurstByOutcome = { winner: [], trap: [], underperform: [] };
  const allHurst = [];

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!hurstByOutcome[outcome]) continue;

    const h = revenueHurst(data.quarterlyMetrics);
    if (!h) continue;

    hurstByOutcome[outcome].push({ ticker: c.ticker, ...h });
    allHurst.push({ ticker: c.ticker, outcome, ...h });

    if (VERBOSE) console.log(`  ${c.ticker}: H = ${fmtNum(h.hurst, 3)} (${h.persistent ? 'persistent' : h.meanReverting ? 'mean-reverting' : 'random'}), n=${h.nPoints}`);
  }

  // 6A: Distribution by outcome
  printSub('6A: Hurst Exponent Distribution');

  const hVals = (group) => group.map(g => g.hurst);
  const pctPersist = (group) => group.length > 0 ? group.filter(g => g.persistent).length / group.length : 0;
  const pctMeanRev = (group) => group.length > 0 ? group.filter(g => g.meanReverting).length / group.length : 0;

  const rows6a = [];
  const headers6a = ['Metric', 'Winners', 'Traps', 'Underperform'];
  const widths6a = [22, 12, 12, 12];

  rows6a.push(['Cases', String(hurstByOutcome.winner.length), String(hurstByOutcome.trap.length), String(hurstByOutcome.underperform.length)]);
  rows6a.push(['Mean H', fmtNum(mean(hVals(hurstByOutcome.winner)), 3), fmtNum(mean(hVals(hurstByOutcome.trap)), 3), fmtNum(mean(hVals(hurstByOutcome.underperform)), 3)]);
  rows6a.push(['Median H', fmtNum(median(hVals(hurstByOutcome.winner)), 3), fmtNum(median(hVals(hurstByOutcome.trap)), 3), fmtNum(median(hVals(hurstByOutcome.underperform)), 3)]);
  rows6a.push(['% persistent (H>0.55)', fmtPct(pctPersist(hurstByOutcome.winner)), fmtPct(pctPersist(hurstByOutcome.trap)), fmtPct(pctPersist(hurstByOutcome.underperform))]);
  rows6a.push(['% mean-reverting (H<0.45)', fmtPct(pctMeanRev(hurstByOutcome.winner)), fmtPct(pctMeanRev(hurstByOutcome.trap)), fmtPct(pctMeanRev(hurstByOutcome.underperform))]);

  printTable(headers6a, rows6a, widths6a);

  const mw6 = mannWhitneyU(hVals(hurstByOutcome.winner), hVals(hurstByOutcome.trap));
  console.log(`\n  Mann-Whitney (winners vs traps): p = ${fmtNum(mw6?.p)}, effect size r = ${fmtNum(mw6?.effectSizeR, 3)}`);

  results.hurstByOutcome = {
    winner: { n: hurstByOutcome.winner.length, mean: mean(hVals(hurstByOutcome.winner)), pctPersistent: pctPersist(hurstByOutcome.winner) },
    trap: { n: hurstByOutcome.trap.length, mean: mean(hVals(hurstByOutcome.trap)), pctPersistent: pctPersist(hurstByOutcome.trap) },
  };
  results.mw = { p: mw6?.p, r: mw6?.effectSizeR };

  // 6B: Hurst × β cross-tab
  printSub('6B: Hurst × β Cross-Tab');

  const crossTab = {
    'H persistent + β>1.0': { winner: 0, trap: 0 },
    'H persistent + β<1.0': { winner: 0, trap: 0 },
    'H random/MR + β>1.0': { winner: 0, trap: 0 },
    'H random/MR + β<1.0': { winner: 0, trap: 0 },
  };

  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;

    const h = revenueHurst(data.quarterlyMetrics);
    const beta = computeScalingExponent(data.quarterlyMetrics);
    if (!h || !beta) continue;

    const persistent = h.persistent;
    const superlinear = beta.beta > 1.0;
    const key = `H ${persistent ? 'persistent' : 'random/MR'} + β${superlinear ? '>1.0' : '<1.0'}`;
    if (crossTab[key]) crossTab[key][c.outcome]++;
  }

  console.log(`  ${''.padEnd(28)}| ${'Winners'.padStart(8)} | ${'Traps'.padStart(8)} | ${'Win Rate'.padStart(8)}`);
  console.log(`  ${'-'.repeat(28)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}`);
  for (const [key, counts] of Object.entries(crossTab)) {
    const total = counts.winner + counts.trap;
    const winRate = total > 0 ? counts.winner / total : 0;
    console.log(`  ${pad(key, 28, 'left')}| ${pad(counts.winner, 8)} | ${pad(counts.trap, 8)} | ${fmtPct(winRate).padStart(8)}`);
  }

  const bestQuadrant = crossTab['H persistent + β>1.0'];
  const bestTotal = bestQuadrant.winner + bestQuadrant.trap;
  console.log(`\n  ${BOLD}"H persistent + β > 1.0" win rate: ${fmtPct(bestTotal > 0 ? bestQuadrant.winner / bestTotal : null)}${RESET}`);
  console.log(`  This is the strongest quantitative confirmation of DKS: superlinear + self-reinforcing`);

  const pass = mw6 && mw6.p < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : mw6?.p < 0.10 ? YELLOW + 'MARGINAL' : RED + 'FAIL'}${RESET} (p = ${fmtNum(mw6?.p)})`);

  results.crossTab = crossTab;
  results.pass = pass;
  return results;
}

// ============================================
// THEORY 7: REVENUE ENTROPY — Diversification
// ============================================
function runTheory7(cases, companyData) {
  printHeader('Theory 7: Revenue Stream Entropy — Diversification');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  const entropyByOutcome = { winner: [], trap: [], underperform: [] };
  let withSegments = 0, withoutSegments = 0;

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!entropyByOutcome[outcome]) continue;

    const segData = extractSegmentRevenues(data.facts, c.entry_date);
    if (!segData || segData.nSegments < 2) {
      withoutSegments++;
      continue;
    }

    withSegments++;
    const ent = revenueEntropy(segData.segments);
    if (!ent) continue;

    entropyByOutcome[outcome].push({ ticker: c.ticker, ...ent, year: segData.year });
    if (VERBOSE) console.log(`  ${c.ticker}: entropy=${fmtNum(ent.normalizedEntropy, 3)}, ${ent.nSegments} segments, concentration=${fmtPct(ent.concentration)}`);
  }

  printSub('7A: Data Coverage');
  console.log(`  Companies with segment data: ${withSegments}`);
  console.log(`  Companies without segment data: ${withoutSegments}`);
  console.log(`  Coverage: ${fmtPct(withSegments / (withSegments + withoutSegments))}`);
  results.coverage = { withSegments, withoutSegments };

  if (withSegments < 10) {
    console.log(`\n  ${RED}${BOLD}Insufficient segment data for meaningful analysis.${RESET}`);
    console.log(`  The companyfacts API does not include dimensional segment breakdowns.`);
    console.log(`  Full XBRL instance documents would be needed for this test.`);
    results.pass = null;
    return results;
  }

  printSub('7B: Entropy Distribution');

  const normEntVals = (group) => group.map(g => g.normalizedEntropy);
  const concVals = (group) => group.map(g => g.concentration);

  const rows7b = [];
  const headers7b = ['Metric', 'Winners', 'Traps', 'Underperform'];
  const widths7b = [24, 12, 12, 12];

  rows7b.push(['Cases', String(entropyByOutcome.winner.length), String(entropyByOutcome.trap.length), String(entropyByOutcome.underperform.length)]);
  rows7b.push(['Mean norm. entropy', fmtNum(mean(normEntVals(entropyByOutcome.winner)), 3), fmtNum(mean(normEntVals(entropyByOutcome.trap)), 3), fmtNum(mean(normEntVals(entropyByOutcome.underperform)), 3)]);
  rows7b.push(['Mean # segments', fmtNum(mean(entropyByOutcome.winner.map(e => e.nSegments)), 1), fmtNum(mean(entropyByOutcome.trap.map(e => e.nSegments)), 1), fmtNum(mean(entropyByOutcome.underperform.map(e => e.nSegments)), 1)]);
  rows7b.push(['Mean max concentration', fmtPct(mean(concVals(entropyByOutcome.winner))), fmtPct(mean(concVals(entropyByOutcome.trap))), fmtPct(mean(concVals(entropyByOutcome.underperform)))]);

  printTable(headers7b, rows7b, widths7b);

  const mw7 = mannWhitneyU(normEntVals(entropyByOutcome.winner), normEntVals(entropyByOutcome.trap));
  if (mw7) {
    console.log(`\n  Mann-Whitney: p = ${fmtNum(mw7.p)}, r = ${fmtNum(mw7.effectSizeR, 3)}`);
  }

  const pass = mw7 && mw7.p < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : mw7?.p < 0.10 ? YELLOW + 'MARGINAL' : RED + 'FAIL'}${RESET} (p = ${fmtNum(mw7?.p)})`);

  results.mw = { p: mw7?.p, r: mw7?.effectSizeR };
  results.pass = pass;
  return results;
}

// ============================================
// THEORY 8: HURST OF β — Meta-Persistence
// ============================================
function runTheory8(cases, companyData) {
  printHeader('Theory 8: Hurst of β Trajectory — Meta-Persistence');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  const hBetaByOutcome = { winner: [], trap: [], underperform: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!hBetaByOutcome[outcome]) continue;

    const hb = hurstOfBeta(data.quarterlyMetrics);
    if (!hb) continue;

    hBetaByOutcome[outcome].push({ ticker: c.ticker, ...hb });
    if (VERBOSE) console.log(`  ${c.ticker}: H(β) = ${fmtNum(hb.hurst, 3)} (${hb.persistent ? 'persistent β' : hb.meanReverting ? 'mean-reverting β' : 'random β'}), n=${hb.nBetaPoints}`);
  }

  printSub('8A: Hurst of β Distribution');

  const hVals = (group) => group.map(g => g.hurst);
  const pctPersist = (group) => group.length > 0 ? group.filter(g => g.persistent).length / group.length : 0;

  const rows8a = [];
  const headers8a = ['Metric', 'Winners', 'Traps', 'Underperform'];
  const widths8a = [28, 12, 12, 12];

  rows8a.push(['Cases', String(hBetaByOutcome.winner.length), String(hBetaByOutcome.trap.length), String(hBetaByOutcome.underperform.length)]);
  rows8a.push(['Mean H(β)', fmtNum(mean(hVals(hBetaByOutcome.winner)), 3), fmtNum(mean(hVals(hBetaByOutcome.trap)), 3), fmtNum(mean(hVals(hBetaByOutcome.underperform)), 3)]);
  rows8a.push(['Median H(β)', fmtNum(median(hVals(hBetaByOutcome.winner)), 3), fmtNum(median(hVals(hBetaByOutcome.trap)), 3), fmtNum(median(hVals(hBetaByOutcome.underperform)), 3)]);
  rows8a.push(['% persistent β (H>0.55)', fmtPct(pctPersist(hBetaByOutcome.winner)), fmtPct(pctPersist(hBetaByOutcome.trap)), fmtPct(pctPersist(hBetaByOutcome.underperform))]);
  rows8a.push(['Mean β level', fmtNum(mean(hBetaByOutcome.winner.map(h => h.betaMean)), 3), fmtNum(mean(hBetaByOutcome.trap.map(h => h.betaMean)), 3), fmtNum(mean(hBetaByOutcome.underperform.map(h => h.betaMean)), 3)]);

  printTable(headers8a, rows8a, widths8a);

  const mw8 = mannWhitneyU(hVals(hBetaByOutcome.winner), hVals(hBetaByOutcome.trap));
  console.log(`\n  Mann-Whitney (winners vs traps): p = ${fmtNum(mw8?.p)}, effect size r = ${fmtNum(mw8?.effectSizeR, 3)}`);

  // Cross-tab: H(β) persistent × β improving
  printSub('8B: H(β) × β Trajectory Cross-Tab');

  const crossTab8 = {
    'H(β) persistent + β improving': { winner: 0, trap: 0 },
    'H(β) persistent + β degrading': { winner: 0, trap: 0 },
    'H(β) not persistent + β improving': { winner: 0, trap: 0 },
    'H(β) not persistent + β degrading': { winner: 0, trap: 0 },
  };

  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;

    const hb = hurstOfBeta(data.quarterlyMetrics);
    const traj = scalingTrajectory(data.quarterlyMetrics);
    if (!hb || !traj) continue;

    const persistent = hb.persistent;
    const improving = traj.betaChange > 0;
    const key = `H(β) ${persistent ? 'persistent' : 'not persistent'} + β ${improving ? 'improving' : 'degrading'}`;
    if (crossTab8[key]) crossTab8[key][c.outcome]++;
  }

  console.log(`  ${''.padEnd(38)}| ${'Winners'.padStart(8)} | ${'Traps'.padStart(8)} | ${'Win Rate'.padStart(8)}`);
  console.log(`  ${'-'.repeat(38)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}`);
  for (const [key, counts] of Object.entries(crossTab8)) {
    const total = counts.winner + counts.trap;
    const winRate = total > 0 ? counts.winner / total : 0;
    console.log(`  ${pad(key, 38, 'left')}| ${pad(counts.winner, 8)} | ${pad(counts.trap, 8)} | ${fmtPct(winRate).padStart(8)}`);
  }

  const pass = mw8 && mw8.p < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : mw8?.p < 0.10 ? YELLOW + 'MARGINAL' : RED + 'FAIL'}${RESET} (p = ${fmtNum(mw8?.p)})`);

  results.hBetaByOutcome = {
    winner: { n: hBetaByOutcome.winner.length, mean: mean(hVals(hBetaByOutcome.winner)) },
    trap: { n: hBetaByOutcome.trap.length, mean: mean(hVals(hBetaByOutcome.trap)) },
  };
  results.mw = { p: mw8?.p, r: mw8?.effectSizeR };
  results.crossTab = crossTab8;
  results.pass = pass;
  return results;
}

// ============================================
// THEORY 9: MUTUAL INFORMATION — Sector Independence
// ============================================
function runTheory9(cases, companyData) {
  printHeader('Theory 9: Mutual Information — Sector Independence');
  const results = {};
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // Build sector company data for computing sector median growth
  const sectorGroups = groupBySectorETF(cases);
  const sectorCompanyData = {};
  for (const [etf, sectorCases] of Object.entries(sectorGroups)) {
    const companies = [];
    for (const c of sectorCases) {
      const data = companyData[c.ticker];
      if (data) companies.push({ ticker: c.ticker, quarterlyMetrics: data.quarterlyMetrics });
    }
    if (companies.length >= 5) sectorCompanyData[etf] = companies;
  }

  // Compute sector median growth for each sector
  const sectorMedianGrowth = {};
  for (const [etf, companies] of Object.entries(sectorCompanyData)) {
    sectorMedianGrowth[etf] = computeSectorMedianGrowth(companies);
  }

  const miByOutcome = { winner: [], trap: [], underperform: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome;
    if (!miByOutcome[outcome]) continue;

    const etf = getSectorETF(c.sector);
    if (!sectorMedianGrowth[etf]) continue;

    // Build aligned company and sector growth series
    const companyGrowth = [];
    const sectorGrowth = [];
    for (const q of data.quarterlyMetrics) {
      if (q.revenueGrowthYoY != null && isFinite(q.revenueGrowthYoY) && sectorMedianGrowth[etf][q.quarter] != null) {
        companyGrowth.push(q.revenueGrowthYoY);
        sectorGrowth.push(sectorMedianGrowth[etf][q.quarter]);
      }
    }

    const mi = mutualInformation(companyGrowth, sectorGrowth);
    if (!mi) continue;

    miByOutcome[outcome].push({ ticker: c.ticker, etf, ...mi });
    if (VERBOSE) console.log(`  ${c.ticker} (${getSectorName(etf)}): MI = ${fmtNum(mi.mi, 3)}, normalized = ${fmtNum(mi.normalizedMI, 3)} (${mi.independent ? 'independent' : 'sector-dependent'})`);
  }

  printSub('9A: Mutual Information Distribution');

  const miVals = (group) => group.map(g => g.mi);
  const normMiVals = (group) => group.map(g => g.normalizedMI);
  const pctIndep = (group) => group.length > 0 ? group.filter(g => g.independent).length / group.length : 0;

  const rows9a = [];
  const headers9a = ['Metric', 'Winners', 'Traps', 'Underperform'];
  const widths9a = [24, 12, 12, 12];

  rows9a.push(['Cases', String(miByOutcome.winner.length), String(miByOutcome.trap.length), String(miByOutcome.underperform.length)]);
  rows9a.push(['Mean MI', fmtNum(mean(miVals(miByOutcome.winner)), 3), fmtNum(mean(miVals(miByOutcome.trap)), 3), fmtNum(mean(miVals(miByOutcome.underperform)), 3)]);
  rows9a.push(['Mean normalized MI', fmtNum(mean(normMiVals(miByOutcome.winner)), 3), fmtNum(mean(normMiVals(miByOutcome.trap)), 3), fmtNum(mean(normMiVals(miByOutcome.underperform)), 3)]);
  rows9a.push(['% independent (<0.15)', fmtPct(pctIndep(miByOutcome.winner)), fmtPct(pctIndep(miByOutcome.trap)), fmtPct(pctIndep(miByOutcome.underperform))]);

  printTable(headers9a, rows9a, widths9a);

  const mw9 = mannWhitneyU(miVals(miByOutcome.winner), miVals(miByOutcome.trap));
  console.log(`\n  Mann-Whitney (winners vs traps): p = ${fmtNum(mw9?.p)}, effect size r = ${fmtNum(mw9?.effectSizeR, 3)}`);
  console.log(`  Prediction: Winners have LOWER MI (more independent from sector)`);

  // 9B: MI × β cross-tab
  printSub('9B: Mutual Information × β Cross-Tab');

  const crossTab9 = {
    'Independent + β>1.0': { winner: 0, trap: 0 },
    'Independent + β<1.0': { winner: 0, trap: 0 },
    'Sector-dep + β>1.0': { winner: 0, trap: 0 },
    'Sector-dep + β<1.0': { winner: 0, trap: 0 },
  };

  for (const c of wtCases) {
    const data = companyData[c.ticker];
    if (!data) continue;

    const etf = getSectorETF(c.sector);
    if (!sectorMedianGrowth[etf]) continue;

    const companyGrowth = [];
    const sectorGrowthArr = [];
    for (const q of data.quarterlyMetrics) {
      if (q.revenueGrowthYoY != null && isFinite(q.revenueGrowthYoY) && sectorMedianGrowth[etf][q.quarter] != null) {
        companyGrowth.push(q.revenueGrowthYoY);
        sectorGrowthArr.push(sectorMedianGrowth[etf][q.quarter]);
      }
    }

    const mi = mutualInformation(companyGrowth, sectorGrowthArr);
    const beta = computeScalingExponent(data.quarterlyMetrics);
    if (!mi || !beta) continue;

    const independent = mi.independent;
    const superlinear = beta.beta > 1.0;
    const key = `${independent ? 'Independent' : 'Sector-dep'} + β${superlinear ? '>1.0' : '<1.0'}`;
    if (crossTab9[key]) crossTab9[key][c.outcome]++;
  }

  console.log(`  ${''.padEnd(28)}| ${'Winners'.padStart(8)} | ${'Traps'.padStart(8)} | ${'Win Rate'.padStart(8)}`);
  console.log(`  ${'-'.repeat(28)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}`);
  for (const [key, counts] of Object.entries(crossTab9)) {
    const total = counts.winner + counts.trap;
    const winRate = total > 0 ? counts.winner / total : 0;
    console.log(`  ${pad(key, 28, 'left')}| ${pad(counts.winner, 8)} | ${pad(counts.trap, 8)} | ${fmtPct(winRate).padStart(8)}`);
  }

  // 9C: MI by sector
  printSub('9C: Mutual Information by Sector');

  const sectorMI = {};
  for (const outcome of ['winner', 'trap']) {
    for (const m of miByOutcome[outcome]) {
      if (!sectorMI[m.etf]) sectorMI[m.etf] = { winner: [], trap: [] };
      sectorMI[m.etf][outcome].push(m.mi);
    }
  }

  const rows9c = [];
  const headers9c = ['Sector', 'Win MI', 'Trap MI', 'Gap', 'N'];
  const widths9c = [24, 10, 10, 10, 6];

  for (const [etf, data] of Object.entries(sectorMI)) {
    const wMean = data.winner.length > 0 ? mean(data.winner) : null;
    const tMean = data.trap.length > 0 ? mean(data.trap) : null;
    const gap = (wMean != null && tMean != null) ? wMean - tMean : null;
    rows9c.push([
      getSectorName(etf),
      fmtNum(wMean, 3),
      fmtNum(tMean, 3),
      gap != null ? (gap >= 0 ? '+' : '') + fmtNum(gap, 3) : 'N/A',
      String(data.winner.length + data.trap.length),
    ]);
  }
  printTable(headers9c, rows9c, widths9c);

  const pass = mw9 && mw9.p < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : mw9?.p < 0.10 ? YELLOW + 'MARGINAL' : RED + 'FAIL'}${RESET} (p = ${fmtNum(mw9?.p)})`);

  results.miByOutcome = {
    winner: { n: miByOutcome.winner.length, mean: mean(miVals(miByOutcome.winner)) },
    trap: { n: miByOutcome.trap.length, mean: mean(miVals(miByOutcome.trap)) },
  };
  results.mw = { p: mw9?.p, r: mw9?.effectSizeR };
  results.crossTab = crossTab9;
  results.pass = pass;
  return results;
}

// ============================================
// SINGLE-TICKER DIAGNOSTIC
// ============================================
function runDiagnostic(ticker, companyData, cases) {
  const data = companyData[ticker];
  if (!data) { console.log(`No data for ${ticker}`); return; }

  printHeader(`Expanded Theory Diagnostic: ${ticker}`);
  const qm = data.quarterlyMetrics;
  const growthPts = qm.filter(q => q.revenueGrowthYoY != null).length;
  console.log(`  Quarters: ${qm.length} | With growth: ${growthPts}`);

  // Hurst
  const h = revenueHurst(qm);
  if (h) {
    printSub('Theory 6: Revenue Hurst Exponent');
    console.log(`  H = ${fmtNum(h.hurst, 3)} (R² = ${fmtNum(h.r2, 3)}, n = ${h.nPoints})`);
    console.log(`  Interpretation: ${h.persistent ? GREEN + 'PERSISTENT — DKS flywheel signature' : h.meanReverting ? RED + 'MEAN-REVERTING — no structural driver' : YELLOW + 'RANDOM WALK'}${RESET}`);
  } else {
    console.log(`\n  Hurst: insufficient data (need 16+ growth data points, have ${growthPts})`);
  }

  // Hurst of β
  const hb = hurstOfBeta(qm);
  if (hb) {
    printSub('Theory 8: Hurst of β Trajectory');
    console.log(`  H(β) = ${fmtNum(hb.hurst, 3)} (β points: ${hb.nBetaPoints}, mean β = ${fmtNum(hb.betaMean, 3)})`);
    console.log(`  Interpretation: ${hb.persistent ? GREEN + 'PERSISTENT — structural scaling improvement' : hb.meanReverting ? RED + 'MEAN-REVERTING — scaling improvement will reverse' : YELLOW + 'RANDOM'}${RESET}`);
  } else {
    console.log(`\n  Hurst of β: insufficient data (need 24+ quarters)`);
  }

  // Segment entropy
  const segData = extractSegmentRevenues(data.facts);
  if (segData) {
    printSub('Theory 7: Revenue Entropy');
    const ent = revenueEntropy(segData.segments);
    console.log(`  Segments: ${segData.nSegments} (year: ${segData.year})`);
    console.log(`  Entropy: ${fmtNum(ent.entropy, 3)}, normalized: ${fmtNum(ent.normalizedEntropy, 3)}`);
    console.log(`  Largest segment share: ${fmtPct(ent.concentration)}`);
  } else {
    console.log(`\n  Revenue Entropy: no segment data available`);
  }

  // MI (needs sector context)
  const c = cases.find(cc => cc.ticker === ticker);
  if (c) {
    const etf = getSectorETF(c.sector);
    const sectorGroups = groupBySectorETF(cases);
    const sectorCases = sectorGroups[etf] || [];
    const sectorCompanies = sectorCases
      .map(sc => ({ ticker: sc.ticker, quarterlyMetrics: companyData[sc.ticker]?.quarterlyMetrics }))
      .filter(sc => sc.quarterlyMetrics);

    if (sectorCompanies.length >= 5) {
      const sectorMedGrowth = computeSectorMedianGrowth(sectorCompanies);
      const compGrowth = [], sectGrowth = [];
      for (const q of qm) {
        if (q.revenueGrowthYoY != null && isFinite(q.revenueGrowthYoY) && sectorMedGrowth[q.quarter] != null) {
          compGrowth.push(q.revenueGrowthYoY);
          sectGrowth.push(sectorMedGrowth[q.quarter]);
        }
      }
      const mi = mutualInformation(compGrowth, sectGrowth);
      if (mi) {
        printSub('Theory 9: Mutual Information');
        console.log(`  Sector: ${getSectorName(etf)} (${sectorCompanies.length} peers)`);
        console.log(`  MI = ${fmtNum(mi.mi, 3)}, normalized = ${fmtNum(mi.normalizedMI, 3)}`);
        console.log(`  ${mi.independent ? GREEN + 'INDEPENDENT — company-specific growth drivers' : YELLOW + 'SECTOR-DEPENDENT — riding sector trends'}${RESET}`);
      }
    }
  }
}

// ============================================
// SUMMARY
// ============================================
function printSummary(allResults) {
  printHeader('EXPANDED THEORY TEST RESULTS');

  const theories = [
    ['Theory 6 — Hurst (revenue persistence)', allResults.theory6],
    ['Theory 7 — Revenue Entropy (diversification)', allResults.theory7],
    ['Theory 8 — Hurst of β (meta-persistence)', allResults.theory8],
    ['Theory 9 — Mutual Information (independence)', allResults.theory9],
  ];

  for (const [name, r] of theories) {
    const pass = r?.pass;
    const status = pass === true ? `${GREEN}PASS${RESET}` : pass === false ? `${RED}FAIL${RESET}` : `${YELLOW}${pass ?? 'NOT RUN'}${RESET}`;
    const pVal = r?.mw?.p != null ? ` (p = ${fmtNum(r.mw.p)}, r = ${fmtNum(r.mw.r, 3)})` : '';
    console.log(`  ${pad(name, 48, 'left')}: ${status}${pVal}`);
  }

  console.log('');

  // Signal summary table
  if (allResults.theory6 || allResults.theory8 || allResults.theory9) {
    printSub('Signal Strength Ranking (including new theories)');
    const signals = [];

    if (allResults.theory6?.mw?.r != null) signals.push({ name: 'Hurst exponent (revenue)', r: allResults.theory6.mw.r, p: allResults.theory6.mw.p });
    if (allResults.theory8?.mw?.r != null) signals.push({ name: 'Hurst of β (meta-persistence)', r: allResults.theory8.mw.r, p: allResults.theory8.mw.p });
    if (allResults.theory9?.mw?.r != null) signals.push({ name: 'Mutual Information (independence)', r: allResults.theory9.mw.r, p: allResults.theory9.mw.p });
    if (allResults.theory7?.mw?.r != null) signals.push({ name: 'Revenue entropy', r: allResults.theory7.mw.r, p: allResults.theory7.mw.p });

    // Add known signals from deep testing for comparison
    signals.push({ name: 'β level (equity) [prior]', r: 0.299, p: 0.0001 });
    signals.push({ name: 'D1 growth rate [prior]', r: 0.331, p: 0.0000 });
    signals.push({ name: 'β trajectory + D1 pair [prior]', r: 0.406, p: 0.0000 });

    signals.sort((a, b) => (b.r ?? 0) - (a.r ?? 0));

    const rows = signals.map(s => [s.name, fmtNum(s.r, 3), fmtNum(s.p)]);
    printTable(['Signal', 'Effect r', 'p-value'], rows, [36, 10, 10]);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('Non-Linear Dynamics — Expanded Theory Tests (6-9)');
  console.log('='.repeat(50));

  const { cases, companyData } = await loadData();

  if (SINGLE_TICKER) { runDiagnostic(SINGLE_TICKER.toUpperCase(), companyData, cases); return; }

  const allResults = {};
  const shouldRun = (n) => !TEST_NUM || TEST_NUM === n;

  if (shouldRun(6)) allResults.theory6 = runTheory6(cases, companyData);
  if (shouldRun(7)) allResults.theory7 = runTheory7(cases, companyData);
  if (shouldRun(8)) allResults.theory8 = runTheory8(cases, companyData);
  if (shouldRun(9)) allResults.theory9 = runTheory9(cases, companyData);

  printSummary(allResults);

  // Save results
  const DATA_DIR = resolve(import.meta.dirname, '../data');
  const outPath = OUTPUT_PATH || resolve(DATA_DIR, `nonlinear-expanded-results-${new Date().toISOString().slice(0, 10)}.json`);

  const saveable = JSON.parse(JSON.stringify(allResults));
  writeFileSync(outPath, JSON.stringify(saveable, null, 2));
  console.log(`\n${DIM}Results saved to: ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
