#!/usr/bin/env node
// Session 4.5 Part 3: Filing Checkpoints
// Maps available filings during holding period at T+12 and T+24.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const FILING_CP_DIR = join(CAL, 'cases', 'filing-checkpoints');
const RESULTS_DIR = join(CAL, 'tests', 'results');

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('='.repeat(60));
  console.log('SESSION 4.5 PART 3: FILING CHECKPOINTS');
  console.log('='.repeat(60));

  const { fetchEdgarSubmissions, ensureCikCache, getCikPadded } = await import('../warehouse/connectors/shared.js');
  await ensureCikCache();

  const universe = JSON.parse(readFileSync(join(CAL, 'cases', 'universe.json'), 'utf-8'));
  const allCases = Object.values(universe.cases);
  console.log(`Total cases: ${allCases.length}`);

  if (!existsSync(FILING_CP_DIR)) mkdirSync(FILING_CP_DIR, { recursive: true });

  // Group by ticker to share EDGAR submissions
  const casesByTicker = {};
  for (const c of allCases) {
    if (!c.cik) continue;
    if (!casesByTicker[c.ticker]) casesByTicker[c.ticker] = [];
    casesByTicker[c.ticker].push(c);
  }

  const tickers = Object.keys(casesByTicker);
  console.log(`Tickers with CIK: ${tickers.length}`);

  let processed = 0;
  let with10kT12 = 0, with10kT24 = 0, withBoth = 0, with8k = 0, withInsider = 0;

  for (let t = 0; t < tickers.length; t++) {
    const ticker = tickers[t];
    const cases = casesByTicker[ticker];
    const cik = getCikPadded(ticker);
    if (!cik) continue;

    if ((t + 1) % 50 === 0) {
      process.stdout.write(`\r  Tickers: ${t + 1}/${tickers.length} | Cases: ${processed}`);
    }

    // Fetch all filings for this ticker (we need them across the holding period)
    // Get filings up to T+36 of the latest entry date
    const latestEntry = cases.reduce((m, c) => c.entry_date > m ? c.entry_date : m, cases[0].entry_date);
    const endDate = addMonths(latestEntry, 37);

    let allFilings10K = [];
    let allFilings8K = [];
    let allFilingsForm4 = [];

    try {
      allFilings10K = await fetchEdgarSubmissions(cik, endDate, ['10-K', '10-K/A'], 30);
    } catch {}
    try {
      allFilings8K = await fetchEdgarSubmissions(cik, endDate, ['8-K', '8-K/A'], 100);
    } catch {}
    try {
      allFilingsForm4 = await fetchEdgarSubmissions(cik, endDate, ['4', '4/A'], 200);
    } catch {}

    for (const c of cases) {
      processed++;
      const entryDate = c.entry_date;
      const t12Date = addMonths(entryDate, 12);
      const t24Date = addMonths(entryDate, 24);

      // T+12: filings between entry and T+12
      const tenK_T12 = allFilings10K.filter(f => f.filing_date > entryDate && f.filing_date <= t12Date);
      const eightK_T12 = allFilings8K.filter(f => f.filing_date > entryDate && f.filing_date <= t12Date);
      const form4_T12 = allFilingsForm4.filter(f => f.filing_date > entryDate && f.filing_date <= t12Date);

      // T+24: filings between T+12 and T+24
      const tenK_T24 = allFilings10K.filter(f => f.filing_date > t12Date && f.filing_date <= t24Date);
      const eightK_T24 = allFilings8K.filter(f => f.filing_date > t12Date && f.filing_date <= t24Date);
      const form4_T24 = allFilingsForm4.filter(f => f.filing_date > t12Date && f.filing_date <= t24Date);

      const has10kT12 = tenK_T12.length > 0;
      const has10kT24 = tenK_T24.length > 0;
      if (has10kT12) with10kT12++;
      if (has10kT24) with10kT24++;
      if (has10kT12 && has10kT24) withBoth++;
      if (eightK_T12.length > 0 || eightK_T24.length > 0) with8k++;
      if (form4_T12.length > 0 || form4_T24.length > 0) withInsider++;

      // Classify 8-K items by description
      const classify8K = (filings) => filings.map(f => ({
        date: f.filing_date,
        accession: f.accession,
        description: f.description || '',
      }));

      const result = {
        case_id: c.case_id,
        ticker,
        entry_date: entryDate,
        outcome: c.outcome?.classification,
        t12: {
          period: `${entryDate} to ${t12Date}`,
          new_10k: tenK_T12.map(f => ({ date: f.filing_date, accession: f.accession })),
          eight_k_count: eightK_T12.length,
          eight_k_filings: classify8K(eightK_T12),
          form4_count: form4_T12.length,
        },
        t24: {
          period: `${t12Date} to ${t24Date}`,
          new_10k: tenK_T24.map(f => ({ date: f.filing_date, accession: f.accession })),
          eight_k_count: eightK_T24.length,
          eight_k_filings: classify8K(eightK_T24),
          form4_count: form4_T24.length,
        },
      };

      writeFileSync(join(FILING_CP_DIR, `${c.case_id}.json`), JSON.stringify(result, null, 2));
    }
  }

  // Also count cases without CIK as no_data
  const noCik = allCases.filter(c => !c.cik).length;

  console.log(`\n\nFiling checkpoints computed for ${processed} cases (${noCik} without CIK skipped)`);

  // Coverage report
  const report = `# Filing Checkpoint Coverage Report

**Date**: 2026-03-26

\`\`\`
FILING CHECKPOINT COVERAGE
============================
Total cases: ${allCases.length}
Cases with CIK (processable): ${processed}
Cases without CIK (skipped): ${noCik}

Cases with new 10-K at T+12: ${with10kT12}/${allCases.length}
Cases with new 10-K at T+24: ${with10kT24}/${allCases.length}
Cases with both T+12 and T+24 10-K: ${withBoth}
Cases with 8-K events during holding: ${with8k}
Cases with insider (Form 4) data during holding: ${withInsider}
\`\`\`
`;

  writeFileSync(join(RESULTS_DIR, 'filing-checkpoints-report-2026-03-26.md'), report);
  console.log(report);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
