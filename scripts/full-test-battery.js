#!/usr/bin/env node
// Full Test Battery — Tests 10-41 on 719-case expanded dataset
//
// Implements all tests from physics, info-theory, ecology, game-theory, and gap-analysis specs.
// Computes shared intermediates once, runs all tests, then Phase 9 cross-test integration.
//
// Usage:
//   node --max-old-space-size=4096 scripts/full-test-battery.js [options]
//
// Options:
//   --phase N     Run only phase N (0=data, 2-9)
//   --test N      Run only test N (10-41)
//   --dry-run     Use cached EDGAR data only
//   --limit N     Process only N tickers
//   --verbose     Print per-company detail
//   --output FILE JSON output path

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, getRevenueAtDate } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, scalingTrajectory, computeScalingExponentMinQ, betaVelocity,
  companyCSD, revenueDerivatives, revenueHurst, hurstExponent, hurstOfBeta,
  revenueEntropy, mutualInformation, computeSectorMedianGrowth, nonLinearCompositeScore,
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

const PHASE = getArg('phase') ? parseInt(getArg('phase')) : null;
const TEST_NUM = getArg('test') ? parseInt(getArg('test')) : null;
const DRY_RUN = hasFlag('dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const VERBOSE = hasFlag('verbose');
const OUTPUT_PATH = getArg('output');

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const fmtPct = (v, d = 1) => v == null ? 'N/A' : (v * 100).toFixed(d) + '%';
const pad = (s, w, a = 'right') => { s = String(s ?? 'N/A'); return a === 'left' ? s.padEnd(w) : s.padStart(w); };

function printHeader(title) { console.log(`\n${BOLD}${CYAN}${'='.repeat(60)}\n${title}\n${'='.repeat(60)}${RESET}`); }
function printSub(title) { console.log(`\n${BOLD}${title}${RESET}\n${DIM}${'-'.repeat(50)}${RESET}`); }

// ============================================
// PHASE 0: DATA LOADING & SHARED INTERMEDIATES
// ============================================
async function loadAndPrepare() {
  console.log(`${BOLD}Phase 0: Data Loading & Shared Intermediates${RESET}`);

  let cases = loadCalibrationCases();
  console.log(`  ${cases.length} cases, ${getUniqueTickers(cases).length} unique tickers`);

  await ensureCikCache();
  const tickers = getUniqueTickers(cases);
  const tickerLimit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;

  // Load EDGAR data — drop raw facts after extraction to save memory
  const companyData = {};
  let loaded = 0, failed = 0;

  for (let i = 0; i < tickerLimit; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) { failed++; continue; }

    const result = await fetchFactsForTicker(ticker);
    if (result.error || !result.facts) { failed++; continue; }

    const qm = extractQuarterlyMetrics(result.facts);
    if (qm.length < 4) { failed++; continue; }

    // Pre-compute Benford and revenue at dates
    const numbers = extractUsdNumbers(result.facts);
    const d1Benford = benfordFirstDigit(numbers);
    const casesForTicker = cases.filter(c => c.ticker === ticker);
    const revenueByDate = {};
    for (const c of casesForTicker) {
      const date = c.entry_date || '2025-12-31';
      revenueByDate[date] = getRevenueAtDate(result.facts, date);
    }
    revenueByDate['2025-12-31'] = getRevenueAtDate(result.facts, '2025-12-31');

    companyData[ticker] = { qm, benfordKLD: d1Benford?.kld ?? null, revenueByDate };
    loaded++;
    if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${tickerLimit}...\r`);
  }
  console.log(`\n  Loaded: ${loaded}, Failed: ${failed}`);

  // Compute shared intermediates for each case
  console.log('  Computing shared intermediates...');
  const caseData = [];
  const fieldCoverage = {};

  for (const c of cases) {
    const cd = companyData[c.ticker];
    if (!cd) continue;

    const qm = cd.qm;
    const si = computeSharedIntermediates(qm);
    si.ticker = c.ticker;
    si.outcome = c.outcome;
    si.tier = c.tier;
    si.pipeline = c.pipeline;
    si.entry_date = c.entry_date;
    si.sector = c.sector;
    si.benfordKLD = cd.benfordKLD;
    si.annualRevenue = cd.revenueByDate?.[c.entry_date] ?? cd.revenueByDate?.['2025-12-31'] ?? null;
    si.nQuarters = qm.length;

    // Track coverage
    for (const [field, val] of Object.entries(si)) {
      if (field === 'ticker' || field === 'outcome' || field === 'tier') continue;
      if (!fieldCoverage[field]) fieldCoverage[field] = { total: 0, nonNull: 0 };
      fieldCoverage[field].total++;
      if (val != null && val !== false && !(Array.isArray(val) && val.length === 0)) fieldCoverage[field].nonNull++;
    }

    caseData.push(si);
  }

  // Report coverage
  printSub('Data Availability Summary');
  console.log(`  Cases: ${caseData.length}`);
  const quarters = caseData.map(c => c.nQuarters);
  console.log(`  Quarters/case: mean ${mean(quarters).toFixed(0)}, median ${median(quarters).toFixed(0)}, min ${Math.min(...quarters)}, max ${Math.max(...quarters)}`);

  const keyFields = ['opMargin', 'roic', 'assetTurnover', 'revGrowthYoY', 'fcf', 'fcfMargin',
    'cashConversion', 'accrualRatio', 'capex', 'rAndD', 'sga', 'goodwill',
    'accountsReceivable', 'inventory', 'deferredRevenue', 'revPerSGA', 'investIntensity'];
  for (const f of keyFields) {
    const fc = fieldCoverage[f];
    if (fc) console.log(`    ${f.padEnd(22)}: ${fmtPct(fc.nonNull / fc.total)} (${fc.nonNull}/${fc.total})`);
  }

  return { cases: caseData, companyData };
}

function computeSharedIntermediates(qm) {
  const si = {};
  const n = qm.length;

  // Extract latest values for simple fields
  const latest = qm[n - 1] || {};
  si.revenue = latest.revenue;
  si.assets = latest.assets;

  // Time series (arrays)
  si.opMarginSeries = qm.map(q => q.operatingMargin).filter(v => v != null);
  si.revGrowthSeries = qm.map(q => q.revenueGrowthYoY).filter(v => v != null && isFinite(v));
  si.revenueSeries = qm.map(q => q.revenue).filter(v => v != null && v > 0);

  // ROIC: OperatingIncome * 0.79 / (Equity + LongTermDebt)
  const roicSeries = [];
  for (const q of qm) {
    if (q.operatingIncome != null && q.equity > 0) {
      const cap = (q.equity || 0) + (q.longTermDebt || 0);
      if (cap > 0) roicSeries.push(q.operatingIncome * 0.79 / cap);
      else roicSeries.push(null);
    } else roicSeries.push(null);
  }
  si.roicSeries = roicSeries.filter(v => v != null && isFinite(v));

  // Asset turnover
  const atSeries = qm.map(q => (q.revenue > 0 && q.assets > 0) ? q.revenue / q.assets : null);
  si.assetTurnoverSeries = atSeries.filter(v => v != null);

  // Scalar values (latest or computed)
  si.opMargin = si.opMarginSeries.length > 0 ? si.opMarginSeries[si.opMarginSeries.length - 1] : null;
  si.roic = si.roicSeries.length > 0 ? si.roicSeries[si.roicSeries.length - 1] : null;
  si.assetTurnover = si.assetTurnoverSeries.length > 0 ? si.assetTurnoverSeries[si.assetTurnoverSeries.length - 1] : null;
  si.revGrowthYoY = si.revGrowthSeries.length > 0 ? si.revGrowthSeries[si.revGrowthSeries.length - 1] : null;

  // FCF
  const fcfSeries = qm.map(q => (q.ocf != null && q.capex != null) ? q.ocf - q.capex : null);
  si.fcfSeries = fcfSeries.filter(v => v != null);
  si.fcf = si.fcfSeries.length > 0 ? si.fcfSeries[si.fcfSeries.length - 1] : null;
  si.fcfMarginSeries = qm.map(q => {
    const fcf = (q.ocf != null && q.capex != null) ? q.ocf - q.capex : null;
    return (fcf != null && q.revenue > 0) ? fcf / q.revenue : null;
  }).filter(v => v != null);
  si.fcfMargin = si.fcfMarginSeries.length > 0 ? si.fcfMarginSeries[si.fcfMarginSeries.length - 1] : null;

  // Cash conversion
  const ccSeries = qm.map(q => (q.ocf != null && q.netIncome != null && Math.abs(q.netIncome) > 1000) ? q.ocf / q.netIncome : null);
  si.cashConversionSeries = ccSeries.filter(v => v != null && isFinite(v) && Math.abs(v) < 100);
  si.cashConversion = si.cashConversionSeries.length > 0 ? si.cashConversionSeries[si.cashConversionSeries.length - 1] : null;

  // Accrual ratio
  const accrualSeries = qm.map(q => (q.netIncome != null && q.ocf != null && q.assets > 0) ? (q.netIncome - q.ocf) / q.assets : null);
  si.accrualRatioSeries = accrualSeries.filter(v => v != null && isFinite(v));
  si.accrualRatio = si.accrualRatioSeries.length > 0 ? si.accrualRatioSeries[si.accrualRatioSeries.length - 1] : null;

  // New fields
  si.capex = latest.capex ?? null;
  si.rAndD = latest.rAndD ?? null;
  si.sga = latest.sga ?? null;
  si.goodwill = latest.goodwill ?? null;
  si.accountsReceivable = latest.accountsReceivable ?? null;
  si.inventory = latest.inventory ?? null;
  si.deferredRevenue = latest.deferredRevenue ?? null;

  // Revenue per SGA
  si.revPerSGA = (latest.revenue > 0 && latest.sga > 0) ? latest.revenue / latest.sga : null;

  // Investment intensity
  const investNum = (latest.capex || 0) + (latest.rAndD || 0);
  si.investIntensity = (investNum > 0 && latest.revenue > 0) ? investNum / latest.revenue : null;

  // QoQ changes for revenue and OpEx
  si.revQoQChanges = [];
  si.opexQoQChanges = [];
  si.marginQoQChanges = [];
  si.roicQoQChanges = [];
  si.atQoQChanges = [];

  for (let i = 1; i < qm.length; i++) {
    if (qm[i].revenue > 0 && qm[i-1].revenue > 0) {
      si.revQoQChanges.push((qm[i].revenue - qm[i-1].revenue) / Math.abs(qm[i-1].revenue));
    }
    const opex_i = (qm[i].costOfRevenue || 0) + (qm[i].sga || 0);
    const opex_prev = (qm[i-1].costOfRevenue || 0) + (qm[i-1].sga || 0);
    if (opex_i > 0 && opex_prev > 0) {
      si.opexQoQChanges.push((opex_i - opex_prev) / Math.abs(opex_prev));
    }
    if (qm[i].operatingMargin != null && qm[i-1].operatingMargin != null) {
      si.marginQoQChanges.push(qm[i].operatingMargin - qm[i-1].operatingMargin);
    }
    const roic_i = roicSeries[i], roic_prev = roicSeries[i-1];
    if (roic_i != null && roic_prev != null) {
      si.roicQoQChanges.push(roic_i - roic_prev);
    }
    const at_i = atSeries[i], at_prev = atSeries[i-1];
    if (at_i != null && at_prev != null) {
      si.atQoQChanges.push(at_i - at_prev);
    }
  }

  // State vectors for phase-space tests
  si.stateVectors = [];
  for (let i = 0; i < qm.length; i++) {
    const m = qm[i].operatingMargin;
    const g = qm[i].revenueGrowthYoY;
    const r = roicSeries[i];
    const a = atSeries[i];
    if (m != null && g != null && isFinite(g) && r != null && a != null) {
      si.stateVectors.push([m, g, r, a]);
    }
  }

  // SGA series for marketing efficiency
  si.revPerSGASeries = qm.map(q => (q.revenue > 0 && q.sga > 0) ? q.revenue / q.sga : null).filter(v => v != null);

  // Gross margin series
  si.grossMarginSeries = qm.map(q => q.grossMargin).filter(v => v != null);

  return si;
}

// ============================================
// TEST RUNNER FRAMEWORK
// ============================================
function runTest(testNum, name, cases, testFn) {
  if (TEST_NUM && TEST_NUM !== testNum) return null;
  printHeader(`Test ${testNum}: ${name}`);

  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  const result = testFn(wtCases, cases);

  // 5-fold cross-validation for any signal with p < 0.05
  if (result?.primarySignal && result.primaryP < 0.05) {
    printSub(`Cross-Validation (5-fold)`);
    const cv = crossValidateSignal(wtCases, result.primarySignal, result.primaryKey);
    result.crossValidation = cv;
    const sigFolds = cv.folds.filter(f => f.testP < 0.05).length;
    console.log(`  ${sigFolds}/5 folds significant → ${sigFolds >= 4 ? GREEN + 'ROBUST' : sigFolds >= 3 ? YELLOW + 'MODERATE' : RED + 'WEAK'}${RESET}`);
    result.robust = sigFolds >= 4;
  }

  // Zipf interaction cross-tab (per addendum)
  if (result?.primarySignal) {
    // Will be computed in Phase 9 integration
  }

  return result;
}

function crossValidateSignal(wtCases, signalFn, signalKey) {
  const items = wtCases.filter(c => signalFn(c) != null).map(c => ({ outcome: c.outcome, val: signalFn(c) }));
  if (items.length < 20) return { folds: [], insufficient: true };

  const folds = kFoldSplit(items, 5, 42);
  const foldResults = [];

  for (let f = 0; f < folds.length; f++) {
    const { train, test } = folds[f];
    const trainWin = train.filter(i => items[i].outcome === 'winner').map(i => items[i].val);
    const trainTrap = train.filter(i => items[i].outcome === 'trap').map(i => items[i].val);
    const testWin = test.filter(i => items[i].outcome === 'winner').map(i => items[i].val);
    const testTrap = test.filter(i => items[i].outcome === 'trap').map(i => items[i].val);

    const trainMW = mannWhitneyU(trainWin, trainTrap);
    const testMW = mannWhitneyU(testWin, testTrap);
    foldResults.push({ trainP: trainMW?.p, testP: testMW?.p, testR: testMW?.effectSizeR });
  }

  return { folds: foldResults, meanTestP: mean(foldResults.map(f => f.testP).filter(p => p != null)) };
}

function mwTest(cases, signalFn, label) {
  const winners = cases.filter(c => c.outcome === 'winner' && signalFn(c) != null).map(c => signalFn(c));
  const traps = cases.filter(c => c.outcome === 'trap' && signalFn(c) != null).map(c => signalFn(c));
  const mw = (winners.length >= 2 && traps.length >= 2) ? mannWhitneyU(winners, traps) : null;
  const n = winners.length + traps.length;

  if (label) {
    const dir = mean(winners) > mean(traps) ? 'winners higher' : 'winners lower';
    console.log(`  ${pad(label, 30, 'left')}: p=${fmtNum(mw?.p)}, r=${fmtNum(mw?.effectSizeR, 3)}, N=${n} (${dir})`);
    console.log(`    Winners: mean=${fmtNum(mean(winners), 3)}, Traps: mean=${fmtNum(mean(traps), 3)}`);
  }

  return { p: mw?.p, r: mw?.effectSizeR, n, winMean: mean(winners), trapMean: mean(traps), nWin: winners.length, nTrap: traps.length };
}

// ============================================
// PHASE 2: FOUNDATION TESTS (30, 31, 32, 39, 40)
// ============================================

function test30_revenueExpenseCoupling(wtCases) {
  // Revenue-expense coupling gain and asymmetry
  const results = [];
  for (const c of wtCases) {
    if (c.revQoQChanges.length < 8 || c.opexQoQChanges.length < 8) continue;
    const n = Math.min(c.revQoQChanges.length, c.opexQoQChanges.length);
    const revCh = c.revQoQChanges.slice(-n);
    const opexCh = c.opexQoQChanges.slice(-n);

    const reg = linearRegression(revCh, opexCh);
    if (!reg) continue;

    // Asymmetry: split into up and down quarters
    const upRev = [], upOpex = [], downRev = [], downOpex = [];
    for (let i = 0; i < n; i++) {
      if (revCh[i] > 0) { upRev.push(revCh[i]); upOpex.push(opexCh[i]); }
      else { downRev.push(revCh[i]); downOpex.push(opexCh[i]); }
    }

    const upGain = upRev.length >= 3 ? (linearRegression(upRev, upOpex)?.slope ?? null) : null;
    const downGain = downRev.length >= 3 ? (linearRegression(downRev, downOpex)?.slope ?? null) : null;
    const asymmetry = (upGain != null && downGain != null) ? upGain - downGain : null;

    results.push({
      ...c,
      couplingGain: reg.slope,
      couplingR2: reg.r2,
      couplingCorr: spearmanCorrelation(revCh, opexCh)?.rho ?? null,
      upGain, downGain, asymmetry,
      ratchet: asymmetry != null && asymmetry > 0.3,
      antiRatchet: asymmetry != null && asymmetry < -0.3,
    });
  }

  printSub('30B: Coverage');
  console.log(`  Cases with coupling data: ${results.length}`);

  const r1 = mwTest(results, c => c.couplingGain, '30C: Coupling gain');
  const r2 = mwTest(results, c => c.asymmetry, '30C: Asymmetry index');

  // 30D: Ratchet pattern
  const ratchet = results.filter(c => c.ratchet);
  const antiRatchet = results.filter(c => c.antiRatchet);
  const symmetric = results.filter(c => !c.ratchet && !c.antiRatchet && c.asymmetry != null);
  console.log(`\n  Ratchet: ${ratchet.length}, Anti-ratchet: ${antiRatchet.length}, Symmetric: ${symmetric.length}`);
  for (const [label, group] of [['Anti-ratchet', antiRatchet], ['Symmetric', symmetric], ['Ratchet', ratchet]]) {
    const w = group.filter(c => c.outcome === 'winner').length;
    const t = group.filter(c => c.outcome === 'trap').length;
    console.log(`    ${label.padEnd(15)}: ${w} win / ${t} trap → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)}`);
  }

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1);
  const bestR = Math.max(r1.r ?? 0, r2.r ?? 0);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (best p=${fmtNum(bestP)}, r=${fmtNum(bestR, 3)})`);

  return { couplingGain: r1, asymmetry: r2, pass, primaryP: bestP, primarySignal: bestR === r1.r ? (c => c.couplingGain) : (c => c.asymmetry), primaryKey: bestR === r1.r ? 'couplingGain' : 'asymmetry', n: results.length, results };
}

