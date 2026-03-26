#!/usr/bin/env node
// Session 2: 50-Company Pilot Run
// Runs all connectors on 50 diverse companies, measures coverage.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const CALIBRATION_ROOT = resolve(import.meta.dirname, '..');
const RESULTS_DIR = join(CALIBRATION_ROOT, 'tests', 'results');

// ============================================================
// PILOT COMPANY SELECTION
// ============================================================

function selectPilotCompanies() {
  const universe = JSON.parse(readFileSync(join(CALIBRATION_ROOT, 'cases', 'universe.json'), 'utf-8'));
  const cases = Object.values(universe.cases);

  // Normalize GICS sectors (some have inconsistent naming)
  const sectorMap = {
    'Technology': 'Information Technology',
    'Healthcare': 'Health Care',
    'Inc."': 'Industrials', // data quality issue
  };

  for (const c of cases) {
    if (sectorMap[c.gics_sector]) c.gics_sector = sectorMap[c.gics_sector];
  }

  // Target 5 sectors with 10 companies each
  const targetSectors = [
    'Information Technology',
    'Health Care',
    'Financials',
    'Industrials',
    'Consumer Discretionary',
  ];

  // Group by sector, then select diverse mix
  const selected = [];
  const usedTickers = new Set();

  for (const sector of targetSectors) {
    const sectorCases = cases.filter(c =>
      c.gics_sector === sector &&
      c.cik && // Must have CIK for EDGAR
      !usedTickers.has(c.ticker)
    );

    // Sort by entry year to spread across time
    sectorCases.sort((a, b) => a.entry_date.localeCompare(b.entry_date));

    // Select 10 companies: mix of outcomes and entry years
    const winners = sectorCases.filter(c => c.outcome?.classification === 'winner');
    const traps = sectorCases.filter(c => c.outcome?.classification === 'trap');
    const other = sectorCases.filter(c => !['winner', 'trap'].includes(c.outcome?.classification));

    // Pick from each outcome type, spreading entry years
    const pick = (arr, n) => {
      if (arr.length <= n) return arr;
      const step = Math.floor(arr.length / n);
      return Array.from({ length: n }, (_, i) => arr[Math.min(i * step, arr.length - 1)]);
    };

    const sectorPicks = [
      ...pick(winners, 4),
      ...pick(traps, 3),
      ...pick(other, 3),
    ];

    // Deduplicate by ticker (take first case per ticker)
    const tickerSeen = new Set();
    for (const c of sectorPicks) {
      if (!tickerSeen.has(c.ticker) && !usedTickers.has(c.ticker)) {
        tickerSeen.add(c.ticker);
        usedTickers.add(c.ticker);
        selected.push(c);
        if (tickerSeen.size >= 10) break;
      }
    }

    // If we didn't get 10, backfill
    if (tickerSeen.size < 10) {
      for (const c of sectorCases) {
        if (!usedTickers.has(c.ticker)) {
          usedTickers.add(c.ticker);
          selected.push(c);
          tickerSeen.add(c.ticker);
          if (tickerSeen.size >= 10) break;
        }
      }
    }
  }

  console.log(`\nPilot companies selected: ${selected.length}`);
  console.log('By sector:');
  const bySector = {};
  for (const c of selected) {
    bySector[c.gics_sector] = (bySector[c.gics_sector] || 0) + 1;
  }
  for (const [sector, count] of Object.entries(bySector)) {
    console.log(`  ${sector}: ${count}`);
  }

  const byOutcome = {};
  for (const c of selected) {
    const o = c.outcome?.classification || 'unknown';
    byOutcome[o] = (byOutcome[o] || 0) + 1;
  }
  console.log('By outcome:', byOutcome);

  const byYear = {};
  for (const c of selected) {
    const y = c.entry_date.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
  }
  console.log('By entry year:', byYear);

  return selected;
}

// ============================================================
// CONNECTOR RUNNER
// ============================================================

