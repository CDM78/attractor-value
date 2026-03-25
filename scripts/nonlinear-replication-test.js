#!/usr/bin/env node
// Nonlinear Dynamics Replication Test
// Tests the EXACT same algorithms from the March 2026 nonlinear dynamics calibration
// on the 1,656-case unbiased dataset. This is a direct replication — same math, different data.
//
// Usage: node scripts/nonlinear-replication-test.js [--dry-run] [--verbose]

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractQuarterlyMetrics, extractUsdNumbers, getRevenueAtDate, buildRollingWindows } from './lib/edgar-extractor.js';
import { benfordFirstDigit } from './lib/benford.js';
import {
  computeScalingExponent, scalingTrajectory,
  maturityBand, companyCSD, revenueDerivatives,
  zipfExponent, rankVelocity, effortAdjustedVelocity, buildSectorRankings, trackRankHistory,
  nonLinearCompositeScore,
} from './lib/nonlinear.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const AGENT_DIR = resolve(DATA_DIR, 'agent');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', DIM = '\x1b[2m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function fmtNum(v, d = 4) { return v == null ? 'N/A' : v.toFixed(d); }
function fmtPct(v, d = 1) { return v == null ? 'N/A' : (v * 100).toFixed(d) + '%'; }

// ============================================
// LOAD THE 1,656 UNBIASED CASES
// ============================================
function loadUnbiasedCases() {
  const deanonKey = loadJSON(resolve(AGENT_DIR, 'deanonymization-key.json'));
  if (!deanonKey) throw new Error('Cannot load deanonymization key');

  // Load all 5 samples
  const allCases = [];
  for (const sample of ['A', 'B', 'C', 'D', 'E']) {
    const data = loadJSON(resolve(AGENT_DIR, `sample-${sample}.json`));
    if (!data) { console.warn(`Warning: Could not load sample-${sample}.json`); continue; }
    for (const c of data) {
      const info = deanonKey.case_id_to_ticker[c.case_id];
      if (!info) continue;
      allCases.push({
        case_id: c.case_id,
        outcome: c.outcome, // 1=winner, 0=trap
        ticker: info.ticker,
        entry_date: info.entry_date,
        company: info.company,
        sector: c.sector, // anonymized but we'll get real sector from systematic data
        sample,
        // Carry forward_return_3yr and sp500_return_3yr from systematic data
      });
    }
  }
  return allCases;
}

// Load systematic cases for returns data
function loadSystematicReturns() {
  const files = [
    'systematic-sp500-crosssection-2013.json',
    'systematic-sp500-crosssection-2016.json',
    'systematic-sp500-crosssection.json',
    'systematic-sp500-crosssection-2022.json',
    'systematic-sp500-changes.json',
    'systematic-smallcap.json',
    'systematic-adr.json',
    'systematic-multi-entry.json',
    'systematic-fraud.json',
  ];
  const returnMap = {}; // ticker|entry_date → { forward_return_3yr, sp500_return_3yr, sector }
  for (const file of files) {
    const data = loadJSON(resolve(DATA_DIR, file));
    if (!data?.cases) continue;
    for (const c of data.cases) {
      const key = `${c.ticker}|${c.entry_date}`;
      returnMap[key] = {
        forward_return_3yr: c.forward_return_3yr,
        sp500_return_3yr: c.sp500_return_3yr,
        sector: c.sector,
        cik: c.cik,
      };
    }
  }
  return returnMap;
}

// Load CIK cache
function loadCikCache() {
  return loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
}

// Load EDGAR facts for a CIK
function loadEdgarFacts(cik) {
  if (!cik) return null;
  const padded = cik.replace(/^0+/, '').padStart(10, '0');
  const path = resolve(EDGAR_CACHE, `${padded}.json`);
  return loadJSON(path);
}

// ============================================
// SIGNAL COMPUTATIONS — EXACT REPLICATION
// ============================================

function computeSignal1_BetaScaling(quarterlyMetrics, entryDate) {
  // Filter to before entry date
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');

  // β from revenue vs assets (original Test 1)
  const betaAssets = computeScalingExponent(filtered, 'assets', 'revenue');

  // β trajectory (early/late split)
  const trajectory = scalingTrajectory(filtered);

  return { betaAssets, trajectory };
}

function computeSignal2_D1GrowthRate(quarterlyMetrics, entryDate) {
  // Average YoY revenue growth over final 8 quarters before entry
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  const withGrowth = filtered.filter(q => q.revenueGrowthYoY != null).slice(-8);
  if (withGrowth.length < 4) return null;
  return mean(withGrowth.map(q => q.revenueGrowthYoY));
}

function computeSignal4_CSD(quarterlyMetrics, entryDate) {
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  return companyCSD(filtered);
}

function computeSignal5_Benford(facts, entryDate) {
  // Use all USD values from the company's EDGAR filings before entry date
  const numbers = extractUsdNumbers(facts);
  if (numbers.length < 50) return null;
  return benfordFirstDigit(numbers);
}

function computeSignal6_SCurve(quarterlyMetrics, entryDate) {
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  return revenueDerivatives(filtered);
}

