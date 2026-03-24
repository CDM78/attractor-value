#!/usr/bin/env node
// Final CV Validation — 4 untested signals + robust combination search

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics } from './lib/edgar-extractor.js';
import { computeScalingExponent, scalingTrajectory, trackRankHistory, rankVelocity } from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';
import { getSectorETF, groupBySectorETF } from './lib/sector-map.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);

async function main() {
  console.log(`${BOLD}Final CV Validation${RESET}\n${'='.repeat(50)}`);

  // Load data
  const cases = loadCalibrationCases();
  await ensureCikCache();
  const tickers = getUniqueTickers(cases);

  const companyData = {};
  let loaded = 0;
  for (const ticker of tickers) {
    const cik = getCikForTicker(ticker);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) continue;
    const result = await fetchFactsForTicker(ticker);
    if (!result.facts) continue;
    const qm = extractQuarterlyMetrics(result.facts);
    if (qm.length < 4) continue;
    companyData[ticker] = qm;
    loaded++;
    if (loaded % 50 === 0) process.stdout.write(`  ${loaded}...\r`);
  }
  console.log(`  Loaded: ${loaded} tickers\n`);

  // Build sector data for Zipf
  const sectorGroups = groupBySectorETF(cases);
  const sectorCompanyData = {};
  for (const [etf, sectorCases] of Object.entries(sectorGroups)) {
    const companies = [];
    for (const c of sectorCases) {
      if (companyData[c.ticker]) companies.push({ ticker: c.ticker, quarterlyMetrics: companyData[c.ticker] });
    }
    if (companies.length >= 10) sectorCompanyData[etf] = companies;
  }
  const years = Array.from({ length: 10 }, (_, i) => 2015 + i);

  // Compute all 4 signals per case
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  const caseSignals = [];

  // Pre-compute percentile ranks for flywheel momentum
  const allAssets = [], allRoic = [];
  for (const c of wtCases) {
    const qm = companyData[c.ticker];
    if (!qm) continue;
    const latest = qm[qm.length - 1];
    if (latest.assets > 0) allAssets.push(latest.assets);
    const roicArr = qm.map(q => {
      if (q.operatingIncome != null && q.equity > 0) {
        const cap = (q.equity || 0) + (q.longTermDebt || 0);
        return cap > 0 ? q.operatingIncome * 0.79 / cap : null;
      }
      return null;
    }).filter(v => v != null && isFinite(v));
    if (roicArr.length > 0) allRoic.push(roicArr[roicArr.length - 1]);
  }
  const assetsSorted = [...allAssets].sort((a, b) => a - b);
  const roicSorted = [...allRoic].sort((a, b) => a - b);
  const pctile = (v, sorted) => v != null ? sorted.filter(x => x <= v).length / sorted.length : null;

  for (const c of wtCases) {
    const qm = companyData[c.ticker];
    if (!qm) continue;

    // 1. Flywheel Momentum
    const latest = qm[qm.length - 1];
    const roicArr = qm.map(q => {
      if (q.operatingIncome != null && q.equity > 0) {
        const cap = (q.equity || 0) + (q.longTermDebt || 0);
        return cap > 0 ? q.operatingIncome * 0.79 / cap : null;
      }
      return null;
    }).filter(v => v != null && isFinite(v));
    const massRank = pctile(latest.assets, assetsSorted);
    const speedRank = roicArr.length > 0 ? pctile(roicArr[roicArr.length - 1], roicSorted) : null;
    const momentum = (massRank != null && speedRank != null) ? massRank * speedRank : null;

    // 2. D1 growth rate
    const growthSeries = qm.map(q => q.revenueGrowthYoY).filter(v => v != null && isFinite(v));
    const d1Growth = growthSeries.length > 0 ? growthSeries[growthSeries.length - 1] : null;

    // 3. Zipf rank velocity
    let zipfVel = null;
    const etf = getSectorETF(c.sector);
    if (sectorCompanyData[etf]) {
      const rh = trackRankHistory(c.ticker, sectorCompanyData[etf], years);
      if (rh.ranks.length >= 3) {
        const rv = rankVelocity(rh.ranks, rh.years);
        if (rv) zipfVel = rv.velocity;
      }
    }

    // 4. β trajectory 12Q
    const valid = qm.filter(q => q.assets > 0 && q.revenue > 0);
    let betaTraj = null;
    if (valid.length >= 12) {
      const mid = Math.max(0, valid.length - 12);
      const early = valid.slice(0, mid);
      const late = valid.slice(mid);
      if (early.length >= 4 && late.length >= 4) {
        const bEarly = computeScalingExponent(early);
        const bLate = computeScalingExponent(late);
        if (bEarly && bLate) betaTraj = bLate.beta - bEarly.beta;
      }
    }

    caseSignals.push({ ticker: c.ticker, outcome: c.outcome, momentum, d1Growth, zipfVel, betaTraj });
  }

  // Define signals
  const signals = [
    { name: 'Flywheel Momentum (T13)', fn: c => c.momentum, r: 0.331 },
    { name: 'D1 growth rate', fn: c => c.d1Growth, r: 0.285 },
    { name: 'Zipf rank velocity', fn: c => c.zipfVel, r: 0.282 },
    { name: 'β trajectory 12Q', fn: c => c.betaTraj, r: 0.169 },
  ];

  // Also add the 2 already-confirmed robust signals for combination search
  const revGrowthFn = c => {
    const qm = companyData[c.ticker];
    if (!qm || qm.length < 8) return null;
    const revs = qm.map(q => q.revenue).filter(v => v != null && v > 0);
    if (revs.length < 8) return null;
    const recent = mean(revs.slice(-4)), earlier = mean(revs.slice(-8, -4));
    return earlier > 0 ? (recent - earlier) / earlier : null;
  };
  const scaleCVFn = c => {
    const qm = companyData[c.ticker];
    if (!qm) return null;
    const gs = qm.map(q => q.revenueGrowthYoY).filter(v => v != null && isFinite(v));
    if (gs.length < 12) return null;
    const scales = [1, 2, 4, 8, 12].map(w => gs.length >= w ? mean(gs.slice(-w)) : null).filter(v => v != null);
    if (scales.length < 3 || Math.abs(mean(scales)) < 0.001) return null;
    return stddev(scales) / Math.abs(mean(scales));
  };

  // Run CV on each signal
  console.log(`${BOLD}5-Fold Cross-Validation Results${RESET}\n`);
  console.log(`  ${'Signal'.padEnd(28)} | F1 p     | F2 p     | F3 p     | F4 p     | F5 p     | Sig | Verdict`);
  console.log(`  ${'-'.repeat(28)}-+----------+----------+----------+----------+----------+-----+--------`);

  const cvResults = [];

  for (const sig of signals) {
    const items = caseSignals.filter(c => sig.fn(c) != null).map(c => ({ outcome: c.outcome, val: sig.fn(c) }));
    if (items.length < 20) {
      console.log(`  ${sig.name.padEnd(28)} | insufficient data (N=${items.length})`);
      cvResults.push({ name: sig.name, sigFolds: 0, robust: false, items: items.length });
      continue;
    }

    const folds = kFoldSplit(items, 5, 42);
    const foldPs = [];
    const foldRs = [];

    for (const { train, test } of folds) {
      const tw = test.filter(i => items[i].outcome === 'winner').map(i => items[i].val);
      const tt = test.filter(i => items[i].outcome === 'trap').map(i => items[i].val);
      const mw = (tw.length >= 2 && tt.length >= 2) ? mannWhitneyU(tw, tt) : null;
      foldPs.push(mw?.p ?? 1);
      foldRs.push(mw?.effectSizeR ?? 0);
    }

    const sigFolds = foldPs.filter(p => p < 0.05).length;
    const verdict = sigFolds >= 4 ? GREEN + 'ROBUST' + RESET : sigFolds >= 3 ? YELLOW + 'MODERATE' + RESET : RED + (sigFolds <= 1 ? 'FAILED' : 'WEAK') + RESET;

    console.log(`  ${sig.name.padEnd(28)} | ${foldPs.map(p => fmtNum(p).padStart(8)).join(' | ')} | ${String(sigFolds).padStart(3)} | ${verdict}`);

    cvResults.push({ name: sig.name, foldPs, foldRs, sigFolds, robust: sigFolds >= 4, meanR: mean(foldRs), n: items.length, originalR: sig.r });
  }

  // Summary
  const robust = cvResults.filter(r => r.robust);
  console.log(`\n  ${BOLD}Robust (4/5+): ${robust.length}${RESET}`);
  for (const r of robust) console.log(`    ${GREEN}${r.name}: original r=${r.originalR}, CV mean r=${fmtNum(r.meanR, 3)}${RESET}`);

  const moderate = cvResults.filter(r => r.sigFolds === 3);
  if (moderate.length) {
    console.log(`  ${BOLD}Moderate (3/5): ${moderate.length}${RESET}`);
    for (const r of moderate) console.log(`    ${YELLOW}${r.name}: original r=${r.originalR}, CV mean r=${fmtNum(r.meanR, 3)}${RESET}`);
  }

  // Combination search with ALL robust signals (new + prior session)
  console.log(`\n${BOLD}Combination Search (Robust Signals Only)${RESET}\n${'='.repeat(50)}`);

  // Build ticker→caseSignal lookup
  const csMap = {};
  for (const cs of caseSignals) csMap[cs.ticker] = cs;

  // Gather all robust signal functions
  const robustSignalFns = [];
  for (const r of cvResults) {
    if (!r.robust) continue;
    const sig = signals.find(s => s.name === r.name);
    if (sig) robustSignalFns.push({ name: r.name, fn: c => { const cs = csMap[c.ticker]; return cs ? sig.fn(cs) : null; } });
  }
  // Add prior-confirmed robust signals
  robustSignalFns.push({ name: 'Revenue growth (T31)', fn: c => revGrowthFn(c) });
  robustSignalFns.push({ name: 'Scale invariance CV (T21)', fn: c => scaleCVFn(c) });

  console.log(`  Robust signals for combination: ${robustSignalFns.length}`);
  for (const s of robustSignalFns) console.log(`    - ${s.name}`);

  // Test all pairs
  if (robustSignalFns.length >= 2) {
    console.log(`\n  Pairwise combinations:`);
    const pairResults = [];

    for (let i = 0; i < robustSignalFns.length; i++) {
      for (let j = i + 1; j < robustSignalFns.length; j++) {
        const a = robustSignalFns[i], b = robustSignalFns[j];
        const combined = wtCases.filter(c => a.fn(c) != null && b.fn(c) != null);
        if (combined.length < 50) continue;

        // Z-score combine
        const aVals = combined.map(c => a.fn(c));
        const bVals = combined.map(c => b.fn(c));
        const aM = mean(aVals), aS = stddev(aVals) || 0.001;
        const bM = mean(bVals), bS = stddev(bVals) || 0.001;

        const scores = combined.map((c, idx) => ({
          outcome: c.outcome,
          score: ((aVals[idx] - aM) / aS + (bVals[idx] - bM) / bS) / 2,
        }));

        const w = scores.filter(s => s.outcome === 'winner').map(s => s.score);
        const t = scores.filter(s => s.outcome === 'trap').map(s => s.score);
        const mw = mannWhitneyU(w, t);

        pairResults.push({ a: a.name, b: b.name, r: mw?.effectSizeR ?? 0, p: mw?.p ?? 1, n: combined.length });
      }
    }

    pairResults.sort((a, b) => b.r - a.r);
    for (const pr of pairResults) {
      console.log(`    ${(pr.a + ' + ' + pr.b).padEnd(55)} r=${fmtNum(pr.r, 3)}, p=${fmtNum(pr.p)}, N=${pr.n}`);
    }

    // CV the best pair
    if (pairResults.length > 0) {
      const best = pairResults[0];
      console.log(`\n  ${BOLD}Best robust pair: ${best.a} + ${best.b} (r=${fmtNum(best.r, 3)})${RESET}`);

      // Cross-validate the best pair
      const aFn = robustSignalFns.find(s => s.name === best.a).fn;
      const bFn = robustSignalFns.find(s => s.name === best.b).fn;
      const pairCases = wtCases.filter(c => aFn(c) != null && bFn(c) != null);
      const aAll = pairCases.map(c => aFn(c));
      const bAll = pairCases.map(c => bFn(c));
      const aM2 = mean(aAll), aS2 = stddev(aAll) || 0.001;
      const bM2 = mean(bAll), bS2 = stddev(bAll) || 0.001;

      const pairItems = pairCases.map((c, idx) => ({
        outcome: c.outcome,
        val: ((aAll[idx] - aM2) / aS2 + (bAll[idx] - bM2) / bS2) / 2,
      }));

      const pairFolds = kFoldSplit(pairItems, 5, 42);
      const pairFoldPs = pairFolds.map(({ train, test }) => {
        const tw = test.filter(i => pairItems[i].outcome === 'winner').map(i => pairItems[i].val);
        const tt = test.filter(i => pairItems[i].outcome === 'trap').map(i => pairItems[i].val);
        const mw = (tw.length >= 2 && tt.length >= 2) ? mannWhitneyU(tw, tt) : null;
        return mw?.p ?? 1;
      });

      const pairSigFolds = pairFoldPs.filter(p => p < 0.05).length;
      console.log(`  CV on best pair: ${pairFoldPs.map(p => fmtNum(p)).join(', ')}`);
      console.log(`  ${BOLD}Folds significant: ${pairSigFolds}/5 → ${pairSigFolds >= 4 ? GREEN + 'ROBUST' : pairSigFolds >= 3 ? YELLOW + 'MODERATE' : RED + 'WEAK'}${RESET}`);
    }
  }

  // Save results
  const output = { cvResults, robust: robust.map(r => ({ name: r.name, r: r.originalR, meanCVr: r.meanR, folds: r.sigFolds })) };
  const outPath = resolve(import.meta.dirname, '../data/cv-final-validation-2026-03-24.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n${DIM}Saved to ${outPath}${RESET}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
