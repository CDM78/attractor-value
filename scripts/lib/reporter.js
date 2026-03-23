// Console report formatting and JSON output for Benford calibration tests.

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../../data');

// ============================================
// CONSOLE FORMATTING
// ============================================
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function colorConformity(c) {
  if (c === 'close') return `${GREEN}${c}${RESET}`;
  if (c === 'acceptable') return `${GREEN}${c}${RESET}`;
  if (c === 'marginal') return `${YELLOW}${c}${RESET}`;
  if (c === 'non-conforming') return `${RED}${c}${RESET}`;
  if (c === 'near-uniform') return `${GREEN}${c}${RESET}`;
  if (c === 'deviating') return `${YELLOW}${c}${RESET}`;
  return c;
}

function pad(s, w, align = 'right') {
  s = String(s);
  if (align === 'left') return s.padEnd(w);
  return s.padStart(w);
}

function fmtPct(v, decimals = 1) {
  return (v * 100).toFixed(decimals) + '%';
}

function fmtNum(v, decimals = 4) {
  if (v === null || v === undefined) return 'N/A';
  return v.toFixed(decimals);
}

export function printHeader(title) {
  console.log('');
  console.log(`${BOLD}${CYAN}${'='.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}${title}${RESET}`);
  console.log(`${BOLD}${CYAN}${'='.repeat(60)}${RESET}`);
}

export function printSubHeader(title) {
  console.log('');
  console.log(`${BOLD}${title}${RESET}`);
  console.log(`${DIM}${'-'.repeat(50)}${RESET}`);
}

