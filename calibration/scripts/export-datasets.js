#!/usr/bin/env node

// Export crawler retest datasets to CSV for external review.
// No analysis — just extract, merge, and format.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }

function escapeCSV(val) {
  if (val == null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCSV(path, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCSV(row[h])).join(','));
  }
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(`  Wrote ${path} (${rows.length} rows, ${headers.length} columns)`);
}

// ============================================================
// Load all source data
// ============================================================

const testCases = readJSON(join(CAL, 'crawler-midcap-test-cases.json')) || [];
const v1OOS = readJSON(join(CAL, 'crawler-midcap-oos/oos-merged.json'));
const v2Merged = readJSON(join(CAL, 'crawler-midcap-oos-v2/v2-merged.json'));
const v2Phase2 = readJSON(join(CAL, 'crawler-midcap-oos-v2/phase2-results.json')) || [];
const sp500Crawler = readJSON(join(CAL, 'crawler/test-5-1/phase3-merged.json'));
const sp500Phase2 = readJSON(join(CAL, 'crawler/test-5-1/phase2-results.json')) || [];
const job2Opus = readJSON(join(CAL, 'tests/job2-cases/opus-results-merged.json'));
const signalsMerged = readJSON(join(CAL, 'midcap-signals-merged.json'));
const mcUniverse = readJSON(join(CAL, 'midcap-universe-sectors-fixed.json'));
const spUniverse = readJSON(join(CAL, 'cases/universe.json'));

// Build lookup maps
const v1Map = {}; if (v1OOS?.results) for (const r of v1OOS.results) v1Map[r.case_id] = r;
const v2Map = {}; if (v2Merged?.results) for (const r of v2Merged.results) v2Map[r.case_id] = r;
const v2P2Map = {}; for (const r of v2Phase2) v2P2Map[r.case_id] = r;
const sp500Map = {}; if (sp500Crawler?.results) for (const r of sp500Crawler.results) sp500Map[r.case_id] = r;
const sp500P2Map = {}; for (const r of sp500Phase2) sp500P2Map[r.case_id] = r;
const job2Map = {}; if (job2Opus?.results) for (const r of job2Opus.results) job2Map[r.case_id] = r;
const sigMap = {}; if (signalsMerged?.results) for (const r of signalsMerged.results) sigMap[r.case_id] = r;
const mcCoMap = {}; if (mcUniverse?.companies) for (const c of mcUniverse.companies) mcCoMap[c.ticker] = c;

console.log('Data loaded. Building exports...\n');

// ============================================================
// File 1: export-crawler-midcap-cases.csv
// ============================================================

const file1Headers = [
  'case_id', 'ticker', 'cik', 'sector', 'market_cap_at_entry', 'entry_date', 'entry_cross_section',
  'outcome_class', 'forward_return_3yr', 'sp500_return_3yr', 'alpha_3yr',
  'baseline_v1_confidence', 'baseline_v1_trajectory',
  'baseline_v2_confidence', 'baseline_v2_trajectory',
  'enriched_v2_confidence', 'enriched_v2_trajectory',
  'classification_changed_v2', 'most_impactful_source_v2', 'key_insight_v2',
  'form4_data_found', 'form4_purchases_count', 'form4_purchases_value',
  'form4_sales_count', 'form4_sales_value', 'form4_net_direction', 'form4_net_value', 'form4_buy_sell_ratio',
  'customer_conc_found', 'customer_conc_summary',
  'management_14a_found', 'management_14a_summary',
];

