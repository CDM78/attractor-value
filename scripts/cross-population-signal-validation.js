#!/usr/bin/env node
// Cross-Population Signal Validation — Test 5 robust signals across all tiers
//
// Phase 5 of the foreign source expansion mission.
// For each of the 5 robust signals, computes effect size and p-value separately on:
//   - Original population (Tiers 1-6, 719 cases)
//   - ADR/International (Tier 7)
//   - Small-Cap (Tier 8)
//   - Fraud/Failure (Tier 9)
//   - Combined expanded dataset (all tiers)
//
// Usage:
//   node --max-old-space-size=4096 scripts/cross-population-signal-validation.js [options]
//
// Options:
//   --dry-run     Use cached EDGAR data only
//   --limit N     Process only N tickers per population
//   --verbose     Print per-company detail
//   --output FILE JSON output path

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadCalibrationCases, getUniqueTickers, groupByOutcome } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, getRevenueAtDate, detectAccountingStandard } from './lib/edgar-extractor.js';
import { mannWhitneyU, spearmanCorrelation, linearRegression, mean, median, stddev, kFoldSplit } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const DRY_RUN = hasFlag('dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const VERBOSE = hasFlag('verbose');
const OUTPUT_PATH = getArg('output') || resolve(DATA_DIR, `cross-pop-validation-${new Date().toISOString().slice(0, 10)}.json`);

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const fmtNum = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const fmtPct = (v, d = 1) => v == null ? 'N/A' : (v * 100).toFixed(d) + '%';
const pad = (s, w) => String(s ?? 'N/A').padStart(w);

// ============================================
// SIGNAL COMPUTATION FUNCTIONS
// ============================================

// Signal 1: Flywheel Momentum (assets_rank × ROIC_rank)
function computeFlywheelMomentum(metrics) {
  if (!metrics || metrics.length < 4) return null;
  const recent = metrics[metrics.length - 1];
  if (recent.assets == null || recent.netIncome == null || recent.equity == null) return null;
  if (recent.equity <= 0) return null;
  const roic = recent.netIncome / recent.equity;
  // Flywheel = assets * ROIC (raw, will be ranked later in population context)
  return { assets: recent.assets, roic, raw: recent.assets * roic };
}

// Signal 2: D1 growth rate (most recent revenue YoY growth)
function computeD1Growth(metrics) {
  if (!metrics || metrics.length < 5) return null;
  // Find most recent quarter with YoY revenue growth
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].revenueGrowthYoY != null) return metrics[i].revenueGrowthYoY;
  }
  return null;
}

// Signal 3: Zipf rank velocity (sector rank trajectory)
function computeZipfRankVelocity(metrics) {
  if (!metrics || metrics.length < 8) return null;
  // Proxy: revenue rank change over time (positive = improving)
  const revenues = metrics.filter(m => m.revenue != null).map(m => m.revenue);
  if (revenues.length < 4) return null;
  const first4 = mean(revenues.slice(0, 4));
  const last4 = mean(revenues.slice(-4));
  if (first4 <= 0) return null;
  return (last4 - first4) / first4;
}

// Signal 4: Revenue growth (4Q vs prior 4Q)
function computeRevenueGrowth(metrics) {
  if (!metrics || metrics.length < 8) return null;
  const revs = metrics.filter(m => m.revenue != null).map(m => m.revenue);
  if (revs.length < 8) return null;
  const recent4 = revs.slice(-4).reduce((s, v) => s + v, 0);
  const prior4 = revs.slice(-8, -4).reduce((s, v) => s + v, 0);
  if (prior4 <= 0) return null;
  return (recent4 - prior4) / prior4;
}

