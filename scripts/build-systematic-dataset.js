#!/usr/bin/env node
// Build Systematic Calibration Dataset — All sources, fully reproducible
//
// Sources:
//   1. S&P 500 constituent changes (reformat from existing expansion data)
//   2. Small-cap (reformat from existing tier8 data)
//   3. ADR/International (reformat from existing tier7 data)
//   4. Multi-entry date expansion (NEW — generate from EDGAR cache)
//   5. Fraud/SEC enforcement (reformat from existing tier9 data)
//   6. S&P 500 cross-section at 2019-01-01 (NEW — unbiased full index)
//
// Usage:
//   node scripts/build-systematic-dataset.js [--source N] [--limit N] [--dry-run] [--status]

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, fetchCompanyFacts, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, getRevenueAtDate, detectAccountingStandard } from './lib/edgar-extractor.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const SP500_DIR = resolve(DATA_DIR, 'sp500-constituents');
const CACHE_DIR = resolve(DATA_DIR, 'edgar-cache');

mkdirSync(CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(`--${n}`);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

const SOURCE = getArg('source') ? parseInt(getArg('source')) : null;
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const DRY_RUN = hasFlag('dry-run');
const STATUS_ONLY = hasFlag('status');

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', D = '\x1b[2m', X = '\x1b[0m';

let lastYahooTime = 0;
async function fetchYahooPrice(ticker, period1, period2) {
  const now = Date.now();
  if (now - lastYahooTime < 200) await new Promise(r => setTimeout(r, 200 - (now - lastYahooTime)));
  lastYahooTime = Date.now();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.adjclose?.[0]?.adjclose) return null;
    const ts = result.timestamp, cl = result.indicators.adjclose[0].adjclose;
    return ts.map((t, i) => cl[i] != null ? { timestamp: t, close: cl[i] } : null).filter(Boolean);
  } catch { return null; }
}

function findClosestPrice(prices, targetTs) {
  if (!prices?.length) return null;
  let best = prices[0], bestDiff = Math.abs(prices[0].timestamp - targetTs);
  for (const p of prices) { const d = Math.abs(p.timestamp - targetTs); if (d < bestDiff) { best = p; bestDiff = d; } }
  return bestDiff > 14 * 86400 ? null : best;
}

function classify(r3yr, benchReturn) {
  if (r3yr > benchReturn + 0.20) return 'winner';
  if (r3yr < 0) return 'trap';
  if (r3yr < benchReturn) return 'underperform';
  return 'mixed';
}

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function saveDataset(name, cases, meta = {}) {
  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of cases) outcomes[c.outcome] = (outcomes[c.outcome] || 0) + 1;
  const dataset = { metadata: { source: name, case_count: cases.length, ...outcomes, ...meta, generated: new Date().toISOString() }, cases };
  const path = resolve(DATA_DIR, `systematic-${name}.json`);
  writeFileSync(path, JSON.stringify(dataset, null, 2));
  console.log(`  ${G}Saved ${cases.length} cases to systematic-${name}.json${X}`);
  console.log(`  Winners: ${outcomes.winner}, Traps: ${outcomes.trap}, Underperform: ${outcomes.underperform}, Mixed: ${outcomes.mixed}`);
  return dataset;
}

// ============================================
// SOURCE 1: S&P 500 constituent changes — reformat existing
// ============================================
function buildSource1() {
  console.log(`\n${B}${C}Source 1: S&P 500 Constituent Changes${X}`);
  const existing = loadJSON(resolve(DATA_DIR, 'expansion/classified.json'));
  if (!existing || !Array.isArray(existing)) {
    console.log(`  ${R}No existing expansion data found${X}`);
    return [];
  }
  const cases = existing.map(c => ({
    ticker: c.ticker, company: c.ticker, source: 'sp500-changes',
    entry_date: c.entry_date || c.event_date, entry_price: c.entry_price,
    outcome: c.outcome, forward_return_3yr: c.return_3yr,
    sp500_return_3yr: c.sp500_return_3yr, sector: null, cik: null,
  }));
  return saveDataset('sp500-changes', cases, { description: 'S&P 500 additions/removals 2010-2024' }).cases;
}

// ============================================
// SOURCE 2: Small-cap — reformat existing
// ============================================
function buildSource2() {
  console.log(`\n${B}${C}Source 2: Small-Cap Universe${X}`);
  const existing = loadJSON(resolve(DATA_DIR, 'smallcap-expansion/classified.json'));
  if (!existing || !Array.isArray(existing)) {
    console.log(`  ${R}No existing small-cap data found${X}`);
    return [];
  }
  const cases = existing.map(c => ({
    ticker: c.ticker, company: c.company_name || c.ticker, source: 'smallcap',
    entry_date: c.entry_date, entry_price: c.entry_price,
    outcome: c.outcome, forward_return_3yr: c.return_3yr,
    sp500_return_3yr: c.sp500_return_3yr || c.iwm_return_3yr, sector: c.sector, cik: null,
  }));
  return saveDataset('smallcap', cases, { description: 'Small-cap companies ($300M-$2B assets), benchmarked vs IWM' }).cases;
}

