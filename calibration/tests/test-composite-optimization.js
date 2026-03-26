#!/usr/bin/env node

// Part 1: BUY Composite Optimization
// Assembles signal matrix, tests combinations, selects best composite.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const RESULTS_DIR = join(CAL, 'tests', 'results');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }
function writeJSON(p, d) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(d, null, 2)); }
function mean(a) { return a.length ? a.reduce((s,v) => s+v, 0) / a.length : 0; }

// ============================================================
// STATISTICS
// ============================================================

function assignRanks(arr) {
  const n = arr.length;
  const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && idx[j + 1].v === idx[j].v) j++;
    const avg = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearman(x, y) {
  const n = x.length;
  if (n < 5) return { r: 0, p: 1, n };
  const rx = assignRanks(x), ry = assignRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  const r = 1 - (6 * sumD2) / (n * (n * n - 1));
  const t = r * Math.sqrt((n - 2) / Math.max(1 - r * r, 1e-12));
  const erf = z => { const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const s=z<0?-1:1; const x2=Math.abs(z)/Math.sqrt(2); const t2=1/(1+p*x2); return s*(1-((((a5*t2+a4)*t2+a3)*t2+a2)*t2+a1)*t2*Math.exp(-x2*x2)); };
  const p = Math.max(0, 2 * (1 - 0.5 * (1 + erf(Math.abs(t)))));
  return { r: +r.toFixed(4), p: +p.toFixed(6), n };
}

function crossValidate(scores, outcomes, folds = 5) {
  const n = scores.length;
  let seed = 42;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
  const foldSize = Math.ceil(n / folds);
  const perFold = [];
  for (let f = 0; f < folds; f++) {
    const testIdx = new Set(indices.slice(f * foldSize, (f + 1) * foldSize));
    const ts = [], to = [];
    for (let i = 0; i < n; i++) { if (testIdx.has(i)) { ts.push(scores[i]); to.push(outcomes[i]); } }
    if (ts.length >= 5) perFold.push(spearman(ts, to).r);
  }
  const cvMean = mean(perFold);
  return { cvMean: +cvMean.toFixed(4), perFold: perFold.map(r => +r.toFixed(4)), folds: perFold.length };
}

function quintileAnalysis(scores, outcomes) {
  const paired = scores.map((s, i) => ({ s, o: outcomes[i] })).sort((a, b) => a.s - b.s);
  const n = paired.length;
  const qs = [];
  for (let q = 0; q < 5; q++) {
    const start = Math.floor(n * q / 5), end = Math.floor(n * (q + 1) / 5);
    const group = paired.slice(start, end);
    const wins = group.filter(g => g.o === 1).length;
    const traps = group.filter(g => g.o === 0).length;
    qs.push({ q: q + 1, n: group.length, winRate: +(wins / group.length * 100).toFixed(1), trapRate: +(traps / group.length * 100).toFixed(1) });
  }
  return qs;
}

function topDecilePrecision(scores, outcomes) {
  const paired = scores.map((s, i) => ({ s, o: outcomes[i] })).sort((a, b) => b.s - a.s);
  const top = paired.slice(0, Math.max(1, Math.floor(paired.length / 10)));
  const wins = top.filter(t => t.o === 1).length;
  return { precision: +(wins / top.length * 100).toFixed(1), n: top.length };
}

// ============================================================
// SIGNAL LOADING
// ============================================================

