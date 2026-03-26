#!/usr/bin/env node

// Market Dynamics Discrimination Test
// Tests whether nonlinear dynamics signals work better on market sentiment data
// than they did on financial statement data.
//
// Phase 1: Credit spread dynamics (data already in warehouse — all 2,832 cases)
// Phase 2: SI dynamics (from existing single snapshots — ~459 companies)
// Phase 3: Pilot FINRA SI time series fetch (50 companies)
//
// Uses ONLY systematic cases. No curated tier data.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

// Import testing framework
import { spearmanCorrelation, pearsonCorrelation, quintileAnalysis, crossValidate, analyze, registerTest } from './testing-framework.js';

// Import signal computers
import { creditSpreadCSD, creditSpreadOU, ornsteinUhlenbeckFit, siBetaScaling, siTrajectory, siMeanReversion, siCSD, siDerivatives, benfordAnalysis, computeAllSignals, extractTestableScores } from '../warehouse/connectors/market-dynamics.js';
import { extractCreditSpreadSeries, getCreditSpreadForCase } from '../warehouse/connectors/fred-credit-spread.js';
import { fetchSITimeSeries } from '../warehouse/connectors/finra-si-series.js';

// Import warehouse
import warehouse from '../warehouse/warehouse.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const CASES_DIR = resolve(import.meta.dirname, '../cases');

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJSON(path, data) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ============================================================
// LOAD SYSTEMATIC CASES
// ============================================================

function loadCases() {
  const universe = readJSON(join(CASES_DIR, 'universe.json'));
  if (!universe?.cases) throw new Error('Universe not found — run case import first');

  const cases = Object.values(universe.cases);
  console.log(`Loaded ${cases.length} systematic cases`);
  console.log(`  Outcomes: ${JSON.stringify(universe.metadata.stats.byOutcome)}`);
  return cases;
}

// ============================================================
// PHASE 1: CREDIT SPREAD DYNAMICS
// All cases can be tested — credit spread is a macro signal.
// ============================================================

function runCreditSpreadTest(cases) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('PHASE 1: CREDIT SPREAD DYNAMICS');
  console.log('══════════════════════════════════════════════════\n');

  const signals = {
    spread_csd_autocorr: [],
    spread_csd_variance: [],
    spread_csd_final_ac: [],
    spread_ou_theta: [],
    spread_ou_half_life: [],
    spread_level: [],
  };
  const outcomes = [];
  const returns = [];
  const validCases = [];

  for (const c of cases) {
    const outcome = c.outcome?.classification;
    if (!outcome || outcome === 'mixed' || outcome === 'underperform') continue;

    const entryDate = c.entry_date;
    if (!entryDate) continue;

    // Get credit spread series for this case
    const spreadSeries = getCreditSpreadForCase(entryDate, 3);
    if (spreadSeries.length < 25) continue; // Need enough for CSD computation

    // Compute CSD
    const csd = creditSpreadCSD(spreadSeries, 10);
    const ou = creditSpreadOU(spreadSeries);

    if (!csd && !ou) continue;

    // Entry-point spread level (closest to entry date)
    const entrySpread = spreadSeries[spreadSeries.length - 1]?.credit_spread || null;

    outcomes.push(outcome);
    returns.push(c.outcome.alpha_3yr || 0);
    validCases.push(c);

    signals.spread_csd_autocorr.push(csd?.autocorrSlope || 0);
    signals.spread_csd_variance.push(csd?.varianceSlope || 0);
    signals.spread_csd_final_ac.push(csd?.finalAutocorr || 0);
    signals.spread_ou_theta.push(ou?.theta || 0);
    signals.spread_ou_half_life.push(ou?.halfLife != null ? Math.min(ou.halfLife, 100) : 50);
    signals.spread_level.push(entrySpread || 0);
  }

  console.log(`  Valid cases (winner/trap with spread data): ${outcomes.length}`);
  console.log(`  Winners: ${outcomes.filter(o => o === 'winner').length}`);
  console.log(`  Traps: ${outcomes.filter(o => o === 'trap').length}\n`);

  const results = {};
  for (const [name, scores] of Object.entries(signals)) {
    if (scores.length < 10) continue;
    const analysis = analyze(scores, outcomes, returns);
    results[name] = analysis;

    const star = analysis.spearman_p < 0.01 ? '**' : analysis.spearman_p < 0.05 ? '*' : '';
    const cvPass = analysis.cross_validation?.per_fold_r?.filter(r => r > 0).length >= 4 ? 'PASS' : 'FAIL';
    console.log(`  ${name.padEnd(25)} r=${(analysis.spearman_r || 0).toFixed(3).padStart(7)}${star}  p=${(analysis.spearman_p || 1).toFixed(4)}  CV=${analysis.cross_validation?.mean_r?.toFixed(3) || 'N/A'} (${cvPass})  n=${analysis.n}`);
  }

  return { signals: results, n: outcomes.length, outcomes_dist: { winner: outcomes.filter(o => o === 'winner').length, trap: outcomes.filter(o => o === 'trap').length } };
}

