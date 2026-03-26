#!/usr/bin/env node
// Run FMP earnings transcripts connector on the same 50 pilot companies from Session 2.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

const CALIBRATION_ROOT = resolve(import.meta.dirname, '..');
const RESULTS_DIR = join(CALIBRATION_ROOT, 'tests', 'results');

async function main() {
  console.log('='.repeat(60));
  console.log('FMP TRANSCRIPTS — 50-COMPANY PILOT');
  console.log('='.repeat(60));

  // Load pilot results to get the same 50 companies
  const pilotData = JSON.parse(readFileSync(join(RESULTS_DIR, 'pilot-50-results.json'), 'utf-8'));
  const pilotSummaries = pilotData.summaries;

  // Also load the full pilot results to get entry dates
  const pilotResults = pilotData.results;

  // Load universe for entry dates
  const universe = JSON.parse(readFileSync(join(CALIBRATION_ROOT, 'cases', 'universe.json'), 'utf-8'));

  // Reconstruct pilot company list with entry dates
  const companies = pilotSummaries.map(s => ({
    ticker: s.ticker,
    entry_date: s.entry_date,
    gics_sector: s.gics_sector,
    outcome: s.outcome,
    edgar_8k_transcripts: s.sources?.['8k_transcripts_count'] || 0,
  }));

  console.log(`\nCompanies: ${companies.length}`);

  // Import FMP connector
  const fmp = await import('../warehouse/connectors/fmp-transcripts.js');

  if (!fmp.default.isAvailable()) {
    console.error('ERROR: FMP API key not available. Check config/connectors.json');
    process.exit(1);
  }

  console.log(`FMP API key: configured`);
  console.log(`Remaining calls today: ${fmp.default.remainingCalls()}`);
  console.log('');

  const allResults = [];
  let totalStored = 0;
  let totalFound = 0;
  let totalDuplicates = 0;
  let companiesWithData = 0;
  let rateLimited = false;

  for (let i = 0; i < companies.length; i++) {
    const co = companies[i];
    const remaining = fmp.default.remainingCalls();

    if (remaining <= 5) {
      console.log(`\n⚠ Rate limit approaching (${remaining} calls left). Stopping.`);
      rateLimited = true;
      break;
    }

    process.stdout.write(`[${i + 1}/${companies.length}] ${co.ticker.padEnd(6)} (before ${co.entry_date})... `);

    try {
      const result = await fmp.default.extractFMPTranscripts(co.ticker, co.entry_date);

      const stored = result.stored || 0;
      const found = result.transcripts_found || 0;
      const dupes = result.skipped_duplicate || 0;

      totalStored += stored;
      totalFound += found;
      totalDuplicates += dupes;
      if (stored > 0 || dupes > 0) companiesWithData++;

      // Compute quarters stored
      const storedDetails = (result.details || []).filter(d => d.status === 'stored');
      const periods = storedDetails.map(d => d.period).join(', ');

      allResults.push({
        ticker: co.ticker,
        entry_date: co.entry_date,
        sector: co.gics_sector,
        outcome: co.outcome,
        edgar_8k: co.edgar_8k_transcripts,
        fmp_found: found,
        fmp_stored: stored,
        fmp_duplicates: dupes,
        fmp_total: stored + dupes,
        periods: storedDetails.map(d => d.period),
        status: result.status,
      });

      if (stored > 0) {
        console.log(`${stored} stored (${found} found, ${dupes} dupes) — ${periods}`);
      } else if (found > 0) {
        console.log(`${dupes} already had from EDGAR (${found} found)`);
      } else {
        console.log(`no transcripts available`);
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      allResults.push({
        ticker: co.ticker,
        entry_date: co.entry_date,
        sector: co.gics_sector,
        outcome: co.outcome,
        edgar_8k: co.edgar_8k_transcripts,
        fmp_found: 0,
        fmp_stored: 0,
        fmp_duplicates: 0,
        fmp_total: 0,
        status: 'error',
        error: err.message,
      });
    }
  }

  // Rebuild warehouse indexes
  const warehouse = (await import('../warehouse/warehouse.js')).default;
  console.log('\nRebuilding warehouse indexes...');
  const indexStats = warehouse.rebuildIndexes();
  console.log(`Indexed: ${indexStats?.companies} companies, ${indexStats?.dataPoints} data points`);

  // Save detailed results
  const resultsPath = join(RESULTS_DIR, 'fmp-pilot-50-results.json');
  writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    companies_processed: allResults.length,
    total_transcripts_found: totalFound,
    total_stored: totalStored,
    total_duplicates: totalDuplicates,
    companies_with_transcripts: companiesWithData,
    rate_limited: rateLimited,
    remaining_calls: fmp.default.remainingCalls(),
    results: allResults,
  }, null, 2));

  // ============================================================
  // COVERAGE REPORT
  // ============================================================
  console.log('\n' + '='.repeat(70));
  console.log('FMP TRANSCRIPT COVERAGE REPORT');
  console.log('='.repeat(70));

  const withFMP = allResults.filter(r => r.fmp_stored > 0 || r.fmp_duplicates > 0);
  const withFMPStored = allResults.filter(r => r.fmp_stored > 0);
  const withEdgar = allResults.filter(r => r.edgar_8k > 0);
  const withEither = allResults.filter(r => r.fmp_total > 0 || r.edgar_8k > 0);

  console.log(`\nCompanies with FMP transcripts:     ${withFMP.length}/${allResults.length} (${(100 * withFMP.length / allResults.length).toFixed(0)}%)`);
  console.log(`Companies with EDGAR 8-K transcripts: ${withEdgar.length}/${allResults.length} (${(100 * withEdgar.length / allResults.length).toFixed(0)}%)`);
  console.log(`Companies with ANY transcript:        ${withEither.length}/${allResults.length} (${(100 * withEither.length / allResults.length).toFixed(0)}%)`);

  // Average quarters per company (among those with data)
  const quartersPerCompany = withFMP.map(r => r.fmp_total);
  const avgQuarters = quartersPerCompany.length > 0
    ? (quartersPerCompany.reduce((a, b) => a + b, 0) / quartersPerCompany.length).toFixed(1)
    : '0';
  const maxQuarters = quartersPerCompany.length > 0 ? Math.max(...quartersPerCompany) : 0;
  const minQuarters = quartersPerCompany.length > 0 ? Math.min(...quartersPerCompany) : 0;

  console.log(`\nAmong companies with FMP data:`);
  console.log(`  Avg quarters per company: ${avgQuarters}`);
  console.log(`  Min quarters: ${minQuarters}`);
  console.log(`  Max quarters: ${maxQuarters}`);
  console.log(`  Total transcripts stored: ${totalStored} (new) + ${totalDuplicates} (already from EDGAR)`);

  // By sector
  console.log(`\nCoverage by sector:`);
  const bySector = {};
  for (const r of allResults) {
    if (!bySector[r.sector]) bySector[r.sector] = { total: 0, withFMP: 0, avgQ: [] };
    bySector[r.sector].total++;
    if (r.fmp_total > 0) {
      bySector[r.sector].withFMP++;
      bySector[r.sector].avgQ.push(r.fmp_total);
    }
  }
  for (const [sector, data] of Object.entries(bySector).sort((a, b) => b[1].withFMP - a[1].withFMP)) {
    const avg = data.avgQ.length > 0 ? (data.avgQ.reduce((a, b) => a + b, 0) / data.avgQ.length).toFixed(1) : '-';
    console.log(`  ${sector.padEnd(28)} ${data.withFMP}/${data.total} (avg ${avg} quarters)`);
  }

  // By entry year
  console.log(`\nCoverage by entry year:`);
  const byYear = {};
  for (const r of allResults) {
    const y = r.entry_date.slice(0, 4);
    if (!byYear[y]) byYear[y] = { total: 0, withFMP: 0 };
    byYear[y].total++;
    if (r.fmp_total > 0) byYear[y].withFMP++;
  }
  for (const [year, data] of Object.entries(byYear).sort()) {
    console.log(`  ${year}: ${data.withFMP}/${data.total}`);
  }

  // Comparison table: EDGAR 8-K vs FMP
  console.log(`\nHead-to-head: EDGAR 8-K vs FMP (per company):`);
  console.log(`${'Ticker'.padEnd(8)} ${'Entry'.padEnd(12)} ${'8-K'.padEnd(6)} ${'FMP'.padEnd(6)} ${'Combined'.padEnd(8)} Winner`);
  console.log('-'.repeat(55));
  for (const r of allResults) {
    const combined = r.edgar_8k + r.fmp_total;
    const winner = r.edgar_8k > r.fmp_total ? 'EDGAR' : r.fmp_total > r.edgar_8k ? 'FMP' : (combined > 0 ? 'TIE' : '-');
    console.log(`${r.ticker.padEnd(8)} ${r.entry_date.padEnd(12)} ${String(r.edgar_8k).padEnd(6)} ${String(r.fmp_total).padEnd(6)} ${String(combined).padEnd(8)} ${winner}`);
  }

  // Bottom line
  const fmpWins = allResults.filter(r => r.fmp_total > r.edgar_8k).length;
  const edgarWins = allResults.filter(r => r.edgar_8k > r.fmp_total).length;
  const ties = allResults.filter(r => r.edgar_8k === r.fmp_total && (r.edgar_8k + r.fmp_total) > 0).length;
  const neither = allResults.filter(r => r.edgar_8k === 0 && r.fmp_total === 0).length;

  console.log(`\nBest transcript source: FMP wins ${fmpWins}, EDGAR wins ${edgarWins}, ties ${ties}, neither ${neither}`);
  console.log(`FMP remaining calls: ${fmp.default.remainingCalls()}/240`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