const file1Rows = [];
for (const tc of testCases) {
  const v1 = v1Map[tc.case_id] || {};
  const v2 = v2Map[tc.case_id] || {};
  const p2 = v2P2Map[tc.case_id] || {};
  const ins = p2.phase2_data?.find(d => d.type === 'INSIDER_TRADING') || {};
  const cust = p2.phase2_data?.find(d => d.type === 'CUSTOMER_CONCENTRATION') || {};
  const mgmt = p2.phase2_data?.find(d => d.type === 'MANAGEMENT') || {};
  const insData = ins.insider_data || {};

  file1Rows.push({
    case_id: tc.case_id, ticker: tc.ticker, cik: tc.cik, sector: tc.sector,
    market_cap_at_entry: tc.market_cap, entry_date: tc.entry_date, entry_cross_section: tc.cross_section,
    outcome_class: tc.classification, forward_return_3yr: tc.forward_return_3yr,
    sp500_return_3yr: tc.sp500_return_3yr, alpha_3yr: tc.alpha_3yr,
    baseline_v1_confidence: v1.baseline_confidence, baseline_v1_trajectory: v1.baseline_trajectory,
    baseline_v2_confidence: v2.baseline_confidence, baseline_v2_trajectory: v2.baseline_trajectory,
    enriched_v2_confidence: v2.enriched_confidence, enriched_v2_trajectory: v2.enriched_trajectory,
    classification_changed_v2: v2.classification_changed, most_impactful_source_v2: v2.most_impactful_source,
    key_insight_v2: v2.key_insight,
    form4_data_found: ins.data_found, form4_purchases_count: insData.purchases?.count,
    form4_purchases_value: insData.purchases?.value, form4_sales_count: insData.sales?.count,
    form4_sales_value: insData.sales?.value, form4_net_direction: insData.net_direction,
    form4_net_value: insData.net_value, form4_buy_sell_ratio: insData.buy_sell_ratio,
    customer_conc_found: cust.data_found, customer_conc_summary: cust.summary?.slice(0, 500),
    management_14a_found: mgmt.data_found, management_14a_summary: mgmt.summary?.slice(0, 500),
  });
}

writeCSV(join(CAL, 'export-crawler-midcap-cases.csv'), file1Headers, file1Rows);

// ============================================================
// File 2: export-crawler-sp500-cases.csv
// ============================================================

const file2Headers = [
  'case_id', 'ticker', 'entry_date', 'outcome_class', 'forward_return_3yr', 'alpha_3yr',
  'initial_trajectory', 'initial_confidence',
  'enriched_trajectory', 'enriched_confidence',
  'classification_changed', 'most_impactful_source', 'key_insight',
  'form4_data_found', 'form4_summary',
  'customer_conc_found', 'customer_conc_summary',
  'management_14a_found', 'management_14a_summary',
];

const file2Rows = [];
if (sp500Crawler?.results) {
  for (const r of sp500Crawler.results) {
    const j2 = job2Map[r.case_id] || {};
    const p2 = sp500P2Map[r.case_id] || {};
    const uCase = spUniverse?.cases?.[r.case_id] || {};
    const ins = p2.phase2_data?.find(d => d.request_type === 'INSIDER_TRADING') || {};
    const cust = p2.phase2_data?.find(d => d.request_type === 'CUSTOMER_CONCENTRATION') || {};
    const mgmt = p2.phase2_data?.find(d => d.request_type === 'MANAGEMENT') || {};

    file2Rows.push({
      case_id: r.case_id, ticker: r.ticker || j2.ticker,
      entry_date: uCase.entry_date, outcome_class: j2.outcome || uCase.outcome?.classification,
      forward_return_3yr: uCase.outcome?.forward_return_3yr, alpha_3yr: uCase.outcome?.alpha_3yr || j2.alpha_3yr,
      initial_trajectory: j2.trajectory, initial_confidence: j2.confidence,
      enriched_trajectory: r.enriched_trajectory, enriched_confidence: r.enriched_confidence,
      classification_changed: r.classification_changed, most_impactful_source: r.most_impactful_source,
      key_insight: r.key_insight,
      form4_data_found: ins.data_found, form4_summary: ins.summary?.slice(0, 500),
      customer_conc_found: cust.data_found, customer_conc_summary: cust.summary?.slice(0, 500),
      management_14a_found: mgmt.data_found, management_14a_summary: mgmt.summary?.slice(0, 500),
    });
  }
}

writeCSV(join(CAL, 'export-crawler-sp500-cases.csv'), file2Headers, file2Rows);

// ============================================================
// File 3: export-insider-signal-raw.csv
// ============================================================

