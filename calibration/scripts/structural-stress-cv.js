#!/usr/bin/env node

// Structural Stress Formal Cross-Validation Test
// ================================================
// Tests whether the STRUCTURAL_STRESS Benford classification is a robust
// predictor of winner/trap outcomes using stratified k-fold CV and
// Fisher exact test.
//
// Data sources:
//   - benford-results.json (892 cases with classification + outcome)
//   - market-dynamics-expanded case_details (457 cases with spread scores)
//
// Output: calibration/tests/results/structural-stress-cv-2026-03-26.md

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

const TESTS_DIR = resolve(import.meta.dirname, '../tests');
const RESULTS_DIR = join(TESTS_DIR, 'results');
const CACHE_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }

// ============================================================
// MATH UTILITIES
// ============================================================

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

/**
 * Log-gamma function (Lanczos approximation).
 */
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Log of binomial coefficient C(n, k) = n! / (k! * (n-k)!)
 */
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/**
 * Fisher exact test for a 2x2 contingency table.
 *
 * Table layout:
 *        outcome=winner  outcome=trap
 *  SS=1      a               b         | R1 = a+b
 *  SS=0      c               d         | R2 = c+d
 *           ---             ---
 *           C1=a+c          C2=b+d       n = a+b+c+d
 *
 * p-value of observing a table at least as extreme as observed,
 * under H0 of independence (two-sided).
 *
 * Uses hypergeometric: P(X=a) = C(R1,a)*C(R2,c) / C(n,C1)
 */
function fisherExact(a, b, c, d) {
  const n = a + b + c + d;
  const R1 = a + b;  // row 1 total (STRUCTURAL_STRESS)
  const R2 = c + d;  // row 2 total (NATURAL_PROCESS)
  const C1 = a + c;  // col 1 total (winners)

  const logDenom = logChoose(n, C1);

  // Probability of the observed table
  function logProb(x) {
    // x = number of winners in STRUCTURAL_STRESS group
    const y = R1 - x;     // traps in SS
    const cx = C1 - x;    // winners in NP
    if (y < 0 || cx < 0 || cx > R2) return -Infinity;
    return logChoose(R1, x) + logChoose(R2, cx) - logDenom;
  }

  const pObserved = Math.exp(logProb(a));

  // Two-sided: sum probabilities of all tables with P <= P(observed)
  const minA = Math.max(0, C1 - R2);
  const maxA = Math.min(R1, C1);

  let pValue = 0;
  for (let x = minA; x <= maxA; x++) {
    const px = Math.exp(logProb(x));
    if (px <= pObserved + 1e-12) {  // small tolerance for floating point
      pValue += px;
    }
  }

  return Math.min(1, pValue);
}

/**
 * Chi-squared test for independence of an r x c contingency table.
 * Returns { chi2, df, p } (p approximated from chi-squared CDF).
 */
function chiSquaredTest(table) {
  const nRows = table.length;
  const nCols = table[0].length;
  const rowTotals = table.map(row => row.reduce((s, v) => s + v, 0));
  const colTotals = Array(nCols).fill(0);
  let total = 0;
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      colTotals[j] += table[i][j];
      total += table[i][j];
    }
  }

  let chi2 = 0;
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const expected = (rowTotals[i] * colTotals[j]) / total;
      if (expected > 0) {
        chi2 += (table[i][j] - expected) ** 2 / expected;
      }
    }
  }

  const df = (nRows - 1) * (nCols - 1);

  // Approximate chi-squared p-value using regularized incomplete gamma
  const p = 1 - gammaCDF(chi2, df);

  return { chi2, df, p };
}

/**
 * Regularized lower incomplete gamma function P(a, x) = gamma(a, x) / Gamma(a)
 * Used for chi-squared CDF: P(chi2/2, df/2)
 */
