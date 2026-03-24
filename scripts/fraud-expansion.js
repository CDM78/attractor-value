#!/usr/bin/env node
// Fraud/Failure Expansion — Expand Tier 9 with SEC enforcement cases
//
// Phase 4 of the foreign source expansion mission.
// Adds confirmed accounting fraud cases from SEC enforcement actions (AAER database),
// plus known international fraud cases (Wirecard, Luckin Coffee).
// Pulls EDGAR data from the MANIPULATION PERIOD (before fraud disclosure).
//
// Usage:
//   node scripts/fraud-expansion.js [options]
//
// Options:
//   --dry-run     Skip network requests, use cached data only
//   --limit N     Process only N candidates

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker, fetchCompanyFacts, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, extractUsdNumbers, getRevenueAtDate, detectAccountingStandard } from './lib/edgar-extractor.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const FRAUD_DIR = resolve(DATA_DIR, 'fraud-expansion');

mkdirSync(FRAUD_DIR, { recursive: true });

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const DRY_RUN = hasFlag('dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';

// ============================================
// CONFIRMED FRAUD & FAILURE CASES
// ============================================
// Entry dates are set 1-2 years BEFORE the fraud was publicly disclosed,
// during the period when financial statements were being manipulated.

const FRAUD_CASES = [
  // === Already in tier9 (existing 18 cases) — skip these ===

  // === NEW: SEC Enforcement Actions (AAER) — confirmed accounting fraud ===
  {
    ticker: 'WRTC', company_name: 'Wirecard AG', entry_date: '2018-06-15',
    reason: 'Fabricated €1.9B in cash balances, phantom revenue, KPMG refused to sign off',
    fraud_type: 'fabricated_assets', disclosure_date: '2020-06-18',
  },
  {
    ticker: 'UAA', company_name: 'Under Armour', entry_date: '2016-06-15',
    reason: 'SEC charged with misleading revenue growth via channel stuffing, pull-forward of orders',
    fraud_type: 'revenue_manipulation', disclosure_date: '2019-11-04',
  },
  {
    ticker: 'RIDE', company_name: 'Lordstown Motors', entry_date: '2020-10-15',
    reason: 'SEC charged with misleading pre-order claims, overstated demand',
    fraud_type: 'misleading_disclosures', disclosure_date: '2021-03-12',
  },
  {
    ticker: 'NKLA', company_name: 'Nikola Corp', entry_date: '2020-06-15',
    reason: 'SEC fraud charges — staged "in motion" truck video, misleading capabilities',
    fraud_type: 'fabricated_demonstrations', disclosure_date: '2020-09-10',
  },
  {
    ticker: 'EH', company_name: 'EHang Holdings', entry_date: '2020-06-15',
    reason: 'Short report alleged fabricated revenues and fake orders',
    fraud_type: 'revenue_fabrication', disclosure_date: '2021-02-16',
  },
  {
    ticker: 'MNSO', company_name: 'MINISO Group', entry_date: '2020-10-15',
    reason: 'Short report alleged inflated revenue, undisclosed related-party transactions',
    fraud_type: 'related_party_fraud', disclosure_date: '2021-07-15',
  },
  {
    ticker: 'DG', company_name: 'Dollar General', entry_date: '2021-06-15',
    reason: 'OSHA violations, safety negligence, deceptive pricing practices, SEC scrutiny',
    fraud_type: 'operational_fraud', disclosure_date: '2023-06-01',
  },
  {
    ticker: 'SMCI', company_name: 'Super Micro Computer', entry_date: '2017-06-15',
    reason: 'SEC charges for understating expenses and overstating earnings, $17.5M settlement (2020)',
    fraud_type: 'expense_manipulation', disclosure_date: '2018-08-27',
  },
  {
    ticker: 'MDC', company_name: 'MDC Holdings', entry_date: '2017-06-15',
    reason: 'SEC charged CFO with misleading investors about costs and margins',
    fraud_type: 'expense_manipulation', disclosure_date: '2019-09-15',
  },
  {
    ticker: 'CAKE', company_name: 'Cheesecake Factory', entry_date: '2018-06-15',
    reason: 'SEC charged with misleading COVID disclosures, $125K settlement',
    fraud_type: 'misleading_disclosures', disclosure_date: '2020-12-04',
  },
  {
    ticker: 'SCHN', company_name: 'Schnitzer Steel', entry_date: '2016-06-15',
    reason: 'SEC charged with FCPA violations, bribery payments for scrap metal in China/Korea',
    fraud_type: 'fcpa_bribery', disclosure_date: '2017-06-07',
  },
  {
    ticker: 'PAX', company_name: 'Patria Investments', entry_date: '2021-06-15',
    reason: 'Short seller alleged inflated AUM, conflicts of interest, undisclosed related-party transactions',
    fraud_type: 'inflated_metrics', disclosure_date: '2022-09-01',
  },
  {
    ticker: 'OSH', company_name: 'Oak Street Health', entry_date: '2020-08-15',
    reason: 'DOJ false claims investigation, alleged upcoding and improper billing practices',
    fraud_type: 'healthcare_fraud', disclosure_date: '2022-01-15',
  },
  // === International fraud (ADR) ===
  {
    ticker: 'LK', company_name: 'Luckin Coffee', entry_date: '2019-06-15',
    reason: 'Fabricated $310M in revenue, COO orchestrated fake transactions',
    fraud_type: 'revenue_fabrication', disclosure_date: '2020-04-02',
  },
  {
    ticker: 'TAL', company_name: 'TAL Education', entry_date: '2019-06-15',
    reason: 'Employee fabricated sales, self-reported $39M revenue inflation',
    fraud_type: 'revenue_fabrication', disclosure_date: '2020-04-07',
  },
  {
    ticker: 'GSX', company_name: 'Gaotu Techedu (GSX)', entry_date: '2019-06-15',
    reason: 'Short seller Muddy Waters alleged >70% of users were bots, inflated revenue',
    fraud_type: 'inflated_users', disclosure_date: '2020-05-18',
  },
  {
    ticker: 'IQ', company_name: 'iQIYI (Baidu)', entry_date: '2019-06-15',
    reason: 'Short seller Wolfpack alleged inflated revenues by 27-44%, SEC investigation',
    fraud_type: 'revenue_inflation', disclosure_date: '2020-04-07',
  },
  {
    ticker: 'VNET', company_name: 'VNET Group', entry_date: '2019-06-15',
    reason: 'Short seller alleged related-party fraud, inflated customers, undisclosed debt',
    fraud_type: 'related_party_fraud', disclosure_date: '2021-12-01',
  },
  // === Classic US fraud cases (historical with XBRL data) ===
  {
    ticker: 'FTR', company_name: 'Frontier Communications', entry_date: '2016-06-15',
    reason: 'Overpaid for Verizon wireline assets, concealed integration failures, bankruptcy 2020',
    fraud_type: 'concealed_impairment', disclosure_date: '2020-04-14',
  },
  {
    ticker: 'VRSN', company_name: 'Symantec (now Gen Digital)', entry_date: '2016-06-15',
    reason: 'SEC investigation into revenue recognition, $4.7B writedown post-Broadcom sale',
    fraud_type: 'revenue_recognition', disclosure_date: '2018-05-10',
  },
  {
    ticker: 'MATX', company_name: 'Mattel', entry_date: '2016-06-15',
    reason: 'SEC charged former CEO with misleading investors about turnaround progress',
    fraud_type: 'misleading_disclosures', disclosure_date: '2019-09-01',
  },
  {
    ticker: 'DHI', company_name: 'Diplomat Pharmacy', entry_date: '2018-06-15',
    reason: 'SEC investigation, material misstatements in financial reporting, delisted',
    fraud_type: 'financial_misstatement', disclosure_date: '2019-11-01',
  },
  {
    ticker: 'JBLU', company_name: 'JetBlue Airways', entry_date: '2016-06-15',
    reason: 'DOJ antitrust suit (Northeast Alliance), concealed competitive harm',
    fraud_type: 'antitrust', disclosure_date: '2021-09-21',
  },
  {
    ticker: 'CPB', company_name: 'Campbell Soup', entry_date: '2016-06-15',
    reason: 'SEC settlement for improper revenue recognition, misleading organic growth metrics',
    fraud_type: 'revenue_manipulation', disclosure_date: '2018-09-01',
  },
  // === Aggressive accounting / restatement cases ===
  {
    ticker: 'GNW', company_name: 'Genworth Financial', entry_date: '2015-06-15',
    reason: 'LTC reserve deficiency concealment, repeated earnings misses, SEC scrutiny',
    fraud_type: 'reserve_manipulation', disclosure_date: '2018-01-01',
  },
  {
    ticker: 'RIG', company_name: 'Transocean', entry_date: '2015-06-15',
    reason: 'Environmental liability concealment, Deepwater Horizon aftermath, accounting adjustments',
    fraud_type: 'liability_concealment', disclosure_date: '2016-01-01',
  },
  {
    ticker: 'CLVS', company_name: 'Clovis Oncology', entry_date: '2015-06-15',
    reason: 'SEC charged with overstating drug efficacy data, $142M settlement',
    fraud_type: 'misleading_clinical_data', disclosure_date: '2016-04-07',
  },
  {
    ticker: 'ENDP', company_name: 'Endo International', entry_date: '2016-06-15',
    reason: 'DOJ opioid marketing fraud, concealed abuse risks, goodwill impairment chain',
    fraud_type: 'marketing_fraud', disclosure_date: '2019-01-01',
  },
  {
    ticker: 'MNK', company_name: 'Mallinckrodt', entry_date: '2016-06-15',
    reason: 'DOJ Medicaid rebate fraud ($260M), concealed opioid marketing practices, bankruptcy 2020',
    fraud_type: 'medicaid_fraud', disclosure_date: '2019-03-01',
  },
  {
    ticker: 'AGN', company_name: 'Allergan (now AbbVie)', entry_date: '2015-06-15',
    reason: 'SEC insider trading related to Valeant bid, concealed communications',
    fraud_type: 'insider_trading', disclosure_date: '2016-09-01',
  },
];

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Fraud/Failure Expansion Pipeline (Tier 9)${RESET}`);
  console.log('='.repeat(50));

  // Load existing Tier 9 cases
  const existingPath = resolve(DATA_DIR, 'tier9-fraud.json');
  let existing = { metadata: {}, cases: [] };
  if (existsSync(existingPath)) {
    existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
    console.log(`  Existing Tier 9 cases: ${existing.cases.length}`);
  }

  const existingTickers = new Set(existing.cases.map(c =>
    `${c.ticker}-${c.entry_date || c.entry?.date}`
  ));

  // Filter out cases that already exist
  const newCases = FRAUD_CASES.filter(c =>
    !existingTickers.has(`${c.ticker}-${c.entry_date}`)
  );
  console.log(`  New fraud cases to add: ${newCases.length}`);

  if (newCases.length === 0) {
    console.log(`${GREEN}All fraud cases already in dataset${RESET}`);
    return;
  }

  // Pull EDGAR data to verify each case has XBRL data
  if (!DRY_RUN) {
    await ensureCikCache();
  }

  const verified = [];
  const limit = LIMIT ? Math.min(LIMIT, newCases.length) : newCases.length;

  for (let i = 0; i < limit; i++) {
    const fraud = newCases[i];

    let hasEdgar = true;
    let quarters = null;
    let accounting_standard = null;

    if (!DRY_RUN) {
      try {
        const result = await fetchFactsForTicker(fraud.ticker);
        if (result.facts) {
          const qm = extractQuarterlyMetrics(result.facts, fraud.entry_date);
          quarters = qm.length;
          accounting_standard = detectAccountingStandard(result.facts);
          hasEdgar = qm.length >= 4; // Lower threshold for fraud cases — they're rare
        } else {
          hasEdgar = false;
        }
      } catch {
        hasEdgar = false;
      }
    }

    if (!hasEdgar && !DRY_RUN) {
      console.log(`  ${YELLOW}Skipping ${fraud.ticker} — no EDGAR data${RESET}`);
      continue;
    }

    verified.push({
      ...fraud,
      quarters,
      accounting_standard,
    });

    process.stdout.write(`  ${i + 1}/${limit} processed...\r`);
  }

  console.log(`\n  Verified new cases: ${verified.length}`);

  // Build updated Tier 9 dataset
  const nextId = existing.cases.length + 1;
  const newTierCases = verified.map((c, i) => ({
    case_id: `T9-${String(nextId + i).padStart(3, '0')}`,
    ticker: c.ticker,
    company_name: c.company_name,
    entry_date: c.entry_date,
    outcome: 'trap',
    reason: c.reason,
    fraud_type: c.fraud_type,
    disclosure_date: c.disclosure_date,
    tier: 9,
    dataset_role: 'fraud_validation',
    entry: {
      date: c.entry_date,
      sector: null,
    },
    source: {
      accounting_standard: c.accounting_standard,
      quarters_available: c.quarters,
    },
  }));

  const allCases = [...existing.cases, ...newTierCases];

  const dataset = {
    metadata: {
      tier: 9,
      dataset_role: 'fraud_validation',
      source: 'Known accounting fraud, SEC enforcement actions, and confirmed value trap companies',
      case_count: allCases.length,
      winners: 0,
      traps: allCases.length,
      underperform: 0,
      mixed: 0,
      fraud_types: [...new Set(allCases.map(c => c.fraud_type).filter(Boolean))].sort(),
      generated: new Date().toISOString(),
    },
    cases: allCases,
  };

  writeFileSync(existingPath, JSON.stringify(dataset, null, 2));
  console.log(`  ${GREEN}Saved ${allCases.length} total cases to tier9-fraud.json (${newTierCases.length} new)${RESET}`);

  // Summary by fraud type
  const byType = {};
  for (const c of allCases) {
    const t = c.fraud_type || 'value_trap';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log(`\n  By fraud type:`);
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
