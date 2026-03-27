#!/usr/bin/env node

// Fetch 10-K Item 1A text for all 120 retest cases.
// Needs current year AND prior year filings for each case.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { parse } from 'csv-parse/sync';

const CAL = resolve(import.meta.dirname, '..');
const RETEST_DIR = join(CAL, 'retest');
const UA = 'Bolin & Troy LLC charles@bolinandtroy.com';

async function fetchJSON(url) {
  await new Promise(r => setTimeout(r, 200));
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fetchText(url) {
  await new Promise(r => setTimeout(r, 200));
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractItem1A(text) {
  const start = text.search(/Item\s+1A[\.\s\-–—]*\s*Risk\s+Factors/i);
  if (start < 0) return null;
  const after = text.slice(start);
  const next = after.search(/\n\s*Item\s+(1B|2|7)[\.\s\-–—]/i);
  const section = next > 0 ? after.slice(0, next) : after.slice(0, 50000);
  return section.length >= 500 ? section : null;
}

async function main() {
  // Load cases
  const csv = readFileSync(join(RETEST_DIR, 'selected-cases.csv'), 'utf-8');
  const cases = csv.split('\n').slice(1).filter(l => l.trim()).map(line => {
    const parts = line.split(',');
    return { case_id: parts[0], ticker: parts[1], cik: parts[2], entry_date: parts[3] };
  });

  console.log(`Cases to process: ${cases.length}`);

  // Deduplicate by ticker (same company may appear at multiple dates)
  const byTicker = {};
  for (const c of cases) {
    if (!byTicker[c.ticker]) byTicker[c.ticker] = [];
    byTicker[c.ticker].push(c);
  }

  const tickers = Object.keys(byTicker);
  console.log(`Unique tickers: ${tickers.length}`);

  // Load CIK cache
  const cikCache = JSON.parse(readFileSync('/home/cm/attractor-value/data/cik-cache.json', 'utf-8'));

  const filingDir = join(RETEST_DIR, 'filings');
  mkdirSync(filingDir, { recursive: true });

  let ok = 0, fail = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const tickerCases = byTicker[ticker];
    const cikInfo = cikCache[ticker];
    if (!cikInfo) { fail++; continue; }

    const cik = String(cikInfo.cik);
    const paddedCik = cik.padStart(10, '0');

    process.stdout.write(`\r  [${i + 1}/${tickers.length}] ${ticker} (${ok} ok, ${fail} fail)    `);

    // Check if already fetched
    const tickerDir = join(filingDir, ticker);
    if (existsSync(tickerDir) && readdirSync(tickerDir).length >= 2) {
      ok++;
      continue;
    }

    try {
      // Get filing list
      const subs = await fetchJSON(`https://data.sec.gov/submissions/CIK${paddedCik}.json`);
      const recent = subs.filings?.recent;
      if (!recent) { fail++; continue; }

      // Find all 10-K filings
      const tenKs = [];
      for (let j = 0; j < (recent.form || []).length; j++) {
        if (recent.form[j] !== '10-K' && recent.form[j] !== '10-K/A') continue;
        tenKs.push({
          date: recent.filingDate[j],
          accession: recent.accessionNumber[j],
          doc: recent.primaryDocument[j],
        });
      }

      // For each case entry date, find current + prior 10-K
      mkdirSync(tickerDir, { recursive: true });

      for (const c of tickerCases) {
        const beforeEntry = tenKs.filter(t => t.date <= c.entry_date).sort((a, b) => b.date.localeCompare(a.date));
        if (beforeEntry.length < 2) continue;

        const current = beforeEntry[0];
        const prior = beforeEntry[1];

        // Fetch and extract Item 1A for current
        for (const [label, filing] of [['current', current], ['prior', prior]]) {
          const outFile = join(tickerDir, `${c.entry_date}_${label}.json`);
          if (existsSync(outFile)) continue;

          try {
            const accClean = filing.accession.replace(/-/g, '');
            const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accClean}/${filing.doc}`;
            const html = await fetchText(url);
            const text = stripHtml(html);
            const item1a = extractItem1A(text);

            writeFileSync(outFile, JSON.stringify({
              ticker, cik, filing_date: filing.date,
              entry_date: c.entry_date, label,
              item1a: item1a || null,
              item1a_words: item1a ? item1a.split(/\s+/).length : 0,
              full_text_words: text.split(/\s+/).length,
            }, null, 2));
          } catch {}
        }
      }

      ok++;
    } catch {
      fail++;
    }
  }

  console.log(`\n\nDone: ${ok} ok, ${fail} fail`);

  // Count how many cases now have both current + prior Item 1A
  let withBoth = 0, withCurrent = 0, withPrior = 0, withNone = 0;
  for (const c of cases) {
    const currentFile = join(filingDir, c.ticker, `${c.entry_date}_current.json`);
    const priorFile = join(filingDir, c.ticker, `${c.entry_date}_prior.json`);
    const hasCurrent = existsSync(currentFile) && JSON.parse(readFileSync(currentFile, 'utf-8')).item1a;
    const hasPrior = existsSync(priorFile) && JSON.parse(readFileSync(priorFile, 'utf-8')).item1a;
    if (hasCurrent && hasPrior) withBoth++;
    else if (hasCurrent) withCurrent++;
    else if (hasPrior) withPrior++;
    else withNone++;
  }

  console.log(`\nItem 1A coverage:`);
  console.log(`  Both current + prior: ${withBoth}/${cases.length}`);
  console.log(`  Current only: ${withCurrent}`);
  console.log(`  Prior only: ${withPrior}`);
  console.log(`  Neither: ${withNone}`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