// ============================================================
// PHASE 2: SI SNAPSHOT DYNAMICS
// Use existing single-snapshot SI data to compute what we can.
// ============================================================

function loadSISnapshot(ticker, beforeDate) {
  const records = warehouse.queryCompanyData(ticker, 'short_interest', { before: beforeDate });
  if (records.length === 0) return null;

  // Get the most recent snapshot before entry
  const latest = records[records.length - 1];
  const content = latest.content;

  // If it's a time series record (source = finra_time_series), return the series
  if (content?.series && Array.isArray(content.series)) {
    return { type: 'series', data: content.series };
  }

  // Single snapshot
  return {
    type: 'snapshot',
    data: {
      date: latest.publication_date,
      short_position: content?.short_position || null,
      days_to_cover: content?.days_to_cover || null,
      avg_daily_volume: content?.avg_daily_volume || null,
      change_pct: content?.change_pct || null,
    },
  };
}

function runSISnapshotTest(cases) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('PHASE 2: SI SNAPSHOT SIGNALS (Static)');
  console.log('══════════════════════════════════════════════════\n');

  const signals = {
    si_level: [],
    si_dtc: [],
    si_change_pct: [],
  };
  const outcomes = [];
  const returns = [];

  for (const c of cases) {
    const outcome = c.outcome?.classification;
    if (!outcome || outcome === 'mixed' || outcome === 'underperform') continue;

    const si = loadSISnapshot(c.ticker, c.entry_date);
    if (!si) continue;

    const data = si.type === 'series' ? si.data[si.data.length - 1] : si.data;
    if (!data?.short_position) continue;

    outcomes.push(outcome);
    returns.push(c.outcome.alpha_3yr || 0);

    signals.si_level.push(data.short_position);
    signals.si_dtc.push(data.days_to_cover || 0);
    signals.si_change_pct.push(data.change_pct || 0);
  }

  console.log(`  Valid cases with SI data: ${outcomes.length}`);
  console.log(`  Winners: ${outcomes.filter(o => o === 'winner').length}`);
  console.log(`  Traps: ${outcomes.filter(o => o === 'trap').length}\n`);

  if (outcomes.length < 20) {
    console.log('  ⚠ Insufficient SI snapshot data for testing\n');
    return null;
  }

  const results = {};
  for (const [name, scores] of Object.entries(signals)) {
    if (scores.length < 10) continue;
    const analysis = analyze(scores, outcomes, returns);
    results[name] = analysis;

    const star = analysis.spearman_p < 0.01 ? '**' : analysis.spearman_p < 0.05 ? '*' : '';
    const cvPass = analysis.cross_validation?.per_fold_r?.filter(r => r > 0).length >= 4 ? 'PASS' : 'FAIL';
    console.log(`  ${name.padEnd(25)} r=${(analysis.spearman_r || 0).toFixed(3).padStart(7)}${star}  p=${(analysis.spearman_p || 1).toFixed(4)}  CV=${analysis.cross_validation?.mean_r?.toFixed(3) || 'N/A'} (${cvPass})  n=${analysis.n}`);
  }

  return { signals: results, n: outcomes.length };
}

// ============================================================
// PHASE 3: SI TIME SERIES PILOT
// Fetch full SI time series from FINRA for a pilot set of 50 companies.
// Compute ALL SI dynamics signals.
// ============================================================

