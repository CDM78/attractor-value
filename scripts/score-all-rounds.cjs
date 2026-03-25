#!/usr/bin/env node
// Score ALL rounds: loads Round 1 + Round 2 batch results, merges, ranks all BUY×SELL pairs

const fs = require('fs');
const path = require('path');

const OPT_DIR = path.resolve(__dirname, '../data/prompt-optimization');
const RESULTS_DIR = path.join(OPT_DIR, 'eval-results');
const ROUND = process.argv[2] || 'all'; // 'all', '1', '2'

// Load training cases
const training = JSON.parse(fs.readFileSync(path.join(OPT_DIR, 'training-cases.json')));
const caseMap = {};
for (const c of training) caseMap[c.case_id] = c;

// Load and merge all batch results
const allResults = {};
let batchesLoaded = 0;

function loadBatches(prefix, count) {
  let loaded = 0;
  for (let i = 0; i < count; i++) {
    const batchFile = path.join(RESULTS_DIR, `${prefix}_batch_${i}.json`);
    if (!fs.existsSync(batchFile)) continue;
    const batch = JSON.parse(fs.readFileSync(batchFile));
    const results = batch.results || batch;
    for (const [caseId, evals] of Object.entries(results)) {
      if (!allResults[caseId]) allResults[caseId] = { buy: {}, sell: {} };
      // Merge buy and sell results
      if (evals.buy) Object.assign(allResults[caseId].buy, evals.buy);
      if (evals.sell) Object.assign(allResults[caseId].sell, evals.sell);
    }
    loaded++;
  }
  return loaded;
}

if (ROUND === 'all' || ROUND === '1') batchesLoaded += loadBatches('round1', 10);
if (ROUND === 'all' || ROUND === '2') batchesLoaded += loadBatches('round2', 10);

console.log(`Loaded ${batchesLoaded} batch files, ${Object.keys(allResults).length} cases\n`);
if (Object.keys(allResults).length === 0) { console.log('No results.'); process.exit(0); }

// === BUY DECISION LOGIC ===
function buyDecision(variant, result) {
  if (!result) return null;
  const a = (result.assessment || '').toLowerCase();
  const t = (result.trajectory || '').toLowerCase();

  // Round 1 variants
  if (variant === 'buy_v1_binary') return a === 'stable' ? 'buy' : 'reject';
  if (variant === 'buy_v2_character') return (a === 'same_character' || result.character_changed === false) ? 'buy' : 'reject';
  if (variant === 'buy_v3_sector_adjusted') return a === 'company_specific_deterioration' ? 'reject' : 'buy';
  if (variant === 'buy_v4_confession') return a === 'temporary_dislocation' ? 'buy' : 'reject';
  if (variant === 'buy_v5_resolution') return a === 'deteriorating' ? 'reject' : 'buy';
  if (variant === 'buy_v6_minimal') return a === 'stable' ? 'buy' : 'reject';
  if (variant === 'buy_v7_quantified') return a === 'more_risks' ? 'reject' : 'buy';
  if (variant === 'buy_v8_forward') return t === 'worsening' ? 'reject' : 'buy';

  // Round 2 variants
  if (variant === 'buy_v9_confession_sector') return a === 'structural_decline' ? 'reject' : 'buy';
  if (variant === 'buy_v10_confession_minimal') return a === 'temporary' ? 'buy' : 'reject';
  if (variant === 'buy_v11_surprise_focus') return a === 'expected' ? 'buy' : 'reject';
  if (variant === 'buy_v12_severity') {
    // Buy if severity ≤ 3 OR trend is resolving
    const sev = result.severity || 3;
    const trend = (result.trend || 'stable').toLowerCase();
    if (trend === 'resolving') return 'buy';
    if (sev >= 4 && trend === 'worsening') return 'reject';
    return 'buy';
  }
  if (variant === 'buy_v13_confession_resolution') return a === 'compounding' ? 'reject' : 'buy';

  return null;
}