async function runConnectorsForCompany(caseRecord) {
  const ticker = caseRecord.ticker;
  const entryDate = caseRecord.entry_date;
  const entryYear = parseInt(entryDate.slice(0, 4), 10);

  const coverage = {
    company: ticker,
    company_name: caseRecord.company_name,
    entry_date: entryDate,
    gics_sector: caseRecord.gics_sector,
    outcome: caseRecord.outcome?.classification,
    results: {},
  };

  // Dynamically import connectors
  const { extract10KItem1A, extract10KItem7 } = await import('../warehouse/connectors/edgar-10k.js');
  const { extract10QItem2 } = await import('../warehouse/connectors/edgar-10q.js');
  const { extract8KTranscripts } = await import('../warehouse/connectors/edgar-8k-transcripts.js');
  const { extractCommentLetters } = await import('../warehouse/connectors/edgar-comment-letters.js');
  const fmp = await import('../warehouse/connectors/fmp-transcripts.js');
  const { fetchPatentData } = await import('../warehouse/connectors/uspto-patents.js');

  // 1. 10-K Item 1A — current + prior year
  try {
    console.log(`    [10-K Item 1A] Extracting...`);
    const results = await extract10KItem1A(ticker, entryDate, { maxFilings: 3 });
    coverage.results['10k_item1a'] = results;
    const stored = results.filter(r => r.status === 'stored');
    console.log(`    [10-K Item 1A] ${stored.length} filings extracted`);
    for (const r of stored) {
      console.log(`      ${r.fiscal_year}: ${r.word_count} words (${r.method})`);
    }
  } catch (err) {
    coverage.results['10k_item1a'] = [{ status: 'error', error: err.message }];
    console.log(`    [10-K Item 1A] ERROR: ${err.message}`);
  }

  // 2. 10-K Item 7 MD&A — current year
  try {
    console.log(`    [10-K Item 7] Extracting...`);
    const results = await extract10KItem7(ticker, entryDate, { maxFilings: 2 });
    coverage.results['10k_mda'] = results;
    const stored = results.filter(r => r.status === 'stored');
    console.log(`    [10-K Item 7] ${stored.length} filings extracted`);
  } catch (err) {
    coverage.results['10k_mda'] = [{ status: 'error', error: err.message }];
    console.log(`    [10-K Item 7] ERROR: ${err.message}`);
  }

  // 3. 10-Q Item 2 — most recent 4 quarters
  try {
    console.log(`    [10-Q Item 2] Extracting...`);
    const results = await extract10QItem2(ticker, entryDate, { maxQuarters: 4 });
    coverage.results['10q_mda'] = results;
    const stored = results.filter(r => r.status === 'stored');
    console.log(`    [10-Q Item 2] ${stored.length} quarters extracted`);
  } catch (err) {
    coverage.results['10q_mda'] = [{ status: 'error', error: err.message }];
    console.log(`    [10-Q Item 2] ERROR: ${err.message}`);
  }

  // 4. 8-K Earnings Transcripts
  try {
    console.log(`    [8-K Transcripts] Searching...`);
    const results = await extract8KTranscripts(ticker, entryDate, { maxFilings: 20 });
    coverage.results['8k_transcripts'] = results;
    const stored = results.filter(r => r.status === 'stored');
    console.log(`    [8-K Transcripts] ${stored.length} transcripts found`);
  } catch (err) {
    coverage.results['8k_transcripts'] = [{ status: 'error', error: err.message }];
    console.log(`    [8-K Transcripts] ERROR: ${err.message}`);
  }

  // 5. FMP Transcripts (if available)
  if (fmp.default.isAvailable()) {
    try {
      console.log(`    [FMP Transcripts] Fetching...`);
      const result = await fmp.default.extractFMPTranscripts(ticker, entryDate);
      coverage.results['fmp_transcripts'] = result;
      console.log(`    [FMP Transcripts] ${result.stored || 0} new, ${result.skipped_duplicate || 0} duplicates`);
    } catch (err) {
      coverage.results['fmp_transcripts'] = { status: 'error', error: err.message };
      console.log(`    [FMP Transcripts] ERROR: ${err.message}`);
    }
  } else {
    coverage.results['fmp_transcripts'] = { status: 'no_api_key' };
    console.log(`    [FMP Transcripts] Skipped — no API key`);
  }

  // 6. USPTO Patents
  try {
    console.log(`    [USPTO Patents] Searching...`);
    const result = await fetchPatentData(ticker, entryDate, { trailingYears: 3 });
    coverage.results['patents'] = result;
    console.log(`    [USPTO Patents] ${result.patent_count || 0} patents found`);
  } catch (err) {
    coverage.results['patents'] = { status: 'error', error: err.message };
    console.log(`    [USPTO Patents] ERROR: ${err.message}`);
  }

  // 7. SEC Comment Letters
  try {
    console.log(`    [Comment Letters] Searching...`);
    const results = await extractCommentLetters(ticker, entryDate, { trailingYears: 3 });
    coverage.results['comment_letters'] = results;
    const stored = results.filter(r => r.status === 'stored');
    console.log(`    [Comment Letters] ${stored.length} letters found`);
  } catch (err) {
    coverage.results['comment_letters'] = [{ status: 'error', error: err.message }];
    console.log(`    [Comment Letters] ERROR: ${err.message}`);
  }

  return coverage;
}