async function runSITimeSeriesPilot(cases) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('PHASE 3: SI TIME SERIES DYNAMICS (Pilot — 50 companies)');
  console.log('══════════════════════════════════════════════════\n');

  // Select 50 companies with the most data coverage and clear outcomes
  // Prefer cases from 2019+ (better FINRA coverage)
  const eligible = cases.filter(c => {
    const outcome = c.outcome?.classification;
    if (!outcome || outcome === 'mixed' || outcome === 'underperform') return false;
    if (c.entry_date < '2018-06-01') return false; // FINRA data starts March 2018
    return true;
  });

  // Deduplicate by ticker (take latest entry date per ticker)
  const byTicker = {};
  for (const c of eligible) {
    if (!byTicker[c.ticker] || c.entry_date > byTicker[c.ticker].entry_date) {
      byTicker[c.ticker] = c;
    }
  }

  // Balance winners and traps
  const winners = Object.values(byTicker).filter(c => c.outcome.classification === 'winner');
  const traps = Object.values(byTicker).filter(c => c.outcome.classification === 'trap');
  console.log(`  Eligible: ${winners.length} winners, ${traps.length} traps (deduplicated by ticker)`);

  // Take up to 25 of each
  const selected = [
    ...winners.slice(0, 25),
    ...traps.slice(0, 25),
  ];
  console.log(`  Selected pilot set: ${selected.length} companies\n`);

  if (selected.length < 20) {
    console.log('  ⚠ Insufficient eligible cases for pilot\n');
    return null;
  }

  // Fetch SI time series for each
  const siSignals = {};
  const pilotOutcomes = [];
  const pilotReturns = [];
  const pilotCases = [];
  let fetched = 0, failed = 0;

  for (const c of selected) {
    process.stdout.write(`\r  Fetching SI series: ${++fetched}/${selected.length} (${failed} failed)  `);

    try {
      const series = await fetchSITimeSeries(c.ticker, c.entry_date, 2);
      if (series.length < 8) {
        failed++;
        continue;
      }

      // Compute all SI dynamics signals
      const signals = computeAllSignals(series);
      const scores = extractTestableScores(signals);

      // Store scores for this case
      for (const [key, value] of Object.entries(scores)) {
        if (!siSignals[key]) siSignals[key] = [];
        siSignals[key].push(value);
      }

      pilotOutcomes.push(c.outcome.classification);
      pilotReturns.push(c.outcome.alpha_3yr || 0);
      pilotCases.push({ ticker: c.ticker, entry_date: c.entry_date, outcome: c.outcome.classification, si_points: series.length });
    } catch (e) {
      failed++;
    }
  }

  console.log(`\n  Successfully fetched: ${pilotOutcomes.length}/${selected.length}\n`);

  if (pilotOutcomes.length < 15) {
    console.log('  ⚠ Insufficient SI time series data for testing\n');
    return { fetched: pilotOutcomes.length, failed, pilotCases };
  }

  const results = {};
  for (const [name, scores] of Object.entries(siSignals)) {
    if (scores.length < 10) continue;
    const analysis = analyze(scores, pilotOutcomes, pilotReturns);
    results[name] = analysis;

    const star = analysis.spearman_p < 0.01 ? '**' : analysis.spearman_p < 0.05 ? '*' : '';
    const cvPass = analysis.cross_validation?.per_fold_r?.filter(r => r > 0).length >= 4 ? 'PASS' : 'FAIL';
    console.log(`  ${name.padEnd(25)} r=${(analysis.spearman_r || 0).toFixed(3).padStart(7)}${star}  p=${(analysis.spearman_p || 1).toFixed(4)}  CV=${analysis.cross_validation?.mean_r?.toFixed(3) || 'N/A'} (${cvPass})  n=${analysis.n}`);
  }

  return { signals: results, n: pilotOutcomes.length, failed, pilotCases };
}

// ============================================================
// COMPARISON TABLE
// ============================================================