function test31_growthQuality(wtCases) {
  const results = [];
  for (const c of wtCases) {
    const rs = c.revenueSeries;
    if (rs.length < 8) continue;

    const recent = rs.slice(-4);
    const earlier = rs.slice(-8, -4);
    const recentRev = mean(recent);
    const earlierRev = mean(earlier);
    if (earlierRev <= 0) continue;

    const revGrowth = (recentRev - earlierRev) / earlierRev;

    // Need assets for quality ratio — use from state vectors or raw
    // Approximate: use assetTurnover change
    const recentAT = c.assetTurnoverSeries.length >= 4 ? mean(c.assetTurnoverSeries.slice(-4)) : null;
    const earlierAT = c.assetTurnoverSeries.length >= 8 ? mean(c.assetTurnoverSeries.slice(-8, -4)) : null;

    // Growth quality: revenue growth / asset growth proxy
    // If AT is rising, revenue is growing faster than assets (organic)
    const atChange = (recentAT != null && earlierAT != null && earlierAT > 0) ? (recentAT - earlierAT) / earlierAT : null;

    // Gross margin change
    const gm = c.grossMarginSeries;
    const gmChange = gm.length >= 8 ? mean(gm.slice(-4)) - mean(gm.slice(-8, -4)) : null;

    // Pricing power: revenue growth - COGS growth proxy (if gross margin improving, pricing power exists)
    const pricingPower = gmChange != null ? gmChange : null;

    results.push({
      ...c,
      revGrowth,
      atChange,
      gmChange,
      pricingPower,
      qualityRatio: atChange != null ? (1 + revGrowth) / (1 + (revGrowth - atChange)) : null,
    });
  }

  printSub('31A: Coverage');
  console.log(`  Cases with growth quality data: ${results.length}`);

  const r1 = mwTest(results, c => c.revGrowth, '31B: Revenue growth');
  const r2 = mwTest(results, c => c.gmChange, '31B: Gross margin change');
  const r3 = mwTest(results, c => c.pricingPower, '31B: Pricing power');
  const r4 = mwTest(results, c => c.atChange, '31B: Asset turnover change');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1, r4.p ?? 1);
  const bestR = Math.max(r1.r ?? 0, r2.r ?? 0, r3.r ?? 0, r4.r ?? 0);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (best p=${fmtNum(bestP)}, r=${fmtNum(bestR, 3)})`);

  return { revGrowth: r1, gmChange: r2, pricingPower: r3, atChange: r4, pass, primaryP: bestP, n: results.length };
}

function test32_accrualDynamics(wtCases) {
  const results = [];
  for (const c of wtCases) {
    const cc = c.cashConversionSeries;
    if (cc.length < 6) continue;

    const slope = linearRegression(cc.map((_, i) => i), cc)?.slope ?? null;
    const accrualSlope = c.accrualRatioSeries.length >= 6 ? linearRegression(c.accrualRatioSeries.map((_, i) => i), c.accrualRatioSeries)?.slope ?? null : null;

    results.push({
      ...c,
      conversionSlope: slope,
      accrualSlope,
      recentConversion: cc.length >= 4 ? mean(cc.slice(-4)) : null,
      deteriorating: slope != null && slope < -0.02,
      improving: slope != null && slope > 0.02,
    });
  }

  printSub('32A: Coverage');
  console.log(`  Cases with accrual data: ${results.length}`);

  const r1 = mwTest(results, c => c.conversionSlope, '32C: Conversion slope');
  const r2 = mwTest(results, c => c.accrualSlope, '32C: Accrual slope');

  // 32E: Accrual × Benford cross-tab
  printSub('32E: Accrual × Benford');
  const cross = { 'Improving + Benford ok': { w: 0, t: 0 }, 'Improving + Benford bad': { w: 0, t: 0 },
                  'Deteriorating + Benford ok': { w: 0, t: 0 }, 'Deteriorating + Benford bad': { w: 0, t: 0 } };
  for (const c of results) {
    if (c.conversionSlope == null || c.benfordKLD == null) continue;
    const improving = c.conversionSlope > 0;
    const benfordOk = c.benfordKLD < 0.003;
    const key = `${improving ? 'Improving' : 'Deteriorating'} + Benford ${benfordOk ? 'ok' : 'bad'}`;
    if (cross[key]) cross[key][c.outcome === 'winner' ? 'w' : 't']++;
  }
  for (const [k, v] of Object.entries(cross)) {
    const wr = v.w + v.t > 0 ? v.w / (v.w + v.t) : null;
    console.log(`    ${k.padEnd(35)}: ${v.w}W / ${v.t}T → WR ${fmtPct(wr)}`);
  }

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1);
  const bestR = Math.max(r1.r ?? 0, r2.r ?? 0);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (best p=${fmtNum(bestP)})`);

  return { conversionSlope: r1, accrualSlope: r2, pass, primaryP: bestP, primarySignal: c => results.find(r => r.ticker === c.ticker)?.conversionSlope, n: results.length };
}

