#!/usr/bin/env node
// Cross-Population Signal Validation
// Step 5C: 5-fold CV on full dataset
// Step 5D: Population-specific findings (by tier, by market cap proxy)
// Step 5E: Fraud detection validation

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers } from './lib/edgar-extractor.js';
import { computeScalingExponent, scalingTrajectory, trackRankHistory, rankVelocity } from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';
import { getSectorETF, groupBySectorETF } from './lib/sector-map.js';
import { benfordFirstDigit } from './lib/benford.js';

const DRY_RUN = process.argv.includes('--dry-run');
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const fmtPct = (v, d = 1) => v == null ? 'N/A' : (v * 100).toFixed(d) + '%';
const pad = (s, w, a = 'right') => { s = String(s ?? 'N/A'); return a === 'left' ? s.padEnd(w) : s.padStart(w); };
function printH(t) { console.log(`\n${BOLD}${CYAN}${'='.repeat(60)}\n${t}\n${'='.repeat(60)}${RESET}`); }
function printS(t) { console.log(`\n${BOLD}${t}${RESET}\n${DIM}${'-'.repeat(50)}${RESET}`); }

const CAL_DIR = resolve(import.meta.dirname, '../../av-calibration-tool/data');
const DATA_DIR = resolve(import.meta.dirname, '../data');

