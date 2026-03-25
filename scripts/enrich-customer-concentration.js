#!/usr/bin/env node
// Expand customer concentration data by parsing 10-K text from EDGAR.
// For each ticker not already covered, finds most recent 10-K before entry date,
// searches for concentration patterns in the text.
//
// Usage: node scripts/enrich-customer-concentration.js [--limit N] [--force]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker } from './lib/edgar-fetcher.js';
import { loadSystematicCases } from './lib/calibration-data.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
mkdirSync(UNCONV_DIR, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();
const FORCE = args.includes('--force');

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';
const USER_AGENT = 'AV-Framework charles@bolinandtroy.com';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

let lastRequestTime = 0;
async function rateLimitedFetch(url) {
  const now = Date.now();
  if (now - lastRequestTime < 120) await new Promise(r => setTimeout(r, 120 - (now - lastRequestTime)));
  lastRequestTime = Date.now();
  return fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' } });
}

// Find most recent 10-K or 20-F before target date
async function find10K(cik, beforeDate) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const recent = data.filings?.recent;
  if (!recent?.form) return null;

  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    if ((form === '10-K' || form === '20-F') && recent.filingDate[i] <= beforeDate) {
      const accession = recent.accessionNumber[i].replace(/-/g, '');
      const primaryDoc = recent.primaryDocument[i];
      const cikNum = parseInt(cik);
      return {
        form,
        filingDate: recent.filingDate[i],
        url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`,
      };
    }
  }
  return null;
}

// Parse customer concentration from 10-K text
function parseConcentration(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ');

  // Search for customer concentration keywords
  const keywords = [
    'customer concentration', 'major customer', 'significant customer',
    'largest customer', 'principal customer', 'key customer',
    'no single customer', 'no customer represented', 'no one customer',
    '10% of revenue', '10% of total revenue', '10% of net revenue',
    '10% or more', 'ten percent',
  ];

  let bestWindow = null;
  let bestScore = 0;

  for (const kw of keywords) {
    const idx = text.toLowerCase().indexOf(kw);
    if (idx !== -1) {
      const start = Math.max(0, idx - 500);
      const end = Math.min(text.length, idx + 2000);
      const window = text.slice(start, end);
      const score = keywords.filter(k => window.toLowerCase().includes(k)).length;
      if (score > bestScore) {
        bestScore = score;
        bestWindow = window;
      }
    }
  }

  if (!bestWindow) {
    return {
      concentration_disclosed: false,
      largest_customer_pct: null,
      customers_above_10pct: 0,
      no_concentration_statement: false,
      concentration_mentions: 0,
      parsing_confidence: 'low',
    };
  }

  const windowLower = bestWindow.toLowerCase();

  // Check for "no single customer" type statements
  const noConcentration = /no\s+(?:single|one|individual)\s+customer\s+(?:represented|accounted|exceeded|comprised)/i.test(bestWindow)
    || /no\s+customer\s+(?:represented|accounted|exceeded)/i.test(bestWindow);

  // Extract percentages near "customer" and "revenue"
  const pctPattern = /(\d{1,2}(?:\.\d+)?)\s*%/g;
  const percentages = [];
  let match;
  while ((match = pctPattern.exec(bestWindow)) !== null) {
    const val = parseFloat(match[1]);
    if (val >= 5 && val <= 90) {
      // Check if this percentage is near "revenue" or "customer" context
      const nearbyText = bestWindow.slice(Math.max(0, match.index - 200), match.index + 100).toLowerCase();
      if (nearbyText.includes('revenue') || nearbyText.includes('customer') || nearbyText.includes('sales') || nearbyText.includes('account')) {
        percentages.push(val);
      }
    }
  }

  const largestPct = percentages.length > 0 ? Math.max(...percentages) : null;
  const above10 = percentages.filter(p => p >= 10).length;

  // Count concentration mentions in full text
  const mentionCount = (text.toLowerCase().match(/customer\s+concentrat/g) || []).length +
    (text.toLowerCase().match(/(?:major|significant|largest|principal)\s+customer/g) || []).length;

  return {
    concentration_disclosed: largestPct != null || noConcentration || above10 > 0,
    largest_customer_pct: largestPct,
    customers_above_10pct: above10,
    no_concentration_statement: noConcentration,
    concentration_mentions: mentionCount,
    parsing_confidence: largestPct != null ? 'medium' : noConcentration ? 'medium' : 'low',
  };
}

async function main() {
  console.log(`${B}Expand Customer Concentration Data${X}`);
  console.log('='.repeat(50));

  await ensureCikCache();

  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  // For each ticker, get earliest entry date
  const tickerDates = {};
  for (const c of cases) {
    if (!tickerDates[c.ticker] || c.entry_date < tickerDates[c.ticker]) {
      tickerDates[c.ticker] = c.entry_date;
    }
  }

  const outPath = resolve(UNCONV_DIR, 'customer-concentration.json');
  let results = loadJSON(outPath) || {};

  // Filter to tickers that need processing
  const tickers = Object.keys(tickerDates).sort().filter(t => {
    if (FORCE) return true;
    const existing = results[t];
    if (!existing) return true;
    if (existing.status === 'ok' && existing.parsing_confidence !== 'low') return false;
    return true;
  });

  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;
  console.log(`\n  Tickers needing processing: ${limit} of ${tickers.length} (${Object.keys(results).length} already cached)`);

  let ok = 0, failed = 0, skipped = 0, noCik = 0, no10K = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    const cik = getCikForTicker(ticker);
    if (!cik) {
      noCik++;
      results[ticker] = { ticker, status: 'no_cik' };
      continue;
    }

    const beforeDate = tickerDates[ticker];
    const filing = await find10K(cik, beforeDate);
    if (!filing) {
      no10K++;
      results[ticker] = { ticker, status: 'no_10k', before_date: beforeDate };
      continue;
    }

    try {
      const res = await rateLimitedFetch(filing.url);
      if (!res.ok) {
        failed++;
        results[ticker] = { ticker, status: 'download_failed' };
        continue;
      }
      const html = await res.text();
      const conc = parseConcentration(html);

      results[ticker] = {
        ticker,
        entry_date: beforeDate,
        status: 'ok',
        filing_date: filing.filingDate,
        filing_form: filing.form,
        ...conc,
      };
      ok++;
    } catch (e) {
      failed++;
      results[ticker] = { ticker, status: 'error', error: e.message };
    }

    if ((i + 1) % 25 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`\r  ${i + 1}/${limit} (${G}${ok} ok${X}, ${R}${failed + noCik + no10K} fail${X})`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const okCount = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n\n  ${G}Customer concentration: ${okCount} tickers with data${X}`);
  console.log(`  No CIK: ${noCik}, No 10-K: ${no10K}, Download fail: ${failed}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
