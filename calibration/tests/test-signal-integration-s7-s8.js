#!/usr/bin/env node

// Sessions 7-8: Signal Integration + Spectral-Narrative Coherence
// Combines surviving signals from S1-6, tests trace formula predictions.
// Session 8 runs with available data — full coherence requires Session 4 narrative data.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { spearmanCorrelation, analyze, crossValidate, registerTest } from './testing-framework.js';
import { rmtAnalysis } from '../services/rmt-analysis.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const CACHE_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }
function writeJSON(p, d) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(d, null, 2)); }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// ============================================================
// SESSION 7: SIGNAL INTEGRATION
// ============================================================

function runSession7() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 7: SIGNAL INTEGRATION                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Load all session results
  const s1_6 = readJSON(join(RESULTS_DIR, 'advanced-math-s1-6-2026-03-26.json'));
  const mdExpanded = readJSON(join(RESULTS_DIR, 'market-dynamics-expanded-2026-03-26.json'));
  const fisherData = readJSON(join(CACHE_DIR, 'fisher/fisher-scores.json'));
  const spectralData = readJSON(join(CACHE_DIR, 'spectral/spectral-results.json'));
  const benfordData = readJSON(join(CACHE_DIR, 'multibase/benford-results.json'));

  if (!mdExpanded) { console.log('  ⚠ Market dynamics results not found'); return null; }

  console.log('  Available data:');
  console.log(`    Market dynamics cases: ${mdExpanded.case_details?.length || 0}`);
  console.log(`    Fisher scores: ${fisherData?.cases?.length || 0}`);
  console.log(`    Spectral results: ${spectralData?.cases?.length || 0}`);
  console.log(`    Benford results: ${benfordData?.cases?.length || 0}\n`);

  // Step 7A: Collect surviving signals
  console.log('  Surviving signals from Sessions 1-6:');
  console.log('  Session | Signal                  | r     | CV    | Status');
  console.log('  ' + '─'.repeat(65));

  const summary = [
    { session: 'S1', signal: 'RMT composite (eigenvalue-wt)', r: s1_6?.session_1_rmt?.rmt_composite_r, cv: s1_6?.session_1_rmt?.rmt_composite_cv },
    { session: 'S1', signal: 'RMT F1-F2 optimal (0.4/0.2)', r: 0.182, cv: 0.182 },
    { session: 'S2', signal: 'Zipf × D1 interaction', r: s1_6?.session_2_multiplicative?.best_interaction_r, cv: 0.223 },
    { session: 'S3', signal: 'Fisher information', r: s1_6?.session_3_fisher?.r, cv: s1_6?.session_3_fisher?.cv },
    { session: 'S5', signal: 'Round-number EPS excess', r: 0.132, cv: null },
    { session: 'S5', signal: 'Base-10 Benford excess', r: 0.075, cv: 0.077 },
    { session: 'S6', signal: 'Secular dominance', r: s1_6?.session_6_spectral?.secular_dominance_r, cv: 0.082 },
  ];

  for (const s of summary) {
    const rStr = s.r != null ? s.r.toFixed(3).padStart(6) : '  N/A ';
    const cvStr = s.cv != null ? s.cv.toFixed(3).padStart(6) : '  N/A ';
    const pass = s.cv != null && s.cv > 0.05 ? 'PASS' : s.cv != null ? 'FAIL' : '?';
    console.log(`  ${s.session.padEnd(7)} | ${s.signal.padEnd(30)} | ${rStr} | ${cvStr} | ${pass}`);
  }

  // Step 7B: Build combined composite from market dynamics + EDGAR signals
  // Find cases that appear in both the 457 market-dynamics set and the EDGAR datasets
  const mdByTicker = {};
  for (const c of mdExpanded.case_details) {
    mdByTicker[`${c.ticker}|${c.entry_date}`] = c;
  }

  const fisherByTicker = {};
  if (fisherData?.cases) {
    for (const c of fisherData.cases) {
      fisherByTicker[`${c.ticker}|${c.entry_date}`] = c;
    }
  }

  const spectralByTicker = {};
  if (spectralData?.cases) {
    for (const c of spectralData.cases) {
      spectralByTicker[`${c.ticker}|${c.entry_date}`] = c;
    }
  }

  // Build combined signal matrix for cases present in multiple datasets
  const combinedCases = [];
  const signalNames = [];
  let firstCase = true;

  for (const [key, md] of Object.entries(mdByTicker)) {
    const fisher = fisherByTicker[key];
    const spectral = spectralByTicker[key];

    // Require at least market dynamics data
    if (!md.scores?.si_zipf_velocity) continue;

    const signals = {};
    // Market dynamics signals
    for (const [k, v] of Object.entries(md.scores)) {
      if (v != null && isFinite(v) && k !== 'composite' && k !== 'volume_benford_anomalous') {
        signals[`md_${k}`] = v;
      }
    }
    // Fisher
    if (fisher) signals.fisher = fisher.fisherMedian;
    // Spectral
    if (spectral) {
      signals.secular_dom = spectral.secularDominance;
      signals.spectral_stn = spectral.signalToNoise;
    }

    if (firstCase) {
      signalNames.push(...Object.keys(signals));
      firstCase = false;
    }

    // Only include if we have all the signals from the first case
    if (Object.keys(signals).length >= signalNames.length) {
      combinedCases.push({
        ticker: md.ticker,
        outcome: md.outcome,
        alpha_3yr: md.alpha_3yr || 0,
        signals,
      });
    }
  }

  console.log(`\n  Combined signal matrix: ${combinedCases.length} cases × ${signalNames.length} signals`);

  if (combinedCases.length < 50) {
    console.log('  ⚠ Insufficient overlapping cases for combined RMT analysis');

    // Fall back to market-dynamics-only integration
    console.log('  → Falling back to market-dynamics-only RMT with optimal weighting\n');

    // Use the optimal weighting from S1: Factor 1 × 0.4 + Factor 2 × 0.2
    const rmtFactorStructure = readJSON(join(CACHE_DIR, 'rmt/factor-structure.json'));
    if (rmtFactorStructure) {
      console.log(`  RMT factor structure: ${rmtFactorStructure.n_significant_factors} factors\n`);
    }

    return { combinedN: combinedCases.length, fallback: true };
  }

  // Run RMT on combined signals
  const dataMatrix = combinedCases.map(c => signalNames.map(k => c.signals[k] || 0));
  const outcomes = combinedCases.map(c => c.outcome);
  const returns = combinedCases.map(c => c.alpha_3yr);

  const rmt = rmtAnalysis(dataMatrix, signalNames);

  console.log(`  Combined RMT: ${rmt.n_significant} significant factors (λ₊ = ${rmt.lambda_plus})\n`);

  for (const f of rmt.significantFactors) {
    console.log(`  Factor ${f.index} (λ=${f.eigenvalue}, ${(f.variance_explained * 100).toFixed(1)}%):`);
    const topLoadings = Object.entries(f.loadings)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 5);
    for (const [name, loading] of topLoadings) {
      console.log(`    ${name.padEnd(25)} ${loading >= 0 ? '+' : ''}${loading.toFixed(3)}`);
    }
    console.log('');
  }

  // Test combined composite
  const compositeAnalysis = analyze(rmt.rmtComposite, outcomes, returns);
  console.log('  Combined RMT composite:');
  console.log(`    r = ${compositeAnalysis.spearman_r?.toFixed(3)}, p = ${compositeAnalysis.spearman_p?.toFixed(6)}`);
  console.log(`    CV mean = ${compositeAnalysis.cross_validation?.mean_r?.toFixed(3)}`);
  console.log(`    Compare: original composite r=0.142, SI Zipf r=0.219\n`);

  // Step 7C: Threshold sweep
  console.log('  Practical threshold sweep:');
  console.log('  Threshold     | Cases | Winners | Traps | Precision | Win rate');
  console.log('  ' + '─'.repeat(65));

  const sorted = [...rmt.rmtComposite].sort((a, b) => a - b);
  const compMean = mean(sorted);
  const compStd = Math.sqrt(sorted.reduce((s, v) => s + (v - compMean) ** 2, 0) / sorted.length);

  for (const sdThresh of [0.0, 0.5, 1.0, 1.5, 2.0]) {
    const thresh = compMean + sdThresh * compStd;
    const above = combinedCases.filter((c, i) => rmt.rmtComposite[i] >= thresh);
    const w = above.filter(c => c.outcome === 'winner').length;
    const t = above.filter(c => c.outcome === 'trap').length;
    const precision = above.length > 0 ? (w / above.length * 100).toFixed(1) : 'N/A';
    console.log(`  > ${sdThresh.toFixed(1)} SD       | ${String(above.length).padStart(5)} | ${String(w).padStart(7)} | ${String(t).padStart(5)} | ${String(precision).padStart(7)}%  | ${precision}%`);
  }

  return { rmt, compositeAnalysis, combinedN: combinedCases.length };
}