// ============================================
// SOURCE 3: ADR/International — reformat existing
// ============================================
function buildSource3() {
  console.log(`\n${B}${C}Source 3: ADR/International${X}`);
  const existing = loadJSON(resolve(DATA_DIR, 'adr-expansion/classified.json'));
  if (!existing || !Array.isArray(existing)) {
    console.log(`  ${R}No existing ADR data found${X}`);
    return [];
  }
  const cases = existing.map(c => ({
    ticker: c.ticker, company: c.company_name || c.ticker, source: 'adr',
    entry_date: c.entry_date, entry_price: c.entry_price,
    outcome: c.outcome, forward_return_3yr: c.return_3yr,
    sp500_return_3yr: c.sp500_return_3yr, sector: c.sector, cik: null,
    country: c.country, accounting_standard: c.accounting_standard,
  }));
  return saveDataset('adr', cases, { description: 'ADR/International 20-F filers with IFRS/GAAP EDGAR data' }).cases;
}

// ============================================
// SOURCE 5: Fraud/SEC enforcement — reformat existing
// ============================================
function buildSource5() {
  console.log(`\n${B}${C}Source 5: Fraud/SEC Enforcement${X}`);
  const existing = loadJSON(resolve(DATA_DIR, 'tier9-fraud.json'));
  if (!existing?.cases) {
    console.log(`  ${R}No existing fraud data found${X}`);
    return [];
  }
  const cases = existing.cases.map(c => ({
    ticker: c.ticker, company: c.company_name || c.ticker, source: 'fraud',
    entry_date: c.entry_date || c.entry?.date, entry_price: null,
    outcome: 'trap', forward_return_3yr: null,
    sp500_return_3yr: null, sector: null, cik: null,
    fraud_type: c.fraud_type || 'value_trap', reason: c.reason,
  }));
  return saveDataset('fraud', cases, { description: 'SEC enforcement actions and confirmed value traps' }).cases;
}