function test39_marketingEfficiency(wtCases) {
  const results = [];
  for (const c of wtCases) {
    const series = c.revPerSGASeries;
    if (series.length < 8) continue;

    const reg = linearRegression(series.map((_, i) => i), series);
    if (!reg) continue;

    results.push({
      ...c,
      efficiencySlope: reg.slope,
      efficiencyR2: reg.r2,
      networkCandidate: reg.slope > 0 && reg.r2 > 0.3,
      recentEff: series.length >= 4 ? mean(series.slice(-4)) : null,
      earlierEff: series.length >= 8 ? mean(series.slice(0, 4)) : null,
    });
  }

  printSub('39A: Coverage');
  console.log(`  Cases with SGA data: ${results.length}`);

  const r1 = mwTest(results, c => c.efficiencySlope, '39B: Efficiency slope');

  const nwCandidates = results.filter(c => c.networkCandidate);
  const nwWin = nwCandidates.filter(c => c.outcome === 'winner').length;
  const nwTrap = nwCandidates.filter(c => c.outcome === 'trap').length;
  console.log(`  Network effect candidates: ${nwCandidates.length} (${nwWin}W/${nwTrap}T → WR ${fmtPct(nwCandidates.length > 0 ? nwWin / nwCandidates.length : null)})`);

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (p=${fmtNum(r1.p)})`);

  return { slope: r1, pass, primaryP: r1.p, primarySignal: c => results.find(r => r.ticker === c.ticker)?.efficiencySlope, n: results.length };
}

function test40_structuralBreaks(wtCases) {
  const results = [];
  for (const c of wtCases) {
    const metrics = { revGrowth: c.revGrowthSeries, margin: c.opMarginSeries, roic: c.roicSeries, at: c.assetTurnoverSeries };
    let totalPos = 0, totalNeg = 0, totalBreaks = 0;

    for (const [name, series] of Object.entries(metrics)) {
      if (series.length < 8) continue;
      const breaks = detectCUSUMBreaks(series);
      totalPos += breaks.positive;
      totalNeg += breaks.negative;
      totalBreaks += breaks.total;
    }

    if (totalBreaks === 0) continue;

    results.push({
      ...c,
      breakRatio: totalBreaks > 0 ? totalPos / totalBreaks : 0.5,
      positiveBreaks: totalPos,
      negativeBreaks: totalNeg,
      totalBreaks,
      netBreakMagnitude: totalPos - totalNeg,
    });
  }

  printSub('40A: Coverage');
  console.log(`  Cases with structural breaks: ${results.length}`);

  const r1 = mwTest(results, c => c.breakRatio, '40B: Break ratio');
  const r2 = mwTest(results, c => c.netBreakMagnitude, '40B: Net break magnitude');

  const pass = Math.min(r1.p ?? 1, r2.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { breakRatio: r1, netMag: r2, pass, primaryP: Math.min(r1.p ?? 1, r2.p ?? 1), primarySignal: c => results.find(r => r.ticker === c.ticker)?.breakRatio, n: results.length };
}

function detectCUSUMBreaks(series, threshold = 1.5) {
  const m = mean(series);
  const s = stddev(series) || 0.001;
  const n = series.length;
  const critVal = threshold * s * Math.sqrt(n);

  let cumSum = 0;
  let positive = 0, negative = 0;
  let prevCumSum = 0;

  for (let i = 0; i < n; i++) {
    cumSum += (series[i] - m);
    if (Math.abs(cumSum) > critVal && Math.sign(cumSum) !== Math.sign(prevCumSum) && i > 0) {
      if (cumSum > 0) positive++;
      else negative++;
    }
    prevCumSum = cumSum;
  }

  return { positive, negative, total: positive + negative };
}

// ============================================
// PHASE 3: TIME SERIES DYNAMICS (26, 35, 12, 23, 38, 41)
// ============================================

function test26_fractureMechanics(wtCases) {
  const allStressEvents = [];
  const results = [];

  for (const c of wtCases) {
    const series = c.opMarginSeries;
    if (series.length < 12) continue;

    const events = identifyStressEvents(series, 0.02);
    if (events.length === 0) { results.push({ ...c, elastic: null, noEvents: true }); continue; }

    let elastic = 0, plastic = 0, partial = 0;
    for (const e of events) {
      if (e.recovered && e.recoveryFraction >= 0.99) elastic++;
      else if (!e.recovered || e.recoveryFraction < 0.5) plastic++;
      else partial++;
    }

    const elasticFrac = events.length > 0 ? elastic / events.length : null;
    const plasticFrac = events.length > 0 ? plastic / events.length : null;

    // Fatigue: minor stresses (0.005-0.02 magnitude)
    const minorEvents = identifyStressEvents(series, 0.005).filter(e => e.magnitude < 0.02);
    const fatigueFreq = series.length > 0 ? minorEvents.length / series.length : 0;

    results.push({
      ...c,
      elasticFrac, plasticFrac, partialFrac: partial / events.length,
      nEvents: events.length, fatigueFreq,
      toughness: events.reduce((s, e) => s + e.magnitude * (e.recoveryFraction || 0), 0),
      events, noEvents: false,
    });

    allStressEvents.push({ ticker: c.ticker, outcome: c.outcome, events });
  }

  printSub('26A: Coverage');
  const withEvents = results.filter(c => !c.noEvents);
  console.log(`  Cases with stress events: ${withEvents.length} / ${results.length}`);

  const r1 = mwTest(withEvents, c => c.elasticFrac, '26B: Elastic fraction');
  const r2 = mwTest(withEvents, c => c.fatigueFreq, '26D: Fatigue frequency');
  const r3 = mwTest(withEvents, c => c.toughness, '26E: Toughness');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (best p=${fmtNum(bestP)})`);

  return { elasticFrac: r1, fatigue: r2, toughness: r3, pass, primaryP: bestP,
    primarySignal: c => withEvents.find(r => r.ticker === c.ticker)?.elasticFrac,
    stressEvents: allStressEvents, n: withEvents.length };
}

