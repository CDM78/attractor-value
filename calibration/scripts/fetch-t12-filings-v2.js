#!/usr/bin/env node

// Fetch T+12 10-K filings — V2
// For each Job 2 case, find the FIRST 10-K filed AFTER entry_date (the T+12 annual report).
// Fetches EDGAR filing index, finds the right filing, extracts Item 1A.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fetchWithRetry, ensureCikCache, getCikForTicker, stripHtml } from '../warehouse/connectors/shared.js';
import warehouse from '../warehouse/warehouse.js';

const CAL = resolve(import.meta.dirname, '..');
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

async function getFilingIndex(ticker) {
  const cik = getCikForTicker(ticker);
  if (!cik) return [];
  const url = `${SUBMISSIONS_BASE}/CIK${String(cik).padStart(10, '0')}.json`;
  let res;
  try { res = await fetchWithRetry(url); } catch { return []; }
  if (!res.ok) return [];
  const data = await res.json();
  const filings = [];
  const recent = data.filings?.recent;
  if (!recent) return [];
  for (let i = 0; i < (recent.accessionNumber?.length || 0); i++) {
    if (recent.form[i] !== '10-K' && recent.form[i] !== '10-K/A') continue;
    filings.push({
      accession: recent.accessionNumber[i],
      date: recent.filingDate[i],
      form: recent.form[i],
      primaryDoc: recent.primaryDocument[i],
      cik: parseInt(cik, 10),
    });
  }
  // Also check older filings
  for (const fileRef of (data.filings?.files || [])) {
    try {
      const olderRes = await fetchWithRetry(`${SUBMISSIONS_BASE}/${fileRef.name}`);
      if (!olderRes.ok) continue;
      const older = await olderRes.json();
      for (let i = 0; i < (older.accessionNumber?.length || 0); i++) {
        if (older.form[i] !== '10-K' && older.form[i] !== '10-K/A') continue;
        filings.push({
          accession: older.accessionNumber[i],
          date: older.filingDate[i],
          form: older.form[i],
          primaryDoc: older.primaryDocument[i],
          cik: parseInt(cik, 10),
        });
      }
    } catch {}
  }
  return filings.sort((a, b) => a.date.localeCompare(b.date));
}

async function extractItem1A(cik, accession, primaryDoc) {
  const accClean = accession.replace(/-/g, '');
  const url = `${ARCHIVES_BASE}/${cik}/${accClean}/${primaryDoc}`;
  let res;
  try { res = await fetchWithRetry(url, { headers: { Accept: 'text/html' } }); } catch { return null; }
  if (!res.ok) return null;
  const html = await res.text();
  const text = stripHtml(html);

  // Extract Item 1A section
  const item1aStart = text.search(/Item\s+1A[\.\s\-–—]*\s*Risk\s+Factors/i);
  if (item1aStart < 0) return null;

  const afterStart = text.slice(item1aStart);
  const nextSection = afterStart.search(/\n\s*Item\s+(1B|2|7)[\.\s\-–—]/i);
  const section = nextSection > 0 ? afterStart.slice(0, nextSection) : afterStart.slice(0, 50000);

  if (section.length < 500) return null;
  return section;
}

async function main() {
  console.log('Fetching T+12 10-K Item 1A filings (V2)...\n');
  await ensureCikCache();

  const universe = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
  const job2 = JSON.parse(readFileSync(join(CAL, 'tests/job2-cases/opus-results-merged.json'), 'utf-8'));
  const job2Ids = new Set(job2.results.map(r => r.case_id));
  const training = Object.values(universe.cases).filter(c => c.partition === 'training' && job2Ids.has(c.case_id));

  let fetched = 0, already = 0, failed = 0, noFiling = 0;
  const tickersDone = new Set();

  for (let i = 0; i < training.length; i++) {
    const c = training[i];

    // Check if T+12 already exists
    const dir = join(CAL, 'warehouse/companies', c.ticker, 'filings', '10-K');
    if (existsSync(dir)) {
      const entryD = new Date(c.entry_date);
      const t18 = new Date(entryD); t18.setMonth(t18.getMonth() + 18);
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      const hasT12 = files.some(f => {
        try {
          const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
          return rec.data_type === '10k_risk_factors' && rec.publication_date > c.entry_date && rec.publication_date <= t18.toISOString().split('T')[0];
        } catch { return false; }
      });
      if (hasT12) { already++; continue; }
    }

    // Skip if we already processed this ticker for another case
    if (tickersDone.has(c.ticker)) continue;
    tickersDone.add(c.ticker);

    process.stdout.write(`\r  [${i + 1}/${training.length}] ${c.ticker} (${fetched} ok, ${noFiling} no filing, ${failed} fail)    `);

    // Get filing index
    const filings = await getFilingIndex(c.ticker);
    await new Promise(r => setTimeout(r, 150));

    // Find the first 10-K filed AFTER entry_date
    const entryD = new Date(c.entry_date);
    const t24 = new Date(entryD); t24.setMonth(t24.getMonth() + 24);
    const t12Filing = filings.find(f => f.date > c.entry_date && f.date <= t24.toISOString().split('T')[0]);

    if (!t12Filing) { noFiling++; continue; }

    // Extract Item 1A
    try {
      const content = await extractItem1A(t12Filing.cik, t12Filing.accession, t12Filing.primaryDoc);
      await new Promise(r => setTimeout(r, 150));

      if (!content) { failed++; continue; }

      // Store
      const fy = t12Filing.date.slice(0, 4);
      const record = warehouse.createRecord({
        company: c.ticker,
        data_type: '10k_risk_factors',
        source: 'edgar_10k',
        source_url: `${ARCHIVES_BASE}/${t12Filing.cik}/${t12Filing.accession.replace(/-/g, '')}/${t12Filing.primaryDoc}`,
        publication_date: t12Filing.date,
        fiscal_period: `FY${fy}`,
        content,
        metadata: { section: 'item_1a', word_count: content.split(/\s+/).length, form: t12Filing.form },
      });
      warehouse.storeRecord(record);
      fetched++;
    } catch (e) {
      failed++;
    }
  }

  console.log(`\n\nDone: ${fetched} fetched, ${already} already had, ${noFiling} no filing on EDGAR, ${failed} failed`);

  // Recount
  let eligible = 0;
  for (const c of training) {
    const dir = join(CAL, 'warehouse/companies', c.ticker, 'filings', '10-K');
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const entryD = new Date(c.entry_date);
    const t18 = new Date(entryD); t18.setMonth(t18.getMonth() + 18);
    const entryFilings = files.filter(f => {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return rec.data_type === '10k_risk_factors' && rec.publication_date < c.entry_date;
      } catch { return false; }
    });
    if (entryFilings.length < 1) continue;
    const hasT12 = files.some(f => {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return rec.data_type === '10k_risk_factors' && rec.publication_date > c.entry_date && rec.publication_date <= t18.toISOString().split('T')[0];
      } catch { return false; }
    });
    if (hasT12) eligible++;
  }
  console.log(`Now eligible for sell signal: ${eligible}/${training.length}`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
