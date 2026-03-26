#!/usr/bin/env node

// Fetch T+12 10-K Item 1A filings for Job 2 sell signal evaluation.
// For each Job 2 training case, fetch the NEXT annual 10-K after entry.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { ensureCikCache } from '../warehouse/connectors/shared.js';
import { fetchAndStore10KSections } from '../warehouse/connectors/edgar-sections.js';

const CAL = resolve(import.meta.dirname, '..');

async function main() {
  console.log('Fetching T+12 10-K filings for Job 2 sell signal...\n');

  await ensureCikCache();

  const universe = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
  const job2 = JSON.parse(readFileSync(join(CAL, 'tests/job2-cases/opus-results-merged.json'), 'utf-8'));

  // Get training Job 2 cases that need T+12 filing
  const job2CaseIds = new Set(job2.results.map(r => r.case_id));
  const training = Object.values(universe.cases).filter(c => c.partition === 'training' && job2CaseIds.has(c.case_id));

  console.log(`Job 2 training cases: ${training.length}`);

  let fetched = 0, already = 0, failed = 0;
  const tickersDone = new Set();

  for (let i = 0; i < training.length; i++) {
    const c = training[i];
    if (tickersDone.has(c.ticker)) { already++; continue; }
    tickersDone.add(c.ticker);

    // Check if T+12 filing already exists
    const dir = join(CAL, 'warehouse/companies', c.ticker, 'filings', '10-K');
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      const entryD = new Date(c.entry_date);
      const t18 = new Date(entryD); t18.setMonth(t18.getMonth() + 18);
      const hasT12 = files.some(f => {
        try {
          const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
          return rec.data_type === '10k_risk_factors' && rec.publication_date > c.entry_date && rec.publication_date <= t18.toISOString().split('T')[0];
        } catch { return false; }
      });
      if (hasT12) { already++; continue; }
    }

    // Need to fetch — get filings up to entry + 18 months
    const entryD = new Date(c.entry_date);
    const t18 = new Date(entryD);
    t18.setMonth(t18.getMonth() + 18);

    try {
      process.stdout.write(`\r  [${i + 1}/${training.length}] Fetching ${c.ticker}... (${fetched} ok, ${failed} fail)    `);
      await fetchAndStore10KSections(c.ticker, {
        beforeDate: t18.toISOString().split('T')[0],
        maxFilings: 5,
      });
      fetched++;
    } catch (e) {
      failed++;
    }

    // SEC rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n\nDone: ${fetched} fetched, ${already} already had, ${failed} failed`);

  // Recount eligible
  let eligible = 0;
  for (const c of training) {
    const dir = join(CAL, 'warehouse/companies', c.ticker, 'filings', '10-K');
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const entryD = new Date(c.entry_date);
    const t18 = new Date(entryD); t18.setMonth(t18.getMonth() + 18);
    const hasT12 = files.some(f => {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return rec.data_type === '10k_risk_factors' && rec.publication_date > c.entry_date && rec.publication_date <= t18.toISOString().split('T')[0];
      } catch { return false; }
    });
    if (hasT12) eligible++;
  }
  console.log(`\nNow eligible for sell signal: ${eligible}/${training.length}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
