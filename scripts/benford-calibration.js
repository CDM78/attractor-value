#!/usr/bin/env node
// Benford's Law Multi-Digit Calibration Test Suite
//
// Tests whether SEC EDGAR financial statement digit distributions can detect
// manipulated data and serve as a quantitative flywheel health indicator.
//
// Usage:
//   node scripts/benford-calibration.js [options]
//
// Options:
//   --test N          Run only test N (1-5, 7, 8)
//   --dry-run         Use cached EDGAR data only, skip fetching
//   --refresh         Re-fetch EDGAR data even if cached
//   --fetch-only      Only fetch and cache EDGAR data
//   --ticker AAPL     Single-ticker diagnostic
//   --verbose         Print per-company detail
//   --output FILE     JSON output path

import { loadCalibrationCases, getUniqueTickers, groupByOutcome } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractUsdNumbers, extractionSummary, buildRollingWindows, extractKeyMetricDigits } from './lib/edgar-extractor.js';
import { benfordFirstDigit, benfordSecondDigit, benfordFirstTwoDigits, benfordThirdDigit, digitConvergenceProfile, runAllTests } from './lib/benford.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median } from './lib/statistics.js';
import { getSectorETF, getSectorName, getAllSectorETFs, groupBySectorETF } from './lib/sector-map.js';
import * as reporter from './lib/reporter.js';

// ============================================
// CLI ARGUMENT PARSING
// ============================================
const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const TEST_NUM = getArg('test') ? parseInt(getArg('test')) : null;
const DRY_RUN = hasFlag('dry-run');
const REFRESH = hasFlag('refresh');
const FETCH_ONLY = hasFlag('fetch-only');
const SINGLE_TICKER = getArg('ticker');
const VERBOSE = hasFlag('verbose');
const OUTPUT_PATH = getArg('output');

// ============================================
// DATA LOADING
// ============================================
async function loadData() {
  console.log('Loading calibration cases...');
  let cases = loadCalibrationCases();
  console.log(`  ${cases.length} cases loaded across ${getUniqueTickers(cases).length} unique tickers`);

  const byOutcome = groupByOutcome(cases);
  for (const [cls, list] of Object.entries(byOutcome)) {
    if (list.length > 0) console.log(`    ${cls}: ${list.length}`);
  }

  if (SINGLE_TICKER) {
    cases = cases.filter(c => c.ticker === SINGLE_TICKER.toUpperCase());
    if (cases.length === 0) {
      // Create a synthetic case for diagnostic mode
      cases = [{ ticker: SINGLE_TICKER.toUpperCase(), company: SINGLE_TICKER, outcome: 'unknown', entry_date: '2024-01-01', sector: 'Unknown', tier: 0, pipeline: 'Diagnostic' }];
    }
  }

  console.log('\nEnsuring CIK cache...');
  await ensureCikCache();

  // Fetch EDGAR data for all tickers
  const tickers = getUniqueTickers(cases);
  console.log(`\nFetching EDGAR data for ${tickers.length} tickers...`);

  const companyData = {}; // ticker → { facts, numbers, summary }
  let fetched = 0, cached = 0, failed = 0, noData = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);

    if (DRY_RUN && cik && !hasCachedFacts(cik)) {
      failed++;
      continue;
    }

    const result = await fetchFactsForTicker(ticker, { refresh: REFRESH });

    if (result.error) {
      if (VERBOSE) console.log(`  ${ticker}: ${result.error}`);
      failed++;
      continue;
    }

    if (!result.facts) {
      noData++;
      continue;
    }

    const numbers = extractUsdNumbers(result.facts);
    const summary = extractionSummary(result.facts);

    if (numbers.length === 0) {
      noData++;
      continue;
    }

    companyData[ticker] = { facts: result.facts, numbers, summary, cik: result.cik };

    if (hasCachedFacts(result.cik)) cached++; else fetched++;

    if (VERBOSE) {
      console.log(`  ${ticker}: ${numbers.length} USD values, ${summary.dateRange}`);
    }

    // Progress every 20 tickers
    if (!VERBOSE && (i + 1) % 20 === 0) {
      process.stdout.write(`  ${i + 1}/${tickers.length}...\r`);
    }
  }

  console.log(`\n  Data loaded: ${Object.keys(companyData).length} companies, ${failed} failed, ${noData} no data`);

  return { cases, companyData };
}