function gammaCDF(x, df) {
  const a = df / 2;
  const z = x / 2;
  if (z <= 0) return 0;

  // Series expansion for small z
  if (z < a + 1) {
    let sum = 1 / a;
    let term = 1 / a;
    for (let n = 1; n < 300; n++) {
      term *= z / (a + n);
      sum += term;
      if (Math.abs(term) < 1e-12 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-z + a * Math.log(z) - lgamma(a));
  }

  // Continued fraction for large z
  let f = 1, c = 1, d = 1 / (z - a + 1);
  f = d;
  for (let n = 1; n < 300; n++) {
    const an = n * (a - n);
    const bn = z - a + 2 * n + 1;
    d = bn + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = bn + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return 1 - f * Math.exp(-z + a * Math.log(z) - lgamma(a));
}

// ============================================================
// DATA LOADING
// ============================================================

function loadBenfordResults() {
  const data = readJSON(join(CACHE_DIR, 'multibase/benford-results.json'));
  if (!data?.cases) throw new Error('Benford results cache not found — run test-advanced-math-sessions-1-6.js first');
  return data.cases;
}

function loadMarketDynamicsCaseDetails() {
  const report = readJSON(join(RESULTS_DIR, 'market-dynamics-expanded-2026-03-26.json'));
  if (!report?.case_details) throw new Error('Market dynamics expanded results not found');
  return report.case_details;
}

// ============================================================
// STRATIFIED K-FOLD SPLIT
// ============================================================

/**
 * Create stratified k-fold indices.
 * Stratifies on both classification (SS vs NP) and outcome (winner vs trap).
 * Returns array of { train: number[], test: number[] }.
 */
function stratifiedKFold(cases, k = 5, seed = 42) {
  // Group indices by (classification, outcome) strata
  const strata = {};
  cases.forEach((c, i) => {
    const key = `${c.classification}_${c.outcome}`;
    if (!strata[key]) strata[key] = [];
    strata[key].push(i);
  });

  // Deterministic shuffle using LCG
  function shuffle(arr, s) {
    const result = [...arr];
    let state = s;
    for (let i = result.length - 1; i > 0; i--) {
      state = (state * 1664525 + 1013904223) & 0x7fffffff;
      const j = state % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Initialize folds
  const folds = Array.from({ length: k }, () => []);

  // Distribute each stratum across folds proportionally
  let seedOffset = 0;
  for (const [key, indices] of Object.entries(strata)) {
    const shuffled = shuffle(indices, seed + seedOffset);
    seedOffset++;
    shuffled.forEach((idx, i) => {
      folds[i % k].push(idx);
    });
  }

  // Build train/test splits
  const splits = [];
  for (let f = 0; f < k; f++) {
    const testSet = new Set(folds[f]);
    const train = [];
    const test = [];
    for (let i = 0; i < cases.length; i++) {
      if (testSet.has(i)) test.push(i);
      else train.push(i);
    }
    splits.push({ train, test });
  }

  return splits;
}

// ============================================================
// CROSS-VALIDATION ANALYSIS
// ============================================================

/**
 * For a given set of cases, compute the 2x2 table and win rates by class.
 * Returns { ssWinRate, npWinRate, table: [a, b, c, d], n }.
 */
function computeClassificationStats(cases) {
  let ssW = 0, ssT = 0, npW = 0, npT = 0;

  for (const c of cases) {
    const isSS = c.classification === 'STRUCTURAL_STRESS';
    const isWinner = c.outcome === 'winner';

    if (isSS && isWinner) ssW++;
    else if (isSS && !isWinner) ssT++;
    else if (!isSS && isWinner) npW++;
    else npT++;
  }

  const ssTotal = ssW + ssT;
  const npTotal = npW + npT;

  return {
    ssWinRate: ssTotal > 0 ? ssW / ssTotal : null,
    npWinRate: npTotal > 0 ? npW / npTotal : null,
    ssWinners: ssW,
    ssTraps: ssT,
    npWinners: npW,
    npTraps: npT,
    ssTotal,
    npTotal,
    n: ssW + ssT + npW + npT,
    // Table: [a, b, c, d] = [SS-winners, SS-traps, NP-winners, NP-traps]
    table: [ssW, ssT, npW, npT],
  };
}

/**
 * Run full 5-fold stratified cross-validation.
 */
function runCrossValidation(cases) {
  const K = 5;
  const splits = stratifiedKFold(cases, K);

  const foldResults = [];

  for (let f = 0; f < K; f++) {
    const testCases = splits[f].test.map(i => cases[i]);
    const stats = computeClassificationStats(testCases);

    // Fisher exact on this fold's 2x2 table
    const pFisher = (stats.ssTotal > 0 && stats.npTotal > 0)
      ? fisherExact(stats.ssWinners, stats.ssTraps, stats.npWinners, stats.npTraps)
      : null;

    foldResults.push({
      fold: f + 1,
      n: stats.n,
      ssWinRate: stats.ssWinRate,
      npWinRate: stats.npWinRate,
      winRateDelta: (stats.ssWinRate != null && stats.npWinRate != null)
        ? stats.ssWinRate - stats.npWinRate : null,
      ssTotal: stats.ssTotal,
      npTotal: stats.npTotal,
      table: stats.table,
      fisherP: pFisher,
    });
  }

  return foldResults;
}

// ============================================================
// CREDIT SPREAD QUINTILE INDEPENDENCE TEST
// ============================================================

/**
 * Cross-tabulate STRUCTURAL_STRESS x credit spread quintile.
 * Uses spread_theta from market-dynamics case_details.
 */
function spreadQuintileIndependence(benfordCases, marketCases) {
  // Build lookup: ticker -> spread_theta
  const spreadByTicker = {};
  for (const c of marketCases) {
    if (c.scores?.spread_theta != null) {
      spreadByTicker[c.ticker] = c.scores.spread_theta;
    }
  }

  // Join benford cases with spread data
  const joined = [];
  for (const c of benfordCases) {
    const spread = spreadByTicker[c.ticker];
    if (spread != null) {
      joined.push({
        ticker: c.ticker,
        classification: c.classification,
        outcome: c.outcome,
        spread_theta: spread,
      });
    }
  }

  if (joined.length < 20) {
    return { error: 'Insufficient joined cases for spread independence test', n: joined.length };
  }

  // Assign spread quintiles
  const sorted = [...joined].sort((a, b) => a.spread_theta - b.spread_theta);
  const n = sorted.length;
  const quintileAssignment = new Map();
  for (let i = 0; i < n; i++) {
    const q = Math.min(4, Math.floor(i * 5 / n));
    // Use index in sorted order to find the case and assign quintile
    sorted[i].quintile = q + 1;
  }

  // Build contingency table: rows = [SS, NP], cols = [Q1, Q2, Q3, Q4, Q5]
  const table = [
    [0, 0, 0, 0, 0],  // STRUCTURAL_STRESS
    [0, 0, 0, 0, 0],  // NATURAL_PROCESS
  ];

  for (const c of sorted) {
    const row = c.classification === 'STRUCTURAL_STRESS' ? 0 : 1;
    table[row][c.quintile - 1]++;
  }

  // Chi-squared test of independence
  const chi2Result = chiSquaredTest(table);

  // Also compute win rates by (classification, quintile)
  const winRateTable = {};
  for (const cls of ['STRUCTURAL_STRESS', 'NATURAL_PROCESS']) {
    winRateTable[cls] = [];
    for (let q = 1; q <= 5; q++) {
      const group = sorted.filter(c => c.classification === cls && c.quintile === q);
      const winners = group.filter(c => c.outcome === 'winner').length;
      winRateTable[cls].push({
        quintile: q,
        count: group.length,
        winners,
        winRate: group.length > 0 ? winners / group.length : null,
      });
    }
  }

  return {
    n: joined.length,
    nSS: sorted.filter(c => c.classification === 'STRUCTURAL_STRESS').length,
    nNP: sorted.filter(c => c.classification === 'NATURAL_PROCESS').length,
    contingencyTable: table,
    chi2: chi2Result.chi2,
    df: chi2Result.df,
    pChi2: chi2Result.p,
    winRateByClassAndQuintile: winRateTable,
  };
}

// ============================================================
// MAIN
// ============================================================

function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  STRUCTURAL STRESS: FORMAL CROSS-VALIDATION TEST           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Load data
  const benfordCases = loadBenfordResults();
  const marketCases = loadMarketDynamicsCaseDetails();

  // Filter to winners and traps only (exclude mixed/underperform)
  const cases = benfordCases.filter(c => c.outcome === 'winner' || c.outcome === 'trap');
  console.log(`  Total Benford-classified cases: ${cases.length}`);
  console.log(`  STRUCTURAL_STRESS: ${cases.filter(c => c.classification === 'STRUCTURAL_STRESS').length}`);
  console.log(`  NATURAL_PROCESS: ${cases.filter(c => c.classification === 'NATURAL_PROCESS').length}`);
  console.log(`  HUMAN_MANIPULATION: ${cases.filter(c => c.classification === 'HUMAN_MANIPULATION').length}`);

  // For CV, collapse to binary: SS vs everything else (NP + HM)
  // But in practice, HM count = 0, so it's SS vs NP
  const ssCases = cases.filter(c => c.classification === 'STRUCTURAL_STRESS');
  const npCases = cases.filter(c => c.classification !== 'STRUCTURAL_STRESS');

  console.log(`\n  Binary split: SS=${ssCases.length}, non-SS=${npCases.length}\n`);

  // ── FULL-SAMPLE STATISTICS ────────────────────────────────────
  console.log('  FULL-SAMPLE RESULTS:');
  const fullStats = computeClassificationStats(cases);
  console.log(`    SS win rate:  ${(fullStats.ssWinRate * 100).toFixed(1)}% (${fullStats.ssWinners}/${fullStats.ssTotal})`);
  console.log(`    NP win rate:  ${(fullStats.npWinRate * 100).toFixed(1)}% (${fullStats.npWinners}/${fullStats.npTotal})`);
  console.log(`    Delta:        ${((fullStats.ssWinRate - fullStats.npWinRate) * 100).toFixed(1)}pp`);

  const fullFisherP = fisherExact(fullStats.ssWinners, fullStats.ssTraps, fullStats.npWinners, fullStats.npTraps);
  console.log(`    Fisher exact p = ${fullFisherP.toFixed(6)}`);
  console.log('');

  // ── 5-FOLD STRATIFIED CV ─────────────────────────────────────
  console.log('  5-FOLD STRATIFIED CROSS-VALIDATION:');
  console.log('  ─────────────────────────────────────────────────');
  const foldResults = runCrossValidation(cases);

  console.log('    Fold │ n   │ SS win% │ NP win% │ Delta  │ Fisher p');
  console.log('    ─────┼─────┼─────────┼─────────┼────────┼─────────');
  for (const f of foldResults) {
    const ssWR = f.ssWinRate != null ? `${(f.ssWinRate * 100).toFixed(1)}%` : '  N/A';
    const npWR = f.npWinRate != null ? `${(f.npWinRate * 100).toFixed(1)}%` : '  N/A';
    const delta = f.winRateDelta != null ? `${(f.winRateDelta * 100).toFixed(1)}pp` : '  N/A';
    const fp = f.fisherP != null ? f.fisherP.toFixed(4) : '  N/A';
    console.log(`      ${f.fold}  │ ${String(f.n).padStart(3)} │ ${ssWR.padStart(7)} │ ${npWR.padStart(7)} │ ${delta.padStart(6)} │ ${fp}`);
  }

  const deltas = foldResults.map(f => f.winRateDelta).filter(d => d != null);
  const meanDelta = mean(deltas);
  const sdDelta = std(deltas);
  const ssWinRates = foldResults.map(f => f.ssWinRate).filter(r => r != null);
  const npWinRates = foldResults.map(f => f.npWinRate).filter(r => r != null);
  const fisherPs = foldResults.map(f => f.fisherP).filter(p => p != null);

  console.log('    ─────┼─────┼─────────┼─────────┼────────┼─────────');
  console.log(`    Mean │     │ ${(mean(ssWinRates) * 100).toFixed(1).padStart(5)}%  │ ${(mean(npWinRates) * 100).toFixed(1).padStart(5)}%  │ ${(meanDelta * 100).toFixed(1).padStart(4)}pp │`);
  console.log(`    SD   │     │ ${(std(ssWinRates) * 100).toFixed(1).padStart(5)}%  │ ${(std(npWinRates) * 100).toFixed(1).padStart(5)}%  │ ${(sdDelta * 100).toFixed(1).padStart(4)}pp │`);
  console.log('');

  // Check if delta is consistently positive across folds
  const positiveFolds = deltas.filter(d => d > 0).length;
  console.log(`    Delta positive in ${positiveFolds}/${deltas.length} folds`);

  // Combined Fisher p from individual fold tables (sum all fold tables)
  const combinedTable = [0, 0, 0, 0]; // [ssW, ssT, npW, npT]
  for (const f of foldResults) {
    combinedTable[0] += f.table[0];
    combinedTable[1] += f.table[1];
    combinedTable[2] += f.table[2];
    combinedTable[3] += f.table[3];
  }
  const combinedFisherP = fisherExact(combinedTable[0], combinedTable[1], combinedTable[2], combinedTable[3]);
  console.log(`    Combined Fisher p (summed tables) = ${combinedFisherP.toFixed(6)}\n`);

  // ── CREDIT SPREAD QUINTILE INDEPENDENCE ───────────────────────
  console.log('  STRUCTURAL_STRESS x CREDIT SPREAD QUINTILE INDEPENDENCE:');
  console.log('  ─────────────────────────────────────────────────');
  const spreadResult = spreadQuintileIndependence(cases, marketCases);

  if (spreadResult.error) {
    console.log(`    ${spreadResult.error} (n=${spreadResult.n})`);
  } else {
    console.log(`    Joined cases: ${spreadResult.n} (SS=${spreadResult.nSS}, NP=${spreadResult.nNP})`);
    console.log('');
    console.log('    Contingency table (rows=class, cols=spread quintile):');
    console.log('             Q1    Q2    Q3    Q4    Q5');
    console.log(`    SS    ${spreadResult.contingencyTable[0].map(v => String(v).padStart(5)).join(' ')}`);
    console.log(`    NP    ${spreadResult.contingencyTable[1].map(v => String(v).padStart(5)).join(' ')}`);
    console.log('');
    console.log(`    Chi-squared = ${spreadResult.chi2.toFixed(3)}, df = ${spreadResult.df}, p = ${spreadResult.pChi2.toFixed(4)}`);
    const independent = spreadResult.pChi2 > 0.05;
    console.log(`    Interpretation: SS classification is ${independent ? 'INDEPENDENT of' : 'NOT independent of'} credit spread regime (p ${independent ? '>' : '<'} 0.05)`);
    console.log('');

    // Win rates by class and quintile
    console.log('    Win rates by (classification, spread quintile):');
    console.log('             Q1      Q2      Q3      Q4      Q5');
    for (const cls of ['STRUCTURAL_STRESS', 'NATURAL_PROCESS']) {
      const label = cls === 'STRUCTURAL_STRESS' ? 'SS' : 'NP';
      const rates = spreadResult.winRateByClassAndQuintile[cls];
      const rateStr = rates.map(r => {
        if (r.count === 0) return '   N/A';
        return `${(r.winRate * 100).toFixed(0).padStart(3)}%(${r.count})`;
      }).join('  ');
      console.log(`    ${label.padEnd(4)}  ${rateStr}`);
    }
    console.log('');
  }

  // ── EFFECT SIZE ───────────────────────────────────────────────
  console.log('  EFFECT SIZE:');
  const h = 2 * Math.asin(Math.sqrt(fullStats.ssWinRate)) - 2 * Math.asin(Math.sqrt(fullStats.npWinRate));
  console.log(`    Cohen's h = ${h.toFixed(3)} (small=0.2, medium=0.5, large=0.8)`);
  const oddsRatioSS = fullStats.ssWinners / Math.max(1, fullStats.ssTraps);
  const oddsRatioNP = fullStats.npWinners / Math.max(1, fullStats.npTraps);
  const OR = oddsRatioSS / oddsRatioNP;
  const logOR = Math.log(OR);
  const seLogOR = Math.sqrt(1/Math.max(1, fullStats.ssWinners) + 1/Math.max(1, fullStats.ssTraps) +
                            1/Math.max(1, fullStats.npWinners) + 1/Math.max(1, fullStats.npTraps));
  const orLower = Math.exp(logOR - 1.96 * seLogOR);
  const orUpper = Math.exp(logOR + 1.96 * seLogOR);
  console.log(`    Odds ratio = ${OR.toFixed(2)} [95% CI: ${orLower.toFixed(2)}-${orUpper.toFixed(2)}]`);
  console.log('');

  // ── SAVE RESULTS ──────────────────────────────────────────────
  const report = generateMarkdownReport({
    cases,
    fullStats,
    fullFisherP,
    foldResults,
    meanDelta,
    sdDelta,
    ssWinRates: mean(ssWinRates),
    npWinRates: mean(npWinRates),
    positiveFolds,
    totalFolds: deltas.length,
    combinedFisherP,
    spreadResult,
    cohenH: h,
    oddsRatio: OR,
    orCI: [orLower, orUpper],
  });

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, 'structural-stress-cv-2026-03-26.md');
  writeFileSync(outPath, report);
  console.log(`  Results saved to ${outPath}`);
}

// ============================================================
// MARKDOWN REPORT GENERATION
// ============================================================

function generateMarkdownReport(data) {
  const {
    cases, fullStats, fullFisherP, foldResults,
    meanDelta, sdDelta, ssWinRates, npWinRates,
    positiveFolds, totalFolds, combinedFisherP,
    spreadResult, cohenH, oddsRatio, orCI,
  } = data;

  const lines = [];
  const p = (s) => lines.push(s);

  p('# Structural Stress Formal Cross-Validation');
  p(`Date: 2026-03-26`);
  p('');
  p('## Overview');
  p('');
  p('Tests whether the multi-base Benford STRUCTURAL_STRESS classification');
  p('(all bases deviate from Benford\'s law, not just base 10) is a robust');
  p('predictor of winner/trap outcomes using stratified 5-fold CV.');
  p('');
  p(`- **Total cases**: ${cases.length} (winners + traps only)`);
  p(`- **STRUCTURAL_STRESS**: ${fullStats.ssTotal} cases (${fullStats.ssWinners}W / ${fullStats.ssTraps}T)`);
  p(`- **NATURAL_PROCESS**: ${fullStats.npTotal} cases (${fullStats.npWinners}W / ${fullStats.npTraps}T)`);
  p('');

  p('## Full-Sample Results');
  p('');
  p('| Metric | STRUCTURAL_STRESS | NATURAL_PROCESS | Delta |');
  p('|--------|-------------------|-----------------|-------|');
  p(`| Win rate | ${(fullStats.ssWinRate * 100).toFixed(1)}% | ${(fullStats.npWinRate * 100).toFixed(1)}% | ${((fullStats.ssWinRate - fullStats.npWinRate) * 100).toFixed(1)}pp |`);
  p(`| Count | ${fullStats.ssTotal} | ${fullStats.npTotal} | |`);
  p('');
  p(`**Fisher exact test**: p = ${fullFisherP.toFixed(6)} ${fullFisherP < 0.01 ? '(**significant at 1%**)' : fullFisherP < 0.05 ? '(*significant at 5%*)' : '(not significant at 5%)'}`);
  p('');
  p(`**Cohen's h**: ${cohenH.toFixed(3)} (${Math.abs(cohenH) >= 0.8 ? 'large' : Math.abs(cohenH) >= 0.5 ? 'medium' : Math.abs(cohenH) >= 0.2 ? 'small' : 'negligible'} effect)`);
  p('');
  p(`**Odds ratio**: ${oddsRatio.toFixed(2)} [95% CI: ${orCI[0].toFixed(2)}-${orCI[1].toFixed(2)}]`);
  p('');

  p('## 5-Fold Stratified Cross-Validation');
  p('');
  p('Stratified on (classification x outcome) to preserve class proportions in each fold.');
  p('');
  p('| Fold | n | SS win% | NP win% | Delta | Fisher p |');
  p('|------|---|---------|---------|-------|----------|');
  for (const f of foldResults) {
    const ssWR = f.ssWinRate != null ? `${(f.ssWinRate * 100).toFixed(1)}%` : 'N/A';
    const npWR = f.npWinRate != null ? `${(f.npWinRate * 100).toFixed(1)}%` : 'N/A';
    const delta = f.winRateDelta != null ? `${(f.winRateDelta * 100).toFixed(1)}pp` : 'N/A';
    const fp = f.fisherP != null ? f.fisherP.toFixed(4) : 'N/A';
    p(`| ${f.fold} | ${f.n} | ${ssWR} | ${npWR} | ${delta} | ${fp} |`);
  }
  p(`| **Mean** | | **${(ssWinRates * 100).toFixed(1)}%** | **${(npWinRates * 100).toFixed(1)}%** | **${(meanDelta * 100).toFixed(1)}pp** | |`);
  p(`| **SD** | | | | ${(sdDelta * 100).toFixed(1)}pp | |`);
  p('');
  p(`- Delta positive in **${positiveFolds}/${totalFolds}** folds`);
  p(`- Combined Fisher p (summed fold tables) = **${combinedFisherP.toFixed(6)}**`);
  p('');

  // Stability assessment
  const stable = positiveFolds === totalFolds && sdDelta * 100 < 15;
  const significant = combinedFisherP < 0.05;
  p('### CV Stability Assessment');
  p('');
  if (stable && significant) {
    p('The STRUCTURAL_STRESS effect is **stable across folds** and **statistically significant**.');
  } else if (significant && !stable) {
    p('The effect is statistically significant but **shows instability across folds**, suggesting it may be driven by a subset of cases.');
  } else if (stable && !significant) {
    p('The effect direction is consistent but **does not reach statistical significance**, likely due to the small STRUCTURAL_STRESS sample size.');
  } else {
    p('The effect is **neither stable nor significant** in cross-validation.');
  }
  p('');

  p('## STRUCTURAL_STRESS x Credit Spread Independence');
  p('');
  if (spreadResult.error) {
    p(`*${spreadResult.error} (n=${spreadResult.n})*`);
  } else {
    p(`Joined ${spreadResult.n} Benford cases with credit spread data (by ticker).`);
    p('');
    p('### Contingency Table');
    p('');
    p('|  | Q1 | Q2 | Q3 | Q4 | Q5 | Total |');
    p('|--|----|----|----|----|----| ------|');
    const ssRow = spreadResult.contingencyTable[0];
    const npRow = spreadResult.contingencyTable[1];
    p(`| SS | ${ssRow.join(' | ')} | ${ssRow.reduce((a, b) => a + b, 0)} |`);
    p(`| NP | ${npRow.join(' | ')} | ${npRow.reduce((a, b) => a + b, 0)} |`);
    p('');
    p(`**Chi-squared test**: chi2 = ${spreadResult.chi2.toFixed(3)}, df = ${spreadResult.df}, p = ${spreadResult.pChi2.toFixed(4)}`);
    p('');
    const independent = spreadResult.pChi2 > 0.05;
    if (independent) {
      p('The STRUCTURAL_STRESS classification is **independent** of the credit spread regime (p > 0.05).');
      p('This means the Benford signal provides information orthogonal to credit market conditions.');
    } else {
      p('The STRUCTURAL_STRESS classification is **not independent** of credit spread regime (p < 0.05).');
      p('Some confounding between Benford classification and credit market conditions may exist.');
    }
    p('');

    p('### Win Rates by (Classification x Spread Quintile)');
    p('');
    p('| Class | Q1 | Q2 | Q3 | Q4 | Q5 |');
    p('|-------|----|----|----|----|----|');
    for (const cls of ['STRUCTURAL_STRESS', 'NATURAL_PROCESS']) {
      const label = cls === 'STRUCTURAL_STRESS' ? 'SS' : 'NP';
      const rates = spreadResult.winRateByClassAndQuintile[cls];
      const cells = rates.map(r => {
        if (r.count === 0) return 'N/A';
        return `${(r.winRate * 100).toFixed(0)}% (n=${r.count})`;
      });
      p(`| ${label} | ${cells.join(' | ')} |`);
    }
    p('');
  }

  p('## Methodology');
  p('');
  p('1. **Data**: 892 cases from the calibration universe with EDGAR XBRL financial data.');
  p('   Multi-base Benford analysis classifies each company\'s financial values in bases 6, 10, 12, 60.');
  p('   STRUCTURAL_STRESS = all bases deviate (KLD > 0.005), indicating genuine complexity.');
  p('   NATURAL_PROCESS = deviations only in base 10 or none at all.');
  p('');
  p('2. **Cross-validation**: 5-fold stratified on (classification x outcome) to preserve');
  p('   class balance. Each fold computes SS and NP win rates independently.');
  p('');
  p('3. **Fisher exact test**: Hypergeometric probability of the 2x2 table');
  p('   (STRUCTURAL_STRESS x outcome) under the null of independence. Two-sided.');
  p('');
  p('4. **Spread independence**: Chi-squared test of the 2x5 contingency table');
  p('   (classification x credit spread quintile) to verify that Benford classification');
  p('   is not merely proxying for credit market conditions.');
  p('');
  p('5. **Effect size**: Cohen\'s h for proportion differences; odds ratio with 95% CI.');
  p('');

  return lines.join('\n');
}

// ── RUN ─────────────────────────────────────────────────────
main();