// === SELL DECISION LOGIC ===
function sellDecision(variant, result) {
  if (!result) return null;

  const action = (result.action || '').toLowerCase();
  const traj = (result.trajectory || '').toLowerCase();
  const dom = (result.dominant || '').toLowerCase();

  // Round 1 variants
  if (variant === 'sell_v1_thesis_drift') return action || (result.thesis_intact === false ? 'sell' : 'hold');
  if (variant === 'sell_v2_escalation') return action || ((result.escalated_count || 0) > 2 ? 'sell' : 'hold');
  if (variant === 'sell_v3_new_confessions') return action || (result.new_confessions_found ? 'sell' : 'hold');
  if (variant === 'sell_v4_simple') return action || (traj === 'worse' ? 'sell' : 'hold');
  if (variant === 'sell_v5_exit_urgency') return action || ((result.urgency || 1) >= 4 ? 'sell' : 'hold');

  // Round 2 variants
  if (variant === 'sell_v6_confession_count') return action || ((result.new_confession_count || 0) >= 2 ? 'sell' : 'hold');
  if (variant === 'sell_v7_confession_escalation') {
    if (action) return action;
    return (dom === 'escalating' || dom === 'new_appearing') ? 'sell' : 'hold';
  }
  if (variant === 'sell_v8_minimal_confession') return action || (result.new_confessions ? 'sell' : 'hold');

  return null;
}

// Discover all BUY and SELL variants from the data
const allBuyVariants = new Set();
const allSellVariants = new Set();
for (const evals of Object.values(allResults)) {
  for (const v of Object.keys(evals.buy || {})) allBuyVariants.add(v);
  for (const v of Object.keys(evals.sell || {})) allSellVariants.add(v);
}

const BUY_VARIANTS = [...allBuyVariants].sort();
const SELL_VARIANTS = [...allSellVariants].sort();

console.log(`BUY variants found: ${BUY_VARIANTS.length} — ${BUY_VARIANTS.join(', ')}`);
console.log(`SELL variants found: ${SELL_VARIANTS.length} — ${SELL_VARIANTS.join(', ')}\n`);

// === SCORE BUY VARIANTS ===
console.log('=== BUY VARIANT SCORES ===\n');
const buyScores = {};

for (const bv of BUY_VARIANTS) {
  let total = 0, passed = 0, winnersPassed = 0, trapsPassed = 0;
  const decisions = [];

  for (const [caseId, evals] of Object.entries(allResults)) {
    const result = evals?.buy?.[bv];
    const outcome = caseMap[caseId];
    if (!outcome || !result) continue;

    const decision = buyDecision(bv, result);
    if (!decision) continue;

    total++;
    const isWinner = outcome.binary_outcome === 'winner';

    if (decision === 'buy') {
      passed++;
      if (isWinner) winnersPassed++;
      else trapsPassed++;
    }

    decisions.push({
      decision: decision === 'buy' ? 1 : 0,
      isWinner: isWinner ? 1 : 0,
      alpha: outcome.alpha,
    });
  }

  const passRate = total > 0 ? passed / total : 0;
  const precision = passed > 0 ? winnersPassed / passed : 0;
  const r = pointBiserialR(decisions.map(d => d.decision), decisions.map(d => d.isWinner));
  const passedAlphas = decisions.filter(d => d.decision === 1).map(d => d.alpha);
  const rejectedAlphas = decisions.filter(d => d.decision === 0).map(d => d.alpha);

  buyScores[bv] = {
    total, passed, passRate: pct(passRate),
    winnersPassed, trapsPassed,
    precision: pct(precision), r: r.toFixed(3),
    meanPassedAlpha: mean(passedAlphas).toFixed(3),
    meanRejectedAlpha: mean(rejectedAlphas).toFixed(3),
    separation: (mean(passedAlphas) - mean(rejectedAlphas)).toFixed(3),
  };

  console.log(`${bv.padEnd(30)} (${total}): pass=${pct(passRate)}% prec=${pct(precision)}% r=${r.toFixed(3)} sep=${(mean(passedAlphas) - mean(rejectedAlphas)).toFixed(3)}`);
}

// === SCORE SELL VARIANTS ===
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
    total, sells, sellRate: pct(sellRate),
    truePos, falsePos,
    truePosRate: pct(truePosRate), falsePosRate: pct(falsePosRate),
  };

  console.log(`${sv.padEnd(30)} (${total}): sell=${pct(sellRate)}% truePos=${pct(truePosRate)}% falsePos=${pct(falsePosRate)}%`);
}