async function loadSignalMatrix() {
  const universe = readJSON(join(CAL, 'cases/universe.json'));
  const mdResults = readJSON(join(RESULTS_DIR, 'market-dynamics-expanded-2026-03-26.json'));
  const job2Results = readJSON(join(CAL, 'tests/job2-cases/opus-results-merged.json'));

  // Import spread computation functions
  const { getCreditSpreadForCase } = await import('../warehouse/connectors/fred-credit-spread.js');
  const { creditSpreadCSD, creditSpreadOU } = await import('../warehouse/connectors/market-dynamics.js');

  const allCases = Object.values(universe.cases);
  const training = allCases.filter(c => c.partition === 'training');
  const validation = allCases.filter(c => c.partition === 'validation');

  // Index SI signals by TICKER (not entry_date — MD test deduplicated by ticker)
  const mdByTicker = {};
  if (mdResults?.case_details) {
    for (const c of mdResults.case_details) mdByTicker[c.ticker] = c;
  }

  // Index Job 2 by case_id
  const job2ByCase = {};
  if (job2Results?.results) {
    for (const r of job2Results.results) {
      if (r.case_id) job2ByCase[r.case_id] = r;
    }
  }

  // Cache spread computations by entry_date (same for all cases at same date)
  const spreadCache = {};
  function getSpreadSignals(entryDate) {
    if (spreadCache[entryDate]) return spreadCache[entryDate];
    const series = getCreditSpreadForCase(entryDate, 3);
    if (series.length < 25) { spreadCache[entryDate] = null; return null; }
    const csd = creditSpreadCSD(series, 10);
    const ou = creditSpreadOU(series);
    const entrySpread = series[series.length - 1]?.credit_spread || null;
    spreadCache[entryDate] = {
      spread_variance_slope: csd?.varianceSlope ?? null,
      spread_theta: ou?.theta ?? null,
      spread_autocorr: csd?.autocorrSlope ?? null,
      spread_level: entrySpread,
    };
    return spreadCache[entryDate];
  }

  function buildRow(c) {
    const outcome = c.outcome?.classification;
    if (outcome !== 'winner' && outcome !== 'trap') return null;

    const md = mdByTicker[c.ticker];
    const j2 = job2ByCase[c.case_id];
    const spread = getSpreadSignals(c.entry_date);

    return {
      case_id: c.case_id,
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome_num: outcome === 'winner' ? 1 : 0,
      outcome_label: outcome,
      alpha_3yr: c.outcome?.alpha_3yr || 0,
      forward_return: c.outcome?.forward_return_3yr || 0,
      // Spread signals (macro — computed fresh per entry date)
      spread_variance_slope: spread?.spread_variance_slope ?? null,
      spread_theta: spread?.spread_theta ?? null,
      // SI signals (company — matched by ticker)
      si_zipf_velocity: md?.scores?.si_zipf_velocity ?? null,
      si_csd: md?.scores?.si_csd ?? null,
      si_d1: md?.scores?.si_d1 ?? null,
      si_theta: md?.scores?.si_theta ?? null,
      // Interaction
      si_zipf_x_d1: (md?.scores?.si_zipf_velocity != null && md?.scores?.si_d1 != null) ? md.scores.si_zipf_velocity * md.scores.si_d1 : null,
      // Job 2 (narrative — matched by case_id)
      job2_trajectory: j2 ? (j2.trajectory === 'stable' ? 1 : 0) : null,
      job2_confidence: j2 ? (j2.confidence === 'high' ? 1 : j2.confidence === 'medium' ? 0.5 : 0.25) : null,
    };
  }

  const trainRows = training.map(buildRow).filter(Boolean);
  const valRows = validation.map(buildRow).filter(Boolean);

  return { trainRows, valRows };
}

// ============================================================
// COMPOSITE METHODS
// ============================================================

function normalizeToZeroOne(values) {
  const valid = values.filter(v => v != null && isFinite(v));
  if (valid.length === 0) return values.map(() => null);
  const min = Math.min(...valid), max = Math.max(...valid);
  if (max === min) return values.map(v => v != null ? 0.5 : null);
  return values.map(v => v != null ? (v - min) / (max - min) : null);
}

function equalWeightComposite(rows, signalKeys) {
  // Normalize each signal to [0,1] using training stats
  const normalized = {};
  for (const key of signalKeys) {
    const vals = rows.map(r => r[key]);
    normalized[key] = normalizeToZeroOne(vals);
  }

  return rows.map((_, i) => {
    const vals = signalKeys.map(k => normalized[k][i]).filter(v => v != null);
    return vals.length > 0 ? mean(vals) : null;
  });
}

function rankBasedComposite(rows, signalKeys) {
  // For each signal, assign percentile ranks
  const ranks = {};
  for (const key of signalKeys) {
    const vals = rows.map(r => r[key]);
    const validIndices = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0);
    const validVals = validIndices.map(i => vals[i]);
    const r = assignRanks(validVals);
    const n = validVals.length;
    ranks[key] = new Array(vals.length).fill(null);
    validIndices.forEach((idx, j) => { ranks[key][idx] = r[j] / n; });
  }

  return rows.map((_, i) => {
    const vals = signalKeys.map(k => ranks[k][i]).filter(v => v != null);
    return vals.length > 0 ? mean(vals) : null;
  });
}

