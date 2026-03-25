#!/usr/bin/env node
// Enrich price-volume data with short interest from Yahoo Finance.
// Uses cookie/crumb authentication flow since Yahoo blocked unauthenticated API access.
//
// Usage: node scripts/enrich-short-interest.js [--limit N]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadSystematicCases } from './lib/calibration-data.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
mkdirSync(UNCONV_DIR, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

// Yahoo Finance cookie/crumb auth
let yahooCookie = null;
let yahooCrumb = null;
let lastYahooTime = 0;

async function initYahooAuth() {
  console.log(`  ${C}Authenticating with Yahoo Finance...${X}`);
  const r = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const cookies = r.headers.getSetCookie?.() || [];
  if (!cookies.length) throw new Error('No cookies from Yahoo');
  yahooCookie = cookies.map(c => c.split(';')[0]).join('; ');

  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': yahooCookie }
  });
  if (!r2.ok) throw new Error(`Crumb fetch failed: ${r2.status}`);
  yahooCrumb = await r2.text();
  console.log(`  ${G}Authenticated (crumb: ${yahooCrumb.slice(0, 6)}...)${X}`);
}

async function fetchShortInterest(ticker) {
  const now = Date.now();
  if (now - lastYahooTime < 250) await new Promise(r => setTimeout(r, 250 - (now - lastYahooTime)));
  lastYahooTime = Date.now();

  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(yahooCrumb)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': yahooCookie }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    if (!stats) return null;

    return {
      shares_short: stats.sharesShort?.raw || null,
      short_ratio: stats.shortRatio?.raw != null ? Math.round(stats.shortRatio.raw * 100) / 100 : null,
      short_pct_float: stats.shortPercentOfFloat?.raw != null ? Math.round(stats.shortPercentOfFloat.raw * 10000) / 10000 : null,
      shares_short_prior_month: stats.sharesShortPriorMonth?.raw || null,
      date_short_interest: stats.dateShortInterest?.fmt || null,
    };
  } catch { return null; }
}

async function main() {
  console.log(`${B}Enrich Short Interest Data${X}`);
  console.log('='.repeat(50));

  await initYahooAuth();

  // Load all cases including extra cross-sections
  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  const tickers = [...new Set(cases.map(c => c.ticker))].sort();
  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;
  console.log(`\n  Tickers to process: ${limit} of ${tickers.length}`);

  // Load existing short interest data (for resume)
  const outPath = resolve(UNCONV_DIR, 'short-interest.json');
  let results = loadJSON(outPath) || {};
  let ok = 0, failed = 0, skipped = 0;
  let authRetries = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    if (results[ticker]?.shares_short != null) { skipped++; continue; }

    const data = await fetchShortInterest(ticker);
    if (data && (data.shares_short != null || data.short_ratio != null)) {
      results[ticker] = { ticker, ...data };
      ok++;
    } else {
      // Might be auth expiry — re-auth after 3 consecutive failures
      failed++;
      if (failed > 0 && failed % 3 === 0 && authRetries < 5) {
        try { await initYahooAuth(); authRetries++; } catch {}
      }
    }

    if ((i + 1) % 50 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`\r  ${i + 1}/${limit} (${G}${ok} new${X}, ${skipped} cached, ${R}${failed} failed${X})`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n\n  ${G}Short interest saved: ${Object.keys(results).length} tickers${X}`);

  // Enrich price-volume-dynamics.json
  const pvPath = resolve(UNCONV_DIR, 'price-volume-dynamics.json');
  const pv = loadJSON(pvPath);
  if (pv) {
    let enriched = 0;
    for (const entry of Object.values(pv)) {
      const si = results[entry.ticker];
      if (si) {
        entry.shares_short = si.shares_short;
        entry.short_ratio = si.short_ratio;
        entry.short_pct_float = si.short_pct_float;
        enriched++;
      }
    }
    writeFileSync(pvPath, JSON.stringify(pv, null, 2));
    console.log(`  ${G}Enriched ${enriched} price-volume entries with short interest${X}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
