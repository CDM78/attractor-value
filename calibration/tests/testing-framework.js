// Prompt Testing Framework
// Defines tests, runs evaluations, computes analysis, tracks results.
// Every test is logged to the registry for reproducibility.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import temporal from '../warehouse/temporal.js';
import universeManager from '../cases/universe-manager.js';

const TESTS_DIR = resolve(import.meta.dirname);
const RESULTS_DIR = join(TESTS_DIR, 'results');
const REGISTRY_PATH = join(TESTS_DIR, 'test-registry.json');
const PROMPT_LIBRARY_PATH = join(TESTS_DIR, 'prompt-library.json');

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJSON(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ============================================================
// STATISTICS (imported from existing calibration lib patterns)
// ============================================================

function assignRanks(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function normalCDF(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * Spearman rank correlation with p-value.
 */
export function spearmanCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const n = x.length;
  const rx = assignRanks(x);
  const ry = assignRanks(y);

  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    sumD2 += d * d;
  }

  const r = 1 - (6 * sumD2) / (n * (n * n - 1));
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = 2 * (1 - tCDF(Math.abs(t), n - 2));

  return { r, p, n };
}

// Approximate t-distribution CDF
function tCDF(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(x, df / 2, 0.5);
}

function incompleteBeta(x, a, b) {
  // Approximation using continued fraction
  if (x === 0 || x === 1) return x === 0 ? 0 : 1;
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  // Simple series expansion for small a,b
  let sum = 1, term = 1;
  for (let n = 1; n < 200; n++) {
    term *= (n - b) * x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }
  return Math.min(1, front * sum);
}

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
 * Pearson correlation.
 */
export function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i];
    sxx += x[i] * x[i]; syy += y[i] * y[i];
    sxy += x[i] * y[i];
  }
  const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (denom === 0) return { r: 0, p: 1, n };
  const r = (n * sxy - sx * sy) / denom;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = 2 * (1 - tCDF(Math.abs(t), n - 2));
  return { r, p, n };
}

// ============================================================
// ANALYSIS
// ============================================================

/**
 * Compute quintile analysis — split scores into 5 equal groups,
 * measure outcome rates in each.
 */
export function quintileAnalysis(scores, outcomes) {
  const paired = scores.map((s, i) => ({ score: s, outcome: outcomes[i] }));
  paired.sort((a, b) => a.score - b.score);

  const quintiles = [];
  const n = paired.length;
  for (let q = 0; q < 5; q++) {
    const start = Math.floor(n * q / 5);
    const end = Math.floor(n * (q + 1) / 5);
    const group = paired.slice(start, end);

    const winCount = group.filter(g => g.outcome === 'winner').length;
    const trapCount = group.filter(g => g.outcome === 'trap').length;

    quintiles.push({
      quintile: q + 1,
      count: group.length,
      win_rate: group.length > 0 ? +(winCount / group.length).toFixed(3) : 0,
      trap_rate: group.length > 0 ? +(trapCount / group.length).toFixed(3) : 0,
      mean_score: +(group.reduce((s, g) => s + g.score, 0) / group.length).toFixed(3),
    });
  }

  return quintiles;
}

/**
 * Compute precision at threshold — for a given score threshold,
 * what fraction of cases above the threshold are actually the target outcome?
 */
export function precisionAtThreshold(scores, outcomes, threshold, targetOutcome = 'winner') {
  const above = scores.map((s, i) => ({ score: s, outcome: outcomes[i] }))
    .filter(x => x.score >= threshold);

  if (above.length === 0) return { threshold, precision: 0, count: 0 };

  const hits = above.filter(x => x.outcome === targetOutcome).length;
  return {
    threshold,
    precision: +(hits / above.length).toFixed(3),
    count: above.length,
    hits,
  };
}

/**
 * K-fold cross-validation of correlation.
 */