// ============================================
// PHASE 4: Create Fraud Cases (Tier 9)
// ============================================
function createFraudCases() {
  printH('Phase 4: Fraud Cases (Tier 9)');

  // Well-known accounting fraud / value trap cases with EDGAR data available
  const fraudCases = [
    { ticker: 'GE', company_name: 'General Electric', entry_date: '2017-06-15', outcome: 'trap', reason: 'Accounting manipulation, insurance reserves, power division writedowns' },
    { ticker: 'VALE', company_name: 'Vale S.A.', entry_date: '2015-06-15', outcome: 'trap', reason: 'Samarco dam disaster, environmental fraud concealment' },
    { ticker: 'VRX', company_name: 'Valeant Pharmaceuticals', entry_date: '2015-06-15', outcome: 'trap', reason: 'Channel stuffing, Philidor pharmacy fraud, accounting manipulation' },
    { ticker: 'WFC', company_name: 'Wells Fargo', entry_date: '2016-06-15', outcome: 'trap', reason: 'Fake accounts scandal, systematic consumer fraud' },
    { ticker: 'KHC', company_name: 'Kraft Heinz', entry_date: '2017-06-15', outcome: 'trap', reason: 'SEC investigation, goodwill impairment, aggressive accounting' },
    { ticker: 'T', company_name: 'AT&T', entry_date: '2018-06-15', outcome: 'trap', reason: 'Capital misallocation, debt-fueled acquisitions, dividend trap' },
    { ticker: 'INTC', company_name: 'Intel', entry_date: '2020-06-15', outcome: 'trap', reason: 'Process technology failure, competitive collapse to TSMC/AMD' },
    { ticker: 'IBM', company_name: 'IBM', entry_date: '2014-06-15', outcome: 'trap', reason: 'Revenue decline disguised by buybacks, financial engineering' },
    { ticker: 'M', company_name: 'Macys', entry_date: '2015-06-15', outcome: 'trap', reason: 'Secular retail decline, real estate value trap narrative' },
    { ticker: 'WBA', company_name: 'Walgreens Boots Alliance', entry_date: '2019-06-15', outcome: 'trap', reason: 'PBM pressure, opioid liability, secular pharmacy disruption' },
    { ticker: 'PCG', company_name: 'PG&E', entry_date: '2017-06-15', outcome: 'trap', reason: 'Wildfire liability, safety negligence, bankruptcy' },
    { ticker: 'LB', company_name: 'L Brands', entry_date: '2016-06-15', outcome: 'trap', reason: "Victoria's Secret brand decline, management denial" },
    { ticker: 'CTL', company_name: 'CenturyLink/Lumen', entry_date: '2017-06-15', outcome: 'trap', reason: 'Unsustainable dividend, declining legacy telecom revenue' },
    { ticker: 'F', company_name: 'Ford Motor', entry_date: '2017-06-15', outcome: 'trap', reason: 'EV transition costs, declining sedan market, quality issues' },
    { ticker: 'GPS', company_name: 'Gap Inc', entry_date: '2015-06-15', outcome: 'trap', reason: 'Brand erosion, fast fashion competition, Old Navy cannibalization' },
    { ticker: 'XRX', company_name: 'Xerox', entry_date: '2016-06-15', outcome: 'trap', reason: 'Secular print decline, failed transformation' },
    { ticker: 'HPQ', company_name: 'HP Inc', entry_date: '2016-06-15', outcome: 'trap', reason: 'PC commoditization, ink subscription controversy' },
    { ticker: 'KSS', company_name: 'Kohls', entry_date: '2017-06-15', outcome: 'trap', reason: 'Department store secular decline, activist distractions' },
  ];

  const dataset = {
    metadata: {
      tier: 9,
      dataset_role: 'fraud_validation',
      source: 'Known accounting fraud and value trap companies',
      case_count: fraudCases.length,
      winners: 0, traps: fraudCases.length, underperform: 0, mixed: 0,
      generated: new Date().toISOString(),
    },
    cases: fraudCases.map((c, i) => ({
      case_id: `T9-${String(i + 1).padStart(3, '0')}`,
      ...c,
      tier: 9,
      dataset_role: 'fraud_validation',
      entry: { date: c.entry_date, sector: null },
    })),
  };

  const outPath = resolve(DATA_DIR, 'fraud-cases.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`  Created ${fraudCases.length} fraud cases → ${outPath}`);

  return fraudCases;
}

// ============================================
// DATA LOADING
// ============================================
async function loadAll() {
  console.log(`${BOLD}Loading all data...${RESET}`);
  const cases = loadCalibrationCases();
  await ensureCikCache();
  const tickers = getUniqueTickers(cases);

  const cd = {};
  let ok = 0;
  for (const t of tickers) {
    const cik = getCikForTicker(t);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) continue;
    const r = await fetchFactsForTicker(t);
    if (!r.facts) continue;
    const qm = extractQuarterlyMetrics(r.facts);
    if (qm.length < 4) continue;
    const numbers = extractUsdNumbers(r.facts);
    const benford = benfordFirstDigit(numbers);
    cd[t] = { qm, benfordKLD: benford?.kld ?? null };
    ok++;
    if (ok % 50 === 0) process.stdout.write(`  ${ok}...\r`);
  }
  console.log(`\n  Loaded: ${ok} tickers`);

  // Also load fraud cases
  const fraudCases = createFraudCases();
  for (const fc of fraudCases) {
    if (!cd[fc.ticker]) {
      const cik = getCikForTicker(fc.ticker);
      if (DRY_RUN && cik && !hasCachedFacts(cik)) continue;
      const r = await fetchFactsForTicker(fc.ticker);
      if (!r.facts) continue;
      const qm = extractQuarterlyMetrics(r.facts);
      if (qm.length < 4) continue;
      const numbers = extractUsdNumbers(r.facts);
      const benford = benfordFirstDigit(numbers);
      cd[fc.ticker] = { qm, benfordKLD: benford?.kld ?? null };
    }
  }

  // Build sector data for Zipf
  const sectorGroups = groupBySectorETF(cases);
  const sectorCompanyData = {};
  for (const [etf, sc] of Object.entries(sectorGroups)) {
    const companies = [];
    for (const c of sc) {
      if (cd[c.ticker]) companies.push({ ticker: c.ticker, quarterlyMetrics: cd[c.ticker].qm });
    }
    if (companies.length >= 10) sectorCompanyData[etf] = companies;
  }
  const years = Array.from({ length: 10 }, (_, i) => 2015 + i);

  return { cases, cd, sectorCompanyData, years, fraudCases };
}

