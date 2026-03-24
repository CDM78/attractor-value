#!/usr/bin/env node
// Test Battery Session 2 — Remaining 11 tests + Cross-Validation + Combination Search
//
// Batch A: Tests 29, 22, 15 (signaling, ecology, symmetry breaking)
// Batch B: Tests 25, 13, 14 (control theory, flywheel momentum, ergodicity)
// Batch C: Tests 10, 11, 18 (Lyapunov, correlation dimension, transfer entropy)
// Then: 5-fold CV on all 20+ passing signals, combination search
//
// Usage:
//   node --max-old-space-size=4096 scripts/test-battery-session2.js --dry-run [options]

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, getRevenueAtDate } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, scalingTrajectory, betaVelocity,
  revenueHurst, hurstOfBeta, revenueEntropy,
  zipfExponent, rankVelocity, trackRankHistory, buildSectorRankings,
} from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';
import { getSectorETF, getSectorName, groupBySectorETF } from './lib/sector-map.js';

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(`--${n}`);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const DRY_RUN = hasFlag('dry-run');
const BATCH = getArg('batch');
const TEST_NUM = getArg('test') ? parseInt(getArg('test')) : null;

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const fmtPct = (v, d = 1) => v == null ? 'N/A' : (v * 100).toFixed(d) + '%';
const pad = (s, w, a = 'right') => { s = String(s ?? 'N/A'); return a === 'left' ? s.padEnd(w) : s.padStart(w); };
function printHeader(t) { console.log(`\n${BOLD}${CYAN}${'='.repeat(60)}\n${t}\n${'='.repeat(60)}${RESET}`); }
function printSub(t) { console.log(`\n${BOLD}${t}${RESET}\n${DIM}${'-'.repeat(50)}${RESET}`); }