// Signal 5: Scale invariance CV (metric consistency across time horizons)
function computeScaleInvarianceCV(metrics) {
  if (!metrics || metrics.length < 8) return null;
  // Compute CV of margin across different time windows
  const margins = metrics.filter(m => m.operatingMargin != null).map(m => m.operatingMargin);
  if (margins.length < 6) return null;

  // CV at different window sizes
  const cvs = [];
  for (const windowSize of [2, 4, 6]) {
    if (margins.length < windowSize) continue;
    const windows = [];
    for (let i = 0; i <= margins.length - windowSize; i++) {
      const windowMean = mean(margins.slice(i, i + windowSize));
      windows.push(windowMean);
    }
    if (windows.length >= 2) {
      const cv = stddev(windows) / (Math.abs(mean(windows)) + 0.001);
      cvs.push(cv);
    }
  }

  if (cvs.length < 2) return null;
  // Lower CV = more scale-invariant = better
  return mean(cvs);
}

// ============================================
// DATA LOADING
// ============================================
async function loadCompanyData(cases) {
  await ensureCikCache();
  const tickers = getUniqueTickers(cases);
  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;

  const companyData = {};
  let loaded = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);
    if (DRY_RUN && cik && !hasCachedFacts(cik)) { failed++; continue; }

    const result = await fetchFactsForTicker(ticker);
    if (result.error || !result.facts) { failed++; continue; }

    // For each case using this ticker, extract metrics at the entry date
    const casesForTicker = cases.filter(c => c.ticker === ticker);
    for (const c of casesForTicker) {
      const qm = extractQuarterlyMetrics(result.facts, c.entry_date);
      const key = `${ticker}-${c.entry_date || ''}`;
      companyData[key] = {
        ticker,
        outcome: c.outcome,
        tier: c.tier,
        metrics: qm,
        accounting_standard: detectAccountingStandard(result.facts),
      };
    }
    loaded++;

    if ((i + 1) % 25 === 0) {
      process.stdout.write(`  Loading: ${i + 1}/${limit} (${loaded} ok, ${failed} failed)...\r`);
    }
  }

  console.log(`  Loaded ${loaded}/${limit} tickers, ${failed} failed, ${Object.keys(companyData).length} case-entries`);
  return companyData;
}