// ============================================
// SIGNAL COMPUTATION
// ============================================
function computeSignals(ticker, qm, benfordKLD, sectorCompanyData, years, sector) {
  // Pre-compute percentile ranks (will be filled in main)
  const signals = {};

  // D1 growth rate
  const growthSeries = qm.map(q => q.revenueGrowthYoY).filter(v => v != null && isFinite(v));
  signals.d1Growth = growthSeries.length > 0 ? growthSeries[growthSeries.length - 1] : null;

  // Revenue growth (4Q vs prior 4Q)
  const revs = qm.map(q => q.revenue).filter(v => v != null && v > 0);
  if (revs.length >= 8) {
    const recent = mean(revs.slice(-4)), earlier = mean(revs.slice(-8, -4));
    signals.revGrowth = earlier > 0 ? (recent - earlier) / earlier : null;
  }

  // Scale invariance CV
  if (growthSeries.length >= 12) {
    const scales = [1, 2, 4, 8, 12].map(w => growthSeries.length >= w ? mean(growthSeries.slice(-w)) : null).filter(v => v != null);
    signals.scaleCV = scales.length >= 3 && Math.abs(mean(scales)) > 0.001 ? stddev(scales) / Math.abs(mean(scales)) : null;
  }

  // β trajectory 12Q
  const valid = qm.filter(q => q.assets > 0 && q.revenue > 0);
  if (valid.length >= 12) {
    const mid = Math.max(0, valid.length - 12);
    const early = valid.slice(0, mid), late = valid.slice(mid);
    if (early.length >= 4 && late.length >= 4) {
      const bE = computeScalingExponent(early), bL = computeScalingExponent(late);
      if (bE && bL) signals.betaTraj = bL.beta - bE.beta;
    }
  }

  // Zipf rank velocity
  const etf = getSectorETF(sector);
  if (sectorCompanyData[etf]) {
    const rh = trackRankHistory(ticker, sectorCompanyData[etf], years);
    if (rh.ranks.length >= 3) {
      const rv = rankVelocity(rh.ranks, rh.years);
      if (rv) signals.zipfVel = rv.velocity;
    }
  }

  // Benford KLD
  signals.benfordKLD = benfordKLD;

  // Market cap proxy (assets as proxy for size segmentation)
  signals.totalAssets = qm[qm.length - 1]?.assets ?? null;

  // Additional for fraud detection
  // Accrual ratio
  const accruals = qm.map(q => (q.netIncome != null && q.ocf != null && q.assets > 0) ? (q.netIncome - q.ocf) / q.assets : null).filter(v => v != null && isFinite(v));
  signals.accrualRatio = accruals.length > 0 ? accruals[accruals.length - 1] : null;

  // Cash conversion
  const cc = qm.map(q => (q.ocf != null && q.netIncome != null && Math.abs(q.netIncome) > 1000) ? q.ocf / q.netIncome : null).filter(v => v != null && isFinite(v) && Math.abs(v) < 100);
  signals.cashConversion = cc.length > 0 ? cc[cc.length - 1] : null;

  return signals;
}

