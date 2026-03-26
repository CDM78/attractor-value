#!/usr/bin/env node
// End-to-end verification of the calibration infrastructure.
// Tests: universe loading, temporal queries, audit trail, analysis functions.

import warehouse from '../warehouse/warehouse.js';
import temporal from '../warehouse/temporal.js';
import universeManager from '../cases/universe-manager.js';
import framework from '../tests/testing-framework.js';

let passed = 0, failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('=== CALIBRATION INFRASTRUCTURE VERIFICATION ===\n');

// ============================================================
// Test 1: Universe loaded correctly
// ============================================================
console.log('Test 1: Universe integrity');

const allIds = universeManager.getAllCaseIds();
assert(allIds.length >= 2800, `Universe has ${allIds.length} cases (expected 2800+)`);

const stats = universeManager.getUniverseStats();
assert(stats.total_cases === allIds.length, `Stats match: ${stats.total_cases} cases`);

const trainingCases = universeManager.getCasesByPartition('training');
const validationCases = universeManager.getCasesByPartition('validation');
const holdoutCases = universeManager.getCasesByPartition('holdout');
assert(trainingCases.length > 0, `Training partition: ${trainingCases.length} cases`);
assert(validationCases.length > 0, `Validation partition: ${validationCases.length} cases`);
assert(holdoutCases.length > 0, `Holdout partition: ${holdoutCases.length} cases`);
assert(
  trainingCases.length + validationCases.length + holdoutCases.length === allIds.length,
  'All cases assigned to exactly one partition'
);

// Check proportions are roughly 40/30/30
const trainPct = trainingCases.length / allIds.length;
const valPct = validationCases.length / allIds.length;
const holdPct = holdoutCases.length / allIds.length;
assert(trainPct > 0.35 && trainPct < 0.45, `Training proportion: ${(trainPct * 100).toFixed(1)}% (target: 40%)`);
assert(valPct > 0.25 && valPct < 0.35, `Validation proportion: ${(valPct * 100).toFixed(1)}% (target: 30%)`);
assert(holdPct > 0.25 && holdPct < 0.35, `Holdout proportion: ${(holdPct * 100).toFixed(1)}% (target: 30%)`);

// ============================================================
// Test 2: Case loading and temporal queries
// ============================================================
console.log('\nTest 2: Temporal integrity');

// Find an AAPL case
const aaplCase = allIds.find(id => {
  const c = temporal.loadCase(id);
  return c.ticker === 'AAPL';
});
assert(!!aaplCase, `Found AAPL case: ${aaplCase}`);

if (aaplCase) {
  const aaplRecord = temporal.loadCase(aaplCase);
  assert(!!aaplRecord.entry_date, `AAPL entry_date: ${aaplRecord.entry_date}`);
  assert(!!aaplRecord.ticker, `AAPL ticker: ${aaplRecord.ticker}`);

  // Query data with temporal enforcement
  const audit = temporal.startAudit('verify-temporal-test');
  const data = temporal.getDataForCase(aaplCase, ['short_interest', '10k_risk_factors'], 'verify-temporal-test');

  // Short interest should exist for AAPL
  const siRecords = data.short_interest || [];
  console.log(`  AAPL short interest records before ${aaplRecord.entry_date}: ${siRecords.length}`);

  // Verify all returned data is before entry date
  let temporalClean = true;
  for (const r of siRecords) {
    if (r.publication_date > aaplRecord.entry_date) {
      temporalClean = false;
      console.error(`  ✗ VIOLATION: ${r.publication_date} > ${aaplRecord.entry_date}`);
    }
  }
  assert(temporalClean, 'All short interest data strictly before entry date');

  const auditReport = temporal.endAudit('verify-temporal-test');
  assert(auditReport.violations === 0, `Audit clean: ${auditReport.violations} violations`);
  assert(auditReport.allDataStrictlyPreEntry, 'Audit confirms all data pre-entry');
}

// ============================================================
// Test 3: Macro data queries
// ============================================================
console.log('\nTest 3: Macro data');

