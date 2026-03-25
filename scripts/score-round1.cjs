#!/usr/bin/env node
// Score Phase 2 Round 1 results: compute metrics for all BUY×SELL pairs
// Loads batch evaluation results, runs portfolio simulation, ranks pairs

const fs = require('fs');
const path = require('path');

const OPT_DIR = path.resolve(__dirname, '../data/prompt-optimization');
const RESULTS_DIR = path.join(OPT_DIR, 'eval-results');

// Load training cases (with outcomes)
const training = JSON.parse(fs.readFileSync(path.join(OPT_DIR, 'training-cases.json')));
const caseMap = {};
for (const c of training) {
  caseMap[c.case_id] = c;
}

// Load all batch results
const allResults = {};
let batchesLoaded = 0;
for (let i = 0; i < 10; i++) {
  const batchFile = path.join(RESULTS_DIR, `round1_batch_${i}.json`);
  if (!fs.existsSync(batchFile)) {
    console.log(`WARNING: Batch ${i} results not found at ${batchFile}`);
    continue;
  }
  const batch = JSON.parse(fs.readFileSync(batchFile));
  const results = batch.results || batch;
  for (const [caseId, evals] of Object.entries(results)) {
    allResults[caseId] = evals;
  }
  batchesLoaded++;
}

console.log(`Loaded ${batchesLoaded}/10 batches, ${Object.keys(allResults).length} cases with results\n`);

if (Object.keys(allResults).length === 0) {
  console.log('No results to score yet. Exiting.');
  process.exit(0);
}

// === BUY VARIANT SCORING ===

const BUY_VARIANTS = [
  'buy_v1_binary', 'buy_v2_character', 'buy_v3_sector_adjusted',
  'buy_v4_confession', 'buy_v5_resolution', 'buy_v6_minimal',
  'buy_v7_quantified', 'buy_v8_forward'
];

const SELL_VARIANTS = [
  'sell_v1_thesis_drift', 'sell_v2_escalation', 'sell_v3_new_confessions',
  'sell_v4_simple', 'sell_v5_exit_urgency'
];

// Determine BUY decision: does this variant say "pass" (buy) or "reject"?
function buyDecision(variant, result) {
  if (!result) return null;

  switch (variant) {
    case 'buy_v1_binary':
      // stable = buy, deteriorating = reject
      return result.assessment === 'stable' ? 'buy' : 'reject';
    case 'buy_v2_character':
      // same_character = buy, new_risk_types = reject
      return (result.assessment === 'same_character' || result.character_changed === false) ? 'buy' : 'reject';
    case 'buy_v3_sector_adjusted':
      // stable or sector_deterioration = buy, company_specific = reject
      return result.assessment === 'company_specific_deterioration' ? 'reject' : 'buy';
    case 'buy_v4_confession':
      // temporary_dislocation = buy, structural_decline = reject
      return result.assessment === 'temporary_dislocation' ? 'buy' : 'reject';
    case 'buy_v5_resolution':
      // improving or stable = buy, deteriorating = reject
      return result.assessment === 'deteriorating' ? 'reject' : 'buy';
    case 'buy_v6_minimal':
      // stable = buy, changing = reject
      return result.assessment === 'stable' ? 'buy' : 'reject';
    case 'buy_v7_quantified':
      // fewer_risks or same = buy, more_risks = reject
      return result.assessment === 'more_risks' ? 'reject' : 'buy';
    case 'buy_v8_forward':
      // improving or stable = buy, worsening = reject
      return result.trajectory === 'worsening' ? 'reject' : 'buy';
    default:
      return null;
  }
}

// Determine SELL decision
function sellDecision(variant, result) {
  if (!result) return null;

  switch (variant) {
    case 'sell_v1_thesis_drift':
      return result.action || (result.thesis_intact === false ? 'sell' : 'hold');
    case 'sell_v2_escalation':
      return result.action || (result.escalated_count > 2 ? 'sell' : 'hold');
    case 'sell_v3_new_confessions':
      return result.action || (result.new_confessions_found ? 'sell' : 'hold');
    case 'sell_v4_simple':
      return result.action || (result.trajectory === 'worse' ? 'sell' : 'hold');
    case 'sell_v5_exit_urgency':
      return result.action || (result.urgency >= 4 ? 'sell' : 'hold');
    default:
      return null;
  }
}

// Score each BUY variant independently
console.log('=== BUY VARIANT SCORES ===\n');
const buyScores = {};