// ============================================
// SOURCE 6: S&P 500 cross-section at 2019-01-02 (NEW)
// ============================================
async function buildSource6() {
  console.log(`\n${B}${C}Source 6: S&P 500 Cross-Section (2019-01-02)${X}`);

  // Determine S&P 500 members as of Jan 2019
  const csv = readFileSync(resolve(SP500_DIR, 'sp500_ticker_start_end.csv'), 'utf-8');
  const lines = csv.trim().split('\n').slice(1);
  const refDate = '2019-01-02';

  const members = [];
  const seen = new Set();
  for (const line of lines) {
    const [ticker, start_date, end_date] = line.split(',').map(s => s.trim());
    if (!ticker || !start_date) continue;
    // Was in S&P 500 on refDate?
    if (start_date <= refDate && (!end_date || end_date >= refDate)) {
      if (!seen.has(ticker)) {
        seen.add(ticker);
        members.push(ticker);
      }
    }
  }

  // Also add current members that might have been in since before 2019
  const currentCsv = readFileSync(resolve(SP500_DIR, 'sp500.csv'), 'utf-8');
  const currentLines = currentCsv.trim().split('\n').slice(1);
  for (const line of currentLines) {
    const cols = line.split(',');
    const ticker = cols[0]?.trim();
    const dateAdded = cols[5]?.trim();
    if (ticker && dateAdded && dateAdded <= refDate && !seen.has(ticker)) {
      seen.add(ticker);
      members.push(ticker);
    }
  }

  console.log(`  S&P 500 members as of ${refDate}: ${members.length}`);

  await ensureCikCache();

  // 3-year forward: 2019-01-02 to 2022-01-02
  const entryTs = new Date('2019-01-02').getTime() / 1000;
  const exitTs = new Date('2022-01-02').getTime() / 1000;
  const period1 = Math.floor(entryTs) - 86400 * 7;
  const period2 = Math.floor(exitTs) + 86400 * 7;

  // Get S&P 500 return for the period
  let sp500Return = null;
  const spPrices = await fetchYahooPrice('^GSPC', period1, period2);
  if (spPrices?.length >= 2) {
    const spEntry = findClosestPrice(spPrices, entryTs);
    const spExit = findClosestPrice(spPrices, exitTs);
    if (spEntry && spExit) sp500Return = (spExit.close - spEntry.close) / spEntry.close;
  }
  console.log(`  S&P 500 3yr return (2019→2022): ${sp500Return ? (sp500Return * 100).toFixed(1) + '%' : 'N/A'}`);

  const cases = [];
  const limit = LIMIT ? Math.min(LIMIT, members.length) : members.length;
  let ok = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = members[i];

    try {
      const prices = await fetchYahooPrice(ticker, period1, period2);
      if (!prices || prices.length < 2) { failed++; continue; }

      const entryPrice = findClosestPrice(prices, entryTs);
      const exitPrice = findClosestPrice(prices, exitTs);
      if (!entryPrice || !exitPrice) { failed++; continue; }

      const r3yr = (exitPrice.close - entryPrice.close) / entryPrice.close;
      const outcome = classify(r3yr, sp500Return ?? 0.60);

      // Get sector from sp500.csv
      let sector = null;
      for (const line of currentLines) {
        const cols = line.split(',');
        if (cols[0]?.trim() === ticker) { sector = cols[2]?.trim(); break; }
      }

      // Get CIK
      const cik = getCikForTicker(ticker);

      cases.push({
        ticker, company: ticker, source: 'sp500-crosssection',
        entry_date: new Date(entryPrice.timestamp * 1000).toISOString().slice(0, 10),
        entry_price: Math.round(entryPrice.close * 100) / 100,
        outcome, forward_return_3yr: Math.round(r3yr * 1000) / 1000,
        sp500_return_3yr: sp500Return ? Math.round(sp500Return * 1000) / 1000 : null,
        sector, cik,
      });
      ok++;
    } catch (e) {
      failed++;
    }

    if ((i + 1) % 25 === 0 || i === limit - 1) {
      process.stdout.write(`  ${i + 1}/${limit} (${ok} ok, ${failed} failed)...\r`);
    }
  }

  console.log(`\n  Fetched: ${ok} ok, ${failed} failed`);

  // Enrich company names from CIK cache
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
  for (const c of cases) {
    const info = cikCache[c.ticker];
    if (info?.name) c.company = info.name;
  }

  return saveDataset('sp500-crosssection', cases, {
    description: 'Full S&P 500 cross-section at 2019-01-02, 3yr forward returns to 2022',
    sp500_return_3yr: sp500Return,
    entry_date: '2019-01-02',
    exit_date: '2022-01-02',
  }).cases;
}

// ============================================
// SOURCE 4: Multi-entry date expansion (NEW)
// ============================================
async function buildSource4(allPriorCases) {
  console.log(`\n${B}${C}Source 4: Multi-Entry Date Expansion${X}`);

  // For companies that appear in sources 1-3,6 — add entry at different dates
  const EXTRA_DATES = ['2015-01-02', '2017-06-15', '2021-01-04'];
  const existingKeys = new Set(allPriorCases.map(c => `${c.ticker}-${c.entry_date}`));
  const uniqueTickers = [...new Set(allPriorCases.map(c => c.ticker))];

  console.log(`  Unique tickers from prior sources: ${uniqueTickers.length}`);

  // S&P 500 benchmark returns for each extra date
  const benchmarks = {};
  for (const date of EXTRA_DATES) {
    const entryTs = new Date(date).getTime() / 1000;
    const exitDate = new Date(date);
    exitDate.setFullYear(exitDate.getFullYear() + 3);
    // Skip if exit is in the future
    if (exitDate > new Date('2025-12-31')) continue;
    const exitTs = exitDate.getTime() / 1000;
    const p1 = Math.floor(entryTs) - 86400 * 7;
    const p2 = Math.floor(exitTs) + 86400 * 7;
    const spPrices = await fetchYahooPrice('^GSPC', p1, p2);
    if (spPrices?.length >= 2) {
      const spEntry = findClosestPrice(spPrices, entryTs);
      const spExit = findClosestPrice(spPrices, exitTs);
      if (spEntry && spExit) benchmarks[date] = (spExit.close - spEntry.close) / spEntry.close;
    }
    console.log(`  Benchmark for ${date}: ${benchmarks[date] ? (benchmarks[date] * 100).toFixed(1) + '%' : 'N/A'}`);
  }

  const viableDates = EXTRA_DATES.filter(d => benchmarks[d] != null);
  if (viableDates.length === 0) {
    console.log(`  ${R}No viable extra dates${X}`);
    return [];
  }

  const cases = [];
  const limit = LIMIT ? Math.min(LIMIT, uniqueTickers.length) : uniqueTickers.length;
  let ok = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = uniqueTickers[i];

    for (const date of viableDates) {
      const key = `${ticker}-${date}`;
      if (existingKeys.has(key)) continue;

      const entryTs = new Date(date).getTime() / 1000;
      const exitDate = new Date(date);
      exitDate.setFullYear(exitDate.getFullYear() + 3);
      const exitTs = exitDate.getTime() / 1000;
      const p1 = Math.floor(entryTs) - 86400 * 7;
      const p2 = Math.floor(exitTs) + 86400 * 7;

      try {
        const prices = await fetchYahooPrice(ticker, p1, p2);
        if (!prices || prices.length < 2) { failed++; continue; }

        const entryPrice = findClosestPrice(prices, entryTs);
        const exitPrice = findClosestPrice(prices, exitTs);
        if (!entryPrice || !exitPrice) { failed++; continue; }

        const r3yr = (exitPrice.close - entryPrice.close) / entryPrice.close;
        const outcome = classify(r3yr, benchmarks[date]);

        cases.push({
          ticker, company: ticker, source: 'multi-entry',
          entry_date: new Date(entryPrice.timestamp * 1000).toISOString().slice(0, 10),
          entry_price: Math.round(entryPrice.close * 100) / 100,
          outcome, forward_return_3yr: Math.round(r3yr * 1000) / 1000,
          sp500_return_3yr: Math.round(benchmarks[date] * 1000) / 1000,
          sector: allPriorCases.find(c => c.ticker === ticker)?.sector || null,
          cik: null,
          original_entry: date,
        });
        ok++;
      } catch { failed++; }
    }

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      process.stdout.write(`  ${i + 1}/${limit} tickers (${ok} new cases, ${failed} failed)...\r`);
    }
  }

  console.log(`\n  Generated: ${ok} new multi-entry cases, ${failed} failed`);

  // Enrich names
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
  for (const c of cases) { const info = cikCache[c.ticker]; if (info?.name) c.company = info.name; }

  return saveDataset('multi-entry', cases, { description: 'Multi-entry date expansion at 2015, 2017, 2021 for existing tickers' }).cases;
}