// ============================================
// TEST 1: AGGREGATE BASELINE
// ============================================
function runTest1(cases, companyData) {
  const allNumbers = [];
  for (const ticker of Object.keys(companyData)) {
    allNumbers.push(...companyData[ticker].numbers);
  }

  const results = {
    totalPoints: allNumbers.length,
    firstDigit: benfordFirstDigit(allNumbers),
    secondDigit: benfordSecondDigit(allNumbers),
    firstTwoDigits: benfordFirstTwoDigits(allNumbers),
    thirdDigit: benfordThirdDigit(allNumbers),
    convergence: digitConvergenceProfile(allNumbers),
  };

  return reporter.reportTest1(results) ? { ...results, pass: true } : { ...results, pass: false };
}

// ============================================
// TEST 2: FRAUD AND DATA QUALITY
// ============================================
function runTest2(cases, companyData) {
  // Compute per-company scores
  const companyScores = [];
  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;

    const d1 = benfordFirstDigit(data.numbers);
    const d2 = benfordSecondDigit(data.numbers);
    const d1d2 = benfordFirstTwoDigits(data.numbers);
    const conv = digitConvergenceProfile(data.numbers);

    companyScores.push({
      ticker: c.ticker,
      outcome: c.outcome,
      d1, d2, d1d2, conv,
      n: data.numbers.length,
    });
  }

  // 2A: First-digit conformity by class
  const firstDigitByClass = buildConformityTable(companyScores, 'd1');

  // 2B: First-two-digit conformity by class
  const firstTwoByClass = buildConformityTable(companyScores, 'd1d2');

  // Threshold flags across all companies
  const thresholdFlags = [];
  for (const cs of companyScores) {
    if (cs.d1d2?.thresholdFlags) {
      for (const f of cs.d1d2.thresholdFlags) {
        thresholdFlags.push({ ticker: cs.ticker, outcome: cs.outcome, ...f });
      }
    }
  }
  thresholdFlags.sort((a, b) => Math.abs(b.belowZScore) - Math.abs(a.belowZScore));

  // 2C: Multi-test flagged companies
  const flaggedCompanies = [];
  for (const cs of companyScores) {
    const d1Conform = cs.d1?.conformity || 'N/A';
    const d2Conform = cs.d2?.conformity || 'N/A';
    const d1d2Conform = cs.d1d2?.conformity || 'N/A';

    let testsFailed = 0;
    if (d1Conform === 'non-conforming' || d1Conform === 'marginal') testsFailed++;
    if (d2Conform === 'non-conforming') testsFailed++;
    if (d1d2Conform === 'non-conforming') testsFailed++;

    if (testsFailed > 0) {
      flaggedCompanies.push({
        ticker: cs.ticker, outcome: cs.outcome,
        d1Conform, d2Conform, d1d2Conform,
        testsFailed,
        confidence: testsFailed >= 2 ? 'HIGH' : 'MODERATE',
      });
    }
  }
  flaggedCompanies.sort((a, b) => b.testsFailed - a.testsFailed);

  // 2D: Convergence anomalies
  const convergenceAnomalies = {};
  for (const cs of companyScores) {
    if (!cs.conv?.flags) continue;
    for (const flag of cs.conv.flags) {
      const key = flag.split(':')[0];
      if (!convergenceAnomalies[key]) convergenceAnomalies[key] = {};
      const outcome = cs.outcome || 'unknown';
      convergenceAnomalies[key][outcome] = (convergenceAnomalies[key][outcome] || 0) + 1;
    }
  }

  // Also count "Any flag"
  const anyFlag = {};
  for (const cs of companyScores) {
    if (cs.conv?.flags?.length > 0) {
      const outcome = cs.outcome || 'unknown';
      anyFlag[outcome] = (anyFlag[outcome] || 0) + 1;
    }
  }
  if (Object.keys(anyFlag).length > 0) {
    convergenceAnomalies['Any_flag'] = anyFlag;
  }

  const results = {
    companyScores, firstDigitByClass, firstTwoByClass,
    thresholdFlags, flaggedCompanies, convergenceAnomalies,
  };

  reporter.reportTest2(results);
  return results;
}

function buildConformityTable(companyScores, testKey) {
  const table = {};
  for (const cs of companyScores) {
    const test = cs[testKey];
    const outcome = cs.outcome || 'unknown';
    if (!table[outcome]) table[outcome] = { close: 0, acceptable: 0, marginal: 0, 'non-conforming': 0, total: 0 };
    table[outcome].total++;
    if (test?.conformity) {
      table[outcome][test.conformity] = (table[outcome][test.conformity] || 0) + 1;
    }
  }
  return table;
}