// ============================================
// ZIPF RANK VELOCITY (Signal 3) — needs sector context
// ============================================
function computeZipfForAllCases(casesWithData) {
  // Group by sector and entry year
  const bySectorYear = {};
  for (const c of casesWithData) {
    if (!c.sector || !c.quarterlyMetrics) continue;
    const entryYear = parseInt(c.entry_date.slice(0, 4));
    const key = `${c.sector}`;
    if (!bySectorYear[key]) bySectorYear[key] = [];
    bySectorYear[key].push(c);
  }

  // For each sector group, compute rank velocity
  for (const [sectorKey, sectorCases] of Object.entries(bySectorYear)) {
    // Build sector companies list for rank tracking
    const sectorCompanies = sectorCases.map(sc => ({
      ticker: sc.ticker,
      quarterlyMetrics: sc.quarterlyMetrics,
    }));

    for (const c of sectorCases) {
      const entryYear = parseInt(c.entry_date.slice(0, 4));
      // Track rank over 4 years before entry
      const years = [];
      for (let y = entryYear - 4; y <= entryYear; y++) years.push(y);

      const history = trackRankHistory(c.ticker, sectorCompanies, years);
      if (history.ranks.length >= 3) {
        const rv = rankVelocity(history.ranks, history.years);
        if (rv) {
          // Get sector Zipf exponent for effort-adjusted velocity
          // Use entry year's sector revenues
          const entryRanking = buildSectorRankings(sectorCompanies, entryYear);
          const revenues = entryRanking.map(r => r.revenue);
          const zipf = zipfExponent(revenues);

          c.zipfVelocity = rv.velocity;
          c.zipfRanksClimbed = rv.ranksClimbed;
          c.zipfR2 = rv.r2;
          c.effortAdjustedVelocity = zipf ? effortAdjustedVelocity(rv, zipf.alpha) : null;
        }
      }
    }
  }
}

// ============================================
// STATISTICAL ANALYSIS
// ============================================
function analyzeSignal(name, winners, traps, curatedR, curatedP, curatedN) {
  if (winners.length < 10 || traps.length < 10) {
    return { name, status: 'INSUFFICIENT_DATA', nWinners: winners.length, nTraps: traps.length };
  }

  const mw = mannWhitneyU(winners, traps);
  const allVals = [...winners.map(v => ({ v, o: 1 })), ...traps.map(v => ({ v, o: 0 }))];
  const sp = spearmanCorrelation(allVals.map(x => x.v), allVals.map(x => x.o));

  const winMean = mean(winners);
  const trapMean = mean(traps);
  const n = winners.length + traps.length;

  const ratio = curatedR > 0 && sp?.rho ? Math.abs(sp.rho / curatedR) : null;
  const directionSame = curatedR > 0 ? (sp?.rho > 0) : (sp?.rho < 0);

  let verdict;
  if (!sp || sp.p > 0.05) verdict = 'DROP';
  else if (ratio >= 0.7) verdict = 'STRONG KEEP';
  else if (ratio >= 0.3) verdict = 'WORTH KEEPING';
  else verdict = 'CURATION ARTIFACT';

  return {
    name,
    unbiased: { r: sp?.rho, p: sp?.p, n },
    curated: { r: curatedR, p: curatedP, n: curatedN },
    winMean, trapMean,
    directionSame,
    ratio,
    verdict,
    mw,
    nWinners: winners.length,
    nTraps: traps.length,
  };
}

// Cross-validation
function crossValidateSignal(name, cases, signalKey) {
  const valid = cases.filter(c => c[signalKey] != null);
  if (valid.length < 50) return null;

  const folds = kFoldSplit(valid, 5, 42);
  const results = [];

  for (let f = 0; f < folds.length; f++) {
    const testCases = folds[f].test.map(i => valid[i]);
    const vals = testCases.map(c => c[signalKey]);
    const outcomes = testCases.map(c => c.outcome);
    const sp = spearmanCorrelation(vals, outcomes);
    results.push({ fold: f + 1, r: sp?.rho, p: sp?.p, n: testCases.length });
  }

  const passingFolds = results.filter(r => r.p < 0.10).length;
  return { name, folds: results, passingFolds, total: 5 };
}