function buildComparisonTable(creditResults, siSnapshotResults, siTimeSeriesResults) {
  console.log('\n\n════════════════════════════════════════════════════════════════════');
  console.log('DYNAMICS TOOLKIT: FINANCIAL vs MARKET DOMAIN');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Financial statement baselines (from the systematic dataset test — all near-zero)
  const financialBaseline = {
    'beta_scaling':    { r: -0.009, label: 'β scaling' },
    'beta_trajectory': { r:  0.010, label: 'β trajectory' },
    'csd_index':       { r: -0.037, label: 'CSD index' },
    'zipf_velocity':   { r:  0.012, label: 'Zipf velocity' },
    'benford_kld':     { r: -0.027, label: 'Benford KLD' },
    'd1_growth':       { r: -0.069, label: 'D1 growth rate' },
  };

  const rows = [];

  // Map market signals to their financial equivalents
  const marketMapping = [
    { financial: 'beta_scaling',    marketKey: 'si_beta',    source: siTimeSeriesResults },
    { financial: 'beta_trajectory', marketKey: 'si_change',  source: siTimeSeriesResults },
    { financial: 'csd_index',       marketKey: 'si_csd',     source: siTimeSeriesResults },
    { financial: 'zipf_velocity',   marketKey: 'si_zipf_velocity', source: siTimeSeriesResults },
    { financial: 'benford_kld',     marketKey: null,         source: null }, // Volume Benford not yet computed
    { financial: 'd1_growth',       marketKey: 'si_d1',      source: siTimeSeriesResults },
  ];

  console.log('Signal              | Financial r | Market r | p-value  | CV mean | Domain?');
  console.log('-'.repeat(85));

  for (const { financial, marketKey, source } of marketMapping) {
    const fin = financialBaseline[financial];
    const marketR = source?.signals?.[marketKey]?.spearman_r;
    const marketP = source?.signals?.[marketKey]?.spearman_p;
    const marketCV = source?.signals?.[marketKey]?.cross_validation?.mean_r;

    const finStr = fin.r.toFixed(3).padStart(7);
    const mktStr = marketR != null ? marketR.toFixed(3).padStart(7) : '   N/A ';
    const pStr = marketP != null ? marketP.toFixed(4).padStart(8) : '    N/A ';
    const cvStr = marketCV != null ? marketCV.toFixed(3).padStart(7) : '   N/A ';
    const better = marketR != null && Math.abs(marketR) > Math.abs(fin.r) ? 'MARKET' : marketR != null ? 'neither' : '?';

    console.log(`${fin.label.padEnd(20)} | ${finStr}     | ${mktStr} | ${pStr} | ${cvStr} | ${better}`);
    rows.push({ signal: fin.label, financial_r: fin.r, market_r: marketR, market_p: marketP, market_cv: marketCV, better });
  }

  // Credit spread signals (new — no financial equivalent)
  console.log('-'.repeat(85));
  console.log('NEW MARKET-ONLY SIGNALS:');
  console.log('-'.repeat(85));

  const creditSignals = ['spread_csd_autocorr', 'spread_csd_variance', 'spread_ou_theta', 'spread_ou_half_life', 'spread_level'];
  for (const key of creditSignals) {
    const result = creditResults?.signals?.[key];
    if (!result) continue;
    const r = result.spearman_r?.toFixed(3).padStart(7) || '   N/A ';
    const p = result.spearman_p?.toFixed(4).padStart(8) || '    N/A ';
    const cv = result.cross_validation?.mean_r?.toFixed(3).padStart(7) || '   N/A ';
    const star = result.spearman_p < 0.01 ? '**' : result.spearman_p < 0.05 ? '*' : '';
    console.log(`${key.padEnd(20)} |     N/A     | ${r}${star} | ${p} | ${cv}   | MARKET-ONLY`);
  }

  // SI snapshot baselines
  if (siSnapshotResults?.signals) {
    console.log('-'.repeat(85));
    console.log('STATIC SI BASELINES:');
    console.log('-'.repeat(85));
    for (const [key, result] of Object.entries(siSnapshotResults.signals)) {
      const r = result.spearman_r?.toFixed(3).padStart(7) || '   N/A ';
      const p = result.spearman_p?.toFixed(4).padStart(8) || '    N/A ';
      console.log(`${key.padEnd(20)} |     N/A     | ${r} | ${p} |         | baseline`);
    }
  }

  // Institutional flow signals (if available from pilot)
  if (siTimeSeriesResults?.signals) {
    const instKeys = Object.keys(siTimeSeriesResults.signals).filter(k => k.startsWith('inst_') || k.startsWith('shares_'));
    if (instKeys.length > 0) {
      console.log('-'.repeat(85));
      console.log('INSTITUTIONAL FLOW SIGNALS:');
      console.log('-'.repeat(85));
      for (const key of instKeys) {
        const result = siTimeSeriesResults.signals[key];
        const r = result.spearman_r?.toFixed(3).padStart(7) || '   N/A ';
        const p = result.spearman_p?.toFixed(4).padStart(8) || '    N/A ';
        const cv = result.cross_validation?.mean_r?.toFixed(3).padStart(7) || '   N/A ';
        console.log(`${key.padEnd(20)} |     N/A     | ${r} | ${p} | ${cv}   | MARKET-ONLY`);
      }
    }
  }

  console.log('-'.repeat(85));

  // Summary verdict
  const marketWins = rows.filter(r => r.better === 'MARKET').length;
  const tested = rows.filter(r => r.market_r != null).length;
  console.log(`\nVerdict: Market domain wins ${marketWins}/${tested} head-to-head comparisons`);

  // Check for any signals exceeding r=0.15
  const allMarketSignals = {
    ...(creditResults?.signals || {}),
    ...(siTimeSeriesResults?.signals || {}),
  };
  const strong = Object.entries(allMarketSignals)
    .filter(([, v]) => v.spearman_r != null && Math.abs(v.spearman_r) >= 0.15 && v.spearman_p < 0.01)
    .map(([k, v]) => `${k} (r=${v.spearman_r.toFixed(3)})`);

  if (strong.length > 0) {
    console.log(`\n✓ STRONG SIGNALS (|r| >= 0.15, p < 0.01): ${strong.join(', ')}`);
  } else {
    console.log(`\n✗ No market signals reached the r=0.15 threshold with p<0.01`);
  }

  return { rows, marketWins, tested, strongSignals: strong };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  MARKET DYNAMICS DISCRIMINATION TEST');
  console.log('  Testing nonlinear dynamics on market sentiment data');
  console.log('  Dataset: Systematic cases (unbiased)');
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const cases = loadCases();
  const startTime = Date.now();

  // Phase 1: Credit spread dynamics (all cases)
  const creditResults = runCreditSpreadTest(cases);

  // Phase 2: SI snapshot signals (cases with warehouse SI data)
  const siSnapshotResults = runSISnapshotTest(cases);

  // Phase 3: SI time series pilot (fetch from FINRA)
  const skipPilot = process.argv.includes('--skip-pilot');
  let siTimeSeriesResults = null;

  if (!skipPilot) {
    siTimeSeriesResults = await runSITimeSeriesPilot(cases);
  } else {
    console.log('\n  [Skipping Phase 3 — FINRA pilot (use without --skip-pilot to enable)]');
  }

  // Build comparison table
  const comparison = buildComparisonTable(creditResults, siSnapshotResults, siTimeSeriesResults);

  // Save results
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const report = {
    test_id: `market-dynamics-discrimination-${new Date().toISOString().split('T')[0]}`,
    test_date: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    phase_1_credit_spread: creditResults,
    phase_2_si_snapshot: siSnapshotResults,
    phase_3_si_time_series: siTimeSeriesResults,
    comparison_table: comparison,
    hypothesis: 'Nonlinear dynamics toolkit works better on market sentiment data than financial statements',
  };

  const reportPath = join(RESULTS_DIR, `market-dynamics-discrimination-${new Date().toISOString().split('T')[0]}.json`);
  writeJSON(reportPath, report);
  console.log(`\nResults saved: ${reportPath}`);
  console.log(`Elapsed: ${elapsed}s`);

  // Register in test registry
  registerTest({
    test_id: report.test_id,
    date: report.test_date,
    type: 'discrimination',
    description: 'Market sentiment vs financial statement domain comparison',
    n_cases: creditResults?.n || 0,
    key_findings: comparison.strongSignals,
    market_wins: comparison.marketWins,
    total_comparisons: comparison.tested,
  });
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
