#!/usr/bin/env node

// Task B: Crawler out-of-sample validation on mid-caps.
// Phase 1: Opus baseline assessment from financial summary (no 10-K text available)
// Phase 2: EDGAR data fetch (insider, proxy, customer concentration from companyfacts)
// Phase 3: Enriched reassessment
// Identity-blinded: CIK only, no ticker/name.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fetchAllRequests } from '../crawler/data-router.js';
import { ensureCikCache } from '../warehouse/connectors/shared.js';

const CAL = resolve(import.meta.dirname, '..');
const TEST_DIR = join(CAL, 'crawler-midcap-oos');
mkdirSync(TEST_DIR, { recursive: true });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TASK B: CRAWLER OUT-OF-SAMPLE VALIDATION (MID-CAPS)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await ensureCikCache();

  const cases = JSON.parse(readFileSync(join(CAL, 'crawler-midcap-test-cases.json'), 'utf-8'));
  console.log(`Selected cases: ${cases.length} (W:${cases.filter(c => c.classification === 'winner').length} T:${cases.filter(c => c.classification === 'trap').length})\n`);

  // Build financial summaries from EDGAR companyfacts
  const edgarDir = join(CAL, 'midcap-edgar-raw');
  const enrichedCases = [];

  for (const c of cases) {
    const edgarPath = join(edgarDir, `${c.ticker}.json`);
    if (!existsSync(edgarPath)) continue;

    const edgar = JSON.parse(readFileSync(edgarPath, 'utf-8'));
    const concepts = edgar.concepts || edgar.facts || {};

    // Extract key financial metrics for baseline
    function getValues(conceptPattern, beforeDate) {
      for (const [key, entries] of Object.entries(concepts)) {
        if (!conceptPattern.test(key) || !Array.isArray(entries)) continue;
        return entries
          .filter(e => e.end && e.end <= beforeDate && (e.form === '10-Q' || e.form === '10-K'))
          .sort((a, b) => a.end.localeCompare(b.end))
          .slice(-8)
          .map(e => ({ date: e.end, value: e.val }));
      }
      return [];
    }

    const revenue = getValues(/revenue|sales/i, c.entry_date);
    const netIncome = getValues(/netincomeloss/i, c.entry_date);
    const eps = getValues(/earningspersharediluted/i, c.entry_date);
    const assets = getValues(/^assets$/i, c.entry_date);

    // Build financial summary (identity-blinded)
    let summary = `ANONYMOUS COMPANY (CIK: ${c.cik || edgar.cik})\nSECTOR: ${c.sector}\nENTRY DATE: ${c.entry_date}\n\n`;

    if (revenue.length > 0) {
      const revTrend = revenue.length >= 4
        ? ((revenue[revenue.length - 1].value / revenue[0].value - 1) * 100).toFixed(1) + '% growth over period'
        : 'insufficient data';
      summary += `QUARTERLY REVENUE (last ${revenue.length} quarters): ${revenue.map(r => '$' + (r.value / 1e6).toFixed(0) + 'M').join(', ')}\nTrend: ${revTrend}\n\n`;
    }
    if (netIncome.length > 0) {
      const profitable = netIncome.filter(n => n.value > 0).length;
      summary += `NET INCOME: ${profitable}/${netIncome.length} quarters profitable. Latest: $${(netIncome[netIncome.length - 1]?.value / 1e6).toFixed(0)}M\n\n`;
    }
    if (eps.length > 0) {
      summary += `EPS (diluted): ${eps.map(e => '$' + e.value.toFixed(2)).join(', ')}\n\n`;
    }

    enrichedCases.push({
      ...c,
      cik: c.cik || edgar.cik,
      financial_summary: summary,
      has_revenue: revenue.length >= 4,
      has_eps: eps.length >= 4,
    });
  }

  console.log(`Cases with financial data: ${enrichedCases.length}`);

  // Phase 2: Fetch EDGAR enrichment data
  console.log('\n── Phase 2: Fetching EDGAR enrichment data ──\n');

  const standardRequests = [
    { type: 'INSIDER_TRADING', query: 'Form 4 insider transactions', reason: 'Insider patterns', expected_impact: 'HIGH' },
    { type: 'MANAGEMENT', query: 'Executive compensation and changes', reason: 'Management stability', expected_impact: 'MEDIUM' },
    { type: 'CUSTOMER_CONCENTRATION', query: 'Customer concentration risk', reason: 'Revenue dependency', expected_impact: 'MEDIUM' },
  ];

  let fetchOk = 0;
  for (let i = 0; i < enrichedCases.length; i++) {
    const c = enrichedCases[i];
    try {
      process.stdout.write(`\r  Phase 2: [${i + 1}/${enrichedCases.length}] CIK ${c.cik} (${fetchOk} ok)    `);
      c.phase2_data = await fetchAllRequests(standardRequests, c.ticker, c.cik, c.entry_date, '');
      c.data_found_count = c.phase2_data.filter(d => d.data_found).length;
      fetchOk++;
    } catch {
      c.phase2_data = [];
      c.data_found_count = 0;
    }
  }

  console.log(`\n  Phase 2 complete: ${fetchOk} ok\n`);

  // Prepare Phase 1+3 batches for Opus evaluation
  // Each batch: 5 cases with financial summary + enrichment data
  const batchSize = 5;
  for (let i = 0; i < enrichedCases.length; i += batchSize) {
    const batch = enrichedCases.slice(i, i + batchSize).map(c => ({
      case_id: c.case_id,
      cik: c.cik,
      sector: c.sector,
      entry_date: c.entry_date,
      financial_summary: c.financial_summary,
      enrichment_data: (c.phase2_data || []).map(d => ({
        type: d.request_type,
        data_found: d.data_found,
        summary: d.summary?.slice(0, 500) || 'No data',
      })),
    }));
    writeFileSync(join(TEST_DIR, `batch-${String(Math.floor(i / batchSize)).padStart(3, '0')}.json`), JSON.stringify(batch, null, 2));
  }

  // Also save the full case list with outcomes (for analysis later)
  writeFileSync(join(TEST_DIR, 'case-list.json'), JSON.stringify(enrichedCases.map(c => ({
    case_id: c.case_id, ticker: c.ticker, cik: c.cik, sector: c.sector,
    entry_date: c.entry_date, classification: c.classification,
    alpha_3yr: c.alpha_3yr, forward_return_3yr: c.forward_return_3yr,
    data_found_count: c.data_found_count,
  })), null, 2));

  console.log(`  Batches prepared: ${Math.ceil(enrichedCases.length / batchSize)}`);
  console.log('  Ready for Opus Phase 1+3 evaluation.\n');

  // Phase 2 coverage
  const typeCounts = { INSIDER_TRADING: { found: 0, total: 0 }, MANAGEMENT: { found: 0, total: 0 }, CUSTOMER_CONCENTRATION: { found: 0, total: 0 } };
  for (const c of enrichedCases) {
    for (const d of (c.phase2_data || [])) {
      if (typeCounts[d.request_type]) { typeCounts[d.request_type].total++; if (d.data_found) typeCounts[d.request_type].found++; }
    }
  }
  console.log('  Phase 2 Data Coverage:');
  for (const [type, counts] of Object.entries(typeCounts)) {
    console.log(`    ${type.padEnd(24)} ${counts.found}/${counts.total} (${(counts.found / Math.max(counts.total, 1) * 100).toFixed(0)}%)`);
  }
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
