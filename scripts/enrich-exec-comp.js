#!/usr/bin/env node
// Rough-extract executive compensation from EDGAR DEF 14A proxy statements.
// For each ticker, finds most recent DEF 14A before entry date, downloads HTML,
// searches for Summary Compensation Table, extracts CEO total comp + rough split.
//
// Usage: node scripts/enrich-exec-comp.js [--limit N]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker } from './lib/edgar-fetcher.js';
import { loadSystematicCases } from './lib/calibration-data.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const UNCONV_DIR = resolve(DATA_DIR, 'unconventional');
mkdirSync(UNCONV_DIR, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

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

// Find the most recent DEF 14A filing before a target date
async function findDef14A(cik, beforeDate) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const res = await rateLimitedFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const recent = data.filings?.recent;
  if (!recent?.form) return null;

  // Search recent filings for DEF 14A
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] === 'DEF 14A' && recent.filingDate[i] <= beforeDate) {
      const accession = recent.accessionNumber[i].replace(/-/g, '');
      const primaryDoc = recent.primaryDocument[i];
      const cikNum = parseInt(cik);
      return {
        filingDate: recent.filingDate[i],
        url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`,
        accession: recent.accessionNumber[i],
      };
    }
  }

  // Check additional filing files if DEF 14A not in recent
  if (data.filings?.files?.length) {
    for (const fileRef of data.filings.files.slice(0, 2)) {
      try {
        const extraUrl = `https://data.sec.gov/submissions/${fileRef.name}`;
        const extraRes = await rateLimitedFetch(extraUrl);
        if (!extraRes.ok) continue;
        const extra = await extraRes.json();
        for (let i = 0; i < (extra.form?.length || 0); i++) {
          if (extra.form[i] === 'DEF 14A' && extra.filingDate[i] <= beforeDate) {
            const accession = extra.accessionNumber[i].replace(/-/g, '');
            const primaryDoc = extra.primaryDocument[i];
            const cikNum = parseInt(cik);
            return {
              filingDate: extra.filingDate[i],
              url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`,
              accession: extra.accessionNumber[i],
            };
          }
        }
      } catch {}
    }
  }

  return null;
}

// Parse compensation from HTML text (rough extraction)
function parseCompensation(html) {
  // Strip HTML tags for text search, but keep the raw HTML for table parsing
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

  // Find "Summary Compensation Table" anchor
  const sctIndex = text.search(/summary\s+compensation\s+table/i);
  if (sctIndex === -1) return null;

  // Extract a window around the table (characters, not lines)
  const windowStart = sctIndex;
  const windowEnd = Math.min(sctIndex + 15000, text.length);
  const window = text.slice(windowStart, windowEnd);

  // Look for CEO / Chief Executive Officer / Principal Executive
  const ceoPatterns = [
    /(?:chief\s+executive\s+officer|CEO|principal\s+executive\s+officer|president\s+and\s+chief)/i,
  ];

  let ceoSection = null;
  for (const pat of ceoPatterns) {
    const m = window.search(pat);
    if (m !== -1) {
      ceoSection = window.slice(Math.max(0, m - 200), m + 2000);
      break;
    }
  }

  if (!ceoSection) {
    // Try first named person after "Summary Compensation Table"
    ceoSection = window.slice(0, 3000);
  }

  // Extract dollar amounts — look for patterns like $1,234,567 or 1,234,567
  const dollarPattern = /\$?\s?([\d,]+(?:\.\d{2})?)/g;
  const amounts = [];
  let match;
  while ((match = dollarPattern.exec(ceoSection)) !== null) {
    const val = parseFloat(match[1].replace(/,/g, ''));
    if (val >= 10000 && val < 500000000) { // Between $10K and $500M
      amounts.push(val);
    }
  }

  if (amounts.length === 0) return null;

  // The total compensation is typically the largest amount in the CEO's row
  // Or in many tables it's the last column value
  const totalComp = Math.max(...amounts);

  // Try to identify salary (usually first reasonable amount, $100K-$5M range)
  const salary = amounts.find(a => a >= 100000 && a <= 5000000 && a < totalComp) || null;

  // Rough split estimation
  let salaryPct = null, equityPct = null, bonusPct = null;
  if (salary && totalComp > 0) {
    salaryPct = Math.round((salary / totalComp) * 1000) / 1000;
    // Equity is typically the bulk of the rest for modern exec comp
    equityPct = Math.round((1 - salaryPct) * 0.7 * 1000) / 1000; // rough estimate
    bonusPct = Math.round((1 - salaryPct - equityPct) * 1000) / 1000;
  }

  return {
    ceo_total_comp: Math.round(totalComp),
    ceo_salary: salary ? Math.round(salary) : null,
    ceo_salary_pct: salaryPct,
    ceo_equity_pct: equityPct,
    ceo_bonus_pct: bonusPct,
    amounts_found: amounts.length,
    parsing_confidence: salary && totalComp > salary ? 'medium' : 'low',
  };
}

async function main() {
  console.log(`${B}Extract Executive Compensation from DEF 14A${X}`);
  console.log('='.repeat(50));

  await ensureCikCache();

  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  // For each ticker, get earliest entry date (we want DEF 14A before that)
  const tickerDates = {};
  for (const c of cases) {
    if (!tickerDates[c.ticker] || c.entry_date < tickerDates[c.ticker]) {
      tickerDates[c.ticker] = c.entry_date;
    }
  }
  const tickers = Object.keys(tickerDates).sort();
  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;
  console.log(`\n  Tickers to process: ${limit} of ${tickers.length}`);

  const outPath = resolve(UNCONV_DIR, 'exec-compensation.json');
  let results = loadJSON(outPath) || {};
  let ok = 0, failed = 0, skipped = 0, noCik = 0, noDef14a = 0, parseFail = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    if (results[ticker]?.ceo_total_comp != null) { skipped++; continue; }

    const cik = getCikForTicker(ticker);
    if (!cik) { noCik++; results[ticker] = { ticker, status: 'no_cik' }; continue; }

    const beforeDate = tickerDates[ticker];
    const filing = await findDef14A(cik, beforeDate);
    if (!filing) {
      noDef14a++;
      results[ticker] = { ticker, status: 'no_def14a', before_date: beforeDate };
      continue;
    }

    try {
      const res = await rateLimitedFetch(filing.url);
      if (!res.ok) {
        failed++;
        results[ticker] = { ticker, status: 'download_failed', filing_date: filing.filingDate };
        continue;
      }
      const html = await res.text();
      const comp = parseCompensation(html);

      if (comp) {
        results[ticker] = {
          ticker,
          status: 'ok',
          filing_date: filing.filingDate,
          ...comp,
        };
        ok++;
      } else {
        parseFail++;
        results[ticker] = { ticker, status: 'parse_failed', filing_date: filing.filingDate };
      }
    } catch (e) {
      failed++;
      results[ticker] = { ticker, status: 'error', error: e.message };
    }

    if ((i + 1) % 25 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`\r  ${i + 1}/${limit} (${G}${ok} ok${X}, ${skipped} cached, ${Y}${parseFail} parse-fail${X}, ${R}${failed + noCik + noDef14a} other-fail${X})`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const okCount = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n\n  ${G}Exec comp saved: ${okCount} tickers with data${X}`);
  console.log(`  No CIK: ${noCik}, No DEF 14A: ${noDef14a}, Parse fail: ${parseFail}, Other fail: ${failed}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