// ============================================
// TEST 1: AGGREGATE BASELINE REPORT
// ============================================
export function reportTest1(results) {
  printHeader('Test 1: Aggregate Baseline — Do Financial Statements Follow Benford?');
  console.log(`  Total data points: ${results.totalPoints.toLocaleString()}`);
  console.log('');

  // Summary table
  console.log('  Aggregate Results:');
  console.log(`  ${''.padEnd(18)}| ${'KLD'.padStart(8)} | ${'MAD'.padStart(8)} | ${'Chi-Sq'.padStart(8)} | Conformity`);
  console.log(`  ${''.padEnd(18)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(16)}`);

  for (const [label, test] of [
    ['First digit', results.firstDigit],
    ['Second digit', results.secondDigit],
    ['First-two digit', results.firstTwoDigits],
    ['Third digit', results.thirdDigit],
  ]) {
    if (!test) {
      console.log(`  ${pad(label, 18, 'left')}| ${'N/A'.padStart(8)} | ${'N/A'.padStart(8)} | ${'N/A'.padStart(8)} | insufficient data`);
      continue;
    }
    console.log(`  ${pad(label, 18, 'left')}| ${fmtNum(test.kld).padStart(8)} | ${fmtNum(test.mad).padStart(8)} | ${fmtNum(test.chiSq, 1).padStart(8)} | ${colorConformity(test.conformity)}`);
  }

  // First digit distribution
  if (results.firstDigit) {
    console.log('');
    console.log('  First digit distribution vs expected:');
    console.log(`    ${'Digit'.padEnd(7)}| ${'Observed'.padStart(9)} | ${'Expected'.padStart(9)} | Deviation`);
    for (const d of results.firstDigit.digitDeviations) {
      console.log(`    ${pad(d.bin, 5, 'left')}  | ${fmtPct(d.observed).padStart(9)} | ${fmtPct(d.expected).padStart(9)} | ${(d.deviation >= 0 ? '+' : '') + fmtPct(d.deviation)}`);
    }
  }

  // Convergence
  if (results.convergence) {
    const c = results.convergence;
    console.log('');
    console.log('  Convergence profile:');
    console.log(`    D1 KLD from uniform: ${fmtNum(c.d1_uniformKLD)} (expected ~0.11)`);
    console.log(`    D2 KLD from uniform: ${fmtNum(c.d2_uniformKLD)} (expected ~0.003)`);
    console.log(`    D3 KLD from uniform: ${c.d3_uniformKLD !== null ? fmtNum(c.d3_uniformKLD) : 'N/A'} (expected <0.001)`);
    console.log(`    Convergence ratio (D2/D1): ${fmtNum(c.convergenceRatio, 3)} (expected << 1)`);
  }

  const pass = results.firstDigit &&
    (results.firstDigit.conformity === 'close' || results.firstDigit.conformity === 'acceptable');
  console.log('');
  console.log(`  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);
  return pass;
}

// ============================================
// TEST 2: FRAUD AND DATA QUALITY
// ============================================
export function reportTest2(results) {
  printHeader('Test 2: Fraud and Data Quality Detection');

  // 2A: First-digit conformity by classification
  printSubHeader('2A: First-digit conformity by classification');
  printConformityTable(results.firstDigitByClass, 'first_digit');

  // 2B: First-two-digit
  printSubHeader('2B: First-two-digit conformity by classification');
  printConformityTable(results.firstTwoByClass, 'first_two_digits');

  if (results.thresholdFlags?.length > 0) {
    console.log('');
    console.log('  Top threshold gaming flags:');
    console.log(`    ${'Ticker'.padEnd(8)}| ${'Class'.padEnd(14)}| ${'Pattern'.padEnd(45)}| Z-Score`);
    for (const f of results.thresholdFlags.slice(0, 15)) {
      console.log(`    ${pad(f.ticker, 8, 'left')}| ${pad(f.outcome, 14, 'left')}| ${pad(f.pattern, 45, 'left')}| ${fmtNum(f.zScore, 2)}`);
    }
  }

  // 2C: Multi-test flagged companies
  printSubHeader('2C: Flagged companies — multi-test results');
  if (results.flaggedCompanies?.length > 0) {
    console.log(`    ${'Ticker'.padEnd(8)}| ${'Class'.padEnd(14)}| ${'D1'.padEnd(15)}| ${'D2'.padEnd(15)}| ${'D1D2'.padEnd(15)}| ${'Tests Failed'.padStart(12)} | Confidence`);
    for (const f of results.flaggedCompanies) {
      console.log(`    ${pad(f.ticker, 8, 'left')}| ${pad(f.outcome, 14, 'left')}| ${pad(f.d1Conform, 15, 'left')}| ${pad(f.d2Conform, 15, 'left')}| ${pad(f.d1d2Conform, 15, 'left')}| ${pad(f.testsFailed, 12)} | ${f.confidence}`);
    }
  } else {
    console.log('    No companies flagged across multiple tests.');
  }

  // 2D: Convergence anomalies
  printSubHeader('2D: Convergence anomaly distribution');
  if (results.convergenceAnomalies) {
    const ca = results.convergenceAnomalies;
    console.log(`    ${''.padEnd(22)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
    for (const [flag, counts] of Object.entries(ca)) {
      console.log(`    ${pad(flag, 22, 'left')}| ${pad(counts.winner || 0, 10)} | ${pad(counts.trap || 0, 10)} | ${pad(counts.underperform || 0, 10)}`);
    }
  }
}

function printConformityTable(data, testName) {
  if (!data) { console.log('    Insufficient data'); return; }
  const classes = ['winner', 'trap', 'underperform'];
  const levels = ['close', 'acceptable', 'marginal', 'non-conforming'];

  console.log(`    ${''.padEnd(18)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`    ${''.padEnd(18)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(12)}`);

  for (const level of levels) {
    const row = [level];
    for (const cls of classes) {
      const count = data[cls]?.[level] || 0;
      const total = data[cls]?.total || 1;
      row.push(`${count} (${Math.round(count / total * 100)}%)`);
    }
    console.log(`    ${pad(row[0], 18, 'left')}| ${pad(row[1], 10)} | ${pad(row[2], 10)} | ${pad(row[3], 10)}`);
  }
}

// ============================================
// TEST 3: DISCRIMINATORY POWER
// ============================================
export function reportTest3(results) {
  printHeader('Test 3: Discriminatory Power — Winners vs Traps');

  console.log(`  ${'Test Level'.padEnd(16)}| ${'Win Mean KLD'.padStart(12)} | ${'Trap Mean KLD'.padStart(13)} | ${'Gap'.padStart(8)} | ${'M-W p'.padStart(8)} | ${'Effect r'.padStart(8)}`);
  console.log(`  ${''.padEnd(16)}|${'-'.repeat(14)}|${'-'.repeat(15)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(10)}`);

  for (const [label, r] of Object.entries(results.byTest)) {
    if (!r) continue;
    console.log(`  ${pad(label, 16, 'left')}| ${fmtNum(r.winnerMeanKLD).padStart(12)} | ${fmtNum(r.trapMeanKLD).padStart(13)} | ${fmtNum(r.gap).padStart(8)} | ${fmtNum(r.pValue).padStart(8)} | ${fmtNum(r.effectSizeR, 3).padStart(8)}`);
  }

  if (results.convergenceComparison) {
    const c = results.convergenceComparison;
    console.log('');
    console.log('  Convergence ratio:');
    console.log(`    Winner mean: ${fmtNum(c.winnerMean, 3)}  |  Trap mean: ${fmtNum(c.trapMean, 3)}  |  M-W p: ${fmtNum(c.pValue)}`);
  }

  if (results.bestDiscriminator) {
    console.log('');
    console.log(`  ${BOLD}Best discriminator: ${CYAN}${results.bestDiscriminator}${RESET} (effect size r = ${fmtNum(results.bestEffectSize, 3)})`);
  }
}

// ============================================
// TEST 4: FLYWHEEL FORMATION
// ============================================
export function reportTest4(results) {
  printHeader('Test 4: Flywheel Formation — Improving Conformity as Leading Indicator');
  console.log(`  Cases with sufficient temporal data: ${results.eligibleCases} / ${results.totalCases}`);
  console.log(`  Using: ${results.testUsed}`);
  console.log('');

  console.log(`  ${''.padEnd(40)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`  ${''.padEnd(40)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(12)}`);
  console.log(`  ${'Mean KLD slope (neg = improving)'.padEnd(40)}| ${fmtNum(results.winnerSlope).padStart(10)} | ${fmtNum(results.trapSlope).padStart(10)} | ${fmtNum(results.underperformSlope).padStart(10)}`);
  console.log(`  ${'% with negative slope (improving)'.padEnd(40)}| ${fmtPct(results.winnerPctImproving).padStart(10)} | ${fmtPct(results.trapPctImproving).padStart(10)} | ${fmtPct(results.underperformPctImproving).padStart(10)}`);
  console.log(`  Mann-Whitney on slopes: p = ${fmtNum(results.pValue)}`);

  const pass = results.pValue !== null && results.pValue < 0.1;
  console.log(`  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET} (p = ${fmtNum(results.pValue)})`);
  return pass;
}

// ============================================
// TEST 5: DISSOLUTION WARNING
// ============================================
export function reportTest5(results) {
  printHeader('Test 5: Dissolution Warning — Worsening Conformity Before Collapse');

  console.log(`  Traps with worsening KLD slope: ${results.trapsWorsening} / ${results.totalTraps} (${fmtPct(results.trapsWorseningPct)})`);
  console.log(`  Winners with worsening KLD slope: ${results.winnersWorsening} / ${results.totalWinners} (${fmtPct(results.winnersWorseningPct)})`);
  console.log(`  Gap: ${((results.trapsWorseningPct - results.winnersWorseningPct) * 100).toFixed(0)}pp`);

  const pass = results.trapsWorseningPct > results.winnersWorseningPct;
  console.log(`  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);
  return pass;
}

// ============================================
// TEST 7: SECTOR-LEVEL
// ============================================
export function reportTest7(results) {
  printHeader('Test 7: Sector-Level Regime Detection');
  console.log(`  Sectors with data: ${results.sectors?.length || 0}`);
  console.log('');

  if (results.sectors) {
    console.log(`  ${'Sector'.padEnd(24)}| ${'Cos'.padStart(4)} | ${'Points'.padStart(8)} | ${'D1 KLD'.padStart(8)} | ${'D1D2 KLD'.padStart(9)} | ${'Conv R'.padStart(7)} | D1 Conform`);
    console.log(`  ${''.padEnd(24)}|${'-'.repeat(6)}|${'-'.repeat(10)}|${'-'.repeat(10)}|${'-'.repeat(11)}|${'-'.repeat(9)}|${'-'.repeat(16)}`);
    for (const s of results.sectors) {
      console.log(`  ${pad(s.name, 24, 'left')}| ${pad(s.companies, 4)} | ${pad(s.points?.toLocaleString(), 8)} | ${fmtNum(s.d1KLD).padStart(8)} | ${(s.d1d2KLD !== null ? fmtNum(s.d1d2KLD) : 'N/A').padStart(9)} | ${(s.convRatio !== null ? fmtNum(s.convRatio, 3) : 'N/A').padStart(7)} | ${colorConformity(s.d1Conformity)}`);
    }
  }
}

// ============================================
// TEST 8: GROWTH RUNWAY
// ============================================
export function reportTest8(results) {
  printHeader('Test 8: Order-of-Magnitude Growth Runway');

  console.log(`  ${''.padEnd(40)}| ${'Winners'.padStart(10)} | ${'Traps'.padStart(10)} | ${'Underperf'.padStart(10)}`);
  console.log(`  ${''.padEnd(40)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(12)}`);
  console.log(`  ${'Revenue leading digit 1-3'.padEnd(40)}| ${fmtPct(results.winnerRevLow).padStart(10)} | ${fmtPct(results.trapRevLow).padStart(10)} | ${fmtPct(results.underperformRevLow).padStart(10)}`);
  console.log(`  ${'Revenue leading digit 7-9'.padEnd(40)}| ${fmtPct(results.winnerRevHigh).padStart(10)} | ${fmtPct(results.trapRevHigh).padStart(10)} | ${fmtPct(results.underperformRevHigh).padStart(10)}`);
  console.log(`  ${'Avg leading digit across key metrics'.padEnd(40)}| ${fmtNum(results.winnerAvgDigit, 1).padStart(10)} | ${fmtNum(results.trapAvgDigit, 1).padStart(10)} | ${fmtNum(results.underperformAvgDigit, 1).padStart(10)}`);

  const pass = results.winnerAvgDigit < results.trapAvgDigit;
  console.log(`  ${BOLD}Result: ${pass ? GREEN + 'PASS' : RED + 'FAIL'}${RESET}`);
  return pass;
}

// ============================================
// FINAL SUMMARY
// ============================================
export function reportSummary(allResults) {
  printHeader("BENFORD'S LAW MULTI-DIGIT CALIBRATION RESULTS");

  console.log(`  Data Coverage:`);
  console.log(`    Cases with EDGAR data: ${allResults.coverage.withData} / ${allResults.coverage.total}`);
  console.log(`    Cases with ≥200 points (D1D2 eligible): ${allResults.coverage.d1d2Eligible} / ${allResults.coverage.total}`);
  console.log(`    Cases with 3+ years temporal data: ${allResults.coverage.temporalEligible} / ${allResults.coverage.total}`);
  console.log('');

  const tests = [
    ['Test 1 — Aggregate Baseline', allResults.test1Pass],
    ['Test 2 — Fraud/Data Quality', allResults.test2Summary],
    ['Test 3 — Discriminatory Power', allResults.test3Pass],
    ['Test 4 — Flywheel Formation', allResults.test4Pass],
    ['Test 5 — Dissolution Warning', allResults.test5Pass],
    ['Test 6 — Attractor Correlation', 'DEFERRED'],
    ['Test 7 — Sector Regime Detection', allResults.test7Summary],
    ['Test 8 — Growth Runway', allResults.test8Pass],
  ];

  for (const [name, result] of tests) {
    let status;
    if (result === 'DEFERRED') status = `${DIM}DEFERRED${RESET}`;
    else if (result === true) status = `${GREEN}PASS${RESET}`;
    else if (result === false) status = `${RED}FAIL${RESET}`;
    else status = `${YELLOW}${result}${RESET}`;
    console.log(`  ${pad(name, 42, 'left')}: ${status}`);
  }

  if (allResults.recommendedMetric) {
    console.log('');
    console.log(`  ${BOLD}RECOMMENDED PRIMARY METRIC: ${CYAN}${allResults.recommendedMetric}${RESET}`);
  }
}

// ============================================
// JSON OUTPUT
// ============================================
export function saveResults(results, outputPath) {
  const path = outputPath || resolve(DATA_DIR, `benford-results-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(path, JSON.stringify(results, null, 2));
  console.log(`\n${DIM}Results saved to: ${path}${RESET}`);
  return path;
}