function ridgeComposite(rows, signalKeys, outcomes) {
  // Simple ridge regression with CV for lambda selection
  // Normalize signals
  const normalized = {};
  const stats = {};
  for (const key of signalKeys) {
    const vals = rows.map(r => r[key]);
    const valid = vals.filter(v => v != null && isFinite(v));
    const m = mean(valid);
    const std = Math.sqrt(valid.reduce((s, v) => s + (v - m) ** 2, 0) / valid.length) || 1;
    stats[key] = { mean: m, std };
    normalized[key] = vals.map(v => v != null ? (v - m) / std : null);
  }

  // Find cases with all signals
  const validIdx = rows.map((_, i) => signalKeys.every(k => normalized[k][i] != null) ? i : -1).filter(i => i >= 0);
  if (validIdx.length < 20) return { scores: rows.map(() => null), weights: {}, lambda: 0, stats };

  const X = validIdx.map(i => signalKeys.map(k => normalized[k][i]));
  const y = validIdx.map(i => outcomes[i]);
  const n = X.length, p = signalKeys.length;

  // Test lambdas
  const lambdas = [0.001, 0.01, 0.1, 1, 10];
  let bestLambda = 0.1, bestCV = -Infinity;

  for (const lambda of lambdas) {
    // 5-fold CV
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }

    const foldRs = [];
    for (let f = 0; f < 5; f++) {
      const foldSize = Math.ceil(n / 5);
      const testSet = new Set(perm.slice(f * foldSize, (f + 1) * foldSize));
      const trainX = [], trainY = [], testX = [], testY = [];
      for (let i = 0; i < n; i++) {
        if (testSet.has(i)) { testX.push(X[i]); testY.push(y[i]); }
        else { trainX.push(X[i]); trainY.push(y[i]); }
      }
      const w = ridgeSolve(trainX, trainY, lambda, p);
      const preds = testX.map(x => x.reduce((s, v, j) => s + v * w[j], 0));
      if (preds.length >= 5) foldRs.push(spearman(preds, testY).r);
    }
    const cvMean = mean(foldRs);
    if (cvMean > bestCV) { bestCV = cvMean; bestLambda = lambda; }
  }

  // Fit on full training set with best lambda
  const weights = ridgeSolve(X, y, bestLambda, p);
  const weightMap = {};
  signalKeys.forEach((k, i) => { weightMap[k] = +weights[i].toFixed(4); });

  // Score all cases
  const scores = rows.map((_, i) => {
    if (signalKeys.some(k => normalized[k][i] == null)) return null;
    return signalKeys.reduce((s, k, j) => s + normalized[k][i] * weights[j], 0);
  });

  return { scores, weights: weightMap, lambda: bestLambda, stats, bestCV: +bestCV.toFixed(4) };
}

function ridgeSolve(X, y, lambda, p) {
  // (X'X + λI)^-1 X'y via normal equations
  const n = X.length;
  // X'X
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = j; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
        if (k !== j) XtX[k][j] = XtX[j][k];
      }
    }
  }
  // Add ridge penalty
  for (let j = 0; j < p; j++) XtX[j][j] += lambda;

  // Solve via Gaussian elimination
  const A = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < p; col++) {
    let maxRow = col;
    for (let row = col + 1; row < p; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) continue;
    for (let row = col + 1; row < p; row++) {
      const factor = A[row][col] / A[col][col];
      for (let j = col; j <= p; j++) A[row][j] -= factor * A[col][j];
    }
  }
  // Back substitution
  const w = new Array(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    w[i] = A[i][p];
    for (let j = i + 1; j < p; j++) w[i] -= A[i][j] * w[j];
    w[i] /= Math.abs(A[i][i]) > 1e-12 ? A[i][i] : 1;
  }
  return w;
}

function applyRidgeToNew(rows, signalKeys, stats, weights) {
  // Apply pre-trained ridge weights to new data
  const weightArr = signalKeys.map(k => weights[k] || 0);
  return rows.map(r => {
    if (signalKeys.some(k => r[k] == null)) return null;
    let score = 0;
    signalKeys.forEach((k, i) => {
      const normalized = (r[k] - stats[k].mean) / stats[k].std;
      score += normalized * weightArr[i];
    });
    return score;
  });
}

// ============================================================
// MAIN
// ============================================================