// ============================================================
// SESSION 8: SPECTRAL-NARRATIVE COHERENCE (Partial — without narrative data)
// ============================================================

function runSession8Partial() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 8: SPECTRAL-NARRATIVE COHERENCE (Partial)         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Step 8A: Dimensional consistency test
  const rmtStructure = readJSON(join(CACHE_DIR, 'rmt/factor-structure.json'));
  const spectralData = readJSON(join(CACHE_DIR, 'spectral/spectral-results.json'));

  if (!rmtStructure || !spectralData?.cases) {
    console.log('  ⚠ Missing RMT or spectral data for dimensional consistency test');
    return null;
  }

  console.log('  Step 8A: Dimensional Consistency (Trace Formula Prediction 1)\n');
  console.log(`    RMT significant factors: ${rmtStructure.n_significant_factors}`);

  const spectralDims = spectralData.cases.map(c => c.spectralDimensionality);
  const meanSpectralDim = mean(spectralDims);
  console.log(`    Mean spectral dimensionality: ${meanSpectralDim.toFixed(2)}`);
  console.log(`    → Prediction: these should roughly correspond.\n`);

  // Check if narrative data exists
  const narrativeFiles = [];
  try {
    const narrDir = join(CACHE_DIR, 'narrative');
    if (existsSync(narrDir)) {
      const files = readdirSync(narrDir).filter(f => f.endsWith('.json'));
      narrativeFiles.push(...files);
    }
  } catch {}

  if (narrativeFiles.length > 20) {
    console.log(`    Narrative data available: ${narrativeFiles.length} cases`);
    console.log('    → Full Session 8 can be run with narrative data\n');
  } else {
    console.log('    ⚠ Narrative data not yet available (run Session 4 first)');
    console.log('    → Session 8 will run fully after Session 4 completes\n');
  }

  // Step 8B-C: Can partially test with spectral data + Fisher
  const fisherData = readJSON(join(CACHE_DIR, 'fisher/fisher-scores.json'));

  if (spectralData?.cases && fisherData?.cases) {
    console.log('  Step 8B-C: Spectral Quality Analysis (partial coherence)\n');

    // Match cases
    const fisherByKey = {};
    for (const c of fisherData.cases) fisherByKey[`${c.ticker}|${c.entry_date}`] = c;

    const matched = [];
    for (const c of spectralData.cases) {
      const fisher = fisherByKey[`${c.ticker}|${c.entry_date}`];
      if (!fisher) continue;
      matched.push({
        ...c,
        fisherMedian: fisher.fisherMedian,
      });
    }

    console.log(`    Matched cases (spectral + Fisher): ${matched.length}`);

    if (matched.length >= 30) {
      // Test if Fisher and spectral dimensionality correlate
      const fisherScores = matched.map(m => m.fisherMedian);
      const specDims = matched.map(m => m.spectralDimensionality);
      const corr = spearmanCorrelation(fisherScores, specDims);

      console.log(`    Correlation(Fisher, spectral dim): r = ${corr?.r?.toFixed(3)}, p = ${corr?.p?.toFixed(6)}`);
      console.log(`    → High r means: informative companies have more spectral structure`);
      console.log(`    → Low r means: Fisher and spectral capture independent aspects\n`);

      // Fisher × secular dominance interaction
      const interaction = matched.map(m => m.fisherMedian * m.secularDominance);
      // We don't have outcomes for the spectral dataset easily matched — skip correlation test
    }
  }

  // Report what Session 8 will need
  console.log('  Session 8 completion requirements:');
  console.log('    ✓ RMT factor structure (Session 1)');
  console.log('    ✓ Spectral dimensionality (Session 6)');
  console.log('    ✓ Fisher information (Session 3)');
  console.log(`    ${narrativeFiles.length > 20 ? '✓' : '✗'} Narrative transitions (Session 4)`);
  console.log(`    → Full coherence test requires narrative data\n`);

  return { rmtFactors: rmtStructure.n_significant_factors, meanSpectralDim };
}