// ============================================
// TEST 3: DISCRIMINATORY POWER
// ============================================
function runTest3(cases, companyData) {
  const byOutcome = groupByOutcome(cases);
  const winnerTickers = byOutcome.winner.map(c => c.ticker).filter(t => companyData[t]);
  const trapTickers = byOutcome.trap.map(c => c.ticker).filter(t => companyData[t]);

  const getKLDs = (tickers, testFn) => {
    const klds = [];
    for (const t of tickers) {
      const result = testFn(companyData[t].numbers);
      if (result) klds.push(result.kld);
    }
    return klds;
  };

  const tests = {
    'First digit': [benfordFirstDigit],
    'Second digit': [benfordSecondDigit],
    'First-two': [benfordFirstTwoDigits],
  };

  const byTest = {};
  let bestTest = null, bestEffectSize = 0;

  for (const [label, [testFn]] of Object.entries(tests)) {
    const winnerKLDs = getKLDs(winnerTickers, testFn);
    const trapKLDs = getKLDs(trapTickers, testFn);

    if (winnerKLDs.length < 3 || trapKLDs.length < 3) {
      byTest[label] = null;
      continue;
    }

    const mw = mannWhitneyU(winnerKLDs, trapKLDs);
    byTest[label] = {
      winnerMeanKLD: mean(winnerKLDs),
      trapMeanKLD: mean(trapKLDs),
      gap: mean(trapKLDs) - mean(winnerKLDs),
      pValue: mw?.p ?? null,
      effectSizeR: mw?.effectSizeR ?? null,
      winnerN: winnerKLDs.length,
      trapN: trapKLDs.length,
    };

    if (mw && mw.effectSizeR > bestEffectSize) {
      bestEffectSize = mw.effectSizeR;
      bestTest = label;
    }
  }

  // Convergence ratio comparison
  let convergenceComparison = null;
  const winnerConvRatios = [], trapConvRatios = [];
  for (const t of winnerTickers) {
    const conv = digitConvergenceProfile(companyData[t].numbers);
    if (conv) winnerConvRatios.push(conv.convergenceRatio);
  }
  for (const t of trapTickers) {
    const conv = digitConvergenceProfile(companyData[t].numbers);
    if (conv) trapConvRatios.push(conv.convergenceRatio);
  }
  if (winnerConvRatios.length >= 3 && trapConvRatios.length >= 3) {
    const mw = mannWhitneyU(winnerConvRatios, trapConvRatios);
    convergenceComparison = {
      winnerMean: mean(winnerConvRatios),
      trapMean: mean(trapConvRatios),
      pValue: mw?.p ?? null,
      effectSizeR: mw?.effectSizeR ?? null,
    };
    if (mw && mw.effectSizeR > bestEffectSize) {
      bestEffectSize = mw.effectSizeR;
      bestTest = 'Convergence ratio';
    }
  }

  const results = {
    byTest,
    convergenceComparison,
    bestDiscriminator: bestTest,
    bestEffectSize,
  };

  reporter.reportTest3(results);
  return results;
}