// ============================================
// DATA LOADING (same as session 1)
// ============================================
async function loadAndPrepare() {
  console.log(`${BOLD}Phase 0: Data Loading${RESET}`);
  let cases = loadCalibrationCases();
  console.log(`  ${cases.length} cases, ${getUniqueTickers(cases).length} unique tickers`);
  await ensureCikCache();
  const tickers = getUniqueTickers(cases);

  const companyData = {};
  let loaded = 0, failed = 0;
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) { failed++; continue; }
    const result = await fetchFactsForTicker(ticker);
    if (result.error || !result.facts) { failed++; continue; }
    const qm = extractQuarterlyMetrics(result.facts);
    if (qm.length < 4) { failed++; continue; }

    const numbers = extractUsdNumbers(result.facts);
    const d1Benford = benfordFirstDigit(numbers);
    const casesForTicker = cases.filter(c => c.ticker === ticker);
    const revenueByDate = {};
    for (const c of casesForTicker) {
      revenueByDate[c.entry_date || '2025-12-31'] = getRevenueAtDate(result.facts, c.entry_date || '2025-12-31');
    }
    revenueByDate['2025-12-31'] = getRevenueAtDate(result.facts, '2025-12-31');

    companyData[ticker] = { qm, benfordKLD: d1Benford?.kld ?? null, revenueByDate };
    loaded++;
    if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${tickers.length}...\r`);
  }
  console.log(`\n  Loaded: ${loaded}, Failed: ${failed}`);

  // Compute shared intermediates
  const caseData = [];
  for (const c of cases) {
    const cd = companyData[c.ticker];
    if (!cd) continue;
    const si = computeIntermediates(cd.qm);
    si.ticker = c.ticker; si.outcome = c.outcome; si.tier = c.tier;
    si.pipeline = c.pipeline; si.entry_date = c.entry_date; si.sector = c.sector;
    si.benfordKLD = cd.benfordKLD;
    si.annualRevenue = cd.revenueByDate?.[c.entry_date] ?? cd.revenueByDate?.['2025-12-31'] ?? null;
    si.nQuarters = cd.qm.length;
    si.rawQm = cd.qm; // Keep raw for new tests
    caseData.push(si);
  }

  console.log(`  Cases prepared: ${caseData.length}`);
  return { cases: caseData, companyData };
}

function computeIntermediates(qm) {
  const si = {};
  const n = qm.length;
  const latest = qm[n - 1] || {};

  si.revenueSeries = qm.map(q => q.revenue).filter(v => v != null && v > 0);
  si.opMarginSeries = qm.map(q => q.operatingMargin).filter(v => v != null);
  si.revGrowthSeries = qm.map(q => q.revenueGrowthYoY).filter(v => v != null && isFinite(v));

  const roicArr = qm.map(q => {
    if (q.operatingIncome != null && q.equity > 0) {
      const cap = (q.equity || 0) + (q.longTermDebt || 0);
      return cap > 0 ? q.operatingIncome * 0.79 / cap : null;
    }
    return null;
  });
  si.roicSeries = roicArr.filter(v => v != null && isFinite(v));

  const atArr = qm.map(q => (q.revenue > 0 && q.assets > 0) ? q.revenue / q.assets : null);
  si.assetTurnoverSeries = atArr.filter(v => v != null);

  si.fcfMarginSeries = qm.map(q => {
    const fcf = (q.ocf != null && q.capex != null) ? q.ocf - q.capex : null;
    return (fcf != null && q.revenue > 0) ? fcf / q.revenue : null;
  }).filter(v => v != null);

  si.cashConversionSeries = qm.map(q => (q.ocf != null && q.netIncome != null && Math.abs(q.netIncome) > 1000) ? q.ocf / q.netIncome : null)
    .filter(v => v != null && isFinite(v) && Math.abs(v) < 100);

  si.accrualRatioSeries = qm.map(q => (q.netIncome != null && q.ocf != null && q.assets > 0) ? (q.netIncome - q.ocf) / q.assets : null)
    .filter(v => v != null && isFinite(v));

  si.revPerSGASeries = qm.map(q => (q.revenue > 0 && q.sga > 0) ? q.revenue / q.sga : null).filter(v => v != null);
  si.grossMarginSeries = qm.map(q => q.grossMargin).filter(v => v != null);

  si.stateVectors = [];
  for (let i = 0; i < qm.length; i++) {
    const m = qm[i].operatingMargin, g = qm[i].revenueGrowthYoY, r = roicArr[i], a = atArr[i];
    if (m != null && g != null && isFinite(g) && r != null && a != null) si.stateVectors.push([m, g, r, a]);
  }

  // Investment intensity series
  si.investIntensitySeries = qm.map(q => {
    const inv = (q.capex || 0) + (q.rAndD || 0);
    return (inv > 0 && q.revenue > 0) ? inv / q.revenue : null;
  }).filter(v => v != null);

  // Dividend series
  si.dividendSeries = qm.map(q => q.dividendsPerShare ?? null);
  si.sharesSeries = qm.map(q => q.sharesOutstanding ?? null);
  si.epsSeries = qm.map(q => q.eps ?? null);

  // Revenue, assets, equity scalars
  si.revenue = latest.revenue; si.assets = latest.assets; si.equity = latest.equity;
  si.capex = latest.capex; si.rAndD = latest.rAndD;
  si.revGrowthYoY = si.revGrowthSeries.length > 0 ? si.revGrowthSeries[si.revGrowthSeries.length - 1] : null;
  si.opMargin = si.opMarginSeries.length > 0 ? si.opMarginSeries[si.opMarginSeries.length - 1] : null;
  si.roic = si.roicSeries.length > 0 ? si.roicSeries[si.roicSeries.length - 1] : null;

  si.revQoQChanges = [];
  for (let i = 1; i < qm.length; i++) {
    if (qm[i].revenue > 0 && qm[i-1].revenue > 0)
      si.revQoQChanges.push((qm[i].revenue - qm[i-1].revenue) / Math.abs(qm[i-1].revenue));
  }

  return si;
}

function mwTest(cases, signalFn, label) {
  const w = cases.filter(c => c.outcome === 'winner' && signalFn(c) != null).map(c => signalFn(c));
  const t = cases.filter(c => c.outcome === 'trap' && signalFn(c) != null).map(c => signalFn(c));
  const mw = (w.length >= 2 && t.length >= 2) ? mannWhitneyU(w, t) : null;
  const n = w.length + t.length;
  const dir = mean(w) > mean(t) ? 'winners higher' : 'winners lower';
  if (label) console.log(`  ${pad(label, 32, 'left')}: p=${fmtNum(mw?.p)}, r=${fmtNum(mw?.effectSizeR, 3)}, N=${n} (${dir})`);
  return { p: mw?.p, r: mw?.effectSizeR, n, winMean: mean(w), trapMean: mean(t) };
}

function crossValidate(wtCases, signalFn) {
  const items = wtCases.filter(c => signalFn(c) != null).map(c => ({ outcome: c.outcome, val: signalFn(c) }));
  if (items.length < 20) return { folds: [], sigFolds: 0 };
  const folds = kFoldSplit(items, 5, 42);
  const results = folds.map(({ train, test }) => {
    const tw = train.filter(i => items[i].outcome === 'winner').map(i => items[i].val);
    const tt = train.filter(i => items[i].outcome === 'trap').map(i => items[i].val);
    const ew = test.filter(i => items[i].outcome === 'winner').map(i => items[i].val);
    const et = test.filter(i => items[i].outcome === 'trap').map(i => items[i].val);
    const testMW = mannWhitneyU(ew, et);
    return { testP: testMW?.p ?? 1, testR: testMW?.effectSizeR ?? 0 };
  });
  const sigFolds = results.filter(f => f.testP < 0.05).length;
  return { folds: results, sigFolds, meanR: mean(results.map(f => f.testR)) };
}

// ============================================
// BATCH A: Tests 29, 13, 25
// ============================================

function test29_signaling(wtCases) {
  printHeader('Test 29: Signaling Theory');
  const results = [];

  for (const c of wtCases) {
    const qm = c.rawQm;
    if (!qm || qm.length < 8) continue;

    // Dividend signal
    const divs = qm.map(q => q.dividendsPerShare).filter(v => v != null && v > 0);
    const hasDividend = divs.length > 0;
    let divSignal = 0;
    if (divs.length >= 4) {
      const recent = mean(divs.slice(-Math.min(4, divs.length)));
      const earlier = divs.length >= 8 ? mean(divs.slice(0, 4)) : divs[0];
      if (earlier > 0) {
        const divGrowth = (recent - earlier) / earlier;
        // Check credibility: margins stable/improving?
        const marginTrend = c.opMarginSeries.length >= 8
          ? mean(c.opMarginSeries.slice(-4)) - mean(c.opMarginSeries.slice(-8, -4))
          : null;
        if (divGrowth > 0.05 && (marginTrend == null || marginTrend >= -0.02)) divSignal = 1;
        else if (divGrowth > 0.05 && marginTrend < -0.02) divSignal = -0.5; // Suspicious
        else if (divGrowth < -0.1) divSignal = -1; // Cut
      }
    }

    // Buyback signal: shares decreasing?
    const shares = qm.map(q => q.sharesOutstanding).filter(v => v != null && v > 0);
    let buybackSignal = 0;
    if (shares.length >= 4) {
      const recentShares = shares[shares.length - 1];
      const earlierShares = shares.length >= 8 ? shares[shares.length - 8] : shares[0];
      if (earlierShares > 0) {
        const shareChange = (recentShares - earlierShares) / earlierShares;
        if (shareChange < -0.02) buybackSignal = 1; // Buying back
        else if (shareChange > 0.03) buybackSignal = -0.5; // Diluting
      }
    }

    // Countercyclical investment: CapEx+R&D up during margin compression?
    let investSignal = 0;
    if (c.investIntensitySeries.length >= 8) {
      const recentInvest = mean(c.investIntensitySeries.slice(-4));
      const earlierInvest = mean(c.investIntensitySeries.slice(-8, -4));
      const marginDown = c.opMarginSeries.length >= 8 &&
        mean(c.opMarginSeries.slice(-4)) < mean(c.opMarginSeries.slice(-8, -4)) - 0.01;
      if (marginDown && recentInvest > earlierInvest * 1.05) investSignal = 1; // Countercyclical
      else if (marginDown && recentInvest < earlierInvest * 0.9) investSignal = -0.5; // Procyclical cut
    }

    const compositeSignal = [divSignal, buybackSignal, investSignal].filter(s => s !== 0);
    const signalScore = compositeSignal.length > 0 ? mean(compositeSignal) : 0;
    const positiveSignals = [divSignal, buybackSignal, investSignal].filter(s => s > 0.3).length;

    results.push({ ...c, divSignal, buybackSignal, investSignal, signalScore, positiveSignals, hasDividend });
  }

  printSub('29B: Coverage');
  console.log(`  Cases: ${results.length}, With dividends: ${results.filter(r => r.hasDividend).length}`);

  const r1 = mwTest(results, c => c.signalScore, '29E: Composite signal');
  const r2 = mwTest(results, c => c.divSignal, '29F: Dividend signal');
  const r3 = mwTest(results, c => c.buybackSignal, '29F: Buyback signal');
  const r4 = mwTest(results, c => c.investSignal, '29F: Countercyclical invest');

  // 29I: Signal count monotonicity
  printSub('29I: Signal Count → Win Rate');
  for (let n = 0; n <= 3; n++) {
    const group = results.filter(r => r.positiveSignals === n);
    const w = group.filter(r => r.outcome === 'winner').length;
    const t = group.filter(r => r.outcome === 'trap').length;
    console.log(`    ${n} signals: ${w}W/${t}T → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)} (N=${w + t})`);
  }

  // 29G: Dividend credibility
  printSub('29G: Dividend Credibility');
  for (const [label, filter] of [['Credible increase', r => r.divSignal === 1], ['Suspicious increase', r => r.divSignal === -0.5], ['Dividend cut', r => r.divSignal === -1], ['No dividend signal', r => r.divSignal === 0]]) {
    const g = results.filter(filter);
    const w = g.filter(r => r.outcome === 'winner').length;
    const t = g.filter(r => r.outcome === 'trap').length;
    console.log(`    ${label.padEnd(22)}: ${w}W/${t}T → WR ${fmtPct(w + t > 0 ? w / (w + t) : null)}`);
  }

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1, r4.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (best p=${fmtNum(bestP)})`);

  return { composite: r1, dividend: r2, buyback: r3, invest: r4, pass, bestP, n: results.length, results };
}