function evaluateCombo(label, rows, signalKeys, method, ridgeResult = null) {
  const outcomes = rows.map(r => r.outcome_num);
  let scores;

  if (method === 'equal') {
    scores = equalWeightComposite(rows, signalKeys);
  } else if (method === 'rank') {
    scores = rankBasedComposite(rows, signalKeys);
  } else if (method === 'ridge') {
    if (!ridgeResult) ridgeResult = ridgeComposite(rows, signalKeys, outcomes);
    scores = ridgeResult.scores;
  }

  // Filter to valid scores
  const valid = scores.map((s, i) => s != null ? i : -1).filter(i => i >= 0);
  const vs = valid.map(i => scores[i]);
  const vo = valid.map(i => outcomes[i]);

  if (vs.length < 20) return null;

  const corr = spearman(vs, vo);
  const cv = crossValidate(vs, vo);
  const quints = quintileAnalysis(vs, vo);
  const topDec = topDecilePrecision(vs, vo);
  const monotonic = quints.every((q, i) => i === 0 || q.winRate >= quints[i - 1].winRate - 3); // Allow 3pp tolerance

  return {
    label, method, signalKeys,
    n: vs.length,
    r: corr.r, p: corr.p,
    cvMean: cv.cvMean, cvPerFold: cv.perFold,
    topDecile: topDec.precision, topDecileN: topDec.n,
    q5WinRate: quints[4]?.winRate, q1WinRate: quints[0]?.winRate,
    q5q1Spread: +((quints[4]?.winRate || 0) - (quints[0]?.winRate || 0)).toFixed(1),
    monotonic,
    quintiles: quints,
    ridgeWeights: ridgeResult?.weights,
    ridgeLambda: ridgeResult?.lambda,
    ridgeStats: ridgeResult?.stats,
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PART 1: BUY COMPOSITE OPTIMIZATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Assemble signal matrix
  console.log('── Step 1: Signal Matrix ──\n');
  const { trainRows, valRows } = await loadSignalMatrix();
  console.log(`  Training cases (winner/trap): ${trainRows.length}`);
  console.log(`  Validation cases (winner/trap): ${valRows.length}\n`);

  const signalKeys = ['spread_variance_slope', 'spread_theta', 'si_zipf_velocity', 'si_csd', 'si_d1', 'si_theta', 'si_zipf_x_d1', 'job2_trajectory', 'job2_confidence'];

  console.log('  Signal coverage (training):');
  for (const k of signalKeys) {
    const count = trainRows.filter(r => r[k] != null).length;
    console.log(`    ${k.padEnd(25)} ${count}/${trainRows.length} (${(count/trainRows.length*100).toFixed(0)}%)`);
  }
  const allSignals = trainRows.filter(r => signalKeys.every(k => r[k] != null)).length;
  console.log(`    ALL signals              ${allSignals}/${trainRows.length} (${(allSignals/trainRows.length*100).toFixed(0)}%)`);

  // Step 2: Correlation matrix
  console.log('\n── Step 2: Signal Correlation Matrix ──\n');
  const corrKeys = ['spread_variance_slope', 'spread_theta', 'si_zipf_velocity', 'si_csd', 'si_d1', 'job2_trajectory'];
  const shortNames = ['spr_var', 'spr_θ', 'si_zipf', 'si_csd', 'si_d1', 'job2'];

  console.log('  ' + ''.padEnd(10) + shortNames.map(n => n.padStart(8)).join(''));
  for (let i = 0; i < corrKeys.length; i++) {
    let row = '  ' + shortNames[i].padEnd(10);
    for (let j = 0; j < corrKeys.length; j++) {
      if (i === j) { row += '   1.000'; continue; }
      const valid = trainRows.filter(r => r[corrKeys[i]] != null && r[corrKeys[j]] != null);
      if (valid.length < 20) { row += '     N/A'; continue; }
      const c = spearman(valid.map(r => r[corrKeys[i]]), valid.map(r => r[corrKeys[j]]));
      row += c.r.toFixed(3).padStart(8);
    }
    console.log(row);
  }

  // Step 3: Test combinations
  console.log('\n── Step 3: Composite Testing ──\n');

  const combos = [
    { label: 'A', keys: ['spread_variance_slope'], methods: ['equal'] },
    { label: 'B', keys: ['si_zipf_velocity'], methods: ['equal'] },
    { label: 'C', keys: ['job2_trajectory'], methods: ['equal'] },
    { label: 'D', keys: ['spread_variance_slope', 'si_zipf_velocity'], methods: ['equal', 'ridge', 'rank'] },
    { label: 'E', keys: ['spread_variance_slope', 'job2_trajectory'], methods: ['equal', 'ridge', 'rank'] },
    { label: 'F', keys: ['si_zipf_velocity', 'job2_trajectory'], methods: ['equal', 'ridge', 'rank'] },
    { label: 'G', keys: ['spread_variance_slope', 'si_zipf_velocity', 'job2_trajectory'], methods: ['equal', 'ridge', 'rank'] },
    { label: 'H', keys: ['spread_variance_slope', 'si_zipf_x_d1', 'job2_trajectory'], methods: ['equal', 'ridge', 'rank'] },
    { label: 'I', keys: ['spread_variance_slope', 'si_zipf_velocity', 'si_csd', 'job2_trajectory'], methods: ['equal', 'ridge', 'rank'] },
    { label: 'J', keys: ['spread_variance_slope', 'spread_theta', 'si_zipf_velocity', 'si_csd', 'job2_trajectory', 'job2_confidence'], methods: ['equal', 'ridge', 'rank'] },
  ];

  console.log('  Combo | Method | N    | r     | CV mean | Top dec | Q5 win% | Q1 win% | Spread | Mono');
  console.log('  ' + '─'.repeat(95));

  const allResults = [];

  for (const combo of combos) {
    for (const method of combo.methods) {
      const result = evaluateCombo(combo.label, trainRows, combo.keys, method);
      if (!result) continue;
      allResults.push(result);

      const mono = result.monotonic ? '✓' : '✗';
      console.log(`  ${result.label.padEnd(5)} | ${method.padEnd(6)} | ${String(result.n).padStart(4)} | ${result.r.toFixed(3).padStart(6)} | ${result.cvMean.toFixed(3).padStart(7)} | ${String(result.topDecile).padStart(6)}% | ${String(result.q5WinRate).padStart(6)}% | ${String(result.q1WinRate).padStart(6)}% | ${String(result.q5q1Spread).padStart(5)}pp | ${mono}`);
    }
  }

  // Step 4: Select best
  console.log('\n── Step 4: Best Composite Selection ──\n');

  // Sort by CV mean, prefer monotonic
  const candidates = allResults.filter(r => r.cvMean > 0 && r.n >= 30);
  candidates.sort((a, b) => {
    if (a.monotonic && !b.monotonic) return -1;
    if (!a.monotonic && b.monotonic) return 1;
    return b.cvMean - a.cvMean;
  });

  const best = candidates[0];
  console.log('  BEST BUY COMPOSITE');
  console.log('  ═══════════════════');
  console.log(`  Combo: ${best.label}`);
  console.log(`  Signals: ${best.signalKeys.join(', ')}`);
  console.log(`  Method: ${best.method}`);
  console.log(`  N (training): ${best.n}`);
  console.log(`  r: ${best.r}`);
  console.log(`  CV mean r: ${best.cvMean}`);
  console.log(`  Top-decile precision: ${best.topDecile}%`);
  console.log(`  Q5 win rate: ${best.q5WinRate}%`);
  console.log(`  Q1 win rate: ${best.q1WinRate}%`);
  console.log(`  Q5-Q1 spread: ${best.q5q1Spread}pp`);
  console.log(`  Monotonic: ${best.monotonic}`);
  if (best.ridgeWeights) console.log(`  Ridge weights: ${JSON.stringify(best.ridgeWeights)}`);
  if (best.ridgeLambda) console.log(`  Ridge λ: ${best.ridgeLambda}`);

  // Step 5: Validate on validation partition
  console.log('\n── Step 5: Validation Check ──\n');

  let valResult;
  if (best.method === 'ridge' && best.ridgeWeights && best.ridgeStats) {
    const valScores = applyRidgeToNew(valRows, best.signalKeys, best.ridgeStats, best.ridgeWeights);
    const validIdx = valScores.map((s, i) => s != null ? i : -1).filter(i => i >= 0);
    const vs = validIdx.map(i => valScores[i]);
    const vo = validIdx.map(i => valRows[i].outcome_num);
    if (vs.length >= 20) {
      const corr = spearman(vs, vo);
      const quints = quintileAnalysis(vs, vo);
      const topDec = topDecilePrecision(vs, vo);
      valResult = { n: vs.length, r: corr.r, q5WinRate: quints[4]?.winRate, q1WinRate: quints[0]?.winRate, topDecile: topDec.precision };
    }
  } else {
    valResult = evaluateCombo(best.label + '_val', valRows, best.signalKeys, best.method);
  }

  if (valResult) {
    const rGap = Math.abs(best.r - valResult.r);
    const q5Gap = Math.abs((best.q5WinRate || 0) - (valResult.q5WinRate || 0));
    const overfit = rGap > 0.10 ? 'YES' : rGap > 0.05 ? 'BORDERLINE' : 'NO';

    console.log('  VALIDATION CHECK');
    console.log('  ════════════════');
    console.log(`  Training r:    ${best.r}   | Validation r:   ${valResult.r}   | Gap: ${rGap.toFixed(3)}`);
    console.log(`  Training Q5:   ${best.q5WinRate}% | Validation Q5:  ${valResult.q5WinRate}% | Gap: ${q5Gap.toFixed(1)}pp`);
    console.log(`  Top-decile:    ${best.topDecile}% | Validation:     ${valResult.topDecile}%`);
    console.log(`  Overfit? ${overfit}`);

    if (overfit === 'YES') {
      console.log('\n  ⚠ Overfitting detected — falling back to simpler composite...');
      // Find simplest combo with smallest gap
      for (const cand of candidates) {
        const candVal = evaluateCombo(cand.label + '_val', valRows, cand.signalKeys, cand.method);
        if (!candVal) continue;
        const gap = Math.abs(cand.r - candVal.r);
        if (gap < 0.10) {
          console.log(`  Fallback: Combo ${cand.label} (${cand.method}), gap=${gap.toFixed(3)}`);
          break;
        }
      }
    }
  } else {
    console.log('  ⚠ Insufficient validation data for selected combo');
  }

  // Save results
  const report = {
    best_combo: best,
    validation: valResult,
    all_results: allResults.map(r => ({ label: r.label, method: r.method, n: r.n, r: r.r, cvMean: r.cvMean, topDecile: r.topDecile, q5WinRate: r.q5WinRate, q1WinRate: r.q1WinRate, q5q1Spread: r.q5q1Spread, monotonic: r.monotonic, signalKeys: r.signalKeys, ridgeWeights: r.ridgeWeights, ridgeLambda: r.ridgeLambda, ridgeStats: r.ridgeStats })),
  };
  writeJSON(join(RESULTS_DIR, 'composite-optimization-2026-03-26.json'), report);

  // Generate markdown report
  let md = `# BUY Composite Optimization\n\n**Date**: ${new Date().toISOString().split('T')[0]}\n\n`;
  md += `## Best Composite\n\n`;
  md += `- **Combo**: ${best.label}\n- **Signals**: ${best.signalKeys.join(', ')}\n`;
  md += `- **Method**: ${best.method}\n- **N**: ${best.n}\n- **r**: ${best.r}\n- **CV mean**: ${best.cvMean}\n`;
  md += `- **Top-decile precision**: ${best.topDecile}%\n- **Q5 win rate**: ${best.q5WinRate}%\n- **Q1 win rate**: ${best.q1WinRate}%\n`;
  md += `- **Q5-Q1 spread**: ${best.q5q1Spread}pp\n`;
  if (valResult) {
    md += `\n## Validation\n\n- Training r: ${best.r} | Validation r: ${valResult.r}\n`;
    md += `- Training Q5: ${best.q5WinRate}% | Validation Q5: ${valResult.q5WinRate}%\n`;
  }
  md += `\n## All Results\n\n`;
  md += `| Combo | Method | N | r | CV mean | Top dec | Q5 win% | Q1 win% | Spread |\n`;
  md += `|-------|--------|---|---|---------|---------|---------|---------|--------|\n`;
  for (const r of allResults) {
    md += `| ${r.label} | ${r.method} | ${r.n} | ${r.r} | ${r.cvMean} | ${r.topDecile}% | ${r.q5WinRate}% | ${r.q1WinRate}% | ${r.q5q1Spread}pp |\n`;
  }

  writeFileSync(join(RESULTS_DIR, 'composite-optimization-2026-03-26.md'), md);

  console.log('\n  Results saved to composite-optimization-2026-03-26.json/.md');
  return report;
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