// ============================================================
// SESSION 9: ARCHITECTURE RECOMMENDATION
// ============================================================

function runSession9(s7Result, s8Result) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SESSION 9: ARCHITECTURE RECOMMENDATION                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('  1. QUANTITATIVE LAYER (computed from EDGAR + market data, $0 API cost):');
  console.log('     - SI Zipf velocity: r=0.219 — best company-specific market signal');
  console.log('     - SI Zipf × SI D1 interaction: r=0.223 — slight improvement via multiplicative');
  console.log('     - RMT Factor 1 (spread/Benford/theta): r=0.163 — macro+micro blend');
  console.log('     - Fisher information: r=0.169 — financial report transparency');
  console.log('     - Round-number EPS excess: r=0.132 — earnings quality filter');
  console.log('     - Composite: RMT optimal (F1×0.4 + F2×0.2): CV=0.182');
  console.log('     - Power-law α=1.5 improves additive composite slightly (CV=0.190)');
  console.log('');
  console.log('  2. META-SIGNALS (confidence weights):');
  console.log('     - Fisher quartile: Q4 win rate 62.3% vs Q1 55.7% — modest but consistent');
  console.log('     - STRUCTURAL_STRESS Benford class: 71.6% win rate (n=95) — concentrate here');
  console.log('');
  console.log('  3. SIGNALS THAT DID NOT PASS:');
  console.log('     - Base-10 Benford excess: r=0.075, too weak');
  console.log('     - Secular dominance: r=0.077, too weak');
  console.log('     - Signal-to-noise: r=0.054, too weak');
  console.log('     - HUMAN_MANIPULATION Benford class: 0 cases identified');
  console.log('     - Geometric mean composite: worse than arithmetic');
  console.log('');
  console.log('  4. PENDING (require Session 4):');
  console.log('     - Narrative transition asymmetry');
  console.log('     - Spectral-narrative perception gap');
  console.log('     - Sequence momentum (noncommutativity)');
  console.log('     - Coherence trajectory (dynamic sell signal)');
  console.log('');
  console.log('  5. EXPECTED IMPROVEMENT:');
  console.log('     - Current best: SI Zipf velocity r=0.219 (4.8% variance)');
  console.log('     - S2 interaction (Zipf × D1): r=0.223 (5.0% variance)');
  console.log('     - S1 RMT optimal: CV=0.182 (3.3% variance)');
  console.log('     - Fisher adds independent signal on different dataset (r=0.169)');
  console.log('     - Combined potential: awaiting Session 4 narrative layer');
  console.log('');
  console.log('  6. DEPLOYMENT ACTIONS:');
  console.log('     - DEPLOY: SI Zipf × SI D1 as primary composite signal');
  console.log('     - DEPLOY: Fisher quartile as confidence weight');
  console.log('     - DEPLOY: STRUCTURAL_STRESS Benford as positive filter');
  console.log('     - DEFER: Narrative layer pending API key + Session 4 execution');
  console.log('     - DROP: Secular dominance, signal-to-noise, base-10 excess');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SESSIONS 7-9: INTEGRATION + COHERENCE + ARCHITECTURE');
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════');

  const startTime = Date.now();

  const s7 = runSession7();
  const s8 = await runSession8Partial();
  runSession9(s7, s8);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Save report
  const report = {
    test_id: `advanced-math-s7-9-${new Date().toISOString().split('T')[0]}`,
    test_date: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    session_7: s7 ? {
      combined_n: s7.combinedN,
      composite_r: s7.compositeAnalysis?.spearman_r,
      composite_cv: s7.compositeAnalysis?.cross_validation?.mean_r,
    } : null,
    session_8: s8,
    narrative_data_available: false,
  };

  const reportPath = join(RESULTS_DIR, `advanced-math-s7-9-${new Date().toISOString().split('T')[0]}.json`);
  writeJSON(reportPath, report);

  registerTest({
    test_id: report.test_id, date: report.test_date,
    type: 'advanced-math-integration',
    description: 'Signal integration + partial coherence + architecture',
  });

  console.log(`\n  Results saved: ${reportPath}`);
  console.log(`  Elapsed: ${elapsed}s`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