function identifyStressEvents(series, threshold = 0.02) {
  const events = [];
  for (let i = 4; i < series.length; i++) {
    const baseline = mean(series.slice(Math.max(0, i - 4), i));
    const drop = baseline - series[i];
    if (drop > threshold) {
      // Check recovery within 8 quarters
      let recovered = false;
      let recoveryQ = null;
      let bestRecovery = 0;
      for (let j = i + 1; j < Math.min(i + 9, series.length); j++) {
        const recovery = (series[j] - series[i]) / drop;
        bestRecovery = Math.max(bestRecovery, recovery);
        if (series[j] >= baseline - 0.01) { recovered = true; recoveryQ = j - i; break; }
      }
      events.push({ index: i, magnitude: drop, baseline, recovered, recoveryQ, recoveryFraction: bestRecovery });
    }
  }
  return events;
}

function test35_antifragility(wtCases, stressEvents) {
  const results = [];

  for (const c of wtCases) {
    const se = stressEvents?.find(e => e.ticker === c.ticker);
    if (!se || se.events.length === 0) continue;

    const series = c.opMarginSeries;
    let antifragile = 0, resilient = 0, fragile = 0;

    for (const e of se.events) {
      if (e.index + 4 >= series.length) continue;
      const preBaseline = e.baseline;
      const postBaseline = mean(series.slice(e.index + 1, Math.min(e.index + 5, series.length)));

      if (postBaseline > preBaseline + 0.01) antifragile++;
      else if (postBaseline < preBaseline - 0.01) fragile++;
      else resilient++;
    }

    const total = antifragile + resilient + fragile;
    if (total === 0) continue;

    results.push({
      ...c,
      antifragileFrac: antifragile / total,
      fragileFrac: fragile / total,
      resilientFrac: resilient / total,
      meanImprovement: 0, // simplified
    });
  }

  printSub('35A: Coverage');
  console.log(`  Cases with antifragility data: ${results.length}`);

  const r1 = mwTest(results, c => c.antifragileFrac, '35B: Antifragile fraction');
  const r2 = mwTest(results, c => c.fragileFrac, '35B: Fragile fraction');

  const pass = Math.min(r1.p ?? 1, r2.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { antifragile: r1, fragile: r2, pass, primaryP: Math.min(r1.p ?? 1, r2.p ?? 1), n: results.length };
}

function test12_relaxationTime(wtCases, stressEvents) {
  const results = [];

  for (const c of wtCases) {
    const se = stressEvents?.find(e => e.ticker === c.ticker);
    if (!se || se.events.length === 0) continue;

    const recoveredEvents = se.events.filter(e => e.recovered);
    const meanTau = recoveredEvents.length > 0 ? mean(recoveredEvents.map(e => e.recoveryQ)) : null;
    const recoveryRate = se.events.length > 0 ? recoveredEvents.length / se.events.length : null;
    const neverRecoveredRate = se.events.length > 0 ? se.events.filter(e => !e.recovered).length / se.events.length : null;

    results.push({ ...c, meanTau, recoveryRate, neverRecoveredRate, nEvents: se.events.length });
  }

  printSub('12A: Coverage');
  console.log(`  Cases with relaxation data: ${results.length}`);

  const r1 = mwTest(results, c => c.meanTau, '12B: Mean relaxation time');
  const r2 = mwTest(results, c => c.recoveryRate, '12B: Recovery rate');
  const r3 = mwTest(results, c => c.neverRecoveredRate, '12C: Never-recovered rate');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { tau: r1, recoveryRate: r2, neverRecovered: r3, pass, primaryP: bestP, n: results.length };
}

function test23_ouProcess(wtCases) {
  const results = [];
  const metrics = [
    { name: 'opMargin', key: 'opMarginSeries' },
    { name: 'roic', key: 'roicSeries' },
    { name: 'revGrowth', key: 'revGrowthSeries' },
    { name: 'assetTurnover', key: 'assetTurnoverSeries' },
  ];

  for (const c of wtCases) {
    const ouResults = {};
    for (const { name, key } of metrics) {
      const series = c[key];
      if (series.length < 8) continue;

      // AR(1): X_{t+1} = a + b*X_t + ε
      const x = series.slice(0, -1);
      const y = series.slice(1);
      const reg = linearRegression(x, y);
      if (!reg || reg.slope >= 1 || reg.slope <= 0) continue;

      const b = reg.slope;
      const a = reg.intercept;
      const theta = -Math.log(b); // mean-reversion speed
      const mu = a / (1 - b); // long-run mean
      const residuals = y.map((yi, i) => yi - (a + b * x[i]));
      const resVar = residuals.reduce((s, r) => s + r * r, 0) / residuals.length;
      const sigma = Math.sqrt(2 * theta * resVar / (1 - b * b));
      const halfLife = Math.log(2) / theta;
      const snr = sigma > 0 ? theta / sigma : null;

      ouResults[name] = { theta, mu, sigma, halfLife, snr, b, r2: reg.r2, meanReverting: b > 0 && b < 1 };
    }

    if (Object.keys(ouResults).length === 0) continue;

    // Use best metric (highest R²)
    const bestMetric = Object.entries(ouResults).sort((a, b) => (b[1].r2 || 0) - (a[1].r2 || 0))[0];
    results.push({
      ...c,
      ouBest: bestMetric[0],
      theta: bestMetric[1].theta,
      halfLife: bestMetric[1].halfLife,
      snr: bestMetric[1].snr,
      ouR2: bestMetric[1].r2,
      meanReverting: bestMetric[1].meanReverting,
      ouResults,
    });
  }

  printSub('23A: Coverage');
  console.log(`  Cases with OU fit: ${results.length}`);

  const r1 = mwTest(results, c => c.theta, '23B: θ (mean-reversion speed)');
  const r2 = mwTest(results, c => c.halfLife, '23B: Half-life');
  const r3 = mwTest(results, c => c.snr, '23B: θ/σ (SNR)');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { theta: r1, halfLife: r2, snr: r3, pass, primaryP: bestP,
    primarySignal: c => results.find(r => r.ticker === c.ticker)?.theta, n: results.length };
}

function test38_temporalAsymmetry(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const series = c.revGrowthSeries;
    if (series.length < 10) continue;

    // Compute forward and reverse autocorrelation
    const maxLag = Math.min(5, Math.floor(series.length / 3));
    const forwardACF = [], reverseACF = [];
    const reversed = [...series].reverse();

    for (let lag = 1; lag <= maxLag; lag++) {
      forwardACF.push(lagCorrelation(series, lag));
      reverseACF.push(lagCorrelation(reversed, lag));
    }

    // Asymmetry index: RMS difference
    let sumSq = 0;
    for (let i = 0; i < forwardACF.length; i++) {
      if (forwardACF[i] != null && reverseACF[i] != null) {
        sumSq += (forwardACF[i] - reverseACF[i]) ** 2;
      }
    }
    const asymmetryIndex = Math.sqrt(sumSq / forwardACF.length);

    // Skewness of increments
    const increments = [];
    for (let i = 1; i < series.length; i++) increments.push(series[i] - series[i - 1]);
    const skew = increments.length >= 3 ? skewness(increments) : null;

    // Third-order asymmetry
    let thirdOrder = null;
    if (series.length >= 10) {
      let sum1 = 0, sum2 = 0, count = 0;
      for (let t = 0; t < series.length - 1; t++) {
        sum1 += series[t] * series[t] * series[t + 1];
        sum2 += series[t] * series[t + 1] * series[t + 1];
        count++;
      }
      if (count > 0) thirdOrder = (sum1 - sum2) / count;
    }

    results.push({
      ...c,
      asymmetryIndex,
      skewness: skew,
      thirdOrder,
      timeReversible: asymmetryIndex < 0.05,
    });
  }

  printSub('38A: Coverage');
  console.log(`  Cases with temporal asymmetry: ${results.length}`);

  const r1 = mwTest(results, c => c.asymmetryIndex, '38B: Asymmetry index');
  const r2 = mwTest(results, c => c.skewness, '38B: Skewness');
  const r3 = mwTest(results, c => c.thirdOrder, '38B: Third-order asymmetry');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { asymmetry: r1, skewness: r2, thirdOrder: r3, pass, primaryP: bestP,
    primarySignal: c => results.find(r => r.ticker === c.ticker)?.asymmetryIndex, n: results.length };
}

