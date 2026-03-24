#!/usr/bin/env node
// Build unconventional data pools for the research agent
// Parts 4C (SEC metadata), 4D (price/volume), 4E (FRED context)
//
// Usage:
//   node scripts/build-unconventional-data.js [--pool POOL] [--limit N]
//   Pools: price-volume, fred, sec-metadata, all

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker } from './lib/edgar-fetcher.js';
import { loadSystematicCases } from './lib/calibration-data.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
mkdirSync(UNCONV_DIR, { recursive: true });

const args = process.argv.slice(2);
const POOL = (() => { const i = args.indexOf('--pool'); return i >= 0 ? args[i + 1] : 'all'; })();
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

// ============================================
// HELPERS
// ============================================
let lastYahooTime = 0;
async function fetchYahoo(ticker, period1, period2, interval = '1d') {
  const now = Date.now();
  if (now - lastYahooTime < 200) await new Promise(r => setTimeout(r, 200 - (now - lastYahooTime)));
  lastYahooTime = Date.now();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=${interval}&includeAdjustedClose=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    return result;
  } catch { return null; }
}

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function stddev(arr) { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); }
function linSlope(arr) {
  const n = arr.length; if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i; }
  const d = n * sx2 - sx * sx;
  return d === 0 ? 0 : (n * sxy - sx * sy) / d;
}

// ============================================
// 4D: PRICE/VOLUME DYNAMICS
// ============================================
async function buildPriceVolume() {
  console.log(`\n${B}${C}Part 4D: Price/Volume Dynamics${X}`);

  const cases = loadSystematicCases();
  // Also load new cross-sections if they exist
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  // Deduplicate by ticker+entry_date
  const seen = new Set();
  const unique = [];
  for (const c of cases) {
    const key = `${c.ticker}|${c.entry_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  console.log(`  Cases to process: ${unique.length}`);

  const outPath = resolve(UNCONV_DIR, 'price-volume-dynamics.json');
  let results = loadJSON(outPath) || {};
  const limit = LIMIT ? Math.min(LIMIT, unique.length) : unique.length;
  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < limit; i++) {
    const c = unique[i];
    const key = `${c.ticker}|${c.entry_date}`;
    if (results[key]) { skipped++; continue; }

    const entryDate = new Date(c.entry_date);
    const oneYearBefore = new Date(entryDate); oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
    const p1 = Math.floor(oneYearBefore.getTime() / 1000);
    const p2 = Math.floor(entryDate.getTime() / 1000) + 86400;

    // Weekly data for 52 weeks
    const weeklyData = await fetchYahoo(c.ticker, p1, p2, '1wk');
    if (!weeklyData?.timestamp) { failed++; continue; }

    const closes = weeklyData.indicators?.adjclose?.[0]?.adjclose || [];
    const volumes = weeklyData.indicators?.quote?.[0]?.volume || [];
    const timestamps = weeklyData.timestamp;

    const validCloses = closes.filter(v => v != null);
    const validVolumes = volumes.filter(v => v != null && v > 0);

    if (validCloses.length < 10) { failed++; continue; }

    // Weekly returns
    const weeklyReturns = [];
    for (let j = 1; j < validCloses.length; j++) {
      if (validCloses[j - 1] > 0) weeklyReturns.push((validCloses[j] - validCloses[j - 1]) / validCloses[j - 1]);
    }

    // Price momentum
    const latestPrice = validCloses[validCloses.length - 1];
    const sixMonthAgo = validCloses.length >= 26 ? validCloses[validCloses.length - 26] : validCloses[0];
    const twelveMonthAgo = validCloses[0];

    const momentum6m = sixMonthAgo > 0 ? (latestPrice - sixMonthAgo) / sixMonthAgo : null;
    const momentum12m = twelveMonthAgo > 0 ? (latestPrice - twelveMonthAgo) / twelveMonthAgo : null;

    // Volume analysis
    const last60dVol = validVolumes.slice(-9); // ~60 days in weekly = ~9 weeks
    const fullYearVol = validVolumes;
    const avgVolRecent = last60dVol.length > 0 ? mean(last60dVol) : null;
    const avgVolYear = fullYearVol.length > 0 ? mean(fullYearVol) : null;
    const relativeVolume = (avgVolRecent && avgVolYear && avgVolYear > 0) ? avgVolRecent / avgVolYear : null;
    const volumeSlope = validVolumes.length >= 4 ? linSlope(validVolumes) : null;

    // Volatility
    const volatility = weeklyReturns.length >= 10 ? stddev(weeklyReturns) * Math.sqrt(52) : null; // Annualized

    results[key] = {
      ticker: c.ticker,
      entry_date: c.entry_date,
      weeks_of_data: validCloses.length,
      price_latest: Math.round(latestPrice * 100) / 100,
      momentum_6m: momentum6m ? Math.round(momentum6m * 1000) / 1000 : null,
      momentum_12m: momentum12m ? Math.round(momentum12m * 1000) / 1000 : null,
      volatility_annual: volatility ? Math.round(volatility * 1000) / 1000 : null,
      avg_weekly_volume_recent: avgVolRecent ? Math.round(avgVolRecent) : null,
      avg_weekly_volume_year: avgVolYear ? Math.round(avgVolYear) : null,
      relative_volume: relativeVolume ? Math.round(relativeVolume * 1000) / 1000 : null,
      volume_trend_slope: volumeSlope ? Math.round(volumeSlope) : null,
      weekly_closes: validCloses.slice(-52).map(v => Math.round(v * 100) / 100),
    };
    ok++;

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} new, ${skipped} cached, ${failed} failed)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n  ${G}Price/volume: ${Object.keys(results).length} entries saved${X}`);
}

