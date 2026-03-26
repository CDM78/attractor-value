#!/usr/bin/env node
// Run all Session 2 connectors on a 50-company pilot set.
// Selects data-rich S&P 500 companies from the 2019 cross-section.
// Measures coverage per data type.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache } from '../warehouse/connectors/shared.js';
import edgarSections from '../warehouse/connectors/edgar-sections.js';
import edgar8K from '../warehouse/connectors/edgar-8k-transcripts.js';
import edgarComment from '../warehouse/connectors/edgar-comment-letters.js';
import uspto from '../warehouse/connectors/uspto-patents.js';
import finraSI from '../warehouse/connectors/finra-si-series.js';
import warehouse from '../warehouse/warehouse.js';

const CASES_DIR = resolve(import.meta.dirname, '../cases');
const RESULTS_DIR = resolve(import.meta.dirname, '../tests/results');

// ============================================================
// SELECT PILOT COMPANIES
// ============================================================

function selectPilotCompanies(n = 50) {
  const universe = JSON.parse(readFileSync(resolve(CASES_DIR, 'universe.json'), 'utf-8'));

  // Pick well-known S&P 500 companies from 2019 cross-section with diverse sectors
  const candidates = Object.values(universe.cases)
    .filter(c => c.universe_source === 'sp500_cs_2019' && c.cik)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  // Ensure sector diversity — pick from each sector
  const bySector = {};
  for (const c of candidates) {
    const sector = c.gics_sector || 'Unknown';
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(c);
  }

  const selected = [];
  const sectors = Object.keys(bySector).sort();

  // Round-robin from sectors until we have enough
  let idx = 0;
  while (selected.length < n && idx < 100) {
    for (const sector of sectors) {
      if (selected.length >= n) break;
      const sectorCases = bySector[sector];
      const sectorIdx = Math.floor(idx / sectors.length);
      if (sectorIdx < sectorCases.length) {
        selected.push(sectorCases[sectorIdx]);
      }
    }
    idx += sectors.length;
  }

  // Fallback if not enough: fill from all candidates
  if (selected.length < n) {
    for (const c of candidates) {
      if (selected.length >= n) break;
      if (!selected.find(s => s.ticker === c.ticker)) {
        selected.push(c);
      }
    }
  }

  return selected.slice(0, n);
}

// ============================================================
// RUN PILOT
// ============================================================