// ============================================
// STEP 5C: 5-fold CV on full dataset
// ============================================
function step5C(allSignals) {
  printH('Step 5C: 5-Fold CV on Full Expanded Dataset');

  const wtCases = allSignals.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  console.log(`  W/T cases: ${wtCases.length}`);

  // Flywheel Momentum needs percentile ranks
  const allAssets = wtCases.map(c => c.totalAssets).filter(v => v != null && v > 0).sort((a, b) => a - b);
  const allRoic = wtCases.map(c => c.roic).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  const pct = (v, sorted) => v != null ? sorted.filter(x => x <= v).length / sorted.length : null;

  for (const c of wtCases) {
    const massR = pct(c.totalAssets, allAssets);
    const speedR = pct(c.roic, allRoic);
    c.flywheelMomentum = (massR != null && speedR != null) ? massR * speedR : null;
  }

  const signalDefs = [
    { name: 'Flywheel Momentum', fn: c => c.flywheelMomentum },
    { name: 'D1 growth rate', fn: c => c.d1Growth },
    { name: 'Zipf rank velocity', fn: c => c.zipfVel },
    { name: 'Revenue growth', fn: c => c.revGrowth },
    { name: 'Scale invariance CV', fn: c => c.scaleCV },
    { name: 'β trajectory 12Q', fn: c => c.betaTraj },
  ];

  const cvResults = [];
  console.log(`\n  ${'Signal'.padEnd(24)} | ${'r'.padStart(6)} | ${'p'.padStart(8)} | ${'N'.padStart(5)} | CV folds | Status`);
  console.log(`  ${'-'.repeat(24)}-+-${'-'.repeat(6)}-+-${'-'.repeat(8)}-+-${'-'.repeat(5)}-+-${'-'.repeat(8)}-+-------`);

  for (const sig of signalDefs) {
    const items = wtCases.filter(c => sig.fn(c) != null).map(c => ({ o: c.outcome, v: sig.fn(c) }));
    if (items.length < 20) { cvResults.push({ name: sig.name, sigFolds: 0, n: items.length }); continue; }

    const w = items.filter(i => i.o === 'winner').map(i => i.v);
    const t = items.filter(i => i.o === 'trap').map(i => i.v);
    const full = mannWhitneyU(w, t);

    const folds = kFoldSplit(items, 5, 42);
    const foldPs = folds.map(({ train, test }) => {
      const tw = test.filter(i => items[i].o === 'winner').map(i => items[i].v);
      const tt = test.filter(i => items[i].o === 'trap').map(i => items[i].v);
      return (tw.length >= 2 && tt.length >= 2) ? (mannWhitneyU(tw, tt)?.p ?? 1) : 1;
    });
    const sigFolds = foldPs.filter(p => p < 0.05).length;
    const status = sigFolds >= 4 ? GREEN + 'ROBUST' + RESET : sigFolds >= 3 ? YELLOW + 'MODERATE' + RESET : RED + sigFolds + '/5' + RESET;

    console.log(`  ${sig.name.padEnd(24)} | ${fmtNum(full?.effectSizeR, 3).padStart(6)} | ${fmtNum(full?.p).padStart(8)} | ${String(items.length).padStart(5)} | ${String(sigFolds + '/5').padStart(8)} | ${status}`);
    cvResults.push({ name: sig.name, r: full?.effectSizeR, p: full?.p, n: items.length, sigFolds, robust: sigFolds >= 4, foldPs });
  }

  // FM + D1 pair
  printS('FM + D1 Pair CV');
  const pairItems = wtCases.filter(c => c.flywheelMomentum != null && c.d1Growth != null);
  if (pairItems.length >= 20) {
    const fmVals = pairItems.map(c => c.flywheelMomentum);
    const d1Vals = pairItems.map(c => c.d1Growth);
    const fmM = mean(fmVals), fmS = stddev(fmVals) || 0.001;
    const d1M = mean(d1Vals), d1S = stddev(d1Vals) || 0.001;
    const combined = pairItems.map((c, i) => ({
      o: c.outcome,
      v: ((fmVals[i] - fmM) / fmS + (d1Vals[i] - d1M) / d1S) / 2,
    }));

    const wC = combined.filter(c => c.o === 'winner').map(c => c.v);
    const tC = combined.filter(c => c.o === 'trap').map(c => c.v);
    const fullPair = mannWhitneyU(wC, tC);

    const pairFolds = kFoldSplit(combined, 5, 42);
    const pairFoldPs = pairFolds.map(({ train, test }) => {
      const tw = test.filter(i => combined[i].o === 'winner').map(i => combined[i].v);
      const tt = test.filter(i => combined[i].o === 'trap').map(i => combined[i].v);
      return (tw.length >= 2 && tt.length >= 2) ? (mannWhitneyU(tw, tt)?.p ?? 1) : 1;
    });
    const pairSigFolds = pairFoldPs.filter(p => p < 0.05).length;
    console.log(`  FM + D1 pair: r=${fmtNum(fullPair?.effectSizeR, 3)}, p=${fmtNum(fullPair?.p)}, CV=${pairSigFolds}/5 → ${pairSigFolds >= 4 ? GREEN + 'ROBUST' : RED + 'WEAK'}${RESET}`);
    console.log(`  Fold p-values: ${pairFoldPs.map(p => fmtNum(p)).join(', ')}`);
    cvResults.push({ name: 'FM + D1 pair', r: fullPair?.effectSizeR, p: fullPair?.p, n: pairItems.length, sigFolds: pairSigFolds, robust: pairSigFolds >= 4, foldPs: pairFoldPs });
  }

  return cvResults;
}