for (const bv of BUY_VARIANTS) {
  let total = 0, passed = 0, winnersPasssed = 0, trapsPasssed = 0;
  let winnersTotal = 0, trapsTotal = 0;
  const decisions = []; // {decision, isWinner, alpha}

  for (const [caseId, evals] of Object.entries(allResults)) {
    const result = evals?.buy?.[bv];
    const outcome = caseMap[caseId];
    if (!outcome || !result) continue;

    const decision = buyDecision(bv, result);
    if (!decision) continue;

    total++;
    const isWinner = outcome.binary_outcome === 'winner';
    if (isWinner) winnersTotal++;
    else trapsTotal++;

    if (decision === 'buy') {
      passed++;
      if (isWinner) winnersPasssed++;
      else trapsPasssed++;
    }

    decisions.push({
      decision: decision === 'buy' ? 1 : 0,
      isWinner: isWinner ? 1 : 0,
      alpha: outcome.alpha,
    });
  }

  const passRate = total > 0 ? passed / total : 0;
  const precision = passed > 0 ? winnersPasssed / passed : 0;

  // Point-biserial correlation between decision and outcome
  const r = pointBiserialR(decisions.map(d => d.decision), decisions.map(d => d.isWinner));

  // Mean alpha of passed vs rejected
  const passedAlphas = decisions.filter(d => d.decision === 1).map(d => d.alpha);
  const rejectedAlphas = decisions.filter(d => d.decision === 0).map(d => d.alpha);
  const meanPassedAlpha = mean(passedAlphas);
  const meanRejectedAlpha = mean(rejectedAlphas);

  buyScores[bv] = {
    total, passed, passRate: (passRate * 100).toFixed(1),
    winnersPasssed, trapsPasssed,
    precision: (precision * 100).toFixed(1),
    r: r.toFixed(3),
    meanPassedAlpha: meanPassedAlpha.toFixed(3),
    meanRejectedAlpha: meanRejectedAlpha.toFixed(3),
    separation: (meanPassedAlpha - meanRejectedAlpha).toFixed(3),
  };

  console.log(`${bv} (${total} cases): pass=${(passRate*100).toFixed(0)}% precision=${(precision*100).toFixed(0)}% r=${r.toFixed(3)} sep=${(meanPassedAlpha-meanRejectedAlpha).toFixed(3)}`);
}

// Score each SELL variant independently
console.log('\n=== SELL VARIANT SCORES ===\n');
const sellScores = {};

for (const sv of SELL_VARIANTS) {
  let total = 0, sells = 0, truePos = 0, falsePos = 0;

  for (const [caseId, evals] of Object.entries(allResults)) {
    const result = evals?.sell?.[sv];
    const outcome = caseMap[caseId];
    if (!outcome || !result) continue;

    const decision = sellDecision(sv, result);
    if (!decision) continue;

    total++;
    const isWinner = outcome.binary_outcome === 'winner';

    if (decision === 'sell') {
      sells++;
      if (!isWinner) truePos++;
      else falsePos++;
    }
  }

  const sellRate = total > 0 ? sells / total : 0;
  const truePosRate = sells > 0 ? truePos / sells : 0;
  const falsePosRate = sells > 0 ? falsePos / sells : 0;

  sellScores[sv] = {
    total, sells,
    sellRate: (sellRate * 100).toFixed(1),
    truePos, falsePos,
    truePosRate: (truePosRate * 100).toFixed(1),
    falsePosRate: (falsePosRate * 100).toFixed(1),
  };

  console.log(`${sv} (${total} cases): sellRate=${(sellRate*100).toFixed(0)}% truePos=${(truePosRate*100).toFixed(0)}% falsePos=${(falsePosRate*100).toFixed(0)}%`);
}

// === PORTFOLIO SIMULATION for BUY×SELL pairs ===
console.log('\n=== PORTFOLIO SIMULATION (BUY × SELL PAIRS) ===\n');

const pairResults = [];

