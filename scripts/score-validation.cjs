#!/usr/bin/env node
// Score validation set results for the top BUY×SELL pairs
// Compares to training performance to detect overfitting

const fs = require('fs');
const path = require('path');

const OPT_DIR = path.resolve(__dirname, '../data/prompt-optimization');
const RESULTS_DIR = path.join(OPT_DIR, 'eval-results');
const PARTITION = process.argv[2] || 'validation'; // 'validation' or 'holdout'

// Load cases
const casesFile = PARTITION === 'holdout' ? 'holdout-cases.json' : 'validation-cases.json';
const cases = JSON.parse(fs.readFileSync(path.join(OPT_DIR, casesFile)));
const caseMap = {};
for (const c of cases) caseMap[c.case_id] = c;

// Load batch results
const allResults = {};
const prefix = PARTITION === 'holdout' ? 'holdout' : 'val';
for (let i = 0; i < 10; i++) {
  const f = path.join(RESULTS_DIR, `${prefix}_batch_${i}.json`);
  if (!fs.existsSync(f)) continue;
  const batch = JSON.parse(fs.readFileSync(f));
  const results = batch.results || batch;
  for (const [caseId, evals] of Object.entries(results)) {
    allResults[caseId] = evals;
  }
}

console.log(`${PARTITION.toUpperCase()} SET: ${Object.keys(allResults).length}/${cases.length} cases evaluated\n`);
if (Object.keys(allResults).length === 0) { console.log('No results.'); process.exit(0); }

// Decision functions
function buyDecision(variant, result) {
  if (!result) return null;
  const a = (result.assessment || '').toLowerCase();
  if (variant === 'buy_v4_confession') return a === 'temporary_dislocation' ? 'buy' : 'reject';
  if (variant === 'buy_v10_confession_minimal') return a === 'temporary' ? 'buy' : 'reject';
  return null;
}

function sellDecision(variant, result) {
  if (!result) return null;
  const action = (result.action || '').toLowerCase();
  if (variant === 'sell_v6_confession_count') return action || ((result.new_confession_count || 0) >= 2 ? 'sell' : 'hold');
  if (variant === 'sell_v8_minimal_confession') return action || (result.new_confessions ? 'sell' : 'hold');
  if (variant === 'sell_v3_new_confessions') return action || (result.new_confessions_found ? 'sell' : 'hold');
  return null;
}

function mean(arr) { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function pct(v) { return (v * 100).toFixed(1); }

const BUY_VARIANTS = ['buy_v4_confession', 'buy_v10_confession_minimal'];
const SELL_VARIANTS = ['sell_v3_new_confessions', 'sell_v6_confession_count', 'sell_v8_minimal_confession'];
const meanVOO = mean(Object.values(caseMap).map(c => c.sp500_return_3yr));

console.log(`Cases: ${Object.keys(allResults).length}, Winners: ${Object.values(caseMap).filter(c => c.binary_outcome === 'winner').length}, Traps: ${Object.values(caseMap).filter(c => c.binary_outcome === 'trap').length}`);
console.log(`Mean VOO return: ${pct(meanVOO)}%\n`);

// Score each BUY variant
for (const bv of BUY_VARIANTS) {
  let total = 0, passed = 0, winnersPassed = 0, trapsPassed = 0;
  for (const [caseId, evals] of Object.entries(allResults)) {
    const result = evals?.buy?.[bv];
    const outcome = caseMap[caseId];
    if (!outcome || !result) continue;
    const d = buyDecision(bv, result);
    if (!d) continue;
    total++;
    if (d === 'buy') {
      passed++;
      if (outcome.binary_outcome === 'winner') winnersPassed++;
      else trapsPassed++;
    }
  }
  console.log(`${bv}: ${total} cases, pass=${pct(passed/total)}%, precision=${pct(passed > 0 ? winnersPassed/passed : 0)}% (${winnersPassed}W/${trapsPassed}T passed)`);
}

// Score each SELL variant
console.log('');
for (const sv of SELL_VARIANTS) {
  let total = 0, sells = 0, truePos = 0, falsePos = 0;
  for (const [caseId, evals] of Object.entries(allResults)) {
    const result = evals?.sell?.[sv];
    const outcome = caseMap[caseId];
    if (!outcome || !result) continue;
    const d = sellDecision(sv, result);
    if (!d) continue;
    total++;
    if (d === 'sell') {
      sells++;
      if (outcome.binary_outcome !== 'winner') truePos++;
      else falsePos++;
    }
  }
  console.log(`${sv}: ${total} cases, sellRate=${pct(sells/total)}%, truePos=${pct(sells > 0 ? truePos/sells : 0)}%, falsePos=${pct(sells > 0 ? falsePos/sells : 0)}%`);
}

// Portfolio simulation for key pairs
console.log('\n=== PORTFOLIO SIMULATION ===\n');
const pairs = [];

for (const bv of BUY_VARIANTS) {
  // BUY only
  const buyOnlyReturns = [];
  for (const [caseId, evals] of Object.entries(allResults)) {
    const outcome = caseMap[caseId];
    if (!outcome || !evals?.buy?.[bv]) continue;
    const bd = buyDecision(bv, evals.buy[bv]);
    if (!bd) continue;
    buyOnlyReturns.push(bd === 'buy' ? outcome.return_3yr : outcome.sp500_return_3yr);
  }
  pairs.push({ buy: bv, sell: 'NONE', return: mean(buyOnlyReturns), alpha: mean(buyOnlyReturns) - meanVOO, n: buyOnlyReturns.length });

  for (const sv of SELL_VARIANTS) {
    const returns = [];
    for (const [caseId, evals] of Object.entries(allResults)) {
      const outcome = caseMap[caseId];
      if (!outcome || !evals?.buy?.[bv]) continue;
      const bd = buyDecision(bv, evals.buy[bv]);
      if (!bd) continue;
      if (bd === 'reject') {
        returns.push(outcome.sp500_return_3yr);
      } else {
        const sellResult = evals?.sell?.[sv];
        const sd = sellResult ? sellDecision(sv, sellResult) : 'hold';
        if (sd === 'sell') {
          returns.push(outcome.return_3yr * 0.4 + outcome.sp500_return_3yr * 0.6);
        } else {
          returns.push(outcome.return_3yr);
        }
      }
    }
    pairs.push({ buy: bv, sell: sv, return: mean(returns), alpha: mean(returns) - meanVOO, n: returns.length });
  }
}

// No-filter baseline
const noFilterReturns = Object.values(caseMap).map(c => c.return_3yr);
pairs.push({ buy: 'NO_FILTER', sell: 'NONE', return: mean(noFilterReturns), alpha: mean(noFilterReturns) - meanVOO, n: noFilterReturns.length });

pairs.sort((a, b) => b.alpha - a.alpha);

console.log(`${'BUY'.padEnd(30)} | ${'SELL'.padEnd(25)} | Return   | Alpha   | N`);
console.log('-'.repeat(90));
for (const p of pairs) {
  console.log(`${p.buy.padEnd(30)} | ${p.sell.padEnd(25)} | ${pct(p.return).padStart(7)}% | ${pct(p.alpha).padStart(6)}% | ${p.n}`);
}

// Save results
const output = {
  partition: PARTITION,
  timestamp: new Date().toISOString(),
  cases_evaluated: Object.keys(allResults).length,
  total_cases: cases.length,
  mean_voo: meanVOO,
  pair_results: pairs,
};
fs.writeFileSync(path.join(OPT_DIR, `${PARTITION}-results.json`), JSON.stringify(output, null, 2));
console.log(`\nSaved to ${PARTITION}-results.json`);