// ============================================
// 4E: FRED ECONOMIC CONTEXT
// ============================================
async function buildFredContext() {
  console.log(`\n${B}${C}Part 4E: FRED Economic Context${X}`);

  // FRED series we want to snapshot
  const FRED_SERIES = {
    'DGS10': 'treasury_10yr',
    'DGS2': 'treasury_2yr',
    'DAAA': 'aaa_yield',
    'DBAA': 'baa_yield',
    'VIXCLS': 'vix',
    'UNRATE': 'unemployment',
    'FEDFUNDS': 'fed_funds',
    'GDP': 'gdp_nominal',
  };

  // Get all unique entry dates
  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  const entryDates = [...new Set(cases.map(c => c.entry_date).filter(Boolean))].sort();
  console.log(`  Unique entry dates: ${entryDates.length}`);

  // For each FRED series, fetch the full history and interpolate
  const fredData = {};
  const USER_AGENT = 'AV-Framework charles@bolinandtroy.com';

  for (const [seriesId, fieldName] of Object.entries(FRED_SERIES)) {
    console.log(`  Fetching ${seriesId}...`);
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=2010-01-01&coed=2026-01-01`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) { console.log(`    ${R}Failed: ${res.status}${X}`); continue; }
      const csv = await res.text();
      const lines = csv.trim().split('\n').slice(1);
      const points = [];
      for (const line of lines) {
        const [date, val] = line.split(',');
        if (date && val && val !== '.') points.push({ date, value: parseFloat(val) });
      }
      fredData[fieldName] = points;
      console.log(`    ${G}${points.length} observations${X}`);
    } catch (e) {
      console.log(`    ${R}Error: ${e.message}${X}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // For each entry date, find the closest FRED value
  function findClosestFredValue(series, targetDate) {
    if (!series || series.length === 0) return null;
    let best = series[0];
    for (const p of series) {
      if (p.date <= targetDate) best = p;
      else break;
    }
    return best.value;
  }

  // Also compute S&P 500 trailing 12m return for each entry date
  // We'll batch this from Yahoo Finance
  console.log(`  Fetching S&P 500 history for trailing returns...`);
  const spPrices = await fetchYahoo('^GSPC',
    Math.floor(new Date('2010-01-01').getTime() / 1000),
    Math.floor(new Date('2026-01-01').getTime() / 1000),
    '1wk'
  );
  const spCloses = [];
  if (spPrices?.timestamp) {
    const closes = spPrices.indicators?.adjclose?.[0]?.adjclose || [];
    for (let i = 0; i < spPrices.timestamp.length; i++) {
      if (closes[i] != null) {
        spCloses.push({ date: new Date(spPrices.timestamp[i] * 1000).toISOString().slice(0, 10), close: closes[i] });
      }
    }
  }
  console.log(`  S&P 500 weekly data points: ${spCloses.length}`);

  function sp500Trailing12m(targetDate) {
    const target = new Date(targetDate);
    const yearAgo = new Date(target); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const yearAgoStr = yearAgo.toISOString().slice(0, 10);

    let current = null, prior = null;
    for (const p of spCloses) {
      if (p.date <= targetDate) current = p;
      if (p.date <= yearAgoStr) prior = p;
    }
    if (current && prior && prior.close > 0) return (current.close - prior.close) / prior.close;
    return null;
  }

  // Build context for each unique entry date
  const context = {};
  for (const date of entryDates) {
    const snapshot = { date };
    for (const [seriesId, fieldName] of Object.entries(FRED_SERIES)) {
      snapshot[fieldName] = findClosestFredValue(fredData[fieldName], date);
    }
    // Derived
    if (snapshot.treasury_10yr != null && snapshot.treasury_2yr != null) {
      snapshot.yield_curve_10y2y = Math.round((snapshot.treasury_10yr - snapshot.treasury_2yr) * 1000) / 1000;
    }
    if (snapshot.baa_yield != null && snapshot.aaa_yield != null) {
      snapshot.credit_spread = Math.round((snapshot.baa_yield - snapshot.aaa_yield) * 1000) / 1000;
    }
    snapshot.sp500_trailing_12m = sp500Trailing12m(date);
    if (snapshot.sp500_trailing_12m != null) {
      snapshot.sp500_trailing_12m = Math.round(snapshot.sp500_trailing_12m * 1000) / 1000;
    }

    // Classify regime
    if (snapshot.credit_spread != null && snapshot.vix != null) {
      if (snapshot.credit_spread > 2.5 || snapshot.vix > 30) snapshot.regime = 'STRESSED';
      else if (snapshot.credit_spread > 1.5 || snapshot.vix > 20) snapshot.regime = 'CAUTIOUS';
      else snapshot.regime = 'NORMAL';
    }

    context[date] = snapshot;
  }

  const outPath = resolve(UNCONV_DIR, 'economic-context.json');
  writeFileSync(outPath, JSON.stringify(context, null, 2));
  console.log(`  ${G}Economic context: ${Object.keys(context).length} date snapshots saved${X}`);
}

// ============================================
// 4C: SEC FILING METADATA
// ============================================
async function buildSecMetadata() {
  console.log(`\n${B}${C}Part 4C: SEC Filing Metadata${X}`);

  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  await ensureCikCache();

  // Deduplicate tickers
  const tickers = [...new Set(cases.map(c => c.ticker))];
  console.log(`  Unique tickers: ${tickers.length}`);

  const outPath = resolve(UNCONV_DIR, 'sec-filing-metadata.json');
  let results = loadJSON(outPath) || {};
  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;
  let ok = 0, failed = 0, skipped = 0;

  const USER_AGENT = 'AV-Framework charles@bolinandtroy.com';

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    if (results[ticker]) { skipped++; continue; }

    const cik = getCikForTicker(ticker);
    if (!cik) { failed++; continue; }

    try {
      // Fetch filing history from EDGAR
      await new Promise(r => setTimeout(r, 110));
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (!res.ok) { failed++; continue; }

      const data = await res.json();
      const recent = data.filings?.recent;
      if (!recent?.form) { failed++; continue; }

      const forms = recent.form;
      const dates = recent.filingDate;
      const sizes = recent.size;
      const accessions = recent.accessionNumber;

      // Count filing types
      let tenK = 0, tenKA = 0, tenQ = 0, tenQA = 0, ntFilings = 0, twentyF = 0;
      const annualSizes = [];
      const filingDates = [];

      for (let j = 0; j < forms.length; j++) {
        const form = forms[j];
        const date = dates[j];
        const size = sizes[j];

        if (form === '10-K') { tenK++; if (size) annualSizes.push({ date, size }); }
        else if (form === '10-K/A') tenKA++;
        else if (form === '10-Q') tenQ++;
        else if (form === '10-Q/A') tenQA++;
        else if (form === 'NT 10-K' || form === 'NT 10-Q') ntFilings++;
        else if (form === '20-F' || form === '20-F/A') twentyF++;

        if (form === '10-K' || form === '10-Q' || form === '20-F') {
          filingDates.push(date);
        }
      }

      // Filing size trend (annual filings)
      const sortedSizes = annualSizes.sort((a, b) => a.date.localeCompare(b.date)).map(s => s.size);
      const sizeSlope = sortedSizes.length >= 3 ? linSlope(sortedSizes) : null;

      // Amendment ratio
      const totalPrimary = tenK + tenQ + twentyF;
      const totalAmendments = tenKA + tenQA;
      const amendmentRate = totalPrimary > 0 ? totalAmendments / totalPrimary : 0;

      results[ticker] = {
        ticker, cik,
        total_10K: tenK, total_10KA: tenKA,
        total_10Q: tenQ, total_10QA: tenQA,
        total_20F: twentyF,
        nt_filings: ntFilings,
        amendment_rate: Math.round(amendmentRate * 1000) / 1000,
        annual_filing_sizes: sortedSizes.slice(-10),
        filing_size_trend: sizeSlope ? Math.round(sizeSlope) : null,
        total_filings_in_history: forms.length,
        company_name: data.name || ticker,
        sic: data.sic || null,
        fiscal_year_end: data.fiscalYearEnd || null,
      };
      ok++;
    } catch { failed++; }

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} new, ${skipped} cached, ${failed} failed)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n  ${G}SEC metadata: ${Object.keys(results).length} tickers saved${X}`);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}Build Unconventional Data Pools${X}`);
  console.log('='.repeat(60));

  if (POOL === 'price-volume' || POOL === 'all') await buildPriceVolume();
  if (POOL === 'fred' || POOL === 'all') await buildFredContext();
  if (POOL === 'sec-metadata' || POOL === 'all') await buildSecMetadata();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