for (const bv of BUY_VARIANTS) {
  // Also score BUY-only (no sell)
  const buyOnlyReturns = [];
  let buyOnlyTotal = 0;

  for (const [caseId, evals] of Object.entries(allResults)) {
    const buyResult = evals?.buy?.[bv];
    const outcome = caseMap[caseId];
    if (!outcome || !buyResult) continue;

    const bd = buyDecision(bv, buyResult);
    if (!bd) continue;

    buyOnlyTotal++;
    if (bd === 'buy') {
      // Hold for 3 years
      buyOnlyReturns.push(outcome.return_3yr);
    } else {
      // Park in VOO
      buyOnlyReturns.push(outcome.sp500_return_3yr);
    }
  }

  const buyOnlyMeanReturn = mean(buyOnlyReturns);
  const buyOnlyMeanVOO = mean(Object.entries(allResults).filter(([id]) => caseMap[id]).map(([id]) => caseMap[id].sp500_return_3yr));
  const buyOnlyAlpha = buyOnlyMeanReturn - buyOnlyMeanVOO;

  pairResults.push({
    buy: bv,
    sell: 'NONE (hold)',
    portfolioReturn: (buyOnlyMeanReturn * 100).toFixed(1),
    alpha: (buyOnlyAlpha * 100).toFixed(1),
    buyPrecision: buyScores[bv]?.precision || 'N/A',
    sellTruePos: 'N/A',
    sellFalsePos: 'N/A',
    n: buyOnlyTotal,
  });

  for (const sv of SELL_VARIANTS) {
    const returns = [];
    let pairTotal = 0;

    for (const [caseId, evals] of Object.entries(allResults)) {
      const buyResult = evals?.buy?.[bv];
      const sellResult = evals?.sell?.[sv];
      const outcome = caseMap[caseId];
      if (!outcome || !buyResult) continue;

      const bd = buyDecision(bv, buyResult);
      if (!bd) continue;

      pairTotal++;

      if (bd === 'reject') {
        // Capital stays in VOO for 3 years
        returns.push(outcome.sp500_return_3yr);
      } else {
        // Position entered
        const sd = sellResult ? sellDecision(sv, sellResult) : 'hold';

        if (sd === 'sell') {
          // Exit at checkpoint, park remainder in VOO
          // Approximate: use midpoint return (half the 3yr return) + VOO for remainder
          // This is a simplification since we don't have exact checkpoint prices in the compact data
          const exitReturn = outcome.return_3yr * 0.4; // rough approximation: exit at ~40% through
          const vooRemainder = outcome.sp500_return_3yr * 0.6;
          returns.push(exitReturn + vooRemainder);
        } else {
          // Hold for full 3 years
          returns.push(outcome.return_3yr);
        }
      }
    }

    const meanReturn = mean(returns);
    const meanVOO = mean(Object.entries(allResults).filter(([id]) => caseMap[id]).map(([id]) => caseMap[id].sp500_return_3yr));
    const alpha = meanReturn - meanVOO;

    pairResults.push({
      buy: bv,
      sell: sv,
      portfolioReturn: (meanReturn * 100).toFixed(1),
      alpha: (alpha * 100).toFixed(1),
      buyPrecision: buyScores[bv]?.precision || 'N/A',
      sellTruePos: sellScores[sv]?.truePosRate || 'N/A',
      sellFalsePos: sellScores[sv]?.falsePosRate || 'N/A',
      n: pairTotal,
    });
  }
}

// Sort by alpha descending
pairResults.sort((a, b) => parseFloat(b.alpha) - parseFloat(a.alpha));

console.log('TOP 20 BUY × SELL PAIRS (Training Set)');
console.log('='.repeat(120));
console.log('Rank | BUY Prompt                  | SELL Prompt            | Portfolio | Alpha  | BUY Prec | SELL TP | SELL FP | N');
console.log('-'.repeat(120));
for (let i = 0; i < Math.min(20, pairResults.length); i++) {
  const p = pairResults[i];
  console.log(`${String(i+1).padStart(4)} | ${p.buy.padEnd(27)} | ${p.sell.padEnd(22)} | ${p.portfolioReturn.padStart(8)}% | ${p.alpha.padStart(5)}% | ${String(p.buyPrecision).padStart(7)}% | ${String(p.sellTruePos).padStart(6)}% | ${String(p.sellFalsePos).padStart(6)}% | ${p.n}`);
}

// Save full results
const output = {
  timestamp: new Date().toISOString(),
  cases_evaluated: Object.keys(allResults).length,
  batches_loaded: batchesLoaded,
  buy_scores: buyScores,
  sell_scores: sellScores,
  pair_rankings: pairResults,
  top_10: pairResults.slice(0, 10),
};

fs.writeFileSync(path.join(OPT_DIR, 'round1-results.json'), JSON.stringify(output, null, 2));
console.log(`\nResults saved to round1-results.json`);

// Helper functions
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pointBiserialR(x, y) {
  // x and y are arrays of 0/1
  const n = x.length;
  if (n < 3) return 0;

  const x1 = [], x0 = [];
  for (let i = 0; i < n; i++) {
    if (x[i] === 1) x1.push(y[i]);
    else x0.push(y[i]);
  }

  if (x1.length === 0 || x0.length === 0) return 0;

  const m1 = mean(x1);
  const m0 = mean(x0);
  const p = x1.length / n;
  const q = 1 - p;

  const allY = [...x1, ...x0];
  const sy = Math.sqrt(allY.reduce((s, v) => s + (v - mean(allY)) ** 2, 0) / n);
  if (sy === 0) return 0;

  return ((m1 - m0) / sy) * Math.sqrt(p * q);
}