const file3Headers = [
  'ticker', 'cik', 'sector', 'entry_date', 'market_cap_at_entry',
  'outcome_class', 'forward_return_3yr',
  'form4_filings_parsed', 'form4_purchases_count', 'form4_purchases_value',
  'form4_sales_count', 'form4_sales_value',
  'form4_net_direction', 'form4_net_value', 'form4_buy_sell_ratio',
];

const file3Rows = [];
for (const p2 of v2Phase2) {
  const ins = p2.phase2_data?.find(d => d.type === 'INSIDER_TRADING');
  if (!ins?.insider_data) continue;
  const d = ins.insider_data;
  const tc = testCases.find(t => t.case_id === p2.case_id) || {};

  file3Rows.push({
    ticker: p2.ticker, cik: p2.cik, sector: p2.sector,
    entry_date: p2.entry_date, market_cap_at_entry: tc.market_cap,
    outcome_class: p2.classification, forward_return_3yr: p2.forward_return_3yr,
    form4_filings_parsed: d.parsed, form4_purchases_count: d.purchases?.count,
    form4_purchases_value: d.purchases?.value, form4_sales_count: d.sales?.count,
    form4_sales_value: d.sales?.value, form4_net_direction: d.net_direction,
    form4_net_value: d.net_value, form4_buy_sell_ratio: d.buy_sell_ratio,
  });
}

writeCSV(join(CAL, 'export-insider-signal-raw.csv'), file3Headers, file3Rows);

// ============================================================
// File 4: export-midcap-all-signals.csv
// ============================================================

const file4Headers = [
  'case_id', 'ticker', 'cik', 'sector', 'entry_date', 'entry_cross_section', 'market_cap_at_entry',
  'outcome_class', 'forward_return_3yr', 'sp500_return_3yr', 'alpha_3yr',
  'spread_variance_slope', 'spread_theta',
  'si_zipf_velocity', 'si_zipf_velocity_fixed', 'si_csd', 'si_d1', 'si_d2', 'si_theta', 'si_beta', 'si_change',
  'composite',
  'fisher_information', 'base10_excess', 'round_number_excess',
  'form4_net_direction', 'form4_net_value', 'form4_buy_sell_ratio',
  'baseline_v2_trajectory', 'enriched_v2_trajectory',
];

const file4Rows = [];
if (signalsMerged?.results) {
  for (const r of signalsMerged.results) {
    const co = mcCoMap[r.ticker] || {};
    const v2 = v2Map[r.case_id] || {};
    const p2 = v2P2Map[r.case_id];
    const ins = p2?.phase2_data?.find(d => d.type === 'INSIDER_TRADING')?.insider_data;

    file4Rows.push({
      case_id: r.case_id, ticker: r.ticker, cik: co.cik, sector: co.sector,
      entry_date: r.entry_date, entry_cross_section: r.cross_section,
      market_cap_at_entry: r.market_cap || co.market_cap,
      outcome_class: r.classification, forward_return_3yr: r.forward_return_3yr,
      sp500_return_3yr: '', alpha_3yr: r.alpha_3yr,
      spread_variance_slope: r.signals?.spread_variance_slope,
      spread_theta: r.signals?.spread_theta,
      si_zipf_velocity: r.signals?.si_zipf_velocity,
      si_zipf_velocity_fixed: r.signals?.si_zipf_velocity_fixed,
      si_csd: r.signals?.si_csd, si_d1: r.signals?.si_d1,
      si_d2: r.signals?.si_d2, si_theta: r.signals?.si_theta,
      si_beta: r.signals?.si_beta, si_change: r.signals?.si_change,
      composite: r.signals?.composite,
      fisher_information: r.signals?.fisher,
      base10_excess: r.signals?.base10_excess,
      round_number_excess: r.signals?.round_number_excess,
      form4_net_direction: ins?.net_direction,
      form4_net_value: ins?.net_value,
      form4_buy_sell_ratio: ins?.buy_sell_ratio,
      baseline_v2_trajectory: v2.baseline_trajectory,
      enriched_v2_trajectory: v2.enriched_trajectory,
    });
  }
}

writeCSV(join(CAL, 'export-midcap-all-signals.csv'), file4Headers, file4Rows);

console.log('\nDone. All 4 CSV files exported to calibration/.');