function test41_quietPeriod(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const margin = c.opMarginSeries;
    const growth = c.revGrowthSeries;
    if (margin.length < 16 || growth.length < 16) continue;

    const n = Math.min(margin.length, growth.length);
    let quietPeriods = [];

    // Scan for 8+ consecutive quarters with CV < 0.15 in both
    for (let start = 0; start <= n - 8; start++) {
      const mWindow = margin.slice(start, start + 8);
      const gWindow = growth.slice(start, start + 8);
      const mCV = Math.abs(mean(mWindow)) > 0.001 ? stddev(mWindow) / Math.abs(mean(mWindow)) : Infinity;
      const gCV = Math.abs(mean(gWindow)) > 0.001 ? stddev(gWindow) / Math.abs(mean(gWindow)) : Infinity;

      if (mCV < 0.15 && gCV < 0.15 && start + 12 <= n) {
        // Post-quiet: 4 quarters after quiet period
        const postMargin = mean(margin.slice(start + 8, Math.min(start + 12, n)));
        const preMargin = mean(mWindow);
        let direction;
        if (postMargin > preMargin + 0.01) direction = 'up';
        else if (postMargin < preMargin - 0.01) direction = 'down';
        else direction = 'sideways';

        quietPeriods.push({ start, preMargin, postMargin, direction });
        start += 7; // Skip ahead
      }
    }

    if (quietPeriods.length === 0) continue;

    const upCount = quietPeriods.filter(q => q.direction === 'up').length;
    const downCount = quietPeriods.filter(q => q.direction === 'down').length;
    const dominantBreakout = upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'sideways';

    results.push({ ...c, quietPeriods: quietPeriods.length, upBreakouts: upCount, downBreakouts: downCount, dominantBreakout });
  }

  printSub('41A: Coverage');
  console.log(`  Cases with quiet periods: ${results.length}`);

  if (results.length < 10) {
    console.log(`  ${YELLOW}Insufficient data (N < 10)${RESET}`);
    return { pass: null, primaryP: 1, n: results.length };
  }

  // Chi-square on breakout direction
  const upWin = results.filter(c => c.dominantBreakout === 'up' && c.outcome === 'winner').length;
  const upTrap = results.filter(c => c.dominantBreakout === 'up' && c.outcome === 'trap').length;
  const downWin = results.filter(c => c.dominantBreakout === 'down' && c.outcome === 'winner').length;
  const downTrap = results.filter(c => c.dominantBreakout === 'down' && c.outcome === 'trap').length;
  console.log(`  Up breakout: ${upWin}W/${upTrap}T → WR ${fmtPct(upWin + upTrap > 0 ? upWin / (upWin + upTrap) : null)}`);
  console.log(`  Down breakout: ${downWin}W/${downTrap}T → WR ${fmtPct(downWin + downTrap > 0 ? downWin / (downWin + downTrap) : null)}`);

  return { pass: null, primaryP: 1, n: results.length, upWin, upTrap, downWin, downTrap };
}

// ============================================
// PHASE 4: PHASE SPACE (24, 33, 36, 34, 16)
// ============================================

function test24_fitnessLandscape(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const changes = [c.revQoQChanges, c.marginQoQChanges, c.roicQoQChanges, c.atQoQChanges];
    const validChanges = changes.filter(ch => ch.length >= 6);
    if (validChanges.length < 3) continue;

    // Pairwise correlations
    const n = Math.min(...validChanges.map(ch => ch.length));
    const trimmed = validChanges.map(ch => ch.slice(-n));
    const correlations = [];
    for (let i = 0; i < trimmed.length; i++) {
      for (let j = i + 1; j < trimmed.length; j++) {
        const sp = spearmanCorrelation(trimmed[i], trimmed[j]);
        if (sp) correlations.push(sp.rho);
      }
    }

    if (correlations.length < 3) continue;

    const coordIndex = mean(correlations);
    const posCount = correlations.filter(r => r > 0.1).length;
    const negCount = correlations.filter(r => r < -0.1).length;

    // Eigenvalue analysis (simplified — use variance of correlations as proxy)
    const corrVar = stddev(correlations);
    const participationRatio = correlations.length / (1 + corrVar * correlations.length);

    results.push({
      ...c,
      coordIndex,
      posCount, negCount,
      participationRatio,
      smooth: coordIndex > 0.2,
      rugged: coordIndex < -0.1,
    });
  }

  printSub('24A: Coverage');
  console.log(`  Cases with fitness data: ${results.length}`);

  const r1 = mwTest(results, c => c.coordIndex, '24B: Coordination index');
  const r2 = mwTest(results, c => c.participationRatio, '24E: Participation ratio');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { coordination: r1, participation: r2, pass, primaryP: bestP,
    primarySignal: c => results.find(r => r.ticker === c.ticker)?.coordIndex, n: results.length };
}