// ============================================
// SIGNAL TESTING
// ============================================
function testSignalOnPopulation(companyData, signalFn, signalName) {
  const winnerValues = [];
  const trapValues = [];
  const allValues = [];
  const allOutcomes = [];

  for (const [key, data] of Object.entries(companyData)) {
    const value = signalFn(data.metrics);
    if (value == null) continue;

    allValues.push(value);
    allOutcomes.push(data.outcome === 'winner' ? 1 : 0);

    if (data.outcome === 'winner') winnerValues.push(value);
    else if (data.outcome === 'trap') trapValues.push(value);
  }

  if (winnerValues.length < 3 || trapValues.length < 3) {
    return {
      signal: signalName,
      n_total: allValues.length,
      n_winners: winnerValues.length,
      n_traps: trapValues.length,
      status: 'insufficient_data',
    };
  }

  // Mann-Whitney U test (winner vs trap)
  const mwu = mannWhitneyU(winnerValues, trapValues);

  // Spearman correlation (signal vs binary outcome)
  const spearman = spearmanCorrelation(allValues, allOutcomes);

  // 5-fold cross-validation
  let cvFolds = 0;
  let cvMeanR = null;
  if (allValues.length >= 20) {
    const folds = kFoldSplit(allValues, 5);
    const foldRs = [];
    for (const fold of folds) {
      const testX = fold.test.map(i => allValues[i]);
      const testY = fold.test.map(i => allOutcomes[i]);
      if (testX.length >= 5) {
        const foldCorr = spearmanCorrelation(testX, testY);
        if (foldCorr && foldCorr.p < 0.05) cvFolds++;
        if (foldCorr) foldRs.push(Math.abs(foldCorr.rho));
      }
    }
    cvMeanR = foldRs.length > 0 ? mean(foldRs) : null;
  }

  return {
    signal: signalName,
    n_total: allValues.length,
    n_winners: winnerValues.length,
    n_traps: trapValues.length,
    winner_mean: mean(winnerValues),
    trap_mean: mean(trapValues),
    effect_r: mwu?.effectSizeR || null,
    mwu_p: mwu?.p || null,
    spearman_rho: spearman?.rho || null,
    spearman_p: spearman?.p || null,
    cv_folds_significant: cvFolds,
    cv_mean_r: cvMeanR,
    status: 'ok',
  };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Cross-Population Signal Validation${RESET}`);
  console.log('='.repeat(60));

  // Load all calibration cases
  const allCases = loadCalibrationCases();
  console.log(`\nTotal cases loaded: ${allCases.length}`);

  // Group by population
  const populations = {
    'Original (T1-6)': allCases.filter(c => c.tier >= 1 && c.tier <= 6),
    'ADR/International (T7)': allCases.filter(c => c.tier === 7),
    'Small-Cap (T8)': allCases.filter(c => c.tier === 8),
    'Fraud/Failure (T9)': allCases.filter(c => c.tier === 9),
    'All Combined': allCases,
  };

  for (const [name, cases] of Object.entries(populations)) {
    const outcomes = {};
    for (const c of cases) outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1;
    console.log(`  ${name}: ${cases.length} cases (${JSON.stringify(outcomes)})`);
  }

  // Define the 5 robust signals
  const SIGNALS = [
    { name: 'Flywheel Momentum', fn: (m) => computeFlywheelMomentum(m)?.raw },
    { name: 'D1 Growth', fn: computeD1Growth },
    { name: 'Zipf Rank Velocity', fn: computeZipfRankVelocity },
    { name: 'Revenue Growth (4Q)', fn: computeRevenueGrowth },
    { name: 'Scale Invariance CV', fn: (m) => { const v = computeScaleInvarianceCV(m); return v != null ? -v : null; } }, // Negate: lower CV = better
  ];

  const results = {};

  for (const [popName, cases] of Object.entries(populations)) {
    if (cases.length === 0) {
      console.log(`\n${YELLOW}Skipping ${popName} — no cases${RESET}`);
      results[popName] = { status: 'no_cases', signals: {} };
      continue;
    }

    console.log(`\n${BOLD}${CYAN}Testing: ${popName} (${cases.length} cases)${RESET}`);

    const companyData = await loadCompanyData(cases);

    if (Object.keys(companyData).length === 0) {
      console.log(`  ${YELLOW}No EDGAR data available for this population${RESET}`);
      results[popName] = { status: 'no_edgar_data', n_cases: cases.length, signals: {} };
      continue;
    }

    results[popName] = {
      status: 'ok',
      n_cases: cases.length,
      n_with_data: Object.keys(companyData).length,
      signals: {},
    };

    for (const signal of SIGNALS) {
      const result = testSignalOnPopulation(companyData, signal.fn, signal.name);
      results[popName].signals[signal.name] = result;

      const statusIcon = result.status !== 'ok' ? `${YELLOW}SKIP${RESET}` :
        (result.cv_folds_significant >= 4 ? `${GREEN}ROBUST${RESET}` :
          result.cv_folds_significant >= 3 ? `${YELLOW}MODERATE${RESET}` :
            `${RED}WEAK${RESET}`);

      console.log(`  ${signal.name}: r=${fmtNum(result.effect_r)} p=${fmtNum(result.mwu_p)} CV=${result.cv_folds_significant}/5 ${statusIcon} (n=${result.n_total})`);
    }
  }

  // ============================================
  // SUMMARY TABLE
  // ============================================
  console.log(`\n\n${BOLD}${'='.repeat(100)}${RESET}`);
  console.log(`${BOLD}CROSS-POPULATION SIGNAL SUMMARY${RESET}`);
  console.log(`${'='.repeat(100)}`);

  const header = `${'Signal'.padEnd(25)} | ${'Original'.padStart(12)} | ${'ADR/Intl'.padStart(12)} | ${'SmallCap'.padStart(12)} | ${'Fraud'.padStart(12)} | ${'Combined'.padStart(12)}`;
  console.log(header);
  console.log('-'.repeat(100));

  for (const signal of SIGNALS) {
    const cols = [];
    for (const popName of Object.keys(populations)) {
      const r = results[popName]?.signals?.[signal.name];
      if (!r || r.status !== 'ok') {
        cols.push('---');
      } else {
        cols.push(`${fmtNum(r.effect_r, 3)} ${r.cv_folds_significant}/5`);
      }
    }
    console.log(`${signal.name.padEnd(25)} | ${cols.map(c => c.padStart(12)).join(' | ')}`);
  }

  console.log(`${'='.repeat(100)}`);

  // Signal stability analysis
  console.log(`\n${BOLD}Signal Stability Across Populations:${RESET}`);
  for (const signal of SIGNALS) {
    const rs = [];
    for (const popName of Object.keys(populations)) {
      const r = results[popName]?.signals?.[signal.name];
      if (r?.status === 'ok' && r.effect_r != null) rs.push(r.effect_r);
    }
    if (rs.length >= 2) {
      const stability = 1 - (stddev(rs) / (mean(rs) + 0.001));
      const stable = stability > 0.7 ? `${GREEN}STABLE${RESET}` : stability > 0.4 ? `${YELLOW}MODERATE${RESET}` : `${RED}UNSTABLE${RESET}`;
      console.log(`  ${signal.name}: mean r=${fmtNum(mean(rs), 3)}, SD=${fmtNum(stddev(rs), 3)}, stability=${fmtNum(stability, 2)} ${stable}`);
    }
  }

  // Save results
  writeFileSync(OUTPUT_PATH, JSON.stringify({
    timestamp: new Date().toISOString(),
    populations: Object.fromEntries(
      Object.entries(populations).map(([k, v]) => [k, { n_cases: v.length }])
    ),
    results,
  }, null, 2));
  console.log(`\n${GREEN}Results saved to ${OUTPUT_PATH}${RESET}`);

  // Generate markdown report
  generateReport(results, populations, SIGNALS);
}

function generateReport(results, populations, signals) {
  const lines = [
    '# Cross-Population Signal Validation Report',
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Dataset:** ${Object.values(populations).find(p => true)?.length || 0} total cases across ${Object.keys(populations).length} populations`,
    '',
    '## Population Summary',
    '',
    '| Population | Cases | Winners | Traps |',
    '|-----------|-------|---------|-------|',
  ];

  for (const [name, cases] of Object.entries(populations)) {
    const w = cases.filter(c => c.outcome === 'winner').length;
    const t = cases.filter(c => c.outcome === 'trap').length;
    lines.push(`| ${name} | ${cases.length} | ${w} | ${t} |`);
  }

  lines.push('', '## Signal Results by Population', '');
  lines.push('| Signal | Original r | ADR r | SmallCap r | Fraud r | Combined r | Stable? |');
  lines.push('|--------|-----------|-------|-----------|---------|-----------|---------|');

  for (const signal of signals) {
    const cols = [signal.name];
    const rs = [];
    for (const popName of Object.keys(populations)) {
      const r = results[popName]?.signals?.[signal.name];
      if (!r || r.status !== 'ok') {
        cols.push('N/A');
      } else {
        cols.push(`${fmtNum(r.effect_r, 3)} (${r.cv_folds_significant}/5)`);
        rs.push(r.effect_r);
      }
    }
    const stability = rs.length >= 2 ? (1 - (stddev(rs) / (mean(rs) + 0.001))) : null;
    cols.push(stability != null ? (stability > 0.7 ? 'YES' : stability > 0.4 ? 'MODERATE' : 'NO') : 'N/A');
    lines.push(`| ${cols.join(' | ')} |`);
  }

  lines.push('', '## Key Findings', '', '(Generated automatically — review signal stability across populations)', '');

  const reportPath = resolve(DATA_DIR, `cross-population-validation-report-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`${GREEN}Report saved to ${reportPath}${RESET}`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