// ============================================
// STEP 5D: Population-specific findings
// ============================================
function step5D(allSignals) {
  printH('Step 5D: Population-Specific Signal Performance');

  const wtCases = allSignals.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  // By Tier
  printS('Signal Performance by Tier');
  const tiers = [...new Set(wtCases.map(c => c.tier))].sort();
  const signalDefs = [
    { name: 'FM', fn: c => c.flywheelMomentum },
    { name: 'D1 growth', fn: c => c.d1Growth },
    { name: 'Zipf vel', fn: c => c.zipfVel },
    { name: 'Rev growth', fn: c => c.revGrowth },
    { name: 'Scale CV', fn: c => c.scaleCV },
  ];

  console.log(`  ${'Tier'.padEnd(8)} | ${'N'.padStart(5)} | ${signalDefs.map(s => s.name.padStart(10)).join(' | ')}`);
  console.log(`  ${'-'.repeat(8)}-+-${'-'.repeat(5)}-+-${signalDefs.map(() => '-'.repeat(10)).join('-+-')}`);

  const tierResults = {};
  for (const tier of tiers) {
    const tierCases = wtCases.filter(c => c.tier === tier);
    const results = {};
    for (const sig of signalDefs) {
      const w = tierCases.filter(c => c.outcome === 'winner' && sig.fn(c) != null).map(c => sig.fn(c));
      const t = tierCases.filter(c => c.outcome === 'trap' && sig.fn(c) != null).map(c => sig.fn(c));
      const mw = (w.length >= 2 && t.length >= 2) ? mannWhitneyU(w, t) : null;
      results[sig.name] = { r: mw?.effectSizeR ?? null, p: mw?.p ?? null, n: w.length + t.length };
    }
    tierResults[tier] = { n: tierCases.length, results };

    const vals = signalDefs.map(s => {
      const r = results[s.name];
      return r.p != null && r.p < 0.05 ? GREEN + fmtNum(r.r, 2).padStart(10) + RESET : fmtNum(r.r, 2).padStart(10);
    });
    console.log(`  ${'T' + tier} ${pad(tierCases.length, 5, 'left')} | ${vals.join(' | ')}`);
  }

  // By Market Cap (using assets as proxy)
  printS('Signal Performance by Size (Assets Proxy)');
  const assetValues = wtCases.map(c => c.totalAssets).filter(v => v != null && v > 0);
  const p33 = assetValues.sort((a, b) => a - b)[Math.floor(assetValues.length / 3)];
  const p67 = assetValues[Math.floor(2 * assetValues.length / 3)];

  const sizeGroups = [
    { name: 'Small (<$' + (p33 / 1e9).toFixed(0) + 'B)', filter: c => c.totalAssets != null && c.totalAssets < p33 },
    { name: 'Mid ($' + (p33 / 1e9).toFixed(0) + '-' + (p67 / 1e9).toFixed(0) + 'B)', filter: c => c.totalAssets != null && c.totalAssets >= p33 && c.totalAssets < p67 },
    { name: 'Large (>$' + (p67 / 1e9).toFixed(0) + 'B)', filter: c => c.totalAssets != null && c.totalAssets >= p67 },
  ];

  const sizeResults = {};
  for (const sg of sizeGroups) {
    const group = wtCases.filter(sg.filter);
    const results = {};
    for (const sig of signalDefs) {
      const w = group.filter(c => c.outcome === 'winner' && sig.fn(c) != null).map(c => sig.fn(c));
      const t = group.filter(c => c.outcome === 'trap' && sig.fn(c) != null).map(c => sig.fn(c));
      const mw = (w.length >= 2 && t.length >= 2) ? mannWhitneyU(w, t) : null;
      results[sig.name] = { r: mw?.effectSizeR ?? null, p: mw?.p ?? null };
    }
    sizeResults[sg.name] = { n: group.length, results };
    const vals = signalDefs.map(s => {
      const r = results[s.name];
      return r.p != null && r.p < 0.05 ? GREEN + fmtNum(r.r, 2).padStart(10) + RESET : fmtNum(r.r, 2).padStart(10);
    });
    console.log(`  ${sg.name.padEnd(20)} N=${String(group.length).padStart(4)} | ${vals.join(' | ')}`);
  }

  // Benford KLD distribution by tier
  printS('Benford KLD Distribution by Tier');
  for (const tier of tiers) {
    const tierCases = allSignals.filter(c => c.tier === tier && c.benfordKLD != null);
    console.log(`  T${tier}: mean KLD=${fmtNum(mean(tierCases.map(c => c.benfordKLD)), 4)}, N=${tierCases.length}`);
  }

  return { tierResults, sizeResults };
}

