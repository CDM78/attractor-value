#!/usr/bin/env node
// Attractor Analysis Trap Test Harness
//
// Runs 6 known trap/failure cases through the live attractor analysis
// endpoint and compares results against expected failure modes.
//
// Usage:
//   node scripts/attractor-trap-harness.js [--dry-run] [--ticker INTC]
//
// The 6 test cases:
//   INTC  — Competitive collapse (lost process leadership to TSMC/AMD)
//   M     — Secular disruption (e-commerce destroying department stores)
//   WBA   — Competitive erosion (pharmacy reimbursement pressure, Amazon threat)
//   WFC   — Regulatory/governance risk (fake accounts scandal, consent orders)
//   T     — Capital misallocation (DirecTV/TimeWarner destroyers, debt spiral)
//   KHC   — Acquisition integration failure (3G Capital cost-cutting exhaustion)
//
// Expected outcomes:
//   - Bear case should identify the specific risk that destroyed the stock
//   - Composite attractor score should be <3.5 (transitional or dissolving)
//   - Secular disruption module should flag relevant indicators for M, INTC

const BASE_URL = process.env.AV_API_URL || 'https://odieseyeball.com';

const TRAP_CASES = [
  {
    ticker: 'INTC',
    expected_failure: 'Competitive collapse — lost process node leadership to TSMC, AMD took market share',
    expected_max_score: 3.0,
    expected_disruption: true,
    expected_red_flags: ['process technology', 'foundry', 'AMD', 'TSMC'],
  },
  {
    ticker: 'M',
    expected_failure: 'Secular disruption — e-commerce destroying brick-and-mortar retail',
    expected_max_score: 2.5,
    expected_disruption: true,
    expected_red_flags: ['e-commerce', 'Amazon', 'foot traffic', 'mall'],
  },
  {
    ticker: 'WBA',
    expected_failure: 'Competitive erosion — pharmacy reimbursement pressure, PBM consolidation, Amazon Pharmacy',
    expected_max_score: 3.0,
    expected_disruption: false,
    expected_red_flags: ['reimbursement', 'PBM', 'Amazon', 'margin pressure'],
  },
  {
    ticker: 'WFC',
    expected_failure: 'Regulatory/governance — fake accounts scandal, asset cap, consent orders',
    expected_max_score: 3.0,
    expected_disruption: false,
    expected_red_flags: ['scandal', 'regulatory', 'consent order', 'asset cap', 'governance'],
  },
  {
    ticker: 'T',
    expected_failure: 'Capital misallocation — DirecTV and TimeWarner acquisitions destroyed value, massive debt',
    expected_max_score: 3.0,
    expected_disruption: true,
    expected_red_flags: ['DirecTV', 'TimeWarner', 'debt', 'acquisition', 'cord-cutting'],
  },
  {
    ticker: 'KHC',
    expected_failure: 'Acquisition integration failure — 3G Capital cost-cutting exhausted, brand erosion',
    expected_max_score: 3.0,
    expected_disruption: false,
    expected_red_flags: ['3G', 'cost-cutting', 'brand', 'goodwill', 'writedown'],
  },
];

async function runAnalysis(ticker) {
  const url = `${BASE_URL}/api/analyze?ticker=${ticker}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analysis failed for ${ticker}: ${res.status} ${text}`);
  }
  return res.json();
}

