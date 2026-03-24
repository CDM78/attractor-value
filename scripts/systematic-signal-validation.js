#!/usr/bin/env node
// Systematic Signal Validation — Test 5 robust signals on 1,592-case dataset
//
// Validations:
//   1. Per-source signal performance
//   2. FM + D1 pair per source
//   3. 5-fold CV on full combined dataset
//   4. Size-stratified analysis
//   5. Domestic vs International
//   6. Fraud detection rate
//
// Usage:
//   node --max-old-space-size=4096 scripts/systematic-signal-validation.js [--dry-run] [--limit N]

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadSystematicCases, groupBySource } from './lib/calibration-data.js';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, getRevenueAtDate } from './lib/edgar-extractor.js';
import { mannWhitneyU, spearmanCorrelation, mean, median, stddev, kFoldSplit } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', X = '\x1b[0m';
const fmt = (v, d = 4) => v == null ? 'N/A' : v.toFixed(d);
const pad = (s, w) => String(s ?? 'N/A').padStart(w);

// ============================================
// SIGNAL FUNCTIONS
// ============================================
function computeFlywheelMomentum(metrics) {
  if (!metrics || metrics.length < 4) return null;
  const recent = metrics[metrics.length - 1];
  if (recent.assets == null || recent.netIncome == null || recent.equity == null) return null;
  if (recent.equity <= 0) return null;
  return recent.assets * (recent.netIncome / recent.equity);
}

function computeD1Growth(metrics) {
  if (!metrics || metrics.length < 5) return null;
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i].revenueGrowthYoY != null) return metrics[i].revenueGrowthYoY;
  }
  return null;
}

function computeZipfVelocity(metrics) {
  if (!metrics || metrics.length < 8) return null;
  const revs = metrics.filter(m => m.revenue != null).map(m => m.revenue);
  if (revs.length < 4) return null;
  const first4 = mean(revs.slice(0, 4));
  const last4 = mean(revs.slice(-4));
  return first4 > 0 ? (last4 - first4) / first4 : null;
}

function computeRevenueGrowth(metrics) {
  if (!metrics || metrics.length < 8) return null;
  const revs = metrics.filter(m => m.revenue != null).map(m => m.revenue);
  if (revs.length < 8) return null;
  const recent4 = revs.slice(-4).reduce((s, v) => s + v, 0);
  const prior4 = revs.slice(-8, -4).reduce((s, v) => s + v, 0);
  return prior4 > 0 ? (recent4 - prior4) / prior4 : null;
}

function computeScaleInvarianceCV(metrics) {
  if (!metrics || metrics.length < 8) return null;
  const margins = metrics.filter(m => m.operatingMargin != null).map(m => m.operatingMargin);
  if (margins.length < 6) return null;
  const cvs = [];
  for (const ws of [2, 4, 6]) {
    if (margins.length < ws) continue;
    const windows = [];
    for (let i = 0; i <= margins.length - ws; i++) windows.push(mean(margins.slice(i, i + ws)));
    if (windows.length >= 2) cvs.push(stddev(windows) / (Math.abs(mean(windows)) + 0.001));
  }
  return cvs.length >= 2 ? -mean(cvs) : null; // Negate: lower CV = better
}

// Combined FM + D1
function computeFMD1(metrics) {
  const fm = computeFlywheelMomentum(metrics);
  const d1 = computeD1Growth(metrics);
  if (fm == null || d1 == null) return null;
  // Normalize: rank-based in population context isn't possible here,
  // so use z-score-like combination
  return fm > 0 ? Math.log(fm) + d1 * 10 : d1 * 10;
}

const SIGNALS = [
  { name: 'Flywheel Momentum', fn: computeFlywheelMomentum },
  { name: 'D1 Growth', fn: computeD1Growth },
  { name: 'Zipf Velocity', fn: computeZipfVelocity },
  { name: 'Revenue Growth (4Q)', fn: computeRevenueGrowth },
  { name: 'Scale Invariance CV', fn: computeScaleInvarianceCV },
  { name: 'FM + D1 (pair)', fn: computeFMD1 },
];

