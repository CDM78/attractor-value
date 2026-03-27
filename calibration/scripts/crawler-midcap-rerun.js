#!/usr/bin/env node

// Rerun crawler Phase 2 on mid-cap cases with fixed Form 4 + 10-K extraction.
// Then prepare Phase 3 batches for Opus evaluation.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { fetchAllRequests } from '../crawler/data-router.js';
import { ensureCikCache } from '../warehouse/connectors/shared.js';

const CAL = resolve(import.meta.dirname, '..');
const TEST_DIR = join(CAL, 'crawler-midcap-oos-v2');
mkdirSync(TEST_DIR, { recursive: true });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CRAWLER RERUN: Fixed Pipeline on Mid-Caps');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await ensureCikCache();

  const cases = JSON.parse(readFileSync(join(CAL, 'crawler-midcap-test-cases.json'), 'utf-8'));
  const priorOOS = JSON.parse(readFileSync(join(CAL, 'crawler-midcap-oos/case-list.json'), 'utf-8'));
  const priorMap = {};
  for (const c of priorOOS) priorMap[c.case_id] = c;

  console.log(`Cases: ${cases.length}\n`);

  const requests = [
    { type: 'INSIDER_TRADING', query: 'Form 4 insider transactions', reason: 'Insider patterns', expected_impact: 'HIGH' },
    { type: 'CUSTOMER_CONCENTRATION', query: 'Customer concentration risk', reason: 'Revenue dependency', expected_impact: 'MEDIUM' },
    { type: 'MANAGEMENT', query: 'Executive changes', reason: 'Management stability', expected_impact: 'MEDIUM' },
  ];

  const results = [];
  let ok = 0, insiderFound = 0, custFound = 0, mgmtFound = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`\r  [${i + 1}/${cases.length}] ${c.ticker} — insider=${insiderFound} cust=${custFound} mgmt=${mgmtFound}    `);

    try {
      const data = await fetchAllRequests(requests, c.ticker, c.cik, c.entry_date, '');

      const insiderResult = data.find(d => d.request_type === 'INSIDER_TRADING');
      const custResult = data.find(d => d.request_type === 'CUSTOMER_CONCENTRATION');
      const mgmtResult = data.find(d => d.request_type === 'MANAGEMENT');

      if (insiderResult?.data_found) insiderFound++;
      if (custResult?.data_found) custFound++;
      if (mgmtResult?.data_found) mgmtFound++;

      // Get prior baseline trajectory
      const prior = priorMap[c.case_id];

      results.push({
        case_id: c.case_id,
        ticker: c.ticker,
        cik: c.cik,
        sector: c.sector,
        entry_date: c.entry_date,
        classification: c.classification,
        alpha_3yr: c.alpha_3yr,
        forward_return_3yr: c.forward_return_3yr,
        prior_baseline_trajectory: prior?.classification, // from prior test
        phase2_data: data.map(d => ({
          type: d.request_type,
          data_found: d.data_found,
          summary: d.summary?.slice(0, 600) || 'No data',
          insider_data: d.insider_data || null,
        })),
      });
      ok++;
    } catch (e) {
      results.push({ case_id: c.case_id, ticker: c.ticker, error: e.message, phase2_data: [] });
    }
  }

  console.log(`\n\n  Phase 2 complete: ${ok} ok`);
  console.log(`  Insider (with actual buy/sell): ${insiderFound}/${cases.length} (${(insiderFound/cases.length*100).toFixed(0)}%)`);
  console.log(`  Customer concentration: ${custFound}/${cases.length} (${(custFound/cases.length*100).toFixed(0)}%)`);
  console.log(`  Management proxy: ${mgmtFound}/${cases.length} (${(mgmtFound/cases.length*100).toFixed(0)}%)`);

  // Insider signal standalone test
  console.log('\n── INSIDER NET DIRECTION AS STANDALONE SIGNAL ──\n');
  const withInsider = results.filter(r => {
    const ins = r.phase2_data?.find(d => d.type === 'INSIDER_TRADING');
    return ins?.insider_data?.net_direction && (r.classification === 'winner' || r.classification === 'trap');
  });

  if (withInsider.length >= 20) {
    const insiderScores = withInsider.map(r => {
      const ins = r.phase2_data.find(d => d.type === 'INSIDER_TRADING').insider_data;
      if (ins.net_direction === 'NET_BUYING') return 1;
      if (ins.net_direction === 'NET_SELLING') return -1;
      return 0;
    });
    const outcomes = withInsider.map(r => r.classification === 'winner' ? 1 : -1);

    // Spearman
    function assignRanks(arr) {
      const n = arr.length;
      const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const ranks = new Array(n);
      let ii = 0;
      while (ii < n) { let j = ii; while (j < n - 1 && idx[j + 1].v === idx[j].v) j++; const avg = (ii + 1 + j + 1) / 2; for (let k = ii; k <= j; k++) ranks[idx[k].i] = avg; ii = j + 1; }
      return ranks;
    }
    const n = insiderScores.length;
    const rx = assignRanks(insiderScores), ry = assignRanks(outcomes);
    let sumD2 = 0;
    for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
    const r = 1 - (6 * sumD2) / (n * (n * n - 1));
    console.log(`  Insider net direction r = ${r.toFixed(4)} (n=${n})`);

    // Win rates
    const buying = withInsider.filter(r => r.phase2_data.find(d => d.type === 'INSIDER_TRADING').insider_data.net_direction === 'NET_BUYING');
    const selling = withInsider.filter(r => r.phase2_data.find(d => d.type === 'INSIDER_TRADING').insider_data.net_direction === 'NET_SELLING');
    const mixed = withInsider.filter(r => r.phase2_data.find(d => d.type === 'INSIDER_TRADING').insider_data.net_direction === 'MIXED');

    for (const [label, group] of [['NET_BUYING', buying], ['NET_SELLING', selling], ['MIXED', mixed]]) {
      if (group.length === 0) continue;
      const wins = group.filter(g => g.classification === 'winner').length;
      console.log(`  ${label.padEnd(14)} n=${group.length.toString().padStart(3)} win rate=${(wins/group.length*100).toFixed(1)}%`);
    }
  }

  // Save Phase 2 results
  writeFileSync(join(TEST_DIR, 'phase2-results.json'), JSON.stringify(results, null, 2));

  // Prepare Phase 3 batches
  const batchSize = 5;
  for (let i = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize).map(c => ({
      case_id: c.case_id, cik: c.cik, sector: c.sector, entry_date: c.entry_date,
      enrichment_data: c.phase2_data || [],
    }));
    writeFileSync(join(TEST_DIR, `batch-${String(Math.floor(i / batchSize)).padStart(3, '0')}.json`), JSON.stringify(batch, null, 2));
  }

  console.log(`\n  Batches prepared: ${Math.ceil(results.length / batchSize)}`);
  writeFileSync(join(TEST_DIR, 'case-list.json'), JSON.stringify(results.map(r => ({
    case_id: r.case_id, ticker: r.ticker, cik: r.cik, classification: r.classification,
    alpha_3yr: r.alpha_3yr, forward_return_3yr: r.forward_return_3yr,
  })), null, 2));
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
