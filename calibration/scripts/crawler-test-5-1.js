#!/usr/bin/env node

// Crawler Test 5.1: Run full 3-phase crawler on 103 Job 2 cases.
// Phase 1+3 are AI evaluations (done by calling Opus sub-agents).
// Phase 2 is EDGAR data fetching (data-router.js).
//
// Since we can't spawn sub-agents from a script, this script:
// 1. Prepares batch files with Phase 1 prompts for each case
// 2. After Phase 1 results are provided, runs Phase 2 data fetching
// 3. Prepares Phase 3 prompts with enriched data
// 4. After Phase 3 results are provided, computes statistics

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { fetchAllRequests } from '../crawler/data-router.js';
import { ensureCikCache } from '../warehouse/connectors/shared.js';

const CAL = resolve(import.meta.dirname, '..');
const CRAWLER_DIR = join(CAL, 'crawler');
const TEST_DIR = join(CRAWLER_DIR, 'test-5-1');
mkdirSync(TEST_DIR, { recursive: true });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CRAWLER TEST 5.1: Prepare Phase 2 Data for 103 Job 2 Cases');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await ensureCikCache();

  // Load Job 2 cases
  const job2 = JSON.parse(readFileSync(join(CAL, 'tests/job2-cases/opus-results-merged.json'), 'utf-8'));
  const universe = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));

  console.log(`Job 2 cases: ${job2.results.length}`);

  // For each case, we already have Phase 1 results from the Job 2 evaluation
  // (trajectory + confidence). We need to:
  // 1. Generate standard info requests (same for all cases since we don't have custom ones)
  // 2. Fetch Phase 2 data
  // 3. Prepare Phase 3 batches for Opus evaluation

  const standardRequests = [
    { type: 'INSIDER_TRADING', query: 'Form 4 insider transactions', reason: 'Insider buying/selling patterns', expected_impact: 'HIGH' },
    { type: 'MANAGEMENT', query: 'Executive compensation and changes', reason: 'Management stability', expected_impact: 'MEDIUM' },
    { type: 'CUSTOMER_CONCENTRATION', query: 'Customer concentration risk', reason: 'Revenue dependency', expected_impact: 'MEDIUM' },
  ];

  // Run Phase 2 for all cases
  const phase2Results = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < job2.results.length; i++) {
    const c = job2.results[i];
    const uCase = universe.cases[c.case_id];
    const cik = uCase?.cik ? parseInt(uCase.cik, 10) : null;

    // Get 10-K text for customer concentration search
    let tenKText = '';
    const dir = join(CAL, 'warehouse/companies', c.ticker, 'filings', '10-K');
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      const entryFilings = files.map(f => {
        try {
          const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
          if (rec.data_type === '10k_risk_factors' && rec.publication_date < (uCase?.entry_date || '9999')) return rec;
        } catch {}
        return null;
      }).filter(Boolean).sort((a, b) => b.publication_date.localeCompare(a.publication_date));

      if (entryFilings.length > 0) tenKText = entryFilings[0].content || '';
    }

    try {
      process.stdout.write(`\r  Phase 2: [${i + 1}/${job2.results.length}] ${c.ticker} (${ok} ok, ${fail} fail)    `);
      const results = await fetchAllRequests(standardRequests, c.ticker, cik, uCase?.entry_date || '2020-01-01', tenKText);

      phase2Results.push({
        case_id: c.case_id,
        ticker: c.ticker,
        entry_date: uCase?.entry_date,
        outcome: c.outcome,
        alpha_3yr: c.alpha_3yr || uCase?.outcome?.alpha_3yr,
        job2_trajectory: c.trajectory,
        job2_confidence: c.confidence,
        phase2_data: results,
        data_found_count: results.filter(r => r.data_found).length,
      });
      ok++;
    } catch (e) {
      fail++;
      phase2Results.push({
        case_id: c.case_id,
        ticker: c.ticker,
        outcome: c.outcome,
        job2_trajectory: c.trajectory,
        phase2_data: [],
        data_found_count: 0,
        error: e.message,
      });
    }
  }

  console.log(`\n\n  Phase 2 complete: ${ok} ok, ${fail} fail`);

  // Save Phase 2 results
  writeFileSync(join(TEST_DIR, 'phase2-results.json'), JSON.stringify(phase2Results, null, 2));

  // Analyze Phase 2 data coverage
  console.log('\n  Phase 2 Data Coverage:');
  const typeCounts = { INSIDER_TRADING: { found: 0, total: 0 }, MANAGEMENT: { found: 0, total: 0 }, CUSTOMER_CONCENTRATION: { found: 0, total: 0 } };

  for (const c of phase2Results) {
    for (const d of (c.phase2_data || [])) {
      if (typeCounts[d.request_type]) {
        typeCounts[d.request_type].total++;
        if (d.data_found) typeCounts[d.request_type].found++;
      }
    }
  }

  console.log('  Type                   | Found | Total | Rate');
  for (const [type, counts] of Object.entries(typeCounts)) {
    console.log(`  ${type.padEnd(24)} | ${String(counts.found).padStart(5)} | ${String(counts.total).padStart(5)} | ${(counts.found / Math.max(counts.total, 1) * 100).toFixed(0)}%`);
  }

  // Prepare Phase 3 batches (5 cases each) for Opus evaluation
  const batchSize = 5;
  for (let i = 0; i < phase2Results.length; i += batchSize) {
    const batch = phase2Results.slice(i, i + batchSize).map(c => ({
      case_id: c.case_id,
      ticker: c.ticker,
      outcome: c.outcome,
      initial_trajectory: c.job2_trajectory,
      initial_confidence: c.job2_confidence,
      enrichment_data: (c.phase2_data || []).map(d => ({
        type: d.request_type,
        data_found: d.data_found,
        summary: d.summary?.slice(0, 500) || 'No data',
      })),
    }));

    writeFileSync(join(TEST_DIR, `phase3-batch-${String(Math.floor(i / batchSize)).padStart(3, '0')}.json`), JSON.stringify(batch, null, 2));
  }

  console.log(`\n  Phase 3 batches prepared: ${Math.ceil(phase2Results.length / batchSize)} files`);
  console.log('  Ready for Opus Phase 3 evaluation.\n');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