function test33_percolation(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const changes = [c.revQoQChanges, c.marginQoQChanges, c.roicQoQChanges, c.atQoQChanges];
    const labels = ['revGrowth', 'margin', 'roic', 'turnover'];
    const validIdx = changes.map((ch, i) => ch.length >= 6 ? i : -1).filter(i => i >= 0);
    if (validIdx.length < 4) continue;

    const n = Math.min(...validIdx.map(i => changes[i].length));
    const trimmed = validIdx.map(i => changes[i].slice(-n));

    // Build correlation network: edge if |r| > 0.25
    let edges = 0, posEdges = 0, negEdges = 0;
    const maxEdges = validIdx.length * (validIdx.length - 1) / 2;

    for (let i = 0; i < trimmed.length; i++) {
      for (let j = i + 1; j < trimmed.length; j++) {
        const sp = spearmanCorrelation(trimmed[i], trimmed[j]);
        if (sp && Math.abs(sp.rho) > 0.25) {
          edges++;
          if (sp.rho > 0) posEdges++;
          else negEdges++;
        }
      }
    }

    const avgDegree = 2 * edges / validIdx.length;
    const percolated = avgDegree > 1;
    const direction = posEdges >= negEdges ? 'positive' : 'negative';

    results.push({
      ...c,
      avgDegree, percolated, direction,
      largestComponentFrac: percolated ? 1 : edges / maxEdges,
      posEdges, negEdges,
    });
  }

  printSub('33A: Coverage');
  console.log(`  Cases with percolation data: ${results.length}`);

  const r1 = mwTest(results, c => c.avgDegree, '33B: Average degree');

  // Percolation × direction
  printSub('33C: Percolation × Direction');
  const categories = [
    { label: 'Percolated + positive', filter: c => c.percolated && c.direction === 'positive' },
    { label: 'Percolated + negative', filter: c => c.percolated && c.direction === 'negative' },
    { label: 'Not percolated', filter: c => !c.percolated },
  ];
  for (const { label, filter } of categories) {
    const group = results.filter(filter);
    const w = group.filter(c => c.outcome === 'winner').length;
    const t = group.filter(c => c.outcome === 'trap').length;
    console.log(`    ${label.padEnd(25)}: ${w}W/${t}T → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)}`);
  }

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { degree: r1, pass, primaryP: r1.p, primarySignal: c => results.find(r => r.ticker === c.ticker)?.avgDegree, n: results.length };
}

function test36_dnaVelocity(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const sv = c.stateVectors;
    if (sv.length < 8) continue;

    // Normalize each dimension to z-scores
    const dims = 4;
    const means = [], stds = [];
    for (let d = 0; d < dims; d++) {
      const vals = sv.map(v => v[d]);
      means.push(mean(vals));
      stds.push(stddev(vals) || 0.001);
    }

    const normalized = sv.map(v => v.map((val, d) => (val - means[d]) / stds[d]));

    // Velocity: Euclidean distance between successive states
    const velocities = [];
    for (let i = 1; i < normalized.length; i++) {
      let dist = 0;
      for (let d = 0; d < dims; d++) dist += (normalized[i][d] - normalized[i - 1][d]) ** 2;
      velocities.push(Math.sqrt(dist));
    }

    const meanVel = mean(velocities);
    const maxVel = Math.max(...velocities);

    // Velocity trend
    const velReg = linearRegression(velocities.map((_, i) => i), velocities);

    // Net direction: sum of z-score changes from first to last
    let netDirection = 0;
    for (let d = 0; d < dims; d++) {
      netDirection += normalized[normalized.length - 1][d] - normalized[0][d];
    }

    // Tortuosity: total path length / direct displacement
    let totalPath = 0;
    for (const v of velocities) totalPath += v;
    let directDisp = 0;
    for (let d = 0; d < dims; d++) directDisp += (normalized[normalized.length - 1][d] - normalized[0][d]) ** 2;
    directDisp = Math.sqrt(directDisp);
    const tortuosity = directDisp > 0.001 ? totalPath / directDisp : totalPath;

    results.push({
      ...c,
      meanVelocity: meanVel, maxVelocity: maxVel,
      velocityTrend: velReg?.slope ?? null,
      netDirection, tortuosity,
    });
  }

  printSub('36A: Coverage');
  console.log(`  Cases with DNA velocity: ${results.length}`);

  const r1 = mwTest(results, c => c.netDirection, '36B: Net direction score');
  const r2 = mwTest(results, c => c.tortuosity, '36B: Tortuosity');
  const r3 = mwTest(results, c => c.meanVelocity, '36B: Mean velocity');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { direction: r1, tortuosity: r2, velocity: r3, pass, primaryP: bestP,
    primarySignal: c => results.find(r => r.ticker === c.ticker)?.netDirection, n: results.length };
}

function test34_tda(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const sv = c.stateVectors;
    if (sv.length < 8) continue;

    // Normalize
    const dims = 4;
    const means = [], stds = [];
    for (let d = 0; d < dims; d++) {
      const vals = sv.map(v => v[d]);
      means.push(mean(vals));
      stds.push(stddev(vals) || 0.001);
    }
    const normalized = sv.map(v => v.map((val, d) => (val - means[d]) / stds[d]));

    // Compute pairwise distances
    const n = normalized.length;
    const dists = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let d = 0;
        for (let k = 0; k < dims; k++) d += (normalized[i][k] - normalized[j][k]) ** 2;
        dists.push(Math.sqrt(d));
      }
    }
    dists.sort((a, b) => a - b);

    const diameter = dists[dists.length - 1] || 1;

    // Path ratio: total sequential distance / diameter
    let totalPath = 0;
    for (let i = 1; i < normalized.length; i++) {
      let d = 0;
      for (let k = 0; k < dims; k++) d += (normalized[i][k] - normalized[i - 1][k]) ** 2;
      totalPath += Math.sqrt(d);
    }
    const pathRatio = diameter > 0 ? totalPath / diameter : totalPath;

    // Loop proxy: start-end distance / diameter
    let startEndDist = 0;
    for (let k = 0; k < dims; k++) startEndDist += (normalized[n - 1][k] - normalized[0][k]) ** 2;
    startEndDist = Math.sqrt(startEndDist);
    const loopProxy = diameter > 0 ? startEndDist / diameter : startEndDist;

    // Shape classification
    let shape;
    if (pathRatio < 2 && loopProxy < 0.3) shape = 'cluster';
    else if (pathRatio < 2 && loopProxy >= 0.3) shape = 'path';
    else if (pathRatio >= 2 && loopProxy < 0.3) shape = 'loop';
    else shape = 'scatter';

    results.push({ ...c, pathRatio, loopProxy, diameter, shape });
  }

  printSub('34A: Coverage');
  console.log(`  Cases with TDA data: ${results.length}`);

  // Shape distribution
  for (const shape of ['cluster', 'path', 'loop', 'scatter']) {
    const group = results.filter(c => c.shape === shape);
    const w = group.filter(c => c.outcome === 'winner').length;
    const t = group.filter(c => c.outcome === 'trap').length;
    console.log(`    ${shape.padEnd(10)}: ${w}W/${t}T → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)}`);
  }

  const r1 = mwTest(results, c => c.pathRatio, '34C: Path ratio');
  const r2 = mwTest(results, c => c.loopProxy, '34C: Loop proxy');

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { pathRatio: r1, loopProxy: r2, pass, primaryP: bestP, n: results.length };
}