async function getStoredAnalysis(ticker) {
  const url = `${BASE_URL}/api/analyze?ticker=${ticker}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) return null;
  return res.json();
}

function checkRedFlags(analysisText, expectedFlags) {
  if (!analysisText) return { found: [], missed: expectedFlags };
  const lower = analysisText.toLowerCase();
  const found = expectedFlags.filter(f => lower.includes(f.toLowerCase()));
  const missed = expectedFlags.filter(f => !lower.includes(f.toLowerCase()));
  return { found, missed };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleTicker = args.find((a, i) => args[i - 1] === '--ticker');
  const cases = singleTicker
    ? TRAP_CASES.filter(c => c.ticker === singleTicker.toUpperCase())
    : TRAP_CASES;

  if (cases.length === 0) {
    console.error(`Unknown ticker: ${singleTicker}`);
    process.exit(1);
  }

  console.log(`\n=== Attractor Trap Test Harness ===`);
  console.log(`Testing ${cases.length} known trap cases against ${BASE_URL}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (using stored analyses)' : 'LIVE (running new analyses ~$0.03 each)'}\n`);

  const results = [];

  for (const tc of cases) {
    console.log(`--- ${tc.ticker}: ${tc.expected_failure.split('—')[0].trim()} ---`);

    let analysis;
    try {
      if (dryRun) {
        analysis = await getStoredAnalysis(tc.ticker);
        if (!analysis) {
          console.log(`  No stored analysis for ${tc.ticker}. Run without --dry-run first.\n`);
          continue;
        }
      } else {
        console.log(`  Running analysis (this takes 10-30s)...`);
        analysis = await runAnalysis(tc.ticker);
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
      results.push({ ticker: tc.ticker, error: err.message });
      continue;
    }

    const score = analysis.attractor_stability_score ?? analysis.adjusted_attractor_score;
    const adjustedScore = analysis.adjusted_attractor_score ?? score;
    const regime = analysis.network_regime;
    const sdClassification = analysis.secular_disruption_classification || 'N/A';

    // Check red flags in analysis text
    const allText = [
      analysis.analysis_text,
      analysis.bull_case_text,
      analysis.bear_case_text,
    ].filter(Boolean).join(' ');
    const flagCheck = checkRedFlags(allText, tc.expected_red_flags);

    // Assess results
    const scorePass = adjustedScore != null && adjustedScore <= tc.expected_max_score;
    const disruptionPass = !tc.expected_disruption || (sdClassification !== 'none' && sdClassification !== 'N/A');
    const flagCoverage = tc.expected_red_flags.length > 0
      ? (flagCheck.found.length / tc.expected_red_flags.length * 100).toFixed(0) + '%'
      : 'N/A';

    console.log(`  Score: ${adjustedScore?.toFixed(1) ?? '?'}/5.0 (expected ≤${tc.expected_max_score}) ${scorePass ? 'PASS' : 'FAIL'}`);
    console.log(`  Regime: ${regime || 'N/A'}`);
    console.log(`  Secular Disruption: ${sdClassification} ${tc.expected_disruption ? (disruptionPass ? 'PASS' : 'FAIL — should flag disruption') : '(not expected)'}`);
    console.log(`  Red Flag Coverage: ${flagCoverage} — found: [${flagCheck.found.join(', ')}]`);
    if (flagCheck.missed.length > 0) {
      console.log(`  Missed flags: [${flagCheck.missed.join(', ')}]`);
    }

    const classification = adjustedScore >= 3.5 ? 'Stable' : adjustedScore >= 2.0 ? 'Transitional' : 'Dissolving';
    console.log(`  Classification: ${classification}`);
    console.log('');

    results.push({
      ticker: tc.ticker,
      expected_failure: tc.expected_failure,
      score: adjustedScore,
      expected_max_score: tc.expected_max_score,
      score_pass: scorePass,
      regime,
      sd_classification: sdClassification,
      disruption_pass: disruptionPass,
      flag_coverage: flagCoverage,
      flags_found: flagCheck.found,
      flags_missed: flagCheck.missed,
      classification,
    });
  }

  // Summary table
  console.log('\n=== Summary ===');
  console.log('Ticker | Score | Expected | Pass | Disruption | Flag Coverage');
  console.log('-------|-------|----------|------|------------|-------------');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.ticker}  | ERROR | — | — | — | ${r.error}`);
      continue;
    }
    console.log(`${r.ticker.padEnd(6)} | ${(r.score?.toFixed(1) ?? '?').padEnd(5)} | ≤${r.expected_max_score}     | ${r.score_pass ? 'PASS' : 'FAIL'} | ${r.disruption_pass ? 'PASS' : 'FAIL'}       | ${r.flag_coverage}`);
  }

  const allPass = results.filter(r => !r.error).every(r => r.score_pass);
  console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAILURES — review bear case quality manually'}`);

  // Save results
  const outPath = `scripts/attractor-trap-results-${new Date().toISOString().split('T')[0]}.json`;
  const fs = require('fs');
  fs.writeFileSync(outPath, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
