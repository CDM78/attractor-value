#!/usr/bin/env node
// Import all systematic datasets into the calibration universe.
// Also creates company directories and metadata in the warehouse.

import universeManager from '../cases/universe-manager.js';
import warehouse from '../warehouse/warehouse.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../../data');

console.log('=== CASE UNIVERSE IMPORT ===\n');

// Step 1: Import systematic datasets
console.log('Step 1: Importing systematic datasets...');
const universe = universeManager.importSystematicDatasets();

// Step 2: Create company meta entries for each unique ticker
console.log('\nStep 2: Creating company metadata...');
const tickers = new Set();
for (const c of Object.values(universe.cases)) {
  tickers.add(c.ticker);
}

let metaCount = 0;
for (const ticker of tickers) {
  // Find the first case with this ticker to get metadata
  const caseEntry = Object.values(universe.cases).find(c => c.ticker === ticker);
  if (!caseEntry) continue;

  warehouse.storeCompanyMeta(ticker, {
    company_name: caseEntry.company_name,
    cik: caseEntry.cik,
    gics_sector: caseEntry.gics_sector,
    sic_code: caseEntry.sic_code,
  });
  metaCount++;
}
console.log(`  Created metadata for ${metaCount} companies`);

// Step 3: Assign partitions
console.log('\nStep 3: Assigning partitions...');
const partitions = universeManager.assignPartitions(42);

// Step 4: Generate initial coverage report
console.log('\nStep 4: Generating coverage report...');
const report = universeManager.generateCoverageReport();
console.log('Coverage Report:');
console.log(`  Total cases: ${report.total_cases}`);
console.log(`  By partition:`, JSON.stringify(report.by_partition));
console.log(`  By outcome:`, JSON.stringify(report.by_outcome));
console.log(`  By year:`, JSON.stringify(report.by_year));

// Step 5: Validate
console.log('\nStep 5: Validation...');
const allIds = universeManager.getAllCaseIds();
let valid = 0, invalid = 0;
for (const id of allIds) {
  const c = universe.cases[id];
  if (c.ticker && c.entry_date && c.outcome?.classification) {
    valid++;
  } else {
    invalid++;
    if (invalid <= 5) console.log(`  Invalid case: ${id} — ticker=${c.ticker} date=${c.entry_date} outcome=${c.outcome?.classification}`);
  }
}
console.log(`  Valid: ${valid}, Invalid: ${invalid}`);

console.log('\n=== IMPORT COMPLETE ===');
console.log(`Universe: ${allIds.length} cases across ${tickers.size} companies`);
console.log(`Partitions: training=${partitions.metadata.training}, validation=${partitions.metadata.validation}, holdout=${partitions.metadata.holdout}`);