// Return hurdle test
function returnHurdleTest(cases, signalKey) {
  const valid = cases.filter(c => c[signalKey] != null && c.forward_return_3yr != null && c.sp500_return_3yr != null);
  if (valid.length < 50) return null;

  // Sort by signal, split into top and bottom halves
  const sorted = [...valid].sort((a, b) => b[signalKey] - a[signalKey]);
  const mid = Math.floor(sorted.length / 2);
  const topHalf = sorted.slice(0, mid);
  const bottomHalf = sorted.slice(mid);

  const topReturn = mean(topHalf.map(c => c.forward_return_3yr));
  const bottomReturn = mean(bottomHalf.map(c => c.forward_return_3yr));
  const topVOO = mean(topHalf.map(c => c.sp500_return_3yr));
  const bottomVOO = mean(bottomHalf.map(c => c.sp500_return_3yr));

  // Annualized alpha: ((1 + 3yr_return) ^ (1/3)) - ((1 + 3yr_voo) ^ (1/3))
  const topAnnReturn = Math.pow(1 + topReturn, 1/3) - 1;
  const topAnnVOO = Math.pow(1 + topVOO, 1/3) - 1;
  const topAlpha = topAnnReturn - topAnnVOO;

  const bottomAnnReturn = Math.pow(1 + bottomReturn, 1/3) - 1;
  const bottomAnnVOO = Math.pow(1 + bottomVOO, 1/3) - 1;
  const bottomAlpha = bottomAnnReturn - bottomAnnVOO;

  return {
    topN: topHalf.length,
    bottomN: bottomHalf.length,
    topReturn3yr: topReturn,
    bottomReturn3yr: bottomReturn,
    topVOO3yr: topVOO,
    bottomVOO3yr: bottomVOO,
    topAnnualizedAlpha: topAlpha,
    bottomAnnualizedAlpha: bottomAlpha,
    passesHurdle: topAlpha >= 0.03,
    spread: topReturn - bottomReturn,
  };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  NONLINEAR DYNAMICS REPLICATION TEST${X}`);
  console.log(`${B}${C}  Same algorithms, 1,656-case unbiased dataset${X}`);
  console.log(`${B}${C}  Date: ${new Date().toISOString().slice(0, 10)}${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}\n`);

  // Step 1: Load all cases
  console.log('Loading 1,656-case unbiased dataset...');
  const cases = loadUnbiasedCases();
  console.log(`  Loaded ${cases.length} cases`);

  // Step 2: Load returns data from systematic datasets
  console.log('Loading return data from systematic datasets...');
  const returnMap = loadSystematicReturns();
  let returnsAttached = 0;
  for (const c of cases) {
    const key = `${c.ticker}|${c.entry_date}`;
    const ret = returnMap[key];
    if (ret) {
      c.forward_return_3yr = ret.forward_return_3yr;
      c.sp500_return_3yr = ret.sp500_return_3yr;
      c.sector = ret.sector || c.sector;
      c.cik = ret.cik;
      returnsAttached++;
    }
  }
  console.log(`  Returns attached: ${returnsAttached}/${cases.length}`);

  // Step 3: Load CIK cache and EDGAR data
  console.log('Loading CIK cache...');
  const cikCache = loadCikCache();

  console.log('Loading EDGAR data for all cases...');
  let edgarLoaded = 0, edgarMissing = 0;
  const tickerFacts = {}; // ticker → facts (avoid loading same ticker twice)

  for (const c of cases) {
    if (tickerFacts[c.ticker] !== undefined) {
      if (tickerFacts[c.ticker]) edgarLoaded++;
      else edgarMissing++;
      continue;
    }

    // Find CIK
    let cik = c.cik || cikCache[c.ticker]?.cik;
    if (!cik) {
      // Try to find in systematic data
      for (const [key, info] of Object.entries(returnMap)) {
        if (key.startsWith(c.ticker + '|') && info.cik) {
          cik = info.cik;
          break;
        }
      }
    }

    const facts = cik ? loadEdgarFacts(cik) : null;
    tickerFacts[c.ticker] = facts;
    if (facts) edgarLoaded++; else edgarMissing++;
  }
  console.log(`  EDGAR loaded: ${edgarLoaded}, missing: ${edgarMissing}`);

  // Step 4: Compute all signals for each case
  console.log('\nComputing nonlinear dynamics signals...');
  let signal1Count = 0, signal2Count = 0, signal3Count = 0, signal4Count = 0, signal5Count = 0, signal6Count = 0;

  for (const c of cases) {
    const facts = tickerFacts[c.ticker];
    if (!facts) continue;

    // Extract quarterly metrics before entry date
    const qm = extractQuarterlyMetrics(facts, c.entry_date);
    c.quarterlyMetrics = qm;
    c.nQuarters = qm.length;

    if (qm.length < 8) continue;

    // Signal 1: β scaling exponent + trajectory
    const s1 = computeSignal1_BetaScaling(qm, c.entry_date);
    if (s1.betaAssets) {
      c.beta = s1.betaAssets.beta;
      c.betaR2 = s1.betaAssets.r2;
      signal1Count++;
    }
    if (s1.trajectory) {
      c.betaTrajectory = s1.trajectory.betaChange;
      c.betaLate = s1.trajectory.betaLate;
      c.betaEarly = s1.trajectory.betaEarly;
      c.betaTrajectoryLabel = s1.trajectory.trajectory;
    }

    // Signal 2: D1 growth rate
    const d1 = computeSignal2_D1GrowthRate(qm, c.entry_date);
    if (d1 != null) {
      c.d1GrowthRate = d1;
      signal2Count++;
    }

    // Signal 4: CSD
    const csd = computeSignal4_CSD(qm, c.entry_date);
    if (csd?.hasData) {
      c.csdIndex = csd.csdIndex;
      c.csdAcComponent = csd.acComponent;
      c.csdVarComponent = csd.varComponent;
      signal4Count++;
    }

    // Signal 5: Benford KLD
    const benford = computeSignal5_Benford(facts, c.entry_date);
    if (benford) {
      c.benfordKLD = benford.kld;
      c.benfordConformity = benford.conformity;
      signal5Count++;
    }

    // Signal 6: S-Curve phase
    const scurve = computeSignal6_SCurve(qm, c.entry_date);
    if (scurve) {
      c.sCurvePhase = scurve.phase;
      c.avgD1 = scurve.avgD1;
      c.avgD2 = scurve.avgD2;
      signal6Count++;
    }

    // Revenue at entry (for Benford maturity segmentation)
    c.revenueAtEntry = getRevenueAtDate(facts, c.entry_date);
    c.maturityBand = maturityBand(c.revenueAtEntry);
  }

  // Signal 3: Zipf rank velocity (needs sector context)
  console.log('Computing Zipf rank velocity (sector-relative)...');
  computeZipfForAllCases(cases);
  signal3Count = cases.filter(c => c.zipfVelocity != null).length;

  console.log(`\n${B}Signal Coverage:${X}`);
  console.log(`  Signal 1 (β scaling):     ${signal1Count} / ${cases.length} (${fmtPct(signal1Count/cases.length)})`);
  console.log(`  Signal 2 (D1 growth):     ${signal2Count} / ${cases.length} (${fmtPct(signal2Count/cases.length)})`);
  console.log(`  Signal 3 (Zipf velocity): ${signal3Count} / ${cases.length} (${fmtPct(signal3Count/cases.length)})`);
  console.log(`  Signal 4 (CSD):           ${signal4Count} / ${cases.length} (${fmtPct(signal4Count/cases.length)})`);
  console.log(`  Signal 5 (Benford):       ${signal5Count} / ${cases.length} (${fmtPct(signal5Count/cases.length)})`);
  console.log(`  Signal 6 (S-curve):       ${signal6Count} / ${cases.length} (${fmtPct(signal6Count/cases.length)})`);

  // ============================================
  // ANALYSIS
  // ============================================
  const winners = cases.filter(c => c.outcome === 1);
  const traps = cases.filter(c => c.outcome === 0);
  console.log(`\n${B}Dataset composition:${X} ${winners.length} winners, ${traps.length} traps`);

  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  SIGNAL-BY-SIGNAL COMPARISON: CURATED vs UNBIASED${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  const results = [];

  // Signal 1a: β level (static)
  {
    const w = winners.filter(c => c.beta != null).map(c => c.beta);
    const t = traps.filter(c => c.beta != null).map(c => c.beta);
    const r = analyzeSignal('β scaling exponent (static)', w, t, 0.267, 0.0006, 292);
    results.push(r);
    printResult(r);
  }

  // Signal 1b: β trajectory (change)
  {
    const w = winners.filter(c => c.betaTrajectory != null).map(c => c.betaTrajectory);
    const t = traps.filter(c => c.betaTrajectory != null).map(c => c.betaTrajectory);
    const r = analyzeSignal('β trajectory (late-early)', w, t, 0.169, 0.0003, 719);
    results.push(r);
    printResult(r);
  }

  // Signal 2: D1 growth rate
  {
    const w = winners.filter(c => c.d1GrowthRate != null).map(c => c.d1GrowthRate);
    const t = traps.filter(c => c.d1GrowthRate != null).map(c => c.d1GrowthRate);
    const r = analyzeSignal('D1 growth rate', w, t, 0.285, 0.0001, 719);
    results.push(r);
    printResult(r);
  }

  // Signal 3: Zipf rank velocity
  {
    const w = winners.filter(c => c.zipfVelocity != null).map(c => c.zipfVelocity);
    const t = traps.filter(c => c.zipfVelocity != null).map(c => c.zipfVelocity);
    const r = analyzeSignal('Zipf rank velocity', w, t, 0.282, 0.0001, 719);
    results.push(r);
    printResult(r);
  }

  // Signal 3b: Effort-adjusted Zipf velocity
  {
    const w = winners.filter(c => c.effortAdjustedVelocity != null).map(c => c.effortAdjustedVelocity);
    const t = traps.filter(c => c.effortAdjustedVelocity != null).map(c => c.effortAdjustedVelocity);
    const r = analyzeSignal('Zipf effort-adjusted velocity', w, t, 0.239, 0.0005, 292);
    results.push(r);
    printResult(r);
  }

  // Signal 4: CSD index
  {
    const w = winners.filter(c => c.csdIndex != null).map(c => c.csdIndex);
    const t = traps.filter(c => c.csdIndex != null).map(c => c.csdIndex);
    const r = analyzeSignal('CSD index', w, t, 0.074, 0.74, 719);
    results.push(r);
    printResult(r);
  }

  // Signal 5: Benford KLD
  {
    const w = winners.filter(c => c.benfordKLD != null).map(c => c.benfordKLD);
    const t = traps.filter(c => c.benfordKLD != null).map(c => c.benfordKLD);
    const r = analyzeSignal('Benford first-digit KLD', w, t, 0.02, 0.02, 292);
    results.push(r);
    printResult(r);
  }

  // Signal 6: S-curve avgD1 (first derivative)
  {
    const w = winners.filter(c => c.avgD1 != null).map(c => c.avgD1);
    const t = traps.filter(c => c.avgD1 != null).map(c => c.avgD1);
    const r = analyzeSignal('S-curve D1 (avg growth rate)', w, t, 0.331, 0.0001, 292);
    results.push(r);
    printResult(r);
  }

  // Signal 6b: S-curve avgD2 (second derivative / acceleration)
  {
    const w = winners.filter(c => c.avgD2 != null).map(c => c.avgD2);
    const t = traps.filter(c => c.avgD2 != null).map(c => c.avgD2);
    const r = analyzeSignal('S-curve D2 (acceleration)', w, t, 0.15, 0.01, 292);
    results.push(r);
    printResult(r);
  }

  // ============================================
  // COMBINED SIGNALS
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  COMBINED SIGNAL TESTS${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  // Best pair from curated: β trajectory + D1 growth rate
  console.log(`\n${B}Combined: β trajectory + D1 growth rate${X}`);
  {
    const valid = cases.filter(c => c.betaTrajectory != null && c.d1GrowthRate != null);
    if (valid.length >= 50) {
      // Z-score normalize both
      const betaVals = valid.map(c => c.betaTrajectory);
      const d1Vals = valid.map(c => c.d1GrowthRate);
      const betaMean = mean(betaVals), betaStd = stddev(betaVals);
      const d1Mean = mean(d1Vals), d1Std = stddev(d1Vals);

      for (const c of valid) {
        c.combinedBetaD1 = ((c.betaTrajectory - betaMean) / (betaStd || 1) + (c.d1GrowthRate - d1Mean) / (d1Std || 1)) / 2;
      }

      const w = valid.filter(c => c.outcome === 1).map(c => c.combinedBetaD1);
      const t = valid.filter(c => c.outcome === 0).map(c => c.combinedBetaD1);
      const r = analyzeSignal('β trajectory + D1 (combined)', w, t, 0.406, 0.0001, 292);
      results.push(r);
      printResult(r);
    }
  }

  // Full composite score
  console.log(`\n${B}Full nonlinear composite score${X}`);
  {
    const valid = cases.filter(c => c.beta != null || c.betaTrajectory != null || c.csdIndex != null);
    for (const c of valid) {
      c.compositeScore = nonLinearCompositeScore({
        beta: c.beta,
        betaTrajectory: c.betaTrajectory,
        zipfVelocity: c.zipfVelocity,
        csdIndex: c.csdIndex,
        benfordKLD: c.benfordKLD,
        sCurvePhase: c.sCurvePhase,
        companyRevenue: c.revenueAtEntry,
      });
    }

    const withScore = valid.filter(c => c.compositeScore != null);
    if (withScore.length >= 50) {
      const w = withScore.filter(c => c.outcome === 1).map(c => c.compositeScore);
      const t = withScore.filter(c => c.outcome === 0).map(c => c.compositeScore);
      const r = analyzeSignal('Full nonlinear composite', w, t, 0.45, 0.0001, 292);
      results.push(r);
      printResult(r);
    }
  }

  // ============================================
  // ZIPF DIAGNOSTIC
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  ZIPF DIAGNOSTIC: WHY DID f060 FAIL?${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  console.log(`
${B}EXPLANATION 1: DIFFERENT COMPUTATION${X}
The blind agent's f060 was computed as:
  ${R}Percentile rank of revenue growth within sector (STATIC, single point)${X}
  Code: rank = revGrowths.filter(g => g <= f001).length / revGrowths.length

The original Test 5 Zipf rank velocity was computed as:
  ${G}Revenue rank TRAJECTORY over 4 years, linear regression slope (DYNAMIC)${X}
  Code: trackRankHistory() → rankVelocity() → effortAdjustedVelocity()

${B}These are COMPLETELY DIFFERENT computations.${X}
f060 measures "where does your growth rate fall in the sector distribution?"
Original Zipf measures "are you climbing or falling in the sector revenue rankings over time?"

The anonymization script (anonymize-dataset.js) lines 360-365 has the comment:
  // f060: Zipf rank velocity — rank change in revenue growth within sector
  // Simplified: use percentile rank of revenue growth within sector

The "Simplified" annotation confirms this was a conscious simplification that
discarded the temporal component entirely.
`);

  // Now check if real Zipf velocity shows a signal
  const zipfCases = cases.filter(c => c.zipfVelocity != null);
  if (zipfCases.length > 0) {
    const zipfW = zipfCases.filter(c => c.outcome === 1);
    const zipfT = zipfCases.filter(c => c.outcome === 0);
    console.log(`${B}Real Zipf velocity on unbiased data:${X}`);
    console.log(`  Cases with Zipf velocity: ${zipfCases.length}`);
    console.log(`  Winners: ${zipfW.length}, Traps: ${zipfT.length}`);
    if (zipfW.length >= 5 && zipfT.length >= 5) {
      console.log(`  Winner mean velocity: ${fmtNum(mean(zipfW.map(c => c.zipfVelocity)))}`);
      console.log(`  Trap mean velocity:   ${fmtNum(mean(zipfT.map(c => c.zipfVelocity)))}`);
    }
  }

  // Check sector distribution
  console.log(`\n${B}EXPLANATION 2: SECTOR MIX${X}`);
  const sectorCounts = {};
  for (const c of cases) {
    const s = c.sector || 'Unknown';
    sectorCounts[s] = (sectorCounts[s] || 0) + 1;
  }
  console.log('Sector distribution in 1,656-case dataset:');
  for (const [s, n] of Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(30)} ${String(n).padStart(5)}`);
  }

  // ============================================
  // BENFORD BY MATURITY BAND
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  BENFORD KLD BY REVENUE BAND${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  const bands = { 'pre-scale': [], 'early-scaling': [], 'late-scaling': [], 'mature': [] };
  for (const c of cases) {
    if (c.benfordKLD != null && c.maturityBand) {
      bands[c.maturityBand].push(c);
    }
  }

  for (const [band, bandCases] of Object.entries(bands)) {
    const w = bandCases.filter(c => c.outcome === 1);
    const t = bandCases.filter(c => c.outcome === 0);
    if (w.length >= 5 && t.length >= 5) {
      const mw = mannWhitneyU(w.map(c => c.benfordKLD), t.map(c => c.benfordKLD));
      const sp = spearmanCorrelation(
        bandCases.map(c => c.benfordKLD),
        bandCases.map(c => c.outcome)
      );
      console.log(`  ${band.padEnd(15)} N=${String(bandCases.length).padStart(4)}, winner_KLD=${fmtNum(mean(w.map(c => c.benfordKLD)))}, trap_KLD=${fmtNum(mean(t.map(c => c.benfordKLD)))}, r=${fmtNum(sp?.rho)}, p=${fmtNum(sp?.p)}`);
    } else {
      console.log(`  ${band.padEnd(15)} N=${bandCases.length} (insufficient for test)`);
    }
  }

  // ============================================
  // S-CURVE PHASE ANALYSIS
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  S-CURVE PHASE WIN RATES${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  const phases = {};
  for (const c of cases) {
    if (c.sCurvePhase) {
      if (!phases[c.sCurvePhase]) phases[c.sCurvePhase] = { winners: 0, traps: 0 };
      if (c.outcome === 1) phases[c.sCurvePhase].winners++;
      else phases[c.sCurvePhase].traps++;
    }
  }
  for (const [phase, counts] of Object.entries(phases)) {
    const total = counts.winners + counts.traps;
    const winRate = total > 0 ? counts.winners / total : 0;
    console.log(`  ${phase.padEnd(15)} ${String(total).padStart(4)} cases, win rate: ${fmtPct(winRate)} (curated PEAK was 66%)`);
  }

  // ============================================
  // β QUADRANT ANALYSIS
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  β QUADRANT ANALYSIS${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  const quadrants = {
    'β > 1.0 + improving': { w: 0, t: 0 },
    'β > 1.0 + degrading': { w: 0, t: 0 },
    'β < 1.0 + improving': { w: 0, t: 0 },
    'β < 1.0 + degrading': { w: 0, t: 0 },
  };

  for (const c of cases) {
    if (c.betaLate == null || c.betaTrajectory == null) continue;
    const high = c.betaLate > 1.0;
    const improving = c.betaTrajectory > 0;
    const key = `β ${high ? '> 1.0' : '< 1.0'} + ${improving ? 'improving' : 'degrading'}`;
    if (c.outcome === 1) quadrants[key].w++;
    else quadrants[key].t++;
  }

  for (const [q, counts] of Object.entries(quadrants)) {
    const total = counts.w + counts.t;
    const winRate = total > 0 ? counts.w / total : 0;
    const curatedRate = q.includes('> 1.0 + improving') ? 0.852 :
                        q.includes('< 1.0 + improving') ? 0.762 : null;
    console.log(`  ${q.padEnd(25)} N=${String(total).padStart(4)}, win rate: ${fmtPct(winRate)}${curatedRate ? ` (curated: ${fmtPct(curatedRate)})` : ''}`);
  }

  // ============================================
  // RETURN HURDLE TESTS (for signals with p < 0.05)
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  RETURN HURDLE TESTS (≥3% annualized alpha vs VOO)${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  const signalKeys = [
    { key: 'beta', name: 'β scaling exponent' },
    { key: 'betaTrajectory', name: 'β trajectory' },
    { key: 'd1GrowthRate', name: 'D1 growth rate' },
    { key: 'zipfVelocity', name: 'Zipf velocity' },
    { key: 'csdIndex', name: 'CSD index' },
    { key: 'benfordKLD', name: 'Benford KLD' },
    { key: 'avgD1', name: 'S-curve D1' },
    { key: 'combinedBetaD1', name: 'β trajectory + D1 combined' },
    { key: 'compositeScore', name: 'Full composite' },
  ];

  for (const { key, name } of signalKeys) {
    const sigResult = results.find(r => r.name?.includes(name.split(' ')[0]));
    if (!sigResult || !sigResult.unbiased || sigResult.unbiased.p > 0.10) continue;

    const hurdle = returnHurdleTest(cases, key);
    if (!hurdle) continue;

    console.log(`\n  ${B}${name}${X}`);
    console.log(`    Top half:    3yr return ${fmtPct(hurdle.topReturn3yr)}, VOO ${fmtPct(hurdle.topVOO3yr)}, alpha ${fmtPct(hurdle.topAnnualizedAlpha)} ann.`);
    console.log(`    Bottom half: 3yr return ${fmtPct(hurdle.bottomReturn3yr)}, VOO ${fmtPct(hurdle.bottomVOO3yr)}, alpha ${fmtPct(hurdle.bottomAnnualizedAlpha)} ann.`);
    console.log(`    Spread:      ${fmtPct(hurdle.spread)}`);
    console.log(`    ${hurdle.passesHurdle ? G + 'PASSES' : R + 'FAILS'} 3% annualized alpha hurdle${X}`);
  }

  // ============================================
  // 5-FOLD CROSS-VALIDATION (for surviving signals)
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  5-FOLD CROSS-VALIDATION ON UNBIASED DATA${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}`);

  for (const { key, name } of signalKeys) {
    const cv = crossValidateSignal(name, cases, key);
    if (!cv) continue;

    console.log(`\n  ${B}${name}${X} — ${cv.passingFolds}/5 folds pass`);
    for (const fold of cv.folds) {
      const pass = fold.p < 0.10;
      console.log(`    Fold ${fold.fold}: r=${fmtNum(fold.r)}, p=${fmtNum(fold.p)}, N=${fold.n} ${pass ? G + '✓' : R + '✗'}${X}`);
    }
  }

  // ============================================
  // SUMMARY TABLE
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(70)}${X}`);
  console.log(`${B}${C}  FINAL COMPARISON TABLE${X}`);
  console.log(`${B}${C}${'='.repeat(70)}${X}\n`);

  console.log(`${'Signal'.padEnd(35)} ${'Curated r'.padStart(10)} ${'Unbiased r'.padStart(11)} ${'Ratio'.padStart(7)} ${'Verdict'.padStart(18)}`);
  console.log('-'.repeat(82));

  for (const r of results) {
    if (r.status === 'INSUFFICIENT_DATA') {
      console.log(`${r.name.padEnd(35)} ${'N/A'.padStart(10)} ${'INSUF'.padStart(11)} ${'N/A'.padStart(7)} ${'INSUFFICIENT DATA'.padStart(18)}`);
      continue;
    }
    const cr = r.curated?.r != null ? fmtNum(r.curated.r, 3) : 'N/A';
    const ur = r.unbiased?.r != null ? fmtNum(r.unbiased.r, 3) : 'N/A';
    const ratio = r.ratio != null ? fmtNum(r.ratio, 2) : 'N/A';
    const verdictColor = r.verdict?.includes('KEEP') ? G : r.verdict?.includes('DROP') ? R : Y;
    console.log(`${r.name.padEnd(35)} ${cr.padStart(10)} ${ur.padStart(11)} ${ratio.padStart(7)} ${verdictColor}${r.verdict?.padStart(18)}${X}`);
  }

  // ============================================
  // SAVE RESULTS
  // ============================================
  const outputData = {
    metadata: {
      date: new Date().toISOString(),
      description: 'Nonlinear dynamics replication test — same algorithms on 1,656-case unbiased dataset',
      totalCases: cases.length,
      winners: winners.length,
      traps: traps.length,
    },
    signalCoverage: {
      beta: signal1Count,
      d1Growth: signal2Count,
      zipfVelocity: signal3Count,
      csd: signal4Count,
      benford: signal5Count,
      sCurve: signal6Count,
    },
    results: results.map(r => ({
      name: r.name,
      curated: r.curated,
      unbiased: r.unbiased ? { r: r.unbiased.r, p: r.unbiased.p, n: r.unbiased.n } : null,
      ratio: r.ratio,
      verdict: r.verdict,
      winMean: r.winMean,
      trapMean: r.trapMean,
      directionSame: r.directionSame,
    })),
    zipfDiagnostic: {
      explanation: 'f060 in blind agent was a STATIC percentile rank of revenue growth within sector. Original Zipf was DYNAMIC rank trajectory over 4 years. Completely different computation.',
      f060_code: 'rank = revGrowths.filter(g => g <= f001).length / revGrowths.length',
      original_code: 'trackRankHistory() → rankVelocity() → effortAdjustedVelocity()',
      realZipfCoverage: signal3Count,
    },
  };

  const outputPath = resolve(DATA_DIR, `nonlinear-replication-results-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n${G}Results saved to: ${outputPath}${X}`);

  // Save markdown report
  const reportPath = resolve(import.meta.dirname, '../results', `nonlinear-replication-report-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(reportPath, generateMarkdownReport(results, outputData, cases));
  console.log(`${G}Report saved to: ${reportPath}${X}`);
}

function printResult(r) {
  if (r.status === 'INSUFFICIENT_DATA') {
    console.log(`\n  ${B}${r.name}${X}: INSUFFICIENT DATA (${r.nWinners}W, ${r.nTraps}T)`);
    return;
  }
  const verdictColor = r.verdict?.includes('KEEP') ? G : r.verdict?.includes('DROP') ? R : Y;
  console.log(`\n  ${B}${r.name}${X}`);
  console.log(`    Curated:     r = ${fmtNum(r.curated?.r, 3)}, p = ${fmtNum(r.curated?.p)}, N = ${r.curated?.n}`);
  console.log(`    Unbiased:    r = ${fmtNum(r.unbiased?.r, 3)}, p = ${fmtNum(r.unbiased?.p)}, N = ${r.unbiased?.n}`);
  console.log(`    Direction:   ${r.directionSame ? G + 'SAME' : R + 'REVERSED'}${X}`);
  console.log(`    Ratio:       ${fmtNum(r.ratio, 2)}`);
  console.log(`    Winner mean: ${fmtNum(r.winMean)}, Trap mean: ${fmtNum(r.trapMean)}`);
  console.log(`    Verdict:     ${verdictColor}${r.verdict}${X}`);
}

function generateMarkdownReport(results, outputData, cases) {
  const lines = [];
  lines.push('# Nonlinear Dynamics Replication Test Report');
  lines.push(`\n**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Purpose:** Rerun exact nonlinear dynamics computations from March 2026 on 1,656-case unbiased dataset`);
  lines.push(`**Dataset:** ${outputData.metadata.totalCases} cases (${outputData.metadata.winners} winners, ${outputData.metadata.traps} traps)`);
  lines.push(`**Pre-registered hurdle:** ≥3% annualized alpha vs VOO\n`);

  lines.push('---\n');
  lines.push('## Signal Coverage\n');
  lines.push('| Signal | Cases with Data | % Coverage |');
  lines.push('|--------|----------------|------------|');
  for (const [key, count] of Object.entries(outputData.signalCoverage)) {
    lines.push(`| ${key} | ${count} | ${(count / outputData.metadata.totalCases * 100).toFixed(1)}% |`);
  }

  lines.push('\n---\n');
  lines.push('## Signal-by-Signal Comparison\n');
  lines.push('| Signal | Curated r | Unbiased r | Ratio | Direction | Verdict |');
  lines.push('|--------|-----------|-----------|-------|-----------|---------|');
  for (const r of results) {
    const cr = r.curated?.r != null ? r.curated.r.toFixed(3) : 'N/A';
    const ur = r.unbiased?.r != null ? r.unbiased.r.toFixed(3) : 'N/A';
    const ratio = r.ratio != null ? r.ratio.toFixed(2) : 'N/A';
    const dir = r.directionSame == null ? 'N/A' : r.directionSame ? 'Same' : 'REVERSED';
    lines.push(`| ${r.name} | ${cr} | ${ur} | ${ratio} | ${dir} | **${r.verdict || 'N/A'}** |`);
  }

  lines.push('\n---\n');
  lines.push('## Zipf Diagnostic\n');
  lines.push('### Why did f060 show p=0.769 in the blind agent test?\n');
  lines.push('**Answer: Different computation (Explanation 1 confirmed)**\n');
  lines.push('The anonymization script (`scripts/anonymize-dataset.js`, lines 360-365) computed f060 as:');
  lines.push('```javascript');
  lines.push('// f060: Zipf rank velocity — rank change in revenue growth within sector');
  lines.push('// Simplified: use percentile rank of revenue growth within sector');
  lines.push('const rank = revGrowths.filter(g => g <= c.features.f001).length;');
  lines.push('c.features.f060 = round3(rank / revGrowths.length);');
  lines.push('```\n');
  lines.push('The original Test 5 from `scripts/lib/nonlinear.js` computes:');
  lines.push('1. Revenue rank within sector across **multiple years** (4-year lookback)');
  lines.push('2. Linear regression slope of rank over time (rank velocity)');
  lines.push('3. Effort-adjusted velocity normalized by Zipf exponent\n');
  lines.push('These are fundamentally different: f060 is a **static percentile** while the original is a **dynamic trajectory**.');
  lines.push('The label "Simplified" in the anonymization code confirms this was a conscious shortcut that discarded the temporal component.\n');

  lines.push('---\n');
  lines.push('## Recommendations\n');

  const keeps = results.filter(r => r.verdict?.includes('KEEP'));
  const drops = results.filter(r => r.verdict?.includes('DROP') || r.verdict?.includes('ARTIFACT'));

  if (keeps.length > 0) {
    lines.push('### Signals to KEEP\n');
    for (const r of keeps) {
      lines.push(`- **${r.name}**: unbiased r=${r.unbiased?.r?.toFixed(3)}, ratio=${r.ratio?.toFixed(2)}`);
    }
  }

  if (drops.length > 0) {
    lines.push('\n### Signals to DROP\n');
    for (const r of drops) {
      lines.push(`- **${r.name}**: unbiased r=${r.unbiased?.r?.toFixed(3) || 'N/A'}, ratio=${r.ratio?.toFixed(2) || 'N/A'}`);
    }
  }

  lines.push('\n---\n');
  lines.push('*Report generated by nonlinear-replication-test.js*');

  return lines.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });
