#!/usr/bin/env node
// Import existing FRED economic data and FINRA short interest into the warehouse.

import warehouse from '../warehouse/warehouse.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../../data');
const UNCONVENTIONAL_DIR = resolve(DATA_DIR, 'unconventional');

console.log('=== MARKET DATA IMPORT ===\n');

// ============================================================
// FRED Economic Context
// ============================================================
console.log('Importing FRED economic context...');
const fredPath = resolve(UNCONVENTIONAL_DIR, 'economic-context.json');
if (existsSync(fredPath)) {
  const fredData = JSON.parse(readFileSync(fredPath, 'utf-8'));

  // Store as macro data — keyed by date
  warehouse.storeMacroData('fred', 'economic-context', fredData);

  const dates = Object.keys(fredData);
  console.log(`  Stored ${dates.length} FRED snapshots`);
  console.log(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
} else {
  console.log('  ⚠️  economic-context.json not found');
}

// ============================================================
// FINRA Short Interest
// ============================================================
console.log('\nImporting FINRA short interest...');
const siPath = resolve(UNCONVENTIONAL_DIR, 'historical-short-interest.json');
if (existsSync(siPath)) {
  const siData = JSON.parse(readFileSync(siPath, 'utf-8'));

  // The short interest data is keyed by anonymized case ID (C0000, etc.)
  // We need to reorganize by ticker for the warehouse
  const byTicker = {};
  let recordCount = 0;

  for (const [caseId, record] of Object.entries(siData)) {
    if (!record.ticker || !record.si_date) continue;
    const ticker = record.ticker;
    if (!byTicker[ticker]) byTicker[ticker] = [];
    byTicker[ticker].push({
      settlement_date: record.si_date,
      short_position: record.short_position,
      prev_short_position: record.prev_short_position,
      avg_daily_volume: record.avg_daily_volume,
      days_to_cover: record.days_to_cover,
      change_pct: record.change_pct,
      market_class: record.market_class,
    });
    recordCount++;
  }

  // Store aggregate short interest data
  warehouse.storeMacroData('finra', 'short-interest', byTicker);

  // Also store per-company short interest as warehouse records
  let companyCount = 0;
  for (const [ticker, records] of Object.entries(byTicker)) {
    for (const r of records) {
      try {
        const record = warehouse.createRecord({
          company: ticker,
          data_type: 'short_interest',
          source: 'finra_historical',
          source_url: 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest',
          publication_date: r.settlement_date,
          content: r,
          metadata: {
            days_to_cover: r.days_to_cover,
            change_pct: r.change_pct,
          },
        });
        warehouse.storeRecord(record);
      } catch (e) {
        // Skip records with invalid dates
      }
    }
    companyCount++;
  }

  console.log(`  Stored ${recordCount} short interest records for ${companyCount} companies`);
  console.log(`  Tickers covered: ${Object.keys(byTicker).length}`);
} else {
  console.log('  ⚠️  historical-short-interest.json not found');
}

// ============================================================
// Price/Volume Dynamics (if available)
// ============================================================
console.log('\nImporting price/volume dynamics...');
const pvPath = resolve(UNCONVENTIONAL_DIR, 'price-volume-dynamics.json');
if (existsSync(pvPath)) {
  const pvData = JSON.parse(readFileSync(pvPath, 'utf-8'));

  // Store as macro reference data
  warehouse.storeMacroData('market', 'price-volume-dynamics', pvData);

  const count = Array.isArray(pvData) ? pvData.length : Object.keys(pvData).length;
  console.log(`  Stored price/volume dynamics (${count} records)`);
} else {
  console.log('  ⚠️  price-volume-dynamics.json not found — skipping');
}

// ============================================================
// Rebuild indexes
// ============================================================
console.log('\nRebuilding warehouse indexes...');
const indexStats = warehouse.rebuildIndexes();
if (indexStats) {
  console.log(`  Companies indexed: ${indexStats.companies}`);
  console.log(`  Data points indexed: ${indexStats.dataPoints}`);
}

console.log('\n=== MARKET DATA IMPORT COMPLETE ===');