// ============================================
// DATA LOADING
// ============================================
async function loadAllData(cases) {
  await ensureCikCache();
  const tickers = [...new Set(cases.map(c => c.ticker))];
  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;

  const tickerData = {}; // ticker → { facts extracted metrics keyed by entry_date }
  let loaded = 0, failed = 0, cached = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);

    if (DRY_RUN && cik && !hasCachedFacts(cik)) { failed++; continue; }

    const result = await fetchFactsForTicker(ticker);
    if (result.error || !result.facts) { failed++; continue; }

    // Extract metrics at each entry date for this ticker
    const casesForTicker = cases.filter(c => c.ticker === ticker);
    for (const c of casesForTicker) {
      const qm = extractQuarterlyMetrics(result.facts, c.entry_date);
      const key = `${ticker}|${c.entry_date}|${c.source}`;
      tickerData[key] = { metrics: qm, outcome: c.outcome, source: c.source, sector: c.sector, entry_price: c.entry_price };
    }
    loaded++;
    if (hasCachedFacts(cik)) cached++;

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      process.stdout.write(`  Loading: ${i + 1}/${limit} (${loaded} ok, ${cached} cached, ${failed} failed)...\r`);
    }
  }

  console.log(`\n  Loaded ${loaded}/${limit} tickers, ${failed} failed, ${Object.keys(tickerData).length} case-entries`);
  return tickerData;
}