function test13_flywheelMomentum(wtCases) {
  printHeader('Test 13: Flywheel Momentum');
  const results = [];

  // Compute percentile ranks for assets and ROIC across all cases
  const allAssets = wtCases.map(c => c.assets).filter(v => v != null && v > 0);
  const allRoic = wtCases.map(c => c.roic).filter(v => v != null && isFinite(v));
  const assetsSorted = [...allAssets].sort((a, b) => a - b);
  const roicSorted = [...allRoic].sort((a, b) => a - b);
  const percentile = (val, sorted) => val != null ? sorted.filter(v => v <= val).length / sorted.length : null;

  for (const c of wtCases) {
    if (c.assets == null || c.roic == null) continue;

    const massRank = percentile(c.assets, assetsSorted);
    const speedRank = percentile(c.roic, roicSorted);
    if (massRank == null || speedRank == null) continue;

    const L = massRank * speedRank;

    // Torque: need ROIC series
    let torque = null;
    if (c.roicSeries.length >= 8) {
      // Compute L series using last 8 quarters of ROIC
      const lSeries = c.roicSeries.slice(-8).map(r => percentile(r, roicSorted) * massRank);
      const reg = linearRegression(lSeries.map((_, i) => i), lSeries);
      torque = reg?.slope ?? null;
    }

    results.push({ ...c, momentum: L, torque, massRank, speedRank });
  }

  printSub('13A: Coverage');
  console.log(`  Cases: ${results.length}`);

  const r1 = mwTest(results, c => c.momentum, '13B: Momentum L (rank-based)');
  const r2 = mwTest(results, c => c.torque, '13B: Torque dL/dt');
  const r3 = mwTest(results, c => c.massRank, '13C: Assets rank alone');
  const r4 = mwTest(results, c => c.speedRank, '13C: ROIC rank alone');

  // Decomposition test: does L beat components?
  printSub('13C: Decomposition Test');
  console.log(`    Momentum L: r=${fmtNum(r1.r, 3)}, p=${fmtNum(r1.p)}`);
  console.log(`    Torque:     r=${fmtNum(r2.r, 3)}, p=${fmtNum(r2.p)}`);
  console.log(`    Assets alone: r=${fmtNum(r3.r, 3)}, p=${fmtNum(r3.p)}`);
  console.log(`    ROIC alone:   r=${fmtNum(r4.r, 3)}, p=${fmtNum(r4.p)}`);
  const bestComponent = Math.max(r3.r ?? 0, r4.r ?? 0);
  const compositeAdds = (r1.r ?? 0) > bestComponent || (r2.r ?? 0) > bestComponent;
  console.log(`    Composite adds value beyond components? ${compositeAdds ? GREEN + 'YES' : RED + 'NO'}${RESET}`);

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1);
  const pass = bestP < 0.05 && compositeAdds;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { momentum: r1, torque: r2, pass, bestP, n: results.length };
}