// ============================================
// TESTS 4 & 5: TEMPORAL ANALYSIS
// ============================================
function runTemporalTests(cases, companyData, bestTestFn) {
  const byOutcome = groupByOutcome(cases);
  const testFn = bestTestFn || benfordFirstDigit;

  const slopes = { winner: [], trap: [], underperform: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data || !data.summary.temporalEligible) continue;

    const windows = buildRollingWindows(data.facts);
    if (windows.length < 3) continue; // Need at least 3 windows for a meaningful slope

    // Compute KLD for each window
    const klds = [];
    for (let i = 0; i < windows.length; i++) {
      const result = testFn(windows[i].values);
      if (result) klds.push({ x: i, kld: result.kld });
    }

    if (klds.length < 3) continue;

    const reg = linearRegression(klds.map(k => k.x), klds.map(k => k.kld));
    if (!reg) continue;

    const outcome = c.outcome || 'unknown';
    if (slopes[outcome]) {
      slopes[outcome].push({ ticker: c.ticker, slope: reg.slope, r2: reg.r2, windows: klds.length });
    }
  }

  // Test 4: Flywheel formation
  const winnerSlopes = slopes.winner.map(s => s.slope);
  const trapSlopes = slopes.trap.map(s => s.slope);
  const underperformSlopes = slopes.underperform.map(s => s.slope);

  const mw45 = (winnerSlopes.length >= 2 && trapSlopes.length >= 2)
    ? mannWhitneyU(winnerSlopes, trapSlopes) : null;

  const totalEligible = winnerSlopes.length + trapSlopes.length + underperformSlopes.length;

  const test4Results = {
    eligibleCases: totalEligible,
    totalCases: cases.length,
    testUsed: 'First digit (default)',
    winnerSlope: winnerSlopes.length > 0 ? mean(winnerSlopes) : null,
    trapSlope: trapSlopes.length > 0 ? mean(trapSlopes) : null,
    underperformSlope: underperformSlopes.length > 0 ? mean(underperformSlopes) : null,
    winnerPctImproving: winnerSlopes.length > 0 ? winnerSlopes.filter(s => s < 0).length / winnerSlopes.length : 0,
    trapPctImproving: trapSlopes.length > 0 ? trapSlopes.filter(s => s < 0).length / trapSlopes.length : 0,
    underperformPctImproving: underperformSlopes.length > 0 ? underperformSlopes.filter(s => s < 0).length / underperformSlopes.length : 0,
    pValue: mw45?.p ?? null,
  };

  const test4Pass = reporter.reportTest4(test4Results);

  // Test 5: Dissolution warning
  const test5Results = {
    trapsWorsening: trapSlopes.filter(s => s > 0).length,
    totalTraps: trapSlopes.length,
    trapsWorseningPct: trapSlopes.length > 0 ? trapSlopes.filter(s => s > 0).length / trapSlopes.length : 0,
    winnersWorsening: winnerSlopes.filter(s => s > 0).length,
    totalWinners: winnerSlopes.length,
    winnersWorseningPct: winnerSlopes.length > 0 ? winnerSlopes.filter(s => s > 0).length / winnerSlopes.length : 0,
    slopeDetails: { winner: slopes.winner, trap: slopes.trap, underperform: slopes.underperform },
  };

  const test5Pass = reporter.reportTest5(test5Results);

  return {
    test4: { ...test4Results, pass: test4Pass },
    test5: { ...test5Results, pass: test5Pass },
  };
}

// ============================================
// TEST 7: SECTOR-LEVEL
// ============================================
function runTest7(cases, companyData) {
  const sectorGroups = groupBySectorETF(cases);
  const sectors = [];

  for (const etf of getAllSectorETFs()) {
    const sectorCases = sectorGroups[etf];
    if (!sectorCases || sectorCases.length === 0) continue;

    // Aggregate all USD values for this sector
    const allNumbers = [];
    let companiesWithData = 0;
    for (const c of sectorCases) {
      if (companyData[c.ticker]) {
        allNumbers.push(...companyData[c.ticker].numbers);
        companiesWithData++;
      }
    }

    if (allNumbers.length < 50) continue;

    const d1 = benfordFirstDigit(allNumbers);
    const d1d2 = benfordFirstTwoDigits(allNumbers);
    const conv = digitConvergenceProfile(allNumbers);

    sectors.push({
      etf,
      name: getSectorName(etf),
      companies: companiesWithData,
      points: allNumbers.length,
      d1KLD: d1?.kld ?? null,
      d1d2KLD: d1d2?.kld ?? null,
      convRatio: conv?.convergenceRatio ?? null,
      d1Conformity: d1?.conformity ?? 'N/A',
    });
  }

  sectors.sort((a, b) => (a.d1KLD ?? 999) - (b.d1KLD ?? 999));

  const results = { sectors };
  reporter.reportTest7(results);
  return results;
}

// ============================================
// TEST 8: ORDER-OF-MAGNITUDE GROWTH RUNWAY
// ============================================
function runTest8(cases, companyData) {
  const metrics = { winner: [], trap: [], underperform: [] };

  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    const outcome = c.outcome || 'unknown';
    if (!metrics[outcome]) continue;

    const beforeDate = c.entry_date || '2025-12-31';
    const km = extractKeyMetricDigits(data.facts, beforeDate);
    if (!km) continue;

    metrics[outcome].push({ ticker: c.ticker, ...km });
  }

  const calcStats = (group) => {
    if (group.length === 0) return { revLow: 0, revHigh: 0, avgDigit: 0 };
    const revDigits = group.map(g => g.revenue.leadingDigit).filter(d => d !== null);
    const allDigits = group.flatMap(g =>
      [g.revenue, g.totalAssets, g.operatingCashFlow, g.netIncome]
        .map(m => m.leadingDigit)
        .filter(d => d !== null)
    );

    return {
      revLow: revDigits.length > 0 ? revDigits.filter(d => d <= 3).length / revDigits.length : 0,
      revHigh: revDigits.length > 0 ? revDigits.filter(d => d >= 7).length / revDigits.length : 0,
      avgDigit: allDigits.length > 0 ? mean(allDigits) : 0,
    };
  };

  const w = calcStats(metrics.winner);
  const t = calcStats(metrics.trap);
  const u = calcStats(metrics.underperform);

  const results = {
    winnerRevLow: w.revLow, trapRevLow: t.revLow, underperformRevLow: u.revLow,
    winnerRevHigh: w.revHigh, trapRevHigh: t.revHigh, underperformRevHigh: u.revHigh,
    winnerAvgDigit: w.avgDigit, trapAvgDigit: t.avgDigit, underperformAvgDigit: u.avgDigit,
  };

  reporter.reportTest8(results);
  return results;
}