// ============================================
// SIGNAL TESTING
// ============================================
function testSignal(data, signalFn, filter = null) {
  const winnerVals = [], trapVals = [], allVals = [], allOutcomes = [];

  for (const [key, d] of Object.entries(data)) {
    if (filter && !filter(d)) continue;
    const val = signalFn(d.metrics);
    if (val == null || !isFinite(val)) continue;

    allVals.push(val);
    allOutcomes.push(d.outcome === 'winner' ? 1 : 0);
    if (d.outcome === 'winner') winnerVals.push(val);
    else if (d.outcome === 'trap') trapVals.push(val);
  }

  if (winnerVals.length < 3 || trapVals.length < 3) {
    return { n: allVals.length, nW: winnerVals.length, nT: trapVals.length, status: 'insufficient' };
  }

  const mwu = mannWhitneyU(winnerVals, trapVals);
  const spearman = spearmanCorrelation(allVals, allOutcomes);

  // 5-fold CV
  let cvFolds = 0, cvRs = [];
  if (allVals.length >= 20) {
    const folds = kFoldSplit(allVals, 5);
    for (const fold of folds) {
      const tx = fold.test.map(i => allVals[i]);
      const ty = fold.test.map(i => allOutcomes[i]);
      if (tx.length >= 5) {
        const fc = spearmanCorrelation(tx, ty);
        if (fc && fc.p < 0.05) cvFolds++;
        if (fc) cvRs.push(Math.abs(fc.rho));
      }
    }
  }

  return {
    n: allVals.length, nW: winnerVals.length, nT: trapVals.length,
    r: mwu?.effectSizeR, p: mwu?.p,
    rho: spearman?.rho, rhoP: spearman?.p,
    cvFolds, cvMeanR: cvRs.length > 0 ? mean(cvRs) : null,
    status: 'ok',
  };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}Systematic Signal Validation${X}`);
  console.log('='.repeat(80));

  const cases = loadSystematicCases();
  console.log(`\nTotal systematic cases: ${cases.length}`);

  const bySource = groupBySource(cases);
  for (const [src, srcCases] of Object.entries(bySource)) {
    const outcomes = {};
    for (const c of srcCases) outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1;
    console.log(`  ${src}: ${srcCases.length} (${JSON.stringify(outcomes)})`);
  }

  // Load EDGAR data
  console.log(`\n${B}Loading EDGAR data...${X}`);
  const data = await loadAllData(cases);

  // ============================================
  // VALIDATION 1: Per-source signal performance
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(80)}${X}`);
  console.log(`${B}VALIDATION 1: Per-Source Signal Performance${X}`);
  console.log(`${'='.repeat(80)}`);

  const sources = Object.keys(bySource);
  const v1Results = {};

  // Header
  const sigNames = SIGNALS.map(s => s.name);
  console.log(`\n${'Source'.padEnd(22)} | ${sigNames.map(s => `${s.slice(0, 10).padStart(12)}`).join(' | ')} | N`);
  console.log('-'.repeat(22 + (sigNames.length * 15) + 5));

  for (const src of [...sources, 'ALL']) {
    const filter = src === 'ALL' ? null : (d) => d.source === src;
    const row = [src.padEnd(22)];
    v1Results[src] = {};

    for (const sig of SIGNALS) {
      const result = testSignal(data, sig.fn, filter);
      v1Results[src][sig.name] = result;
      if (result.status !== 'ok') row.push('---'.padStart(12));
      else row.push(`${fmt(result.r, 3)} ${result.cvFolds}/5`.padStart(12));
    }

    // N
    const srcData = src === 'ALL' ? Object.values(data) : Object.values(data).filter(d => d.source === src);
    row.push(String(srcData.length).padStart(4));

    console.log(row.join(' | '));
  }

  // ============================================
  // VALIDATION 2: FM + D1 pair per source
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(60)}${X}`);
  console.log(`${B}VALIDATION 2: FM + D1 Pair Per Source${X}`);
  console.log(`${'='.repeat(60)}`);

  console.log(`\n${'Source'.padEnd(22)} | ${'FM+D1 r'.padStart(10)} | ${'p'.padStart(10)} | ${'CV'.padStart(5)} | ${'N'.padStart(5)}`);
  console.log('-'.repeat(60));

  for (const src of [...sources, 'ALL']) {
    const filter = src === 'ALL' ? null : (d) => d.source === src;
    const result = testSignal(data, computeFMD1, filter);
    const rStr = result.status === 'ok' ? fmt(result.r, 3) : '---';
    const pStr = result.status === 'ok' ? fmt(result.p, 4) : '---';
    const cvStr = result.status === 'ok' ? `${result.cvFolds}/5` : '---';
    console.log(`${src.padEnd(22)} | ${rStr.padStart(10)} | ${pStr.padStart(10)} | ${cvStr.padStart(5)} | ${String(result.n).padStart(5)}`);
  }

  // ============================================
  // VALIDATION 3: 5-fold CV on full dataset
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(60)}${X}`);
  console.log(`${B}VALIDATION 3: 5-Fold CV on Full Dataset${X}`);
  console.log(`${'='.repeat(60)}`);

  console.log(`\n${'Signal'.padEnd(25)} | ${'r'.padStart(8)} | ${'p'.padStart(10)} | ${'CV folds'.padStart(10)} | ${'CV mean r'.padStart(10)}`);
  console.log('-'.repeat(70));

  for (const sig of SIGNALS) {
    const result = testSignal(data, sig.fn);
    if (result.status !== 'ok') {
      console.log(`${sig.name.padEnd(25)} | ${'---'.padStart(8)} | ${'---'.padStart(10)} | ${'---'.padStart(10)} | ${'---'.padStart(10)}`);
    } else {
      const label = result.cvFolds >= 4 ? `${G}ROBUST${X}` : result.cvFolds >= 3 ? `${Y}MODERATE${X}` : `${R}WEAK${X}`;
      console.log(`${sig.name.padEnd(25)} | ${fmt(result.r, 3).padStart(8)} | ${fmt(result.p, 6).padStart(10)} | ${(result.cvFolds + '/5').padStart(10)} | ${fmt(result.cvMeanR, 3).padStart(10)} ${label}`);
    }
  }

  // ============================================
  // VALIDATION 4: Size-stratified
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(60)}${X}`);
  console.log(`${B}VALIDATION 4: Size-Stratified (FM + D1)${X}`);
  console.log(`${'='.repeat(60)}`);

  // Use entry_price as rough proxy for size (not perfect but usable)
  const sizeFilters = {
    'Small (<$50)': (d) => d.entry_price != null && d.entry_price < 50,
    'Mid ($50-200)': (d) => d.entry_price != null && d.entry_price >= 50 && d.entry_price < 200,
    'Large (>$200)': (d) => d.entry_price != null && d.entry_price >= 200,
  };

  console.log(`\n${'Size'.padEnd(20)} | ${'FM+D1 r'.padStart(10)} | ${'p'.padStart(10)} | ${'N'.padStart(5)}`);
  console.log('-'.repeat(50));

  for (const [label, filter] of Object.entries(sizeFilters)) {
    const result = testSignal(data, computeFMD1, filter);
    console.log(`${label.padEnd(20)} | ${(result.status === 'ok' ? fmt(result.r, 3) : '---').padStart(10)} | ${(result.status === 'ok' ? fmt(result.p, 4) : '---').padStart(10)} | ${String(result.n).padStart(5)}`);
  }

  // ============================================
  // VALIDATION 5: Domestic vs International
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(60)}${X}`);
  console.log(`${B}VALIDATION 5: Domestic vs International (FM + D1)${X}`);
  console.log(`${'='.repeat(60)}`);

  console.log(`\n${'Market'.padEnd(20)} | ${'FM+D1 r'.padStart(10)} | ${'p'.padStart(10)} | ${'N'.padStart(5)}`);
  console.log('-'.repeat(50));

  const domesticResult = testSignal(data, computeFMD1, (d) => d.source !== 'adr');
  const intlResult = testSignal(data, computeFMD1, (d) => d.source === 'adr');

  console.log(`${'US Domestic'.padEnd(20)} | ${(domesticResult.status === 'ok' ? fmt(domesticResult.r, 3) : '---').padStart(10)} | ${(domesticResult.status === 'ok' ? fmt(domesticResult.p, 4) : '---').padStart(10)} | ${String(domesticResult.n).padStart(5)}`);
  console.log(`${'ADR/International'.padEnd(20)} | ${(intlResult.status === 'ok' ? fmt(intlResult.r, 3) : '---').padStart(10)} | ${(intlResult.status === 'ok' ? fmt(intlResult.p, 4) : '---').padStart(10)} | ${String(intlResult.n).padStart(5)}`);

  // ============================================
  // VALIDATION 6: Fraud detection
  // ============================================
  console.log(`\n${B}${C}${'='.repeat(60)}${X}`);
  console.log(`${B}VALIDATION 6: Fraud Detection Rate${X}`);
  console.log(`${'='.repeat(60)}`);

  const fraudCases = Object.entries(data).filter(([k, d]) => d.source === 'fraud');
  let fraudTotal = 0, fraudFlagged = {};
  for (const sig of SIGNALS) fraudFlagged[sig.name] = 0;

  // For each fraud case, check if signal value is in bottom quartile of all cases
  const allSignalValues = {};
  for (const sig of SIGNALS) {
    allSignalValues[sig.name] = [];
    for (const [k, d] of Object.entries(data)) {
      const v = sig.fn(d.metrics);
      if (v != null && isFinite(v)) allSignalValues[sig.name].push(v);
    }
    allSignalValues[sig.name].sort((a, b) => a - b);
  }

  for (const [key, d] of fraudCases) {
    fraudTotal++;
    for (const sig of SIGNALS) {
      const v = sig.fn(d.metrics);
      if (v == null) continue;
      const vals = allSignalValues[sig.name];
      const pctile = vals.findIndex(x => x >= v) / vals.length;
      // Flag if in bottom 25%
      if (pctile < 0.25) fraudFlagged[sig.name]++;
    }
  }

  console.log(`\nFraud cases with EDGAR data: ${fraudTotal}`);
  console.log(`\n${'Signal'.padEnd(25)} | ${'Flagged'.padStart(8)} | ${'Rate'.padStart(8)}`);
  console.log('-'.repeat(45));
  for (const sig of SIGNALS) {
    const rate = fraudTotal > 0 ? (fraudFlagged[sig.name] / fraudTotal * 100).toFixed(0) + '%' : 'N/A';
    console.log(`${sig.name.padEnd(25)} | ${String(fraudFlagged[sig.name]).padStart(8)} | ${rate.padStart(8)}`);
  }

  // ============================================
  // SAVE RESULTS & REPORT
  // ============================================
  const reportLines = [
    '# Systematic Dataset Validation Report',
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Dataset:** ${cases.length} cases from ${sources.length} sources`,
    `**EDGAR data loaded:** ${Object.keys(data).length} case-entries`,
    '',
    '## Dataset Composition',
    '',
    '| Source | Cases | Winners | Traps | Underperform | Mixed |',
    '|--------|-------|---------|-------|-------------|-------|',
  ];

  for (const src of sources) {
    const sc = bySource[src];
    const o = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
    for (const c of sc) o[c.outcome] = (o[c.outcome] || 0) + 1;
    reportLines.push(`| ${src} | ${sc.length} | ${o.winner} | ${o.trap} | ${o.underperform} | ${o.mixed} |`);
  }
  reportLines.push(`| **TOTAL** | **${cases.length}** | | | | |`);

  reportLines.push('', '## Validation 1: Per-Source Signal Performance', '');
  reportLines.push('| Source | FM r | D1 r | Zipf r | RevG r | SI r | FM+D1 r |');
  reportLines.push('|--------|------|------|--------|--------|------|---------|');
  for (const src of [...sources, 'ALL']) {
    const cols = [src];
    for (const sig of SIGNALS) {
      const r = v1Results[src]?.[sig.name];
      cols.push(r?.status === 'ok' ? `${fmt(r.r, 3)} (${r.cvFolds}/5)` : 'N/A');
    }
    reportLines.push(`| ${cols.join(' | ')} |`);
  }

  reportLines.push('', '## Validation 3: 5-Fold CV on Full Dataset', '');
  reportLines.push('| Signal | Effect r | p-value | CV Folds | CV Mean r | Status |');
  reportLines.push('|--------|----------|---------|----------|-----------|--------|');
  for (const sig of SIGNALS) {
    const r = v1Results['ALL']?.[sig.name];
    if (r?.status === 'ok') {
      const status = r.cvFolds >= 4 ? 'ROBUST' : r.cvFolds >= 3 ? 'MODERATE' : 'WEAK';
      reportLines.push(`| ${sig.name} | ${fmt(r.r, 3)} | ${fmt(r.p, 6)} | ${r.cvFolds}/5 | ${fmt(r.cvMeanR, 3)} | ${status} |`);
    }
  }

  reportLines.push('', '## Validation 6: Fraud Detection', '');
  reportLines.push(`Fraud cases tested: ${fraudTotal}`);
  reportLines.push('');
  reportLines.push('| Signal | Flagged (bottom 25%) | Detection Rate |');
  reportLines.push('|--------|---------------------|---------------|');
  for (const sig of SIGNALS) {
    const rate = fraudTotal > 0 ? (fraudFlagged[sig.name] / fraudTotal * 100).toFixed(0) + '%' : 'N/A';
    reportLines.push(`| ${sig.name} | ${fraudFlagged[sig.name]}/${fraudTotal} | ${rate} |`);
  }

  const reportPath = resolve(DATA_DIR, 'systematic-dataset-validation-report.md');
  writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`\n${G}Report saved to ${reportPath}${X}`);

  // Save raw results JSON
  writeFileSync(resolve(DATA_DIR, `systematic-validation-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify({ v1Results, timestamp: new Date().toISOString(), nCases: cases.length, nData: Object.keys(data).length }, null, 2));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