function test25_controlTheory(wtCases) {
  printHeader('Test 25: Control Theory — Feedback Stability');
  const results = [];

  for (const c of wtCases) {
    if (c.investIntensitySeries.length < 10 || c.revGrowthSeries.length < 10) continue;

    const n = Math.min(c.investIntensitySeries.length, c.revGrowthSeries.length);
    const inv = c.investIntensitySeries.slice(-n);
    const rev = c.revGrowthSeries.slice(-n);

    // Normalize both
    const invM = mean(inv), invS = stddev(inv) || 0.001;
    const revM = mean(rev), revS = stddev(rev) || 0.001;
    const normInv = inv.map(v => (v - invM) / invS);
    const normRev = rev.map(v => (v - revM) / revS);

    // Cross-correlation at lags 0-8
    let bestGain = 0, bestLag = 0, bestSign = 0;
    let signChanges = 0, prevSign = 0;
    const lagCorrs = [];

    for (let lag = 0; lag <= Math.min(8, n - 4); lag++) {
      const x = normInv.slice(0, n - lag);
      const y = normRev.slice(lag);
      const minLen = Math.min(x.length, y.length);
      if (minLen < 4) break;
      const sp = spearmanCorrelation(x.slice(0, minLen), y.slice(0, minLen));
      const r = sp?.rho ?? 0;
      lagCorrs.push(r);
      if (Math.abs(r) > bestGain) { bestGain = Math.abs(r); bestLag = lag; bestSign = Math.sign(r); }
      if (lag > 0 && Math.sign(r) !== 0 && prevSign !== 0 && Math.sign(r) !== prevSign) signChanges++;
      if (Math.sign(r) !== 0) prevSign = Math.sign(r);
    }

    const oscillatory = signChanges >= 2;
    const gainMargin = bestGain / (signChanges + 1);

    results.push({ ...c, gain: bestGain, delay: bestLag, oscillatory, signChanges, gainMargin, bestSign });
  }

  printSub('25A: Coverage');
  console.log(`  Cases: ${results.length}`);

  const r1 = mwTest(results, c => c.gain, '25B: Feedback gain');
  const r2 = mwTest(results, c => c.gainMargin, '25B: Gain margin');
  const r3 = mwTest(results, c => c.delay, '25B: Feedback delay');

  // Oscillation binary
  const oscWin = results.filter(r => r.oscillatory && r.outcome === 'winner').length;
  const oscTrap = results.filter(r => r.oscillatory && r.outcome === 'trap').length;
  const noOscWin = results.filter(r => !r.oscillatory && r.outcome === 'winner').length;
  const noOscTrap = results.filter(r => !r.oscillatory && r.outcome === 'trap').length;
  console.log(`\n  Oscillatory:     ${oscWin}W/${oscTrap}T → WR ${fmtPct((oscWin + oscTrap) > 0 ? oscWin / (oscWin + oscTrap) : null)}`);
  console.log(`  Non-oscillatory: ${noOscWin}W/${noOscTrap}T → WR ${fmtPct((noOscWin + noOscTrap) > 0 ? noOscWin / (noOscWin + noOscTrap) : null)}`);

  const bestP = Math.min(r1.p ?? 1, r2.p ?? 1, r3.p ?? 1);
  const pass = bestP < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { gain: r1, gainMargin: r2, delay: r3, pass, bestP, n: results.length };
}

// ============================================
// BATCH C: Tests 10, 18 (simplified Lyapunov, Transfer Entropy)
// ============================================

function test10_lyapunov(wtCases) {
  printHeader('Test 10: Lyapunov Exponent');
  const results = [];

  for (const c of wtCases) {
    const series = c.revGrowthSeries;
    if (series.length < 12) continue;

    // Rosenstein algorithm (simplified for short series)
    const m = 2, tau = 1; // embedding dim=2, delay=1
    const vectors = [];
    for (let i = 0; i <= series.length - m * tau; i++) {
      vectors.push(series.slice(i, i + m * tau));
    }
    if (vectors.length < 6) continue;

    // For each vector, find nearest neighbor (skip temporally adjacent)
    const divergences = [];
    for (let i = 0; i < vectors.length; i++) {
      let minDist = Infinity, nnIdx = -1;
      for (let j = 0; j < vectors.length; j++) {
        if (Math.abs(i - j) <= 2) continue; // Theiler window
        const d = Math.sqrt(vectors[i].reduce((s, v, k) => s + (v - vectors[j][k]) ** 2, 0));
        if (d > 0 && d < minDist) { minDist = d; nnIdx = j; }
      }
      if (nnIdx >= 0 && minDist > 0) {
        // Track divergence for k steps forward
        for (let k = 1; k <= Math.min(3, vectors.length - Math.max(i, nnIdx) - 1); k++) {
          if (i + k < vectors.length && nnIdx + k < vectors.length) {
            const dK = Math.sqrt(vectors[i + k].reduce((s, v, idx) => s + (v - vectors[nnIdx + k][idx]) ** 2, 0));
            if (dK > 0) {
              if (!divergences[k]) divergences[k] = [];
              divergences[k].push(Math.log(dK));
            }
          }
        }
      }
    }

    // Fit slope to mean divergence curve
    const divCurve = [];
    for (let k = 1; k < divergences.length; k++) {
      if (divergences[k] && divergences[k].length >= 3) divCurve.push({ k, meanDiv: mean(divergences[k]) });
    }
    if (divCurve.length < 2) continue;

    const reg = linearRegression(divCurve.map(d => d.k), divCurve.map(d => d.meanDiv));
    const lambda = reg?.slope ?? null;

    results.push({ ...c, lambda, lambdaR2: reg?.r2 ?? null });
  }

  printSub('10A: Coverage');
  console.log(`  Cases: ${results.length}`);

  const r1 = mwTest(results, c => c.lambda, '10B: Lyapunov λ (revenue growth)');

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { lambda: r1, pass, bestP: r1.p, n: results.length };
}

