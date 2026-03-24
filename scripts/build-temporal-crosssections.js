#!/usr/bin/env node
// Build S&P 500 cross-sections at 2013, 2016, 2022
// Reuses infrastructure from build-systematic-dataset.js

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker } from './lib/edgar-fetcher.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const SP500_DIR = resolve(DATA_DIR, 'sp500-constituents');

const args = process.argv.slice(2);
const YEAR = args[0] ? parseInt(args[0]) : null;
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', X = '\x1b[0m';

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

function classify(r3yr, bench) {
  if (r3yr > bench + 0.20) return 'winner';
  if (r3yr < 0) return 'trap';
  if (r3yr < bench) return 'underperform';
  return 'mixed';
}

function getSP500MembersAt(refDate) {
  const csv = readFileSync(resolve(SP500_DIR, 'sp500_ticker_start_end.csv'), 'utf-8');
  const lines = csv.trim().split('\n').slice(1);
  const members = [];
  const seen = new Set();
  for (const line of lines) {
    const [ticker, start_date, end_date] = line.split(',').map(s => s.trim());
    if (!ticker || !start_date) continue;
    if (start_date <= refDate && (!end_date || end_date >= refDate)) {
      if (!seen.has(ticker)) { seen.add(ticker); members.push(ticker); }
    }
  }
  // Also check current sp500.csv for long-tenured members
  const currentCsv = readFileSync(resolve(SP500_DIR, 'sp500.csv'), 'utf-8');
  for (const line of currentCsv.trim().split('\n').slice(1)) {
    const cols = line.split(',');
    const ticker = cols[0]?.trim();
    const dateAdded = cols[5]?.trim();
    if (ticker && dateAdded && dateAdded <= refDate && !seen.has(ticker)) {
      seen.add(ticker); members.push(ticker);
    }
  }
  return members;
}

async function buildCrossSection(year) {
  const refDate = `${year}-01-02`;
  const exitYear = year + 3;
  const exitDate = `${exitYear}-01-02`;

  console.log(`\n${B}${C}S&P 500 Cross-Section: ${refDate} → ${exitDate}${X}`);

  const members = getSP500MembersAt(refDate);
  console.log(`  Members at ${refDate}: ${members.length}`);

  await ensureCikCache();

  const entryTs = new Date(refDate).getTime() / 1000;
  const exitTs = new Date(exitDate).getTime() / 1000;
  const p1 = Math.floor(entryTs) - 86400 * 7;
  const p2 = Math.floor(exitTs) + 86400 * 7;

  // S&P 500 benchmark
  let sp500Return = null;
  const spPrices = await fetchYahooPrice('^GSPC', p1, p2);
  if (spPrices?.length >= 2) {
    const spEntry = findClosestPrice(spPrices, entryTs);
    const spExit = findClosestPrice(spPrices, exitTs);
    if (spEntry && spExit) sp500Return = (spExit.close - spEntry.close) / spEntry.close;
  }
  console.log(`  S&P 500 3yr return: ${sp500Return ? (sp500Return * 100).toFixed(1) + '%' : 'N/A'}`);

  if (sp500Return == null) { console.log(`  ${R}Cannot compute benchmark — skipping${X}`); return; }

  // Sector map from sp500.csv
  const sectorMap = {};
  const currentCsv = readFileSync(resolve(SP500_DIR, 'sp500.csv'), 'utf-8');
  for (const line of currentCsv.trim().split('\n').slice(1)) {
    const cols = line.split(',');
    if (cols[0] && cols[2]) sectorMap[cols[0].trim()] = cols[2].trim();
  }

  // CIK cache for company names
  const cikCache = (() => { try { return JSON.parse(readFileSync(resolve(DATA_DIR, 'cik-cache.json'), 'utf-8')); } catch { return {}; } })();

  const cases = [];
  const limit = LIMIT ? Math.min(LIMIT, members.length) : members.length;
  let ok = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = members[i];
    try {
      const prices = await fetchYahooPrice(ticker, p1, p2);
      if (!prices || prices.length < 2) { failed++; continue; }
      const entryPrice = findClosestPrice(prices, entryTs);
      const exitPrice = findClosestPrice(prices, exitTs);
      if (!entryPrice || !exitPrice) { failed++; continue; }

      const r3yr = (exitPrice.close - entryPrice.close) / entryPrice.close;
      cases.push({
        ticker,
        company: cikCache[ticker]?.name || ticker,
        source: `sp500-crosssection-${year}`,
        entry_date: new Date(entryPrice.timestamp * 1000).toISOString().slice(0, 10),
        entry_price: Math.round(entryPrice.close * 100) / 100,
        outcome: classify(r3yr, sp500Return),
        forward_return_3yr: Math.round(r3yr * 1000) / 1000,
        sp500_return_3yr: Math.round(sp500Return * 1000) / 1000,
        sector: sectorMap[ticker] || null,
        cik: getCikForTicker(ticker),
      });
      ok++;
    } catch { failed++; }

    if ((i + 1) % 25 === 0 || i === limit - 1) {
      process.stdout.write(`  ${i + 1}/${limit} (${ok} ok, ${failed} failed)...\r`);
    }
  }

  console.log(`\n  Fetched: ${ok} ok, ${failed} failed`);

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of cases) outcomes[c.outcome]++;
  console.log(`  W:${outcomes.winner} T:${outcomes.trap} U:${outcomes.underperform} M:${outcomes.mixed}`);

  const outPath = resolve(DATA_DIR, `systematic-sp500-crosssection-${year}.json`);
  writeFileSync(outPath, JSON.stringify({
    metadata: {
      source: `sp500-crosssection-${year}`, case_count: cases.length, ...outcomes,
      entry_date: refDate, exit_date: exitDate, sp500_return_3yr: sp500Return,
      generated: new Date().toISOString(),
    },
    cases,
  }, null, 2));
  console.log(`  ${G}Saved to ${outPath}${X}`);
}

async function main() {
  console.log(`${B}Build Temporal Cross-Sections${X}`);
  const years = YEAR ? [YEAR] : [2013, 2016, 2022];
  for (const y of years) await buildCrossSection(y);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