// ============================================
// STATUS
// ============================================
function printStatus() {
  console.log(`\n${B}Systematic Dataset Status${X}\n`);
  const sources = ['sp500-changes', 'smallcap', 'adr', 'multi-entry', 'fraud', 'sp500-crosssection'];
  let total = 0;
  for (const s of sources) {
    const path = resolve(DATA_DIR, `systematic-${s}.json`);
    if (!existsSync(path)) { console.log(`  ${s}: ${R}NOT BUILT${X}`); continue; }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const n = data.cases?.length || 0;
    total += n;
    console.log(`  ${s}: ${G}${n} cases${X} (W:${data.metadata?.winner || 0} T:${data.metadata?.trap || 0} U:${data.metadata?.underperform || 0} M:${data.metadata?.mixed || 0})`);
  }
  console.log(`\n  ${B}Total: ${total} cases${X}`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}Build Systematic Calibration Dataset${X}`);
  console.log('='.repeat(60));

  if (STATUS_ONLY) { printStatus(); return; }

  const shouldRun = (n) => !SOURCE || SOURCE === n;

  await ensureCikCache();

  let allCases = [];

  // Source 6 first (priority — unbiased cross-section)
  if (shouldRun(6)) {
    const s6 = await buildSource6();
    allCases.push(...s6);
  }

  // Source 1: S&P 500 changes
  if (shouldRun(1)) {
    const s1 = buildSource1();
    allCases.push(...s1);
  }

  // Source 2: Small-cap
  if (shouldRun(2)) {
    const s2 = buildSource2();
    allCases.push(...s2);
  }

  // Source 3: ADR
  if (shouldRun(3)) {
    const s3 = buildSource3();
    allCases.push(...s3);
  }

  // Source 5: Fraud
  if (shouldRun(5)) {
    const s5 = buildSource5();
    allCases.push(...s5);
  }

  // Source 4: Multi-entry (needs prior cases)
  if (shouldRun(4)) {
    // Load all systematic sources built so far
    if (allCases.length === 0) {
      for (const s of ['sp500-crosssection', 'sp500-changes', 'smallcap', 'adr']) {
        const data = loadJSON(resolve(DATA_DIR, `systematic-${s}.json`));
        if (data?.cases) allCases.push(...data.cases);
      }
    }
    const s4 = await buildSource4(allCases);
    allCases.push(...s4);
  }

  printStatus();

  // Save session status
  const status = `# Systematic Dataset Build Status\nUpdated: ${new Date().toISOString()}\n\n`;
  writeFileSync(resolve(DATA_DIR, 'systematic-dataset-status.md'), status);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