// ============================================
// STEP 5E: Fraud Detection Validation
// ============================================
async function step5E(fraudCases, cd, sectorCompanyData, years, allSignals) {
  printH('Step 5E: Fraud Detection Validation');

  const wtCases = allSignals.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  const allAssets = wtCases.map(c => c.totalAssets).filter(v => v != null && v > 0).sort((a, b) => a - b);
  const allRoic = wtCases.map(c => c.roic).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  const pct = (v, sorted) => v != null ? sorted.filter(x => x <= v).length / sorted.length : null;

  // Compute signals for each fraud case
  const fraudSignals = [];
  for (const fc of fraudCases) {
    const data = cd[fc.ticker];
    if (!data) { console.log(`  ${fc.ticker}: no EDGAR data`); continue; }

    const sig = computeSignals(fc.ticker, data.qm, data.benfordKLD, sectorCompanyData, years, null);

    // ROIC for FM
    const roicArr = data.qm.map(q => (q.operatingIncome != null && q.equity > 0) ? q.operatingIncome * 0.79 / ((q.equity || 0) + (q.longTermDebt || 0) || 1) : null).filter(v => v != null && isFinite(v));
    sig.roic = roicArr.length > 0 ? roicArr[roicArr.length - 1] : null;
    sig.flywheelMomentum = (pct(sig.totalAssets, allAssets) ?? 0) * (pct(sig.roic, allRoic) ?? 0);

    // FM + D1 combined (z-score using main dataset stats)
    const fmAll = wtCases.map(c => c.flywheelMomentum).filter(v => v != null);
    const d1All = wtCases.map(c => c.d1Growth).filter(v => v != null);
    const fmM = mean(fmAll), fmS = stddev(fmAll) || 0.001;
    const d1M = mean(d1All), d1S = stddev(d1All) || 0.001;
    sig.fmD1Score = (sig.flywheelMomentum != null && sig.d1Growth != null)
      ? ((sig.flywheelMomentum - fmM) / fmS + (sig.d1Growth - d1M) / d1S) / 2
      : null;

    fraudSignals.push({ ticker: fc.ticker, company: fc.company_name, reason: fc.reason, ...sig });
  }

  console.log(`\n  Fraud cases with data: ${fraudSignals.length}`);

  // Per-signal: what fraction of frauds would be flagged?
  printS('Fraud Detection by Signal');

  // Compute winner medians for thresholds
  const winnerMedians = {};
  const signalKeys = ['flywheelMomentum', 'd1Growth', 'zipfVel', 'revGrowth', 'scaleCV', 'betaTraj', 'accrualRatio', 'cashConversion', 'benfordKLD'];
  for (const key of signalKeys) {
    const wVals = wtCases.filter(c => c.outcome === 'winner' && c[key] != null).map(c => c[key]);
    const tVals = wtCases.filter(c => c.outcome === 'trap' && c[key] != null).map(c => c[key]);
    winnerMedians[key] = { wMedian: median(wVals), tMedian: median(tVals) };
  }

  console.log(`\n  ${'Signal'.padEnd(22)} | Flagged | Detection Rate | Fraud Mean | Trap Mean | Winner Mean`);
  console.log(`  ${'-'.repeat(22)}-+---------+----------------+------------+-----------+------------`);

  const detectionResults = {};
  for (const key of signalKeys) {
    const fraudWithSignal = fraudSignals.filter(f => f[key] != null);
    if (fraudWithSignal.length === 0) continue;

    const trapMedian = winnerMedians[key].tMedian;
    const winMedian = winnerMedians[key].wMedian;

    // "Flagged" = signal value is on the trap side of the trap median
    // For most signals: lower = worse (except scaleCV where higher = worse, and zipfVel where more positive = worse)
    let flagged;
    if (key === 'scaleCV') {
      flagged = fraudWithSignal.filter(f => f[key] > trapMedian).length;
    } else if (key === 'zipfVel') {
      flagged = fraudWithSignal.filter(f => f[key] > trapMedian).length; // Positive velocity = falling
    } else if (key === 'accrualRatio') {
      flagged = fraudWithSignal.filter(f => f[key] > trapMedian).length; // High accruals = bad
    } else if (key === 'benfordKLD') {
      flagged = fraudWithSignal.filter(f => f[key] > trapMedian).length; // High KLD = non-conforming
    } else {
      flagged = fraudWithSignal.filter(f => f[key] < trapMedian).length; // Below trap median = very bad
    }

    const rate = flagged / fraudWithSignal.length;
    const fraudMean = mean(fraudWithSignal.map(f => f[key]));
    const tMean = mean(wtCases.filter(c => c.outcome === 'trap' && c[key] != null).map(c => c[key]));
    const wMean = mean(wtCases.filter(c => c.outcome === 'winner' && c[key] != null).map(c => c[key]));

    console.log(`  ${key.padEnd(22)} | ${String(flagged + '/' + fraudWithSignal.length).padStart(7)} | ${fmtPct(rate).padStart(14)} | ${fmtNum(fraudMean, 3).padStart(10)} | ${fmtNum(tMean, 3).padStart(9)} | ${fmtNum(wMean, 3).padStart(10)}`);
    detectionResults[key] = { flagged, total: fraudWithSignal.length, rate, fraudMean, trapMean: tMean, winnerMean: wMean };
  }

  // FM + D1 pair rejection
  printS('FM + D1 Pair: Fraud Rejection');
  const pairFrauds = fraudSignals.filter(f => f.fmD1Score != null);
  const pairThreshold = 0; // Below zero = trap side
  const rejected = pairFrauds.filter(f => f.fmD1Score < pairThreshold).length;
  console.log(`  Fraud cases with FM+D1 score: ${pairFrauds.length}`);
  console.log(`  Rejected (score < 0): ${rejected}/${pairFrauds.length} = ${fmtPct(pairFrauds.length > 0 ? rejected / pairFrauds.length : null)}`);

  // Per-fraud case detail
  printS('Per-Fraud Case Detail');
  console.log(`  ${'Ticker'.padEnd(6)} | ${'FM'.padStart(6)} | ${'D1'.padStart(6)} | ${'FM+D1'.padStart(6)} | ${'Benford'.padStart(8)} | ${'Accrual'.padStart(8)} | Reason`);
  for (const f of fraudSignals) {
    console.log(`  ${f.ticker.padEnd(6)} | ${fmtNum(f.flywheelMomentum, 3).padStart(6)} | ${fmtNum(f.d1Growth, 3).padStart(6)} | ${fmtNum(f.fmD1Score, 2).padStart(6)} | ${fmtNum(f.benfordKLD, 4).padStart(8)} | ${fmtNum(f.accrualRatio, 4).padStart(8)} | ${f.reason?.substring(0, 40)}`);
  }

  return { detectionResults, fraudSignals, rejected, total: pairFrauds.length };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Cross-Population Signal Validation${RESET}\n${'='.repeat(50)}`);

  const { cases, cd, sectorCompanyData, years, fraudCases } = await loadAll();

  // Compute signals for all main cases
  const allSignals = [];
  const wtCases = cases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');

  for (const c of cases) {
    if (!cd[c.ticker]) continue;
    const sig = computeSignals(c.ticker, cd[c.ticker].qm, cd[c.ticker].benfordKLD, sectorCompanyData, years, c.sector);

    // ROIC for FM
    const roicArr = cd[c.ticker].qm.map(q => (q.operatingIncome != null && q.equity > 0) ? q.operatingIncome * 0.79 / ((q.equity || 0) + (q.longTermDebt || 0) || 1) : null).filter(v => v != null && isFinite(v));
    sig.roic = roicArr.length > 0 ? roicArr[roicArr.length - 1] : null;

    allSignals.push({ ...c, ...sig });
  }

  console.log(`  Cases with signals: ${allSignals.length}`);

  // Compute FM percentile ranks
  const assetsSorted = allSignals.filter(c => c.totalAssets > 0).map(c => c.totalAssets).sort((a, b) => a - b);
  const roicSorted = allSignals.filter(c => c.roic != null && isFinite(c.roic)).map(c => c.roic).sort((a, b) => a - b);
  for (const c of allSignals) {
    const mR = c.totalAssets > 0 ? assetsSorted.filter(v => v <= c.totalAssets).length / assetsSorted.length : null;
    const sR = (c.roic != null && isFinite(c.roic)) ? roicSorted.filter(v => v <= c.roic).length / roicSorted.length : null;
    c.flywheelMomentum = (mR != null && sR != null) ? mR * sR : null;
  }

  // Run all steps
  const cvResults = step5C(allSignals);
  const popResults = step5D(allSignals);
  const fraudResults = await step5E(fraudCases, cd, sectorCompanyData, years, allSignals);

  // Save results
  const output = {
    cvResults: cvResults.map(({ foldPs, ...r }) => r),
    populationResults: {
      tierResults: Object.fromEntries(Object.entries(popResults.tierResults).map(([k, v]) => [k, { n: v.n, results: Object.fromEntries(Object.entries(v.results).map(([sk, sv]) => [sk, { r: sv.r, p: sv.p }])) }])),
      sizeResults: Object.fromEntries(Object.entries(popResults.sizeResults).map(([k, v]) => [k, { n: v.n, results: Object.fromEntries(Object.entries(v.results).map(([sk, sv]) => [sk, { r: sv.r, p: sv.p }])) }])),
    },
    fraudDetection: {
      detectionResults: fraudResults.detectionResults,
      pairRejection: { rejected: fraudResults.rejected, total: fraudResults.total },
      perCase: fraudResults.fraudSignals.map(({ reason, ...r }) => r),
    },
    timestamp: new Date().toISOString(),
  };

  writeFileSync(resolve(DATA_DIR, 'cross-population-validation-2026-03-24.json'), JSON.stringify(output, null, 2));
  console.log(`\n${DIM}Results saved${RESET}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