const fredData = warehouse.queryMacroData('fred', 'economic-context', { before: '2018-01-01' });
assert(fredData && Object.keys(fredData).length > 0, `FRED data available before 2018: ${Object.keys(fredData).length} snapshots`);

// Verify temporal filtering on macro data
if (fredData) {
  const dates = Object.keys(fredData);
  const allBefore = dates.every(d => d <= '2018-01-01');
  assert(allBefore, 'All FRED data before cutoff date');
}

const finraData = warehouse.loadMacroData('finra', 'short-interest');
assert(finraData && Object.keys(finraData).length > 0, `FINRA short interest: ${Object.keys(finraData).length} tickers`);

// ============================================================
// Test 4: Warehouse coverage
// ============================================================
console.log('\nTest 4: Warehouse coverage');

const companies = warehouse.listCompanies();
assert(companies.length >= 400, `Warehouse has ${companies.length} companies`);

const coverage = warehouse.getCoverageMatrix();
const companiesWithSI = warehouse.getCompaniesByDataType('short_interest');
assert(companiesWithSI.length > 0, `Companies with short interest: ${companiesWithSI.length}`);

// ============================================================
// Test 5: Analysis functions
// ============================================================
console.log('\nTest 5: Analysis functions');

// Generate synthetic scores to test analysis pipeline
const testScores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const testOutcomes = ['trap', 'trap', 'trap', 'trap', 'trap', 'underperform', 'underperform', 'mixed', 'mixed', 'mixed',
  'mixed', 'underperform', 'winner', 'winner', 'winner', 'winner', 'winner', 'winner', 'winner', 'winner'];

const analysis = framework.analyze(testScores, testOutcomes);
assert(analysis.spearman_r > 0.5, `Spearman r=${analysis.spearman_r?.toFixed(3)} (expected >0.5 for monotonic data)`);
assert(analysis.spearman_p < 0.05, `p-value=${analysis.spearman_p?.toFixed(6)} (significant)`);
assert(analysis.quintile_win_rates.length === 5, `Quintile analysis: ${analysis.quintile_win_rates.length} quintiles`);
assert(
  analysis.quintile_win_rates[4] > analysis.quintile_win_rates[0],
  `Top quintile win rate (${analysis.quintile_win_rates[4]}) > bottom (${analysis.quintile_win_rates[0]})`
);
assert(analysis.cross_validation.folds > 0, `Cross-validation: ${analysis.cross_validation.folds} folds`);

// ============================================================
// Test 6: Coverage report
// ============================================================
console.log('\nTest 6: Coverage report');

const report = universeManager.generateCoverageReport();
assert(report.total_cases >= 2800, `Coverage report: ${report.total_cases} cases`);
assert(Object.keys(report.by_partition).length >= 3, 'Partitions represented');
assert(Object.keys(report.by_outcome).length >= 3, 'Outcomes represented');

// ============================================================
// Test 7: Test registry
// ============================================================
console.log('\nTest 7: Test registry');

// Register a synthetic test
const testResult = framework.registerTest({
  test_id: 'verify-synthetic-001',
  created: new Date().toISOString(),
  description: 'Synthetic verification test',
  prompt_version: 'verify_v1',
  data_types_required: ['short_interest'],
  model: 'none',
  partition_used: 'training',
  cases_evaluated: 20,
  temporal_violations: 0,
  results: {
    spearman_r: analysis.spearman_r,
    spearman_p: analysis.spearman_p,
    quintile_win_rates: analysis.quintile_win_rates,
    cross_validation: analysis.cross_validation,
  },
});
assert(!!testResult, 'Test registered in registry');

const history = framework.getTestHistory();
assert(history.length >= 1, `Registry has ${history.length} test(s)`);

// ============================================================
// Summary
// ============================================================
console.log('\n=== VERIFICATION COMPLETE ===');
console.log(`Passed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);

if (failed > 0) {
  console.error('\n⚠️  Some tests failed — review above');
  process.exit(1);
} else {
  console.log('\n✓ All systems operational. Calibration infrastructure ready for Session 2.');
}