async function runPilot() {
  console.log('=== SESSION 2 PILOT: 50-COMPANY DATA ACQUISITION ===\n');

  await ensureCikCache();

  const pilot = selectPilotCompanies(50);
  console.log(`Selected ${pilot.length} pilot companies across sectors:`);
  const sectorCounts = {};
  for (const c of pilot) {
    const s = c.gics_sector || 'Unknown';
    sectorCounts[s] = (sectorCounts[s] || 0) + 1;
  }
  for (const [sector, count] of Object.entries(sectorCounts).sort()) {
    console.log(`  ${sector}: ${count}`);
  }
  console.log('');

  const coverage = {};
  const errors = [];
  const startTime = Date.now();

  for (let i = 0; i < pilot.length; i++) {
    const c = pilot[i];
    const ticker = c.ticker;
    const companyName = c.company_name;
    const beforeDate = c.entry_date;

    console.log(`\n[${i + 1}/${pilot.length}] ${ticker} — ${companyName} (entry: ${beforeDate})`);
    coverage[ticker] = { sector: c.gics_sector };

    // 1. EDGAR 10-K sections (Risk Factors + MD&A)
    try {
      const result = await edgarSections.fetchAndStore10KSections(ticker, { beforeDate, maxFilings: 5 });
      coverage[ticker].risk_factors = result.risk_factors;
      coverage[ticker].mda = result.mda;
      console.log(`  10-K: ${result.risk_factors} risk factors, ${result.mda} MD&A sections`);
    } catch (e) {
      coverage[ticker].risk_factors = 0;
      coverage[ticker].mda = 0;
      errors.push({ ticker, connector: 'edgar_10k', error: e.message });
      console.log(`  10-K: ERROR — ${e.message}`);
    }

    // 2. EDGAR 8-K transcripts
    try {
      const result = await edgar8K.fetchAndStoreTranscripts(ticker, { beforeDate, maxFilings: 10 });
      coverage[ticker].transcripts_8k = result.transcripts;
      console.log(`  8-K: ${result.transcripts} transcripts, ${result.press_releases} press releases`);
    } catch (e) {
      coverage[ticker].transcripts_8k = 0;
      errors.push({ ticker, connector: 'edgar_8k', error: e.message });
      console.log(`  8-K: ERROR — ${e.message}`);
    }

    // 3. SEC comment letters
    try {
      const result = await edgarComment.fetchAndStoreCommentLetters(ticker, { beforeDate });
      coverage[ticker].comment_letters = result.letters;
      console.log(`  Comment letters: ${result.letters}`);
    } catch (e) {
      coverage[ticker].comment_letters = 0;
      errors.push({ ticker, connector: 'comment_letters', error: e.message });
    }

    // 4. USPTO patents
    try {
      const result = await uspto.fetchAndStorePatents(ticker, companyName, { beforeDate });
      coverage[ticker].patent_years = result.years;
      coverage[ticker].total_patents = result.total;
      console.log(`  Patents: ${result.total} total across ${result.years} years`);
    } catch (e) {
      coverage[ticker].patent_years = 0;
      coverage[ticker].total_patents = 0;
      errors.push({ ticker, connector: 'patents', error: e.message });
    }

    // 5. FINRA SI time series (Session 2.5)
    if (beforeDate >= '2018-03-15') {
      try {
        const result = await finraSI.fetchAndStoreSISeries(ticker, { beforeDate, trailingYears: 2 });
        coverage[ticker].si_series_points = result.dataPoints;
        console.log(`  SI series: ${result.dataPoints} data points`);
      } catch (e) {
        coverage[ticker].si_series_points = 0;
        errors.push({ ticker, connector: 'finra_si', error: e.message });
      }
    } else {
      coverage[ticker].si_series_points = 0;
      console.log(`  SI series: skipped (entry before 2018-03-15)`);
    }

    // Save progress after each company
    if ((i + 1) % 10 === 0) {
      saveProgress(coverage, errors);
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log(`\n  --- Progress saved: ${i + 1}/${pilot.length} companies, ${elapsed} min elapsed ---`);
    }
  }

  // Final save
  saveProgress(coverage, errors);

  // Generate coverage summary
  const summary = generateSummary(coverage);
  console.log('\n\n=== COVERAGE SUMMARY ===');
  console.log(`Companies processed: ${Object.keys(coverage).length}`);
  for (const [metric, stats] of Object.entries(summary)) {
    console.log(`  ${metric}: ${stats.nonzero}/${stats.total} companies (${stats.pct}%)`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  ${e.ticker} [${e.connector}]: ${e.error}`);
    }
    if (errors.length > 10) console.log(`  ... and ${errors.length - 10} more`);
  }

  // Rebuild indexes
  console.log('\nRebuilding warehouse indexes...');
  const idxStats = warehouse.rebuildIndexes();
  console.log(`  Companies: ${idxStats.companies}, Data points: ${idxStats.dataPoints}`);

  console.log('\n=== PILOT COMPLETE ===');
}

function saveProgress(coverage, errors) {
  writeFileSync(
    resolve(RESULTS_DIR, 'pilot-50-coverage.json'),
    JSON.stringify({ coverage, errors, timestamp: new Date().toISOString() }, null, 2)
  );
}

function generateSummary(coverage) {
  const metrics = ['risk_factors', 'mda', 'transcripts_8k', 'comment_letters', 'patent_years', 'si_series_points'];
  const summary = {};

  for (const metric of metrics) {
    const values = Object.values(coverage).map(c => c[metric] || 0);
    const nonzero = values.filter(v => v > 0).length;
    summary[metric] = {
      total: values.length,
      nonzero,
      pct: ((nonzero / values.length) * 100).toFixed(0),
      mean: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1),
      max: Math.max(...values),
    };
  }

  return summary;
}

runPilot().catch(e => {
  console.error('Pilot failed:', e);
  process.exit(1);
});
