#!/usr/bin/env node

// Fetch extended SI time series for checkpoint analysis.
// For each cached ticker, re-fetch with end date = entry + 36 months.
// Uses the FINRA bulk API (1 call per ticker).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fetchSITimeSeries } from '../warehouse/connectors/finra-si-series.js';

const CACHE_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache/si');
const EXTENDED_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache/si-extended');
const CASES_DIR = resolve(import.meta.dirname, '../cases');

mkdirSync(EXTENDED_DIR, { recursive: true });

async function main() {
  // Load universe to get entry dates
  const universe = JSON.parse(readFileSync(join(CASES_DIR, 'universe.json'), 'utf-8'));
  const allCases = Object.values(universe.cases);

  // Build ticker → latest entry date map (we want the full range)
  const tickerEntryDates = {};
  for (const c of allCases) {
    if (c.entry_date >= '2018-03-15') {
      if (!tickerEntryDates[c.ticker] || c.entry_date > tickerEntryDates[c.ticker].entry_date) {
        tickerEntryDates[c.ticker] = c;
      }
    }
  }

  // Get list of tickers from existing cache
  const cachedFiles = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  const tickers = cachedFiles.map(f => f.replace('.json', '')).filter(t => tickerEntryDates[t]);

  console.log(`Tickers to fetch: ${tickers.length}`);

  let ok = 0, fail = 0, skip = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const extPath = join(EXTENDED_DIR, `${ticker}.json`);

    // Skip if already fetched
    if (existsSync(extPath)) {
      const existing = JSON.parse(readFileSync(extPath, 'utf-8'));
      if (existing.series?.length >= 10) { skip++; continue; }
    }

    const c = tickerEntryDates[ticker];
    // Fetch from 2 years before entry to 3 years after entry (5 year span)
    const entryD = new Date(c.entry_date);
    const startD = new Date(entryD);
    startD.setFullYear(startD.getFullYear() - 2);
    const endD = new Date(entryD);
    endD.setFullYear(endD.getFullYear() + 3);

    // Cap at today
    const now = new Date();
    const effectiveEnd = endD > now ? now.toISOString().split('T')[0] : endD.toISOString().split('T')[0];
    const startDate = startD.toISOString().split('T')[0] < '2018-03-15' ? '2018-03-15' : startD.toISOString().split('T')[0];

    try {
      const series = await fetchSITimeSeries(ticker, effectiveEnd, 5);
      // Filter to our date range
      const filtered = series.filter(s => s.date >= startDate && s.date <= effectiveEnd);

      writeFileSync(extPath, JSON.stringify({
        ticker,
        entryDate: c.entry_date,
        startDate,
        endDate: effectiveEnd,
        series: filtered,
      }));

      ok++;
    } catch {
      fail++;
    }

    if ((i + 1) % 10 === 0 || i === tickers.length - 1) {
      process.stdout.write(`\r  [${i + 1}/${tickers.length}] ok=${ok} fail=${fail} skip=${skip}    `);
    }

    // Small delay to be polite to FINRA API
    await new Promise(r => setTimeout(r, 80));
  }

  console.log(`\n\nDone: ${ok} fetched, ${fail} failed, ${skip} skipped (already cached)`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