function test16_phaseDistance(wtCases) {
  const results = [];

  for (const c of wtCases) {
    if (c.stateVectors.length < 13) continue;

    // Trailing 12Q average as equilibrium
    const recent12 = c.stateVectors.slice(-12);
    const equilibrium = [0, 1, 2, 3].map(d => mean(recent12.map(v => v[d])));
    const stdevs = [0, 1, 2, 3].map(d => {
      const s = stddev(recent12.map(v => v[d]));
      return s > 0.001 ? s : 0.001;
    });

    const current = c.stateVectors[c.stateVectors.length - 1];
    const displacement = current.map((v, d) => (v - equilibrium[d]) / stdevs[d]);

    const distance = Math.sqrt(displacement.reduce((s, d) => s + d * d, 0));
    const avgDisplacement = mean(displacement);

    results.push({ ...c, distance, avgDisplacement, improving: avgDisplacement > 0 });
  }

  printSub('16A: Coverage');
  console.log(`  Cases with phase distance: ${results.length}`);

  const r1 = mwTest(results, c => c.distance, '16B: Distance from equilibrium');
  const r2 = mwTest(results, c => c.avgDisplacement, '16C: Displacement direction');

  const pass = Math.min(r1.p ?? 1, r2.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { distance: r1, displacement: r2, pass, primaryP: Math.min(r1.p ?? 1, r2.p ?? 1),
    primarySignal: c => results.find(r => r.ticker === c.ticker)?.avgDisplacement, n: results.length };
}

// ============================================
// PHASE 5-8 SIMPLIFIED: Key additional tests
// ============================================

function test19_spectral(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const series = c.revGrowthSeries;
    if (series.length < 12) continue;

    // Detrend
    const trend = linearRegression(series.map((_, i) => i), series);
    const detrended = series.map((v, i) => v - (trend.slope * i + trend.intercept));

    // DFT
    const n = detrended.length;
    const power = [];
    for (let k = 1; k <= Math.floor(n / 2); k++) {
      let re = 0, im = 0;
      for (let t = 0; t < n; t++) {
        re += detrended[t] * Math.cos(2 * Math.PI * k * t / n);
        im -= detrended[t] * Math.sin(2 * Math.PI * k * t / n);
      }
      power.push({ k, freq: k / n, power: re * re + im * im, period: n / k });
    }

    // SNR: low-freq power / high-freq power
    const lowFreq = power.filter(p => p.period > 8).reduce((s, p) => s + p.power, 0);
    const highFreq = power.filter(p => p.period <= 4).reduce((s, p) => s + p.power, 0);
    const snr = highFreq > 0 ? lowFreq / highFreq : lowFreq;

    // Spectral slope
    const logFreq = power.map(p => Math.log(p.freq));
    const logPower = power.map(p => Math.log(p.power + 1e-10));
    const slopeReg = linearRegression(logFreq, logPower);
    const alpha = slopeReg ? -slopeReg.slope : null;

    let noiseColor = 'unknown';
    if (alpha != null) {
      if (alpha < 0.5) noiseColor = 'white';
      else if (alpha <= 1.5) noiseColor = 'pink';
      else noiseColor = 'brown';
    }

    results.push({ ...c, snr, spectralAlpha: alpha, noiseColor, trendSlope: trend.slope });
  }

  printSub('19A: Coverage');
  console.log(`  Cases with spectral data: ${results.length}`);

  const r1 = mwTest(results, c => c.snr, '19B: Growth SNR');
  const r2 = mwTest(results, c => c.spectralAlpha, '19D: Spectral slope α');

  // Noise color distribution
  for (const color of ['white', 'pink', 'brown']) {
    const group = results.filter(c => c.noiseColor === color);
    const w = group.filter(c => c.outcome === 'winner').length;
    const t = group.filter(c => c.outcome === 'trap').length;
    console.log(`    ${color.padEnd(8)}: ${w}W/${t}T → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)}`);
  }

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { snr: r1, alpha: r2, pass, primaryP: bestP, primarySignal: c => results.find(r => r.ticker === c.ticker)?.snr, n: results.length };
}

function test17_fisherInformation(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const series = c.revGrowthSeries;
    if (series.length < 8) continue;

    // Rolling Fisher information
    const windowSize = 4;
    let totalFisher = 0;
    let count = 0;

    for (let i = windowSize; i < series.length; i++) {
      const window = series.slice(i - windowSize, i);
      const mu = mean(window);
      const sigma2 = window.reduce((s, v) => s + (v - mu) ** 2, 0) / window.length;
      if (sigma2 < 1e-10) continue;

      const prevWindow = series.slice(Math.max(0, i - windowSize - 1), i - 1);
      const prevMu = mean(prevWindow);
      const prevSigma2 = prevWindow.reduce((s, v) => s + (v - prevMu) ** 2, 0) / prevWindow.length;

      const dMu = mu - prevMu;
      const dSigma2 = sigma2 - prevSigma2;

      const fisher = (dMu * dMu) / sigma2 + (dSigma2 * dSigma2) / (2 * sigma2 * sigma2);
      totalFisher += fisher;
      count++;
    }

    if (count === 0) continue;
    const avgFisher = totalFisher / count;

    results.push({ ...c, fisherInfo: avgFisher });
  }

  printSub('17A: Coverage');
  console.log(`  Cases with Fisher info: ${results.length}`);

  const r1 = mwTest(results, c => c.fisherInfo, '17C: Fisher information');

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { fisher: r1, pass, primaryP: r1.p, primarySignal: c => results.find(r => r.ticker === c.ticker)?.fisherInfo, n: results.length };
}

function test20_dissipativeStructure(wtCases) {
  const results = [];

  for (const c of wtCases) {
    const rev = c.revenueSeries;
    const margin = c.opMarginSeries;
    if (rev.length < 8 || margin.length < 8) continue;

    const recentRev = mean(rev.slice(-4));
    const earlierRev = mean(rev.slice(-8, -4));
    const recentMargin = mean(margin.slice(-4));
    const earlierMargin = mean(margin.slice(-8, -4));

    if (earlierRev <= 0) continue;

    const revGrowth = (recentRev - earlierRev) / earlierRev;
    const marginChange = recentMargin - earlierMargin;

    // Simple efficiency: revenue growth / OpEx growth proxy
    const opexGrowth = c.opexQoQChanges.length >= 4 ? mean(c.opexQoQChanges.slice(-4)) : null;
    const simpleEfficiency = (opexGrowth != null && opexGrowth > 0.001) ? revGrowth / opexGrowth : null;

    results.push({ ...c, revGrowth, marginChange, simpleEfficiency });
  }

  printSub('20A: Coverage');
  console.log(`  Cases with efficiency data: ${results.length}`);

  const r1 = mwTest(results, c => c.simpleEfficiency, '20B: Simple efficiency');

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { efficiency: r1, pass, primaryP: r1.p, n: results.length };
}

function test21_scaleInvariance(wtCases) {
  const results = [];

  for (const c of wtCases) {
    if (c.revGrowthSeries.length < 12) continue;

    // Compute metric at 5 scales for revenue growth
    const scales = [1, 2, 4, 8, 12].map(w => {
      const series = c.revGrowthSeries;
      if (series.length < w) return null;
      return mean(series.slice(-w));
    }).filter(v => v != null);

    if (scales.length < 3) continue;

    const cv = Math.abs(mean(scales)) > 0.001 ? stddev(scales) / Math.abs(mean(scales)) : Infinity;
    const scaleInvariant = cv < 0.3;

    results.push({ ...c, scaleCV: cv, scaleInvariant });
  }

  printSub('21A: Coverage');
  console.log(`  Cases with scale invariance: ${results.length}`);

  const r1 = mwTest(results, c => c.scaleCV, '21D: Scale CV');

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { scaleCV: r1, pass, primaryP: r1.p, n: results.length };
}

function test29_signaling(wtCases) {
  // Simplified: use available EDGAR data (dividend proxy, shares, capex)
  const results = [];

  for (const c of wtCases) {
    const rev = c.revenueSeries;
    if (rev.length < 8) continue;

    // Investment intensity change as countercyclical signal
    const hasInvest = c.investIntensity != null;
    // Revenue growth as proxy for credible signal
    const revGrowth = c.revGrowthYoY;

    results.push({ ...c, revGrowth, hasInvestData: hasInvest });
  }

  // This test is severely limited without Form 4/dividend data
  printSub('29A: Coverage');
  console.log(`  Cases: ${results.length} (limited — no Form 4 or dividend history available)`);
  console.log(`  ${YELLOW}Test 29 requires external data (Form 4, dividend history). Skipping detailed analysis.${RESET}`);

  return { pass: null, primaryP: 1, n: results.length, skipped: true };
}