// === PORTFOLIO SIMULATION ===
console.log('\n=== PORTFOLIO SIMULATION (ALL BUY × SELL PAIRS) ===\n');
const pairResults = [];

for (const bv of BUY_VARIANTS) {
  // BUY-only (no sell)
  const buyOnlyReturns = [];
  for (const [caseId, evals] of Object.entries(allResults)) {
    const outcome = caseMap[caseId];
    if (!outcome || !evals?.buy?.[bv]) continue;
    const bd = buyDecision(bv, evals.buy[bv]);
    if (!bd) continue;
    buyOnlyReturns.push(bd === 'buy' ? outcome.return_3yr : outcome.sp500_return_3yr);
  }

  const meanVOO = mean(Object.values(caseMap).map(c => c.sp500_return_3yr));
  pairResults.push({
    buy: bv, sell: 'NONE (hold)',
    portfolioReturn: pct(mean(buyOnlyReturns)),
    alpha: pct(mean(buyOnlyReturns) - meanVOO),
    buyPrecision: buyScores[bv]?.precision || 'N/A',
    sellTruePos: 'N/A', sellFalsePos: 'N/A',
    n: buyOnlyReturns.length,
  });

  // BUY + SELL pairs
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
          // Approximate: exit ~40% through, park remainder in VOO
          returns.push(outcome.return_3yr * 0.4 + outcome.sp500_return_3yr * 0.6);
        } else {
          returns.push(outcome.return_3yr);
        }
      }
    }

    pairResults.push({
      buy: bv, sell: sv,
      portfolioReturn: pct(mean(returns)),
      alpha: pct(mean(returns) - meanVOO),
      buyPrecision: buyScores[bv]?.precision || 'N/A',
      sellTruePos: sellScores[sv]?.truePosRate || 'N/A',
      sellFalsePos: sellScores[sv]?.falsePosRate || 'N/A',
      n: returns.length,
    });
  }
}

pairResults.sort((a, b) => parseFloat(b.alpha) - parseFloat(a.alpha));

console.log('TOP 25 BUY × SELL PAIRS');
console.log('='.repeat(130));
console.log(`${'Rank'.padStart(4)} | ${'BUY Prompt'.padEnd(30)} | ${'SELL Prompt'.padEnd(30)} | Portfolio | Alpha  | Prec   | STP    | SFP    | N`);
console.log('-'.repeat(130));
for (let i = 0; i < Math.min(25, pairResults.length); i++) {
  const p = pairResults[i];
  console.log(`${String(i+1).padStart(4)} | ${p.buy.padEnd(30)} | ${p.sell.padEnd(30)} | ${String(p.portfolioReturn).padStart(8)}% | ${String(p.alpha).padStart(5)}% | ${String(p.buyPrecision).padStart(5)}% | ${String(p.sellTruePos).padStart(5)}% | ${String(p.sellFalsePos).padStart(5)}% | ${p.n}`);
}

// Save results
const output = {
  timestamp: new Date().toISOString(),
  cases_evaluated: Object.keys(allResults).length,
  buy_variants: BUY_VARIANTS,
  sell_variants: SELL_VARIANTS,
  buy_scores: buyScores,
  sell_scores: sellScores,
  pair_rankings: pairResults,
  top_10: pairResults.slice(0, 10),
};

const outFile = ROUND === 'all' ? 'all-rounds-results.json' : `round${ROUND}-results.json`;
fs.writeFileSync(path.join(OPT_DIR, outFile), JSON.stringify(output, null, 2));
console.log(`\nResults saved to ${outFile}`);

// === HELPERS ===
function mean(arr) { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function pct(v) { return (v * 100).toFixed(1); }
function pointBiserialR(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  const x1 = [], x0 = [];
  for (let i = 0; i < n; i++) { (x[i] === 1 ? x1 : x0).push(y[i]); }
  if (x1.length === 0 || x0.length === 0) return 0;
  const m1 = mean(x1), m0 = mean(x0);
  const p = x1.length / n, q = 1 - p;
  const allY = [...x1, ...x0], my = mean(allY);
  const sy = Math.sqrt(allY.reduce((s, v) => s + (v - my) ** 2, 0) / n);
  return sy === 0 ? 0 : ((m1 - m0) / sy) * Math.sqrt(p * q);
}
