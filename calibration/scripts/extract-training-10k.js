#!/usr/bin/env node
// Extract 10-K Item 1A for training cases that need it for Job 2 replication.
// Targets 250+ tickers to get 200+ cases with both current and prior Item 1A.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');

async function main() {
  console.log('='.repeat(60));
  console.log('TARGETED 10-K ITEM 1A EXTRACTION FOR JOB 2');
  console.log('='.repeat(60));

  const { ensureCikCache } = await import('../warehouse/connectors/shared.js');
  const { extract10KItem1A } = await import('../warehouse/connectors/edgar-10k.js');
  const warehouse = (await import('../warehouse/warehouse.js')).default;

  await ensureCikCache();

  // Load universe
  const universe = JSON.parse(readFileSync(join(CAL, 'cases', 'universe.json'), 'utf-8'));
  const allCases = Object.values(universe.cases);
  const training = allCases.filter(c => c.partition === 'training' && c.cik);

  console.log(`Training cases with CIK: ${training.length}`);

  // Find training cases that still need 10-K Item 1A
  const needsExtraction = [];
  const alreadyHasBoth = [];
  const wh = join(CAL, 'warehouse', 'companies');

  for (const c of training) {
    const dir = join(wh, c.ticker, 'filings', '10-K');
    let count = 0;
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const r = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
          if (r.data_type === '10k_risk_factors' && r.publication_date < c.entry_date) count++;
        } catch {}
      }
    }
    if (count >= 2) alreadyHasBoth.push(c);
    else needsExtraction.push(c);
  }

  console.log(`Already have both: ${alreadyHasBoth.length}`);
  console.log(`Need extraction: ${needsExtraction.length}`);

  // Group by ticker to avoid redundant extractions
  const byTicker = {};
  for (const c of needsExtraction) {
    if (!byTicker[c.ticker]) byTicker[c.ticker] = [];
    byTicker[c.ticker].push(c);
  }

  const tickers = Object.keys(byTicker);
  console.log(`Unique tickers to process: ${tickers.length}`);

  let extracted = 0;
  let newBoth = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const cases = byTicker[ticker];
    // Use the latest entry date as the before cutoff
    const latestEntry = cases.reduce((m, c) => c.entry_date > m ? c.entry_date : m, cases[0].entry_date);

    if ((i + 1) % 25 === 0) {
      process.stdout.write(`\r  [${i + 1}/${tickers.length}] Extracted: ${extracted} | Both: ${newBoth + alreadyHasBoth.length}`);
    }

    try {
      const results = await extract10KItem1A(ticker, latestEntry, { maxFilings: 3 });
      const stored = results.filter(r => r.status === 'stored');
      extracted += stored.length;

      if (stored.length >= 2) newBoth += cases.length;
      else if (stored.length === 1) {
        // Check if we already had one from the pilot
        const dir = join(wh, ticker, 'filings', '10-K');
        if (existsSync(dir)) {
          const total = readdirSync(dir).filter(f => f.endsWith('.json')).length;
          if (total >= 2) newBoth += cases.length;
        }
      }
    } catch (err) {
      // Skip failures
    }

    // Stop if we have enough (target: 250+ cases with both)
    if (newBoth + alreadyHasBoth.length >= 300) {
      console.log(`\n  Reached target (${newBoth + alreadyHasBoth.length} cases with both). Stopping early.`);
      break;
    }
  }

  console.log(`\n\nExtraction complete:`);
  console.log(`  New filings extracted: ${extracted}`);
  console.log(`  Cases with both Item 1A: ${newBoth + alreadyHasBoth.length}`);

  // Rebuild indexes
  console.log('Rebuilding warehouse indexes...');
  warehouse.rebuildIndexes();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
