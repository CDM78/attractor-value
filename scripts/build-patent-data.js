#!/usr/bin/env node
// Build patent data pool from USPTO PatentsView API
// Part 4A of unconventional data pools

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadSystematicCases } from './lib/calibration-data.js';

const UNCONV_DIR = resolve(import.meta.dirname, '../data/unconventional');
const DATA_DIR = resolve(import.meta.dirname, '../data');
mkdirSync(UNCONV_DIR, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : null; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function mean(a) { return a.length ? a.reduce((s,v) => s+v, 0) / a.length : 0; }
function linSlope(a) {
  const n = a.length; if (n < 2) return 0;
  let sx=0,sy=0,sxy=0,sx2=0;
  for (let i=0;i<n;i++){sx+=i;sy+=a[i];sxy+=i*a[i];sx2+=i*i;}
  const d=n*sx2-sx*sx; return d===0?0:(n*sxy-sx*sy)/d;
}

// Company name variants for patent matching
function getSearchNames(ticker, companyName) {
  const names = new Set();
  if (companyName && companyName !== ticker) {
    // Clean up company name
    let clean = companyName.replace(/\s+(Inc\.?|Corp\.?|Co\.?|Ltd\.?|PLC|plc|LLC|LP|SA|SE|NV|AG)$/i, '').trim();
    names.add(clean);
    // Also try shorter versions
    if (clean.includes(',')) names.add(clean.split(',')[0].trim());
  }
  return [...names].filter(n => n.length >= 3);
}

async function fetchPatents(companyName, startDate, endDate) {
  // PatentsView API
  const query = {
    q: { _and: [
      { _contains: { assignees: { assignee_organization: companyName } } },
      { _gte: { patent_date: startDate } },
      { _lte: { patent_date: endDate } },
    ]},
    f: ['patent_number', 'patent_date', 'patent_title', 'patent_num_cited_by_us_patents', 'cpc_current.cpc_group_id'],
    o: { per_page: 1000 },
  };

  try {
    await new Promise(r => setTimeout(r, 1000)); // Rate limit: 1/sec
    const res = await fetch('https://api.patentsview.org/patents/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch { return null; }
}

async function main() {
  console.log(`${B}Build Patent Data Pool${X}`);
  console.log('='.repeat(60));

  // Load SEC metadata for company names (best source of full names)
  const secMeta = loadJSON(resolve(UNCONV_DIR, 'sec-filing-metadata.json')) || {};
  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};

  // Get all unique tickers with entry dates
  const cases = loadSystematicCases();
  for (const y of [2013, 2016, 2022]) {
    const d = loadJSON(resolve(DATA_DIR, `systematic-sp500-crosssection-${y}.json`));
    if (d?.cases) cases.push(...d.cases);
  }

  // Deduplicate by ticker
  const tickerMap = {}; // ticker → { name, entry_dates }
  for (const c of cases) {
    if (!tickerMap[c.ticker]) {
      const secName = secMeta[c.ticker]?.company_name;
      const cikName = cikCache[c.ticker]?.name;
      tickerMap[c.ticker] = { name: secName || cikName || c.company || c.ticker, entry_dates: [] };
    }
    if (c.entry_date && !tickerMap[c.ticker].entry_dates.includes(c.entry_date)) {
      tickerMap[c.ticker].entry_dates.push(c.entry_date);
    }
  }

  const tickers = Object.keys(tickerMap);
  console.log(`  Unique tickers: ${tickers.length}`);

  const outPath = resolve(UNCONV_DIR, 'patent-data.json');
  let results = loadJSON(outPath) || {};
  const limit = LIMIT ? Math.min(LIMIT, tickers.length) : tickers.length;
  let ok = 0, failed = 0, skipped = 0, noMatch = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = tickers[i];
    if (results[ticker]) { skipped++; continue; }

    const info = tickerMap[ticker];
    const searchNames = getSearchNames(ticker, info.name);

    if (searchNames.length === 0) {
      results[ticker] = { status: 'no_name', ticker };
      noMatch++;
      continue;
    }

    // Use earliest entry date for the 4-year window
    const entryDates = info.entry_dates.sort();
    const refDate = entryDates[0] || '2019-01-02';
    const endDate = refDate;
    const startYear = parseInt(refDate.slice(0, 4)) - 4;
    const startDate = `${startYear}${refDate.slice(4)}`;

    // Try each name variant
    let patentData = null;
    let matchedName = null;

    for (const name of searchNames) {
      patentData = await fetchPatents(name, startDate, endDate);
      if (patentData?.patents && patentData.patents.length > 0) {
        matchedName = name;
        break;
      }
    }

    if (!patentData?.patents || patentData.patents.length === 0) {
      results[ticker] = { status: 'no_patents', ticker, searched: searchNames };
      noMatch++;
      continue;
    }

    const patents = patentData.patents;

    // Compute metrics
    const patentsByYear = {};
    const allCitations = [];
    const allCpcClasses = new Set();

    for (const p of patents) {
      const year = p.patent_date?.slice(0, 4);
      if (year) patentsByYear[year] = (patentsByYear[year] || 0) + 1;

      const citations = p.patent_num_cited_by_us_patents || 0;
      allCitations.push(citations);

      if (p.cpc_current) {
        for (const cpc of (Array.isArray(p.cpc_current) ? p.cpc_current : [p.cpc_current])) {
          if (cpc.cpc_group_id) allCpcClasses.add(cpc.cpc_group_id);
        }
      }
    }

    const years = Object.keys(patentsByYear).sort();
    const patentsPerYear = years.map(y => patentsByYear[y]);

    results[ticker] = {
      status: 'ok', ticker, matched_name: matchedName,
      window: `${startDate} to ${endDate}`,
      patents_4yr: patents.length,
      patents_per_year: Object.fromEntries(years.map((y, i) => [y, patentsPerYear[i]])),
      patent_velocity_slope: patentsPerYear.length >= 2 ? Math.round(linSlope(patentsPerYear) * 10) / 10 : null,
      unique_cpc_classes: allCpcClasses.size,
      mean_citations: allCitations.length > 0 ? Math.round(mean(allCitations) * 10) / 10 : 0,
      total_citations: allCitations.reduce((s, v) => s + v, 0),
    };
    ok++;

    if ((i + 1) % 20 === 0 || i === limit - 1) {
      writeFileSync(outPath, JSON.stringify(results, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${ok} with patents, ${noMatch} no match, ${skipped} cached, ${failed} api fail)...\r`);
    }
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  const withPatents = Object.values(results).filter(r => r.status === 'ok').length;
  console.log(`\n  ${G}Patent data: ${Object.keys(results).length} tickers processed, ${withPatents} with patent data${X}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