// ============================================================
// COVERAGE SUMMARY
// ============================================================

function summarizeCoverage(companyResults) {
  const summary = {
    ticker: companyResults.company,
    entry_date: companyResults.entry_date,
    gics_sector: companyResults.gics_sector,
    outcome: companyResults.outcome,
    sources: {},
    data_richness_score: 0,
  };

  // 10-K Item 1A
  const item1a = (companyResults.results['10k_item1a'] || []).filter(r => r.status === 'stored');
  summary.sources['10k_item1a_current'] = item1a.length >= 1;
  summary.sources['10k_item1a_prior'] = item1a.length >= 2;
  summary.sources['10k_item1a_words'] = item1a[0]?.word_count || 0;

  // 10-K Item 7
  const mda = (companyResults.results['10k_mda'] || []).filter(r => r.status === 'stored');
  summary.sources['10k_mda'] = mda.length >= 1;
  summary.sources['10k_mda_words'] = mda[0]?.word_count || 0;

  // 10-Q Item 2
  const q10 = (companyResults.results['10q_mda'] || []).filter(r => r.status === 'stored');
  summary.sources['10q_mda_quarters'] = q10.length;
  summary.sources['10q_mda_any'] = q10.length > 0;

  // 8-K Transcripts
  const transcripts8k = (companyResults.results['8k_transcripts'] || []).filter(r => r.status === 'stored');
  summary.sources['8k_transcripts_count'] = transcripts8k.length;
  summary.sources['8k_transcripts_any'] = transcripts8k.length > 0;

  // FMP Transcripts
  const fmpResult = companyResults.results['fmp_transcripts'];
  const fmpStored = fmpResult?.stored || 0;
  summary.sources['fmp_transcripts_count'] = fmpStored;
  summary.sources['fmp_available'] = fmpResult?.status !== 'no_api_key';

  // Combined transcript coverage
  summary.sources['combined_transcripts'] = transcripts8k.length + fmpStored;

  // Patents
  const patents = companyResults.results['patents'];
  summary.sources['patents_count'] = patents?.patent_count || 0;
  summary.sources['patents_any'] = (patents?.patent_count || 0) > 0;

  // Comment Letters
  const letters = (companyResults.results['comment_letters'] || []).filter(r => r.status === 'stored');
  summary.sources['comment_letters_count'] = letters.length;
  summary.sources['comment_letters_any'] = letters.length > 0;

  // Compute data richness score (0-10)
  let richness = 0;
  if (summary.sources['10k_item1a_current']) richness += 1.5;
  if (summary.sources['10k_item1a_prior']) richness += 1.5;
  if (summary.sources['10k_mda']) richness += 1.5;
  richness += Math.min(summary.sources['10q_mda_quarters'], 4) * 0.25; // up to 1.0
  if (summary.sources['combined_transcripts'] >= 4) richness += 2.0;
  else if (summary.sources['combined_transcripts'] >= 1) richness += 1.0;
  if (summary.sources['patents_any']) richness += 0.5;
  if (summary.sources['comment_letters_any']) richness += 1.0;

  summary.data_richness_score = Math.min(10, Math.round(richness * 10) / 10);

  return summary;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('=' .repeat(60));
  console.log('SESSION 2: 50-COMPANY PILOT RUN');
  console.log('=' .repeat(60));

  const startTime = Date.now();

  // Initialize shared CIK cache
  const { ensureCikCache } = await import('../warehouse/connectors/shared.js');
  await ensureCikCache();

  // Select pilot companies
  const pilotCases = selectPilotCompanies();

  // Run connectors for each company
  const allResults = [];
  const allSummaries = [];

  for (let i = 0; i < pilotCases.length; i++) {
    const caseRecord = pilotCases[i];
    console.log(`\n[${ i + 1}/${pilotCases.length}] ${caseRecord.ticker} (${caseRecord.company_name})`);
    console.log(`  Entry: ${caseRecord.entry_date} | Sector: ${caseRecord.gics_sector} | Outcome: ${caseRecord.outcome?.classification}`);

    try {
      const result = await runConnectorsForCompany(caseRecord);
      allResults.push(result);

      const summary = summarizeCoverage(result);
      allSummaries.push(summary);

      // Print coverage record
      console.log(`  COVERAGE: richness=${summary.data_richness_score}/10`);
      console.log(`    10-K Item 1A: current=${summary.sources['10k_item1a_current'] ? 'YES' : 'NO'}, prior=${summary.sources['10k_item1a_prior'] ? 'YES' : 'NO'}`);
      console.log(`    10-K MD&A: ${summary.sources['10k_mda'] ? 'YES' : 'NO'}`);
      console.log(`    10-Q quarters: ${summary.sources['10q_mda_quarters']}`);
      console.log(`    Transcripts: 8-K=${summary.sources['8k_transcripts_count']}, FMP=${summary.sources['fmp_transcripts_count']}`);
      console.log(`    Patents: ${summary.sources['patents_count']}`);
      console.log(`    Comment letters: ${summary.sources['comment_letters_count']}`);
    } catch (err) {
      console.log(`  FATAL ERROR: ${err.message}`);
      allResults.push({ company: caseRecord.ticker, error: err.message });
      allSummaries.push({
        ticker: caseRecord.ticker,
        entry_date: caseRecord.entry_date,
        gics_sector: caseRecord.gics_sector,
        outcome: caseRecord.outcome?.classification,
        data_richness_score: 0,
        sources: {},
      });
    }

    // Save progress every 10 companies
    if ((i + 1) % 10 === 0) {
      saveProgress(allResults, allSummaries, pilotCases.length);
    }
  }

  // Save final results
  saveProgress(allResults, allSummaries, pilotCases.length);

  // Rebuild warehouse indexes
  const warehouse = (await import('../warehouse.js')).default;
  console.log('\nRebuilding warehouse indexes...');
  const indexStats = warehouse.rebuildIndexes();
  console.log(`  Indexed: ${indexStats?.companies} companies, ${indexStats?.dataPoints} data points`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nPilot complete in ${elapsed}s`);
  console.log(`Results saved to: ${RESULTS_DIR}/pilot-50-results.json`);

  // Print summary table
  printSummaryTable(allSummaries);
}

function saveProgress(results, summaries, total) {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  writeFileSync(
    join(RESULTS_DIR, 'pilot-50-results.json'),
    JSON.stringify({ total, completed: results.length, results, summaries, timestamp: new Date().toISOString() }, null, 2)
  );

  // Write resume state
  writeFileSync(
    join(CALIBRATION_ROOT, 'resume-state.json'),
    JSON.stringify({
      session: 2,
      phase: `pilot-50: ${results.length}/${total} companies processed`,
      completed: ['edgar_10k_sections', 'edgar_10q_mda', 'edgar_8k_transcripts', 'edgar_comment_letters', 'fmp_transcripts', 'uspto_patents'],
      remaining: results.length < total ? ['pilot_remaining', 'coverage_report', 'structural_stress_cv'] : ['coverage_report', 'structural_stress_cv'],
      pilot_companies_done: results.length,
      timestamp: new Date().toISOString(),
    }, null, 2)
  );
}

function printSummaryTable(summaries) {
  console.log('\n' + '='.repeat(80));
  console.log('PILOT SUMMARY TABLE');
  console.log('='.repeat(80));
  console.log('Ticker  | Sector                    | Outcome    | Score | 1A  | MD&A | Qs | Tx | Pat | CL');
  console.log('-'.repeat(80));

  for (const s of summaries) {
    const ticker = (s.ticker || '').padEnd(7);
    const sector = (s.gics_sector || '').slice(0, 25).padEnd(25);
    const outcome = (s.outcome || '').padEnd(10);
    const score = String(s.data_richness_score || 0).padEnd(5);
    const item1a = s.sources?.['10k_item1a_current'] ? (s.sources['10k_item1a_prior'] ? '2/2' : '1/2') : '0/2';
    const mda = s.sources?.['10k_mda'] ? 'YES' : 'NO ';
    const qs = String(s.sources?.['10q_mda_quarters'] || 0).padEnd(2);
    const tx = String(s.sources?.['combined_transcripts'] || 0).padEnd(2);
    const pat = String(s.sources?.['patents_count'] || 0).padEnd(3);
    const cl = String(s.sources?.['comment_letters_count'] || 0).padEnd(2);

    console.log(`${ticker} | ${sector} | ${outcome} | ${score} | ${item1a} | ${mda}  | ${qs} | ${tx} | ${pat} | ${cl}`);
  }

  // Aggregate stats
  const n = summaries.length;
  const withItem1a = summaries.filter(s => s.sources?.['10k_item1a_current']).length;
  const withBoth1a = summaries.filter(s => s.sources?.['10k_item1a_prior']).length;
  const withMda = summaries.filter(s => s.sources?.['10k_mda']).length;
  const withQ10 = summaries.filter(s => (s.sources?.['10q_mda_quarters'] || 0) > 0).length;
  const with8k = summaries.filter(s => s.sources?.['8k_transcripts_any']).length;
  const withPatents = summaries.filter(s => s.sources?.['patents_any']).length;
  const withLetters = summaries.filter(s => s.sources?.['comment_letters_any']).length;
  const avgRichness = (summaries.reduce((s, c) => s + (c.data_richness_score || 0), 0) / n).toFixed(1);

  console.log('-'.repeat(80));
  console.log(`TOTALS: ${n} companies | Avg richness: ${avgRichness}/10`);
  console.log(`  10-K Item 1A (current): ${withItem1a}/${n}`);
  console.log(`  10-K Item 1A (both):    ${withBoth1a}/${n}`);
  console.log(`  10-K MD&A:              ${withMda}/${n}`);
  console.log(`  10-Q MD&A (any):        ${withQ10}/${n}`);
  console.log(`  8-K Transcripts (any):  ${with8k}/${n}`);
  console.log(`  Patents (any):          ${withPatents}/${n}`);
  console.log(`  Comment Letters (any):  ${withLetters}/${n}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