function test18_transferEntropy(wtCases) {
  printHeader('Test 18: Transfer Entropy (Flywheel Loops)');
  const results = [];

  for (const c of wtCases) {
    const revG = c.revGrowthSeries;
    const margin = c.opMarginSeries;
    const fcfM = c.fcfMarginSeries;
    if (revG.length < 10 || margin.length < 10 || fcfM.length < 10) continue;

    const n = Math.min(revG.length, margin.length, fcfM.length);
    const rg = revG.slice(-n), mg = margin.slice(-n), fm = fcfM.slice(-n);

    // Compute TE for 3 flywheel links
    const te1 = computeTE(rg, mg); // revenue → margin
    const te2 = computeTE(mg, fm); // margin → FCF
    const te3 = computeTE(fm, rg); // FCF → revenue

    // Simple surrogate test: shuffle source 20 times, compare
    let sig1 = false, sig2 = false, sig3 = false;
    if (te1 != null && te2 != null && te3 != null) {
      sig1 = surrogateTest(rg, mg, te1, 20);
      sig2 = surrogateTest(mg, fm, te2, 20);
      sig3 = surrogateTest(fm, rg, te3, 20);
    }

    const loopStrength = (te1 ?? 0) + (te2 ?? 0) + (te3 ?? 0);
    const sigLinks = [sig1, sig2, sig3].filter(Boolean).length;
    const loopComplete = sigLinks >= 2;

    results.push({ ...c, te1, te2, te3, loopStrength, sigLinks, loopComplete });
  }

  printSub('18A: Coverage');
  console.log(`  Cases: ${results.length}`);

  const r1 = mwTest(results, c => c.loopStrength, '18B: Loop strength');

  // Loop completeness
  const completeWin = results.filter(r => r.loopComplete && r.outcome === 'winner').length;
  const completeTrap = results.filter(r => r.loopComplete && r.outcome === 'trap').length;
  const incompleteWin = results.filter(r => !r.loopComplete && r.outcome === 'winner').length;
  const incompleteTrap = results.filter(r => !r.loopComplete && r.outcome === 'trap').length;
  console.log(`\n  Complete loop (≥2 sig links): ${completeWin}W/${completeTrap}T → WR ${fmtPct((completeWin + completeTrap) > 0 ? completeWin / (completeWin + completeTrap) : null)}`);
  console.log(`  Incomplete loop: ${incompleteWin}W/${incompleteTrap}T → WR ${fmtPct((incompleteWin + incompleteTrap) > 0 ? incompleteWin / (incompleteWin + incompleteTrap) : null)}`);

  const pass = (r1.p ?? 1) < 0.05;
  console.log(`\n  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);

  return { loopStrength: r1, pass, bestP: r1.p, n: results.length };
}

function computeTE(source, target, lag = 1, bins = 3) {
  const n = Math.min(source.length, target.length) - lag;
  if (n < 10) return null;

  // Discretize into terciles
  const disc = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const t1 = sorted[Math.floor(sorted.length / 3)];
    const t2 = sorted[Math.floor(2 * sorted.length / 3)];
    return arr.map(v => v <= t1 ? 0 : v <= t2 ? 1 : 2);
  };

  const dSource = disc(source);
  const dTarget = disc(target);

  // Count joint probabilities: P(Y_future, Y_past, X_past)
  const counts3 = {}, counts2YpXp = {}, counts2YfYp = {}, countsYp = {};

  for (let i = lag; i < n + lag; i++) {
    const yf = dTarget[i];     // Y future
    const yp = dTarget[i - lag]; // Y past
    const xp = dSource[i - lag]; // X past

    const k3 = `${yf},${yp},${xp}`;
    const k2yx = `${yp},${xp}`;
    const k2yy = `${yf},${yp}`;
    const k1 = `${yp}`;

    counts3[k3] = (counts3[k3] || 0) + 1;
    counts2YpXp[k2yx] = (counts2YpXp[k2yx] || 0) + 1;
    counts2YfYp[k2yy] = (counts2YfYp[k2yy] || 0) + 1;
    countsYp[k1] = (countsYp[k1] || 0) + 1;
  }

  // TE = Σ P(yf,yp,xp) * log2[P(yf|yp,xp) / P(yf|yp)]
  let te = 0;
  const total = n;
  for (const [k3, c3] of Object.entries(counts3)) {
    const [yf, yp, xp] = k3.split(',');
    const p3 = c3 / total;
    const pYfGivenYpXp = c3 / (counts2YpXp[`${yp},${xp}`] || 1);
    const pYfGivenYp = (counts2YfYp[`${yf},${yp}`] || 0) / (countsYp[yp] || 1);
    if (pYfGivenYp > 0 && pYfGivenYpXp > 0) {
      te += p3 * Math.log2(pYfGivenYpXp / pYfGivenYp);
    }
  }

  return te;
}

function surrogateTest(source, target, realTE, nSurrogates = 20) {
  const surrogates = [];
  for (let s = 0; s < nSurrogates; s++) {
    const shuffled = [...source];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const te = computeTE(shuffled, target);
    if (te != null) surrogates.push(te);
  }
  if (surrogates.length < 5) return false;
  const m = mean(surrogates);
  const s = stddev(surrogates) || 0.001;
  const z = (realTE - m) / s;
  return z > 1.96;
}

// ============================================
// CROSS-VALIDATION OF ALL PASSING SIGNALS
// ============================================

function runAllCrossValidation(caseData) {
  printHeader('CROSS-VALIDATION: All Passing Signals (5-fold, 4/5 required)');
  const wtCases = caseData.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // Load session 1 results for signal references
  const signalDefs = [
    // Session 1 signals
    { name: 'Revenue growth (T31)', fn: c => c.revGrowthSeries.length >= 8 ? mean(c.revenueSeries.slice(-4)) / mean(c.revenueSeries.slice(-8, -4)) - 1 : null },
    { name: 'Dissipative eff. (T20)', fn: c => { const rg = c.revGrowthSeries; const opex = c.revQoQChanges; if (rg.length < 4 || opex.length < 4) return null; const og = mean(opex.slice(-4)); return og > 0.001 ? mean(rg.slice(-4)) / og : null; } },
    { name: 'Scale invariance CV (T21)', fn: c => { const s = c.revGrowthSeries; if (s.length < 12) return null; const scales = [1,2,4,8,12].map(w => s.length >= w ? mean(s.slice(-w)) : null).filter(v=>v!=null); return scales.length>=3 && Math.abs(mean(scales))>0.001 ? stddev(scales)/Math.abs(mean(scales)) : null; } },
    { name: 'Marketing eff. slope (T39)', fn: c => { const s = c.revPerSGASeries; if (s.length < 8) return null; const r = linearRegression(s.map((_,i)=>i), s); return r?.slope ?? null; } },
    { name: 'DNA net direction (T36)', fn: c => { const sv = c.stateVectors; if (sv.length < 8) return null; const dims=4; const ms=[],ss=[]; for(let d=0;d<dims;d++){const v=sv.map(s=>s[d]); ms.push(mean(v)); ss.push(stddev(v)||0.001);} const norm=sv.map(v=>v.map((x,d)=>(x-ms[d])/ss[d])); let nd=0; for(let d=0;d<dims;d++) nd+=norm[norm.length-1][d]-norm[0][d]; return nd; } },
    { name: 'Fracture toughness (T26)', fn: c => { const s = c.opMarginSeries; if(s.length<12)return null; let tough=0; for(let i=4;i<s.length;i++){const bl=mean(s.slice(Math.max(0,i-4),i)); const drop=bl-s[i]; if(drop>0.02){let best=0;for(let j=i+1;j<Math.min(i+9,s.length);j++){best=Math.max(best,(s[j]-s[i])/drop);}tough+=drop*best;}} return tough; } },
    { name: 'Recovery rate (T12)', fn: c => { const s = c.opMarginSeries; if(s.length<12)return null; let events=0,recovered=0; for(let i=4;i<s.length;i++){const bl=mean(s.slice(Math.max(0,i-4),i)); if(bl-s[i]>0.02){events++; for(let j=i+1;j<Math.min(i+9,s.length);j++){if(s[j]>=bl-0.01){recovered++;break;}}}} return events>0?recovered/events:null; } },
    { name: 'Phase displacement (T16)', fn: c => { const sv=c.stateVectors; if(sv.length<13)return null; const r12=sv.slice(-12); const eq=[0,1,2,3].map(d=>mean(r12.map(v=>v[d]))); const sd=[0,1,2,3].map(d=>{const s=stddev(r12.map(v=>v[d]));return s>0.001?s:0.001;}); const cur=sv[sv.length-1]; return mean(cur.map((v,d)=>(v-eq[d])/sd[d])); } },
    { name: 'OU theta (T23)', fn: c => { const s=c.opMarginSeries; if(s.length<8)return null; const x=s.slice(0,-1),y=s.slice(1); const r=linearRegression(x,y); return(r&&r.slope>0&&r.slope<1)?-Math.log(r.slope):null; } },
    { name: 'Accrual slope (T32)', fn: c => { const s=c.accrualRatioSeries; if(s.length<6)return null; return linearRegression(s.map((_,i)=>i),s)?.slope??null; } },
    { name: 'Gross margin chg (T31)', fn: c => { const g=c.grossMarginSeries; return g.length>=8?mean(g.slice(-4))-mean(g.slice(-8,-4)):null; } },
    { name: 'Fragile fraction (T35)', fn: c => { const s=c.opMarginSeries; if(s.length<12)return null; let events=0,fragile=0; for(let i=4;i<s.length;i++){const bl=mean(s.slice(Math.max(0,i-4),i)); if(bl-s[i]>0.02){events++; if(i+4<s.length){const post=mean(s.slice(i+1,Math.min(i+5,s.length))); if(post<bl-0.01)fragile++;}}} return events>0?fragile/events:null; } },
    { name: 'TDA path ratio (T34)', fn: c => { const sv=c.stateVectors; if(sv.length<8)return null; const dims=4; const ms=[],ss=[]; for(let d=0;d<dims;d++){const v=sv.map(s=>s[d]); ms.push(mean(v)); ss.push(stddev(v)||0.001);} const norm=sv.map(v=>v.map((x,d)=>(x-ms[d])/ss[d])); let tp=0,dia=0; for(let i=1;i<norm.length;i++){let d=0;for(let k=0;k<dims;k++)d+=(norm[i][k]-norm[i-1][k])**2;tp+=Math.sqrt(d);} for(let i=0;i<norm.length;i++)for(let j=i+1;j<norm.length;j++){let d=0;for(let k=0;k<dims;k++)d+=(norm[i][k]-norm[j][k])**2;dia=Math.max(dia,Math.sqrt(d));} return dia>0?tp/dia:tp; } },
    { name: 'Conversion slope (T32)', fn: c => { const s=c.cashConversionSeries; if(s.length<6)return null; return linearRegression(s.map((_,i)=>i),s)?.slope??null; } },
  ];

  const cvResults = [];
  for (const sig of signalDefs) {
    const cv = crossValidate(wtCases, sig.fn);
    const initial = mwTest(wtCases, sig.fn, null);
    cvResults.push({ name: sig.name, r: initial.r, p: initial.p, n: initial.n, sigFolds: cv.sigFolds, meanR: cv.meanR, robust: cv.sigFolds >= 4 });
  }

  cvResults.sort((a, b) => (b.r ?? 0) - (a.r ?? 0));

  console.log(`\n  ${'Signal'.padEnd(34)} | ${'r'.padStart(6)} | ${'p'.padStart(8)} | ${'N'.padStart(5)} | CV folds | Status`);
  console.log(`  ${'-'.repeat(34)}-+-${'-'.repeat(6)}-+-${'-'.repeat(8)}-+-${'-'.repeat(5)}-+-${'-'.repeat(8)}-+-------`);
  for (const s of cvResults) {
    const status = s.robust ? GREEN + 'ROBUST' + RESET : s.sigFolds >= 3 ? YELLOW + 'MODERATE' + RESET : RED + (s.sigFolds + '/5') + RESET;
    console.log(`  ${s.name.padEnd(34)} | ${fmtNum(s.r, 3).padStart(6)} | ${fmtNum(s.p).padStart(8)} | ${String(s.n).padStart(5)} | ${String(s.sigFolds + '/5').padStart(8)} | ${status}`);
  }

  const robust = cvResults.filter(s => s.robust);
  console.log(`\n  ${BOLD}Robust signals (4/5+ folds): ${robust.length}${RESET}`);
  for (const s of robust) console.log(`    ${GREEN}${s.name}: r=${fmtNum(s.r, 3)}${RESET}`);

  return cvResults;
}

// ============================================
// COMBINATION SEARCH
// ============================================

function combinationSearch(caseData, cvResults) {
  printHeader('COMBINATION SEARCH: Starting from Zipf+D1 (r=0.312)');
  const wtCases = caseData.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // Get robust signals only
  const robustSignals = cvResults.filter(s => s.robust);
  if (robustSignals.length === 0) {
    console.log(`  No robust signals found. Using all p<0.05 signals for exploratory search.`);
  }

  // Signal functions (reuse from CV section — simplified here)
  const signalFns = {
    'Revenue growth': c => c.revGrowthSeries.length >= 8 ? mean(c.revenueSeries.slice(-4)) / mean(c.revenueSeries.slice(-8, -4)) - 1 : null,
    'Dissipative eff.': c => { const rg = c.revGrowthSeries; const opex = c.revQoQChanges; if (rg.length < 4 || opex.length < 4) return null; const og = mean(opex.slice(-4)); return og > 0.001 ? mean(rg.slice(-4)) / og : null; },
    'Marketing eff.': c => { const s = c.revPerSGASeries; if (s.length < 8) return null; return linearRegression(s.map((_,i)=>i), s)?.slope ?? null; },
    'DNA direction': c => { const sv = c.stateVectors; if (sv.length < 8) return null; const d=4; const ms=[],ss=[]; for(let i=0;i<d;i++){const v=sv.map(s=>s[i]); ms.push(mean(v)); ss.push(stddev(v)||0.001);} const norm=sv.map(v=>v.map((x,i)=>(x-ms[i])/ss[i])); let nd=0; for(let i=0;i<d;i++) nd+=norm[norm.length-1][i]-norm[0][i]; return nd; },
    'Toughness': c => { const s = c.opMarginSeries; if(s.length<12)return null; let t=0; for(let i=4;i<s.length;i++){const bl=mean(s.slice(Math.max(0,i-4),i));const dr=bl-s[i];if(dr>0.02){let best=0;for(let j=i+1;j<Math.min(i+9,s.length);j++)best=Math.max(best,(s[j]-s[i])/dr);t+=dr*best;}}return t; },
    'Recovery rate': c => { const s = c.opMarginSeries; if(s.length<12)return null; let ev=0,rec=0; for(let i=4;i<s.length;i++){const bl=mean(s.slice(Math.max(0,i-4),i));if(bl-s[i]>0.02){ev++;for(let j=i+1;j<Math.min(i+9,s.length);j++){if(s[j]>=bl-0.01){rec++;break;}}}}return ev>0?rec/ev:null; },
    'Phase displacement': c => { const sv=c.stateVectors; if(sv.length<13)return null; const r12=sv.slice(-12); const eq=[0,1,2,3].map(d=>mean(r12.map(v=>v[d]))); const sd=[0,1,2,3].map(d=>{const s=stddev(r12.map(v=>v[d]));return s>0.001?s:0.001;}); return mean(sv[sv.length-1].map((v,d)=>(v-eq[d])/sd[d])); },
    'OU theta': c => { const s=c.opMarginSeries; if(s.length<8)return null; const x=s.slice(0,-1),y=s.slice(1); const r=linearRegression(x,y); return(r&&r.slope>0&&r.slope<1)?-Math.log(r.slope):null; },
  };

  // Test adding each signal to baseline (using z-score averaging)
  printSub('Greedy Forward Selection');
  const available = Object.entries(signalFns);

  console.log(`  Testing each signal individually and as addition to best combination...\n`);

  let bestCombo = [];
  let bestR = 0;

  // Step 1: Test all individually
  const individualResults = [];
  for (const [name, fn] of available) {
    const cases = wtCases.filter(c => fn(c) != null);
    if (cases.length < 50) continue;
    const vals = cases.map(c => ({ outcome: c.outcome, val: fn(c) }));
    const w = vals.filter(v => v.outcome === 'winner').map(v => v.val);
    const t = vals.filter(v => v.outcome === 'trap').map(v => v.val);
    const mw = mannWhitneyU(w, t);
    individualResults.push({ name, r: mw?.effectSizeR ?? 0, p: mw?.p ?? 1, n: cases.length });
  }
  individualResults.sort((a, b) => b.r - a.r);
  console.log(`  Individual signals:`);
  for (const s of individualResults.slice(0, 10)) {
    console.log(`    ${s.name.padEnd(22)}: r=${fmtNum(s.r, 3)}, p=${fmtNum(s.p)}, N=${s.n}`);
  }

  // Step 2: Greedy forward — start with best, add one at a time
  const usedSignals = [];
  const remainingSignals = [...available];

  for (let step = 0; step < 5 && remainingSignals.length > 0; step++) {
    let bestAddition = null, bestAddR = 0;

    for (let i = 0; i < remainingSignals.length; i++) {
      const [name, fn] = remainingSignals[i];
      const allFns = [...usedSignals.map(s => s[1]), fn];

      // Z-score combine all signals
      const combined = wtCases.filter(c => allFns.every(f => f(c) != null));
      if (combined.length < 50) continue;

      const zScores = combined.map(c => {
        const vals = allFns.map(f => f(c));
        return { outcome: c.outcome, score: mean(vals.map((v, j) => {
          const allVals = combined.map(cc => allFns[j](cc));
          const m = mean(allVals), s = stddev(allVals) || 0.001;
          return (v - m) / s;
        })) };
      });

      const w = zScores.filter(z => z.outcome === 'winner').map(z => z.score);
      const t = zScores.filter(z => z.outcome === 'trap').map(z => z.score);
      const mw = mannWhitneyU(w, t);
      const r = mw?.effectSizeR ?? 0;

      if (r > bestAddR) { bestAddR = r; bestAddition = { name, fn, idx: i, r, n: combined.length }; }
    }

    if (!bestAddition || bestAddR <= bestR + 0.005) break; // Stop if marginal < 0.005

    usedSignals.push([bestAddition.name, bestAddition.fn]);
    remainingSignals.splice(bestAddition.idx, 1);
    bestR = bestAddR;
    bestCombo.push(bestAddition.name);
    console.log(`\n  Step ${step + 1}: Add "${bestAddition.name}" → r=${fmtNum(bestR, 3)}, N=${bestAddition.n}`);
    console.log(`    Current combo: ${bestCombo.join(' + ')}`);
  }

  console.log(`\n  ${BOLD}Best combination: ${bestCombo.join(' + ')}${RESET}`);
  console.log(`  ${BOLD}Effect size: r=${fmtNum(bestR, 3)}${RESET}`);
  console.log(`  ${BOLD}vs Zipf+D1 baseline (r=0.312): ${bestR > 0.312 ? GREEN + 'IMPROVEMENT' : RED + 'NO IMPROVEMENT'}${RESET}`);

  return { bestCombo, bestR };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Test Battery Session 2 — Remaining Tests + CV + Combination${RESET}\n${'='.repeat(60)}`);

  const { cases, companyData } = await loadAndPrepare();
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  console.log(`  Winner/trap cases: ${wtCases.length}`);

  const allResults = {};
  const shouldBatch = (b) => !BATCH || BATCH === b;
  const shouldTest = (n) => !TEST_NUM || TEST_NUM === n;

  // Batch A
  if (shouldBatch('A') || shouldBatch('a')) {
    printHeader('BATCH A: HIGH PRIORITY');
    if (shouldTest(29)) allResults.test29 = test29_signaling(wtCases);
    if (shouldTest(13)) allResults.test13 = test13_flywheelMomentum(wtCases);
    if (shouldTest(25)) allResults.test25 = test25_controlTheory(wtCases);
  }

  // Batch C
  if (shouldBatch('C') || shouldBatch('c')) {
    printHeader('BATCH C: LOW PRIORITY');
    if (shouldTest(10)) allResults.test10 = test10_lyapunov(wtCases);
    if (shouldTest(18)) allResults.test18 = test18_transferEntropy(wtCases);
  }

  // Cross-validation
  let cvResults = null;
  if (!BATCH || BATCH === 'cv' || BATCH === 'CV') {
    cvResults = runAllCrossValidation(cases);
    allResults.crossValidation = cvResults;
  }

  // Combination search
  if ((!BATCH || BATCH === 'combo') && cvResults) {
    const combo = combinationSearch(cases, cvResults);
    allResults.combination = combo;
  }

  // Summary
  printHeader('SESSION 2 SUMMARY');
  const testNames = { test29: 'Signaling', test13: 'Flywheel Momentum', test25: 'Control Theory', test10: 'Lyapunov', test18: 'Transfer Entropy' };
  for (const [k, name] of Object.entries(testNames)) {
    const r = allResults[k];
    if (!r) continue;
    const status = r.pass ? GREEN + 'PASS' : RED + 'FAIL';
    console.log(`  ${name.padEnd(22)}: ${status}${RESET} (best p=${fmtNum(r.bestP)}, N=${r.n})`);
  }

  // Save
  const outPath = resolve(import.meta.dirname, '../data', `test-battery-session2-${new Date().toISOString().slice(0, 10)}.json`);
  const saveable = {};
  for (const [k, v] of Object.entries(allResults)) {
    if (k === 'crossValidation') { saveable[k] = v; continue; }
    if (k === 'combination') { saveable[k] = v; continue; }
    const clean = {};
    for (const [ck, cv] of Object.entries(v || {})) {
      if (ck === 'results' || ck === 'rawQm' || typeof cv === 'function') continue;
      clean[ck] = cv;
    }
    saveable[k] = clean;
  }
  writeFileSync(outPath, JSON.stringify(saveable, null, 2));
  console.log(`\n${DIM}Results saved to: ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