export function crossValidate(scores, outcomes, folds = 5) {
  const n = scores.length;
  const indices = Array.from({ length: n }, (_, i) => i);

  // Shuffle indices deterministically
  let seed = 12345;
  for (let i = indices.length - 1; i > 0; i--) {
    seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // Convert outcomes to numeric for correlation
  const numericOutcomes = outcomes.map(o => o === 'winner' ? 1 : o === 'trap' ? -1 : 0);

  const foldResults = [];
  const foldSize = Math.ceil(n / folds);

  for (let f = 0; f < folds; f++) {
    const testStart = f * foldSize;
    const testEnd = Math.min(testStart + foldSize, n);
    const testIdx = new Set(indices.slice(testStart, testEnd));

    const testScores = [], testOutcomes = [];
    for (let i = 0; i < n; i++) {
      if (testIdx.has(i)) {
        testScores.push(scores[i]);
        testOutcomes.push(numericOutcomes[i]);
      }
    }

    if (testScores.length < 3) continue;
    const corr = spearmanCorrelation(testScores, testOutcomes);
    if (corr) foldResults.push(corr.r);
  }

  const meanR = foldResults.length > 0
    ? +(foldResults.reduce((a, b) => a + b, 0) / foldResults.length).toFixed(4)
    : 0;
  const sdR = foldResults.length > 1
    ? +Math.sqrt(foldResults.reduce((s, r) => s + (r - meanR) ** 2, 0) / (foldResults.length - 1)).toFixed(4)
    : 0;

  return { folds: foldResults.length, per_fold_r: foldResults.map(r => +r.toFixed(4)), mean_r: meanR, sd_r: sdR };
}

/**
 * Full analysis suite — run all standard analyses on scores + outcomes.
 */
export function analyze(scores, outcomes, forwardReturns = null) {
  // Convert outcomes to numeric for correlation
  const numericOutcomes = outcomes.map(o => o === 'winner' ? 1 : o === 'trap' ? -1 : 0);

  // Correlation with outcome classification
  const spearman = spearmanCorrelation(scores, numericOutcomes);
  const pearson = pearsonCorrelation(scores, numericOutcomes);

  // Correlation with forward returns if provided
  let returnCorrelation = null;
  if (forwardReturns) {
    returnCorrelation = spearmanCorrelation(scores, forwardReturns);
  }

  // Quintile analysis
  const quintiles = quintileAnalysis(scores, outcomes);

  // Precision at multiple thresholds
  const scoreSorted = [...scores].sort((a, b) => a - b);
  const p75 = scoreSorted[Math.floor(scores.length * 0.75)];
  const p90 = scoreSorted[Math.floor(scores.length * 0.90)];

  const precisions = {
    top_quartile: precisionAtThreshold(scores, outcomes, p75, 'winner'),
    top_decile: precisionAtThreshold(scores, outcomes, p90, 'winner'),
  };

  // Cross-validation
  const cv = crossValidate(scores, outcomes);

  return {
    n: scores.length,
    spearman_r: spearman?.r,
    spearman_p: spearman?.p,
    pearson_r: pearson?.r,
    pearson_p: pearson?.p,
    return_correlation: returnCorrelation ? { r: returnCorrelation.r, p: returnCorrelation.p } : null,
    quintile_analysis: quintiles,
    quintile_win_rates: quintiles.map(q => q.win_rate),
    quintile_trap_rates: quintiles.map(q => q.trap_rate),
    precision: precisions,
    cross_validation: cv,
  };
}

// ============================================================
// TEST REGISTRY
// ============================================================

function loadRegistry() {
  return readJSON(REGISTRY_PATH) || { tests: [] };
}

function saveRegistry(registry) {
  writeJSON(REGISTRY_PATH, registry);
}

/**
 * Register a completed test in the registry.
 */
export function registerTest(testResult) {
  const registry = loadRegistry();

  // Check for duplicate test_id
  const existing = registry.tests.find(t => t.test_id === testResult.test_id);
  if (existing) {
    console.warn(`Test ${testResult.test_id} already in registry — updating`);
    Object.assign(existing, testResult);
  } else {
    registry.tests.push(testResult);
  }

  saveRegistry(registry);
  return testResult;
}

/**
 * Get all tests from registry.
 */
export function getTestHistory() {
  return loadRegistry().tests;
}

/**
 * Find tests by prompt version.
 */
export function findTestsByPrompt(promptId) {
  return loadRegistry().tests.filter(t => t.prompt_version === promptId);
}

// ============================================================
// PROMPT LIBRARY
// ============================================================

function loadPromptLibrary() {
  return readJSON(PROMPT_LIBRARY_PATH) || { prompts: [] };
}

function savePromptLibrary(lib) {
  writeJSON(PROMPT_LIBRARY_PATH, lib);
}

/**
 * Store a prompt variant in the library.
 */
export function storePrompt(prompt) {
  const lib = loadPromptLibrary();
  const existing = lib.prompts.find(p => p.prompt_id === prompt.prompt_id);
  if (existing) {
    Object.assign(existing, prompt);
  } else {
    lib.prompts.push(prompt);
  }
  savePromptLibrary(lib);
  return prompt;
}

/**
 * Get a prompt by ID.
 */
export function getPrompt(promptId) {
  const lib = loadPromptLibrary();
  return lib.prompts.find(p => p.prompt_id === promptId);
}

// ============================================================
// TEST RUNNER
// ============================================================

/**
 * Define and run a test.
 *
 * @param {Object} testDef - Test definition
 * @param {string} testDef.test_id - Unique test ID
 * @param {string} testDef.description - What this test evaluates
 * @param {string} testDef.prompt_version - Which prompt variant
 * @param {string[]} testDef.data_types_required - Data types to fetch
 * @param {string} testDef.partition - Which partition to use (training/validation)
 * @param {Function} testDef.evaluator - async (caseData, caseRecord) => number (score)
 * @returns {Object} Test result with full analysis
 */
export async function runTest(testDef) {
  const {
    test_id,
    description = '',
    prompt_version = 'unknown',
    data_types_required = [],
    partition = 'training',
    evaluator,
    model = 'unknown',
  } = testDef;

  console.log(`\n=== Running Test: ${test_id} ===`);
  console.log(`Partition: ${partition}, Data types: ${data_types_required.join(', ')}`);

  // Get cases for this partition
  const cases = universeManager.getCasesByPartition(partition);
  console.log(`Cases in partition: ${cases.length}`);

  // Start temporal audit
  const audit = temporal.startAudit(test_id);

  const scores = [];
  const outcomes = [];
  const forwardReturns = [];
  const caseResults = [];
  let evaluated = 0, skipped = 0;

  for (const caseRecord of cases) {
    try {
      // Get temporally-safe data
      const caseData = temporal.getDataForCase(caseRecord.case_id, data_types_required, test_id);

      // Check if we have enough data
      const hasData = data_types_required.some(dt => caseData[dt]?.length > 0);
      if (!hasData) {
        skipped++;
        continue;
      }

      // Run the evaluator
      const score = await evaluator(caseData, caseRecord);
      if (score == null || isNaN(score)) {
        skipped++;
        continue;
      }

      scores.push(score);
      outcomes.push(caseRecord.outcome.classification);
      if (caseRecord.outcome.forward_return_3yr != null) {
        forwardReturns.push(caseRecord.outcome.forward_return_3yr);
      }

      caseResults.push({
        case_id: caseRecord.case_id,
        ticker: caseRecord.ticker,
        score,
        outcome: caseRecord.outcome.classification,
      });

      evaluated++;
    } catch (e) {
      console.warn(`  Error on ${caseRecord.case_id}: ${e.message}`);
      skipped++;
    }
  }

  // End audit
  const auditReport = temporal.endAudit(test_id);

  // Run analysis
  const analysis = analyze(scores, outcomes, forwardReturns.length === scores.length ? forwardReturns : null);

  // Build test result
  const testResult = {
    test_id,
    created: new Date().toISOString(),
    description,
    prompt_version,
    data_types_required,
    model,
    partition_used: partition,
    cases_evaluated: evaluated,
    cases_skipped: skipped,
    temporal_violations: auditReport.violations,
    contaminated: auditReport.contaminated,
    results: {
      spearman_r: analysis.spearman_r,
      spearman_p: analysis.spearman_p,
      pearson_r: analysis.pearson_r,
      return_correlation: analysis.return_correlation,
      quintile_win_rates: analysis.quintile_win_rates,
      quintile_trap_rates: analysis.quintile_trap_rates,
      precision: analysis.precision,
      cross_validation: analysis.cross_validation,
      quintile_analysis: analysis.quintile_analysis,
    },
  };

  // Save to registry and results file
  registerTest(testResult);
  writeJSON(join(RESULTS_DIR, `${test_id}.json`), { test: testResult, case_results: caseResults });

  // Print summary
  console.log(`\n--- Test Results: ${test_id} ---`);
  console.log(`Evaluated: ${evaluated}, Skipped: ${skipped}`);
  console.log(`Spearman r: ${analysis.spearman_r?.toFixed(4)} (p=${analysis.spearman_p?.toFixed(6)})`);
  console.log(`Quintile win rates: [${analysis.quintile_win_rates.join(', ')}]`);
  console.log(`CV mean r: ${analysis.cross_validation.mean_r} ± ${analysis.cross_validation.sd_r}`);
  console.log(`Temporal violations: ${auditReport.violations}`);
  if (auditReport.contaminated) {
    console.log('⚠️  TEST CONTAMINATED — results excluded from valid registry');
  }

  return testResult;
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  analyze,
  spearmanCorrelation,
  pearsonCorrelation,
  quintileAnalysis,
  precisionAtThreshold,
  crossValidate,
  registerTest,
  getTestHistory,
  findTestsByPrompt,
  storePrompt,
  getPrompt,
  runTest,
};