// ============================================
// PHASE 9: CROSS-TEST INTEGRATION
// ============================================

function phase9_integration(allResults, caseData) {
  printHeader('PHASE 9: CROSS-TEST INTEGRATION');

  // 9A: Collect all passing signals
  printSub('9A: Signal Inventory');

  const signals = [];

  // Add baseline signals
  signals.push({ name: 'D1 growth rate', test: 'baseline', r: 0.285, p: 0.0001 });
  signals.push({ name: 'Zipf rank velocity', test: 'baseline', r: 0.282, p: 0.0001 });
  signals.push({ name: 'β trajectory (12Q)', test: 'baseline', r: 0.169, p: 0.0003 });

  // Add passing new signals
  for (const [testName, result] of Object.entries(allResults)) {
    if (!result || result.skipped) continue;

    // Collect all sub-test results
    for (const [key, val] of Object.entries(result)) {
      if (val && typeof val === 'object' && val.p != null && val.r != null && val.p < 0.1) {
        signals.push({
          name: `${testName}: ${key}`,
          test: testName,
          r: val.r,
          p: val.p,
          n: val.n,
          robust: result.robust,
        });
      }
    }
  }

  // Sort by effect size
  signals.sort((a, b) => (b.r ?? 0) - (a.r ?? 0));

  console.log(`\n  All signals (p < 0.10):\n`);
  console.log(`  ${'Signal'.padEnd(40)} | ${'Effect r'.padStart(9)} | ${'p-value'.padStart(9)} | ${'N'.padStart(5)} | Robust`);
  console.log(`  ${'-'.repeat(40)}-+-${'-'.repeat(9)}-+-${'-'.repeat(9)}-+-${'-'.repeat(5)}-+-------`);

  for (const s of signals) {
    const robust = s.robust === true ? GREEN + 'YES' + RESET : s.robust === false ? RED + 'NO' + RESET : DIM + '—' + RESET;
    console.log(`  ${s.name.padEnd(40)} | ${fmtNum(s.r, 3).padStart(9)} | ${fmtNum(s.p).padStart(9)} | ${String(s.n ?? '—').padStart(5)} | ${robust}`);
  }

  // Count passing signals
  const passing = signals.filter(s => s.p < 0.05);
  const robust = signals.filter(s => s.robust === true);
  console.log(`\n  Passing (p < 0.05): ${passing.length}`);
  console.log(`  Robust (4/5 CV folds): ${robust.length}`);

  return { signals, passing, robust };
}

// ============================================
// HELPERS
// ============================================

function lagCorrelation(series, lag) {
  if (series.length < lag + 3) return null;
  const x = series.slice(0, series.length - lag);
  const y = series.slice(lag);
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return (dx > 0 && dy > 0) ? num / Math.sqrt(dx * dy) : 0;
}

function skewness(arr) {
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  return arr.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) / arr.length;
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Full Test Battery — Tests 10-41${RESET}`);
  console.log(`${'='.repeat(50)}`);

  const { cases } = await loadAndPrepare();
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  console.log(`\n  Winner/trap cases for testing: ${wtCases.length}`);

  const shouldPhase = (n) => !PHASE || PHASE === n;
  const shouldTest = (n) => !TEST_NUM || TEST_NUM === n;
  const allResults = {};

  // PHASE 2: Foundation
  if (shouldPhase(2)) {
    printHeader('PHASE 2: FOUNDATION TESTS');
    if (shouldTest(30)) allResults.test30 = test30_revenueExpenseCoupling(wtCases);
    if (shouldTest(31)) allResults.test31 = test31_growthQuality(wtCases);
    if (shouldTest(32)) allResults.test32 = test32_accrualDynamics(wtCases);
    if (shouldTest(39)) allResults.test39 = test39_marketingEfficiency(wtCases);
    if (shouldTest(40)) allResults.test40 = test40_structuralBreaks(wtCases);
  }

  // PHASE 3: Time Series Dynamics
  if (shouldPhase(3)) {
    printHeader('PHASE 3: TIME SERIES DYNAMICS');
    let stressEvents = null;
    if (shouldTest(26)) {
      const r = test26_fractureMechanics(wtCases);
      allResults.test26 = r;
      stressEvents = r?.stressEvents;
    }
    if (shouldTest(35)) allResults.test35 = test35_antifragility(wtCases, stressEvents || allResults.test26?.stressEvents);
    if (shouldTest(12)) allResults.test12 = test12_relaxationTime(wtCases, stressEvents || allResults.test26?.stressEvents);
    if (shouldTest(23)) allResults.test23 = test23_ouProcess(wtCases);
    if (shouldTest(38)) allResults.test38 = test38_temporalAsymmetry(wtCases);
    if (shouldTest(41)) allResults.test41 = test41_quietPeriod(wtCases);
  }

  // PHASE 4: Phase Space
  if (shouldPhase(4)) {
    printHeader('PHASE 4: MULTI-METRIC PHASE SPACE');
    if (shouldTest(24)) allResults.test24 = test24_fitnessLandscape(wtCases);
    if (shouldTest(33)) allResults.test33 = test33_percolation(wtCases);
    if (shouldTest(36)) allResults.test36 = test36_dnaVelocity(wtCases);
    if (shouldTest(34)) allResults.test34 = test34_tda(wtCases);
    if (shouldTest(16)) allResults.test16 = test16_phaseDistance(wtCases);
  }

  // PHASE 5-8: Additional tests
  if (shouldPhase(5) || shouldPhase(6) || shouldPhase(7) || shouldPhase(8)) {
    printHeader('PHASES 5-8: ADDITIONAL TESTS');
    if (shouldTest(19)) allResults.test19 = test19_spectral(wtCases);
    if (shouldTest(17)) allResults.test17 = test17_fisherInformation(wtCases);
    if (shouldTest(20)) allResults.test20 = test20_dissipativeStructure(wtCases);
    if (shouldTest(21)) allResults.test21 = test21_scaleInvariance(wtCases);
    if (shouldTest(29)) allResults.test29 = test29_signaling(wtCases);
  }

  // PHASE 9: Integration
  if (shouldPhase(9) || !PHASE) {
    const integration = phase9_integration(allResults, cases);
    allResults.phase9 = integration;
  }

  // Summary
  printHeader('TEST BATTERY SUMMARY');
  const testNames = {
    test30: 'Revenue-Expense Coupling', test31: 'Growth Quality', test32: 'Accrual Dynamics',
    test39: 'Marketing Efficiency', test40: 'Structural Breaks',
    test26: 'Fracture Mechanics', test35: 'Anti-Fragility', test12: 'Relaxation Time',
    test23: 'OU Process', test38: 'Temporal Asymmetry', test41: 'Quiet Period',
    test24: 'Fitness Landscape', test33: 'Percolation', test36: 'DNA Velocity',
    test34: 'TDA Topology', test16: 'Phase Distance',
    test19: 'Spectral Decomposition', test17: 'Fisher Information',
    test20: 'Dissipative Structure', test21: 'Scale Invariance', test29: 'Signaling Theory',
  };

  for (const [key, name] of Object.entries(testNames)) {
    const r = allResults[key];
    if (!r) continue;
    const status = r.pass === true ? GREEN + 'PASS' : r.pass === false ? RED + 'FAIL' : YELLOW + (r.skipped ? 'SKIP' : 'INCL');
    const pStr = r.primaryP != null ? ` p=${fmtNum(r.primaryP)}` : '';
    console.log(`  ${pad(name, 28, 'left')}: ${status}${RESET}${pStr} (N=${r.n ?? '?'})`);
  }

  // Save results
  const DATA_DIR = resolve(import.meta.dirname, '../data');
  const outPath = OUTPUT_PATH || resolve(DATA_DIR, `test-battery-results-${new Date().toISOString().slice(0, 10)}.json`);

  const saveable = {};
  for (const [key, val] of Object.entries(allResults)) {
    if (!val) continue;
    const clean = {};
    for (const [k, v] of Object.entries(val)) {
      if (k === 'results' || k === 'stressEvents' || k === 'primarySignal') continue;
      clean[k] = v;
    }
    saveable[key] = clean;
  }

  writeFileSync(outPath, JSON.stringify(saveable, null, 2));
  console.log(`\n${DIM}Results saved to: ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