// ============================================
// SINGLE-TICKER DIAGNOSTIC
// ============================================
function runDiagnostic(ticker, companyData) {
  const data = companyData[ticker];
  if (!data) {
    console.log(`No EDGAR data found for ${ticker}`);
    return;
  }

  reporter.printHeader(`Benford Diagnostic: ${ticker}`);
  console.log(`  USD values: ${data.numbers.length}`);
  console.log(`  Date range: ${data.summary.dateRange}`);
  console.log(`  D1 eligible: ${data.summary.d1Eligible} | D1D2 eligible: ${data.summary.d1d2Eligible} | Temporal eligible: ${data.summary.temporalEligible}`);

  const tests = runAllTests(data.numbers);

  if (tests.firstDigit) {
    reporter.printSubHeader('First Digit Test');
    console.log(`  KLD: ${tests.firstDigit.kld.toFixed(6)} | MAD: ${tests.firstDigit.mad.toFixed(6)} | Conformity: ${tests.firstDigit.conformity}`);
    console.log('  Digit | Observed | Expected | Deviation');
    for (const d of tests.firstDigit.digitDeviations) {
      console.log(`    ${d.bin}   | ${(d.observed * 100).toFixed(1).padStart(6)}% | ${(d.expected * 100).toFixed(1).padStart(6)}% | ${(d.deviation >= 0 ? '+' : '') + (d.deviation * 100).toFixed(1)}%`);
    }
  }

  if (tests.secondDigit) {
    reporter.printSubHeader('Second Digit Test');
    console.log(`  KLD: ${tests.secondDigit.kld.toFixed(6)} | MAD: ${tests.secondDigit.mad.toFixed(6)} | Conformity: ${tests.secondDigit.conformity}`);
  }

  if (tests.firstTwoDigits) {
    reporter.printSubHeader('First-Two Digits Test');
    console.log(`  KLD: ${tests.firstTwoDigits.kld.toFixed(6)} | MAD: ${tests.firstTwoDigits.mad.toFixed(6)} | Conformity: ${tests.firstTwoDigits.conformity}`);
    if (tests.firstTwoDigits.topAnomalies?.length > 0) {
      console.log('  Top anomalies:');
      for (const a of tests.firstTwoDigits.topAnomalies.slice(0, 5)) {
        console.log(`    ${a.digits}: observed ${(a.observed * 100).toFixed(2)}% vs expected ${(a.expected * 100).toFixed(2)}% (z=${a.zScore.toFixed(2)})`);
      }
    }
    if (tests.firstTwoDigits.thresholdFlags?.length > 0) {
      console.log('  Threshold flags:');
      for (const f of tests.firstTwoDigits.thresholdFlags) {
        console.log(`    ${f.pattern} (z=${f.belowZScore.toFixed(2)})`);
      }
    }
  }

  if (tests.thirdDigit) {
    reporter.printSubHeader('Third Digit Test');
    console.log(`  KLD: ${tests.thirdDigit.kld.toFixed(6)} | MAD: ${tests.thirdDigit.mad.toFixed(6)} | Conformity: ${tests.thirdDigit.conformity}`);
  }

  if (tests.convergence) {
    reporter.printSubHeader('Convergence Profile');
    console.log(`  D1 KLD from uniform: ${tests.convergence.d1_uniformKLD.toFixed(4)}`);
    console.log(`  D2 KLD from uniform: ${tests.convergence.d2_uniformKLD.toFixed(4)}`);
    if (tests.convergence.d3_uniformKLD !== null) {
      console.log(`  D3 KLD from uniform: ${tests.convergence.d3_uniformKLD.toFixed(4)}`);
    }
    console.log(`  Convergence ratio: ${tests.convergence.convergenceRatio.toFixed(4)}`);
    if (tests.convergence.flags.length > 0) {
      console.log('  Flags:');
      for (const f of tests.convergence.flags) {
        console.log(`    ⚠ ${f}`);
      }
    } else {
      console.log('  No anomaly flags.');
    }
  }

  // Temporal windows
  const windows = buildRollingWindows(data.facts);
  if (windows.length > 0) {
    reporter.printSubHeader('Temporal Analysis (rolling 8-quarter windows)');
    const klds = [];
    for (let i = 0; i < windows.length; i++) {
      const result = benfordFirstDigit(windows[i].values);
      if (result) {
        klds.push({ x: i, kld: result.kld, label: windows[i].label, conformity: result.conformity });
      }
    }
    if (klds.length >= 2) {
      const reg = linearRegression(klds.map(k => k.x), klds.map(k => k.kld));
      console.log(`  Windows: ${klds.length} | Slope: ${reg.slope.toFixed(6)} (${reg.slope < 0 ? 'improving' : 'worsening'}) | R²: ${reg.r2.toFixed(3)}`);
      for (const k of klds) {
        console.log(`    ${k.label}: KLD=${k.kld.toFixed(6)} ${k.conformity}`);
      }
    } else {
      console.log(`  Only ${klds.length} valid windows — insufficient for trend`);
    }
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log("Benford's Law Multi-Digit Calibration Test Suite");
  console.log('='.repeat(50));

  const { cases, companyData } = await loadData();

  if (FETCH_ONLY) {
    console.log('\nFetch complete. Exiting (--fetch-only mode).');
    return;
  }

  if (SINGLE_TICKER) {
    runDiagnostic(SINGLE_TICKER.toUpperCase(), companyData);
    return;
  }

  // Coverage stats
  const coverage = {
    total: cases.length,
    withData: 0,
    d1d2Eligible: 0,
    temporalEligible: 0,
  };
  for (const c of cases) {
    const data = companyData[c.ticker];
    if (!data) continue;
    coverage.withData++;
    if (data.summary.d1d2Eligible) coverage.d1d2Eligible++;
    if (data.summary.temporalEligible) coverage.temporalEligible++;
  }

  const allResults = { coverage };
  const shouldRun = (n) => !TEST_NUM || TEST_NUM === n;

  // Test 1
  if (shouldRun(1)) {
    const r = runTest1(cases, companyData);
    allResults.test1Pass = r.pass;
    allResults.test1 = r;
  }

  // Test 2
  if (shouldRun(2)) {
    const r = runTest2(cases, companyData);
    allResults.test2 = r;
    // Summary: count flagged traps vs total flagged
    const flaggedTraps = r.flaggedCompanies.filter(f => f.outcome === 'trap').length;
    const totalFlagged = r.flaggedCompanies.length;
    allResults.test2Summary = `${totalFlagged} flagged, ${flaggedTraps} traps`;
  }

  // Test 3
  if (shouldRun(3)) {
    const r = runTest3(cases, companyData);
    allResults.test3Pass = r.bestEffectSize > 0.1; // Small effect threshold
    allResults.test3 = r;
  }

  // Tests 4 & 5
  if (shouldRun(4) || shouldRun(5)) {
    const r = runTemporalTests(cases, companyData);
    allResults.test4Pass = r.test4.pass;
    allResults.test4 = r.test4;
    allResults.test5Pass = r.test5.pass;
    allResults.test5 = r.test5;
  }

  // Test 7
  if (shouldRun(7)) {
    const r = runTest7(cases, companyData);
    allResults.test7Summary = `${r.sectors.length} sectors analyzed`;
    allResults.test7 = r;
  }

  // Test 8
  if (shouldRun(8)) {
    const r = runTest8(cases, companyData);
    allResults.test8Pass = r.winnerAvgDigit < r.trapAvgDigit;
    allResults.test8 = r;
  }

  // Determine recommended metric
  if (allResults.test3) {
    allResults.recommendedMetric = allResults.test3.bestDiscriminator || 'First digit KLD';
  }

  // Final summary
  reporter.reportSummary(allResults);

  // Save results
  // Strip the raw facts from output (too large)
  const outputResults = { ...allResults };
  delete outputResults.test2?.companyScores;
  reporter.saveResults(outputResults, OUTPUT_PATH);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
