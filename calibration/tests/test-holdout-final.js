#!/usr/bin/env node

// Part 3: HOLDOUT TEST — ONE SHOT
// Apply finalized BUY composite to holdout partition.
// No refitting. No further optimization after this.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const RESULTS_DIR = join(CAL, 'tests', 'results');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }
function writeJSON(p, d) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(d, null, 2)); }
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }

function assignRanks(arr) {
  const n = arr.length;
  const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && idx[j + 1].v === idx[j].v) j++;
    const avg = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function spearman(x, y) {
  const n = x.length;
  if (n < 5) return { r: 0, p: 1, n };
  const rx = assignRanks(x), ry = assignRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  const r = 1 - (6 * sumD2) / (n * (n * n - 1));
  return { r: +r.toFixed(4), n };
}

function quintileAnalysis(scores, outcomes) {
  const paired = scores.map((s, i) => ({ s, o: outcomes[i] })).sort((a, b) => a.s - b.s);
  const n = paired.length;
  const qs = [];
  for (let q = 0; q < 5; q++) {
    const start = Math.floor(n * q / 5), end = Math.floor(n * (q + 1) / 5);
    const group = paired.slice(start, end);
    const wins = group.filter(g => g.o === 1).length;
    qs.push({ q: q + 1, n: group.length, winRate: +(wins / group.length * 100).toFixed(1) });
  }
  return qs;
}

function topDecilePrecision(scores, outcomes) {
  const paired = scores.map((s, i) => ({ s, o: outcomes[i] })).sort((a, b) => b.s - a.s);
  const top = paired.slice(0, Math.max(1, Math.floor(paired.length / 10)));
  const wins = top.filter(t => t.o === 1).length;
  return +(wins / top.length * 100).toFixed(1);
}

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('                    HOLDOUT RESULTS');
  console.log('              (Final — No Further Optimization)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  // Load data
  const universe = readJSON(join(CAL, 'cases/universe.json'));
  const mdResults = readJSON(join(RESULTS_DIR, 'market-dynamics-expanded-2026-03-26.json'));
  const job2Results = readJSON(join(CAL, 'tests/job2-cases/opus-results-merged.json'));
  const compositeOpt = readJSON(join(RESULTS_DIR, 'composite-optimization-2026-03-26.json'));

  // Import spread computation
  const { getCreditSpreadForCase } = await import('../warehouse/connectors/fred-credit-spread.js');
  const { creditSpreadCSD, creditSpreadOU } = await import('../warehouse/connectors/market-dynamics.js');

  // Get holdout cases
  const allCases = Object.values(universe.cases);
  const holdout = allCases.filter(c => c.partition === 'holdout');
  const holdoutWT = holdout.filter(c => c.outcome?.classification === 'winner' || c.outcome?.classification === 'trap');

  console.log(`  N holdout cases: ${holdout.length}`);
  console.log(`  N holdout winner/trap: ${holdoutWT.length}`);

  // Index SI signals by ticker
  const mdByTicker = {};
  if (mdResults?.case_details) {
    for (const c of mdResults.case_details) mdByTicker[c.ticker] = c;
  }

  // Index Job 2 by case_id (these are training only — holdout won't have them)
  // For holdout, we need to run Job 2 fresh... BUT the spec says to apply EXACT same method
  // Job 2 requires 10-K filings which most holdout cases won't have
  // So we test BUY composite only (spread + SI Zipf) on holdout

  // Compute spread signals for each holdout case
  const spreadCache = {};
  function getSpread(entryDate) {
    if (spreadCache[entryDate]) return spreadCache[entryDate];
    const series = getCreditSpreadForCase(entryDate, 3);
    if (series.length < 25) { spreadCache[entryDate] = null; return null; }
    const csd = creditSpreadCSD(series, 10);
    spreadCache[entryDate] = { spread_variance_slope: csd?.varianceSlope ?? null };
    return spreadCache[entryDate];
  }

  // Build holdout signal matrix
  const holdoutRows = [];
  for (const c of holdoutWT) {
    const spread = getSpread(c.entry_date);
    const md = mdByTicker[c.ticker];
    const outcome = c.outcome.classification === 'winner' ? 1 : 0;

    holdoutRows.push({
      case_id: c.case_id,
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome_num: outcome,
      outcome_label: c.outcome.classification,
      alpha_3yr: c.outcome?.alpha_3yr || 0,
      forward_return: c.outcome?.forward_return_3yr || 0,
      spread_variance_slope: spread?.spread_variance_slope ?? null,
      si_zipf_velocity: md?.scores?.si_zipf_velocity ?? null,
    });
  }

  console.log(`  N with spread data: ${holdoutRows.filter(r => r.spread_variance_slope != null).length}`);
  console.log(`  N with SI Zipf: ${holdoutRows.filter(r => r.si_zipf_velocity != null).length}`);
  console.log(`  N with both: ${holdoutRows.filter(r => r.spread_variance_slope != null && r.si_zipf_velocity != null).length}`);

  // ============================================================
  // TEST 1: D-rank composite (spread + SI Zipf, rank-based)
  // This was the validated BUY composite from Part 1
  // ============================================================

  console.log('\n── BUY COMPOSITE: D-rank (spread_variance_slope + si_zipf_velocity) ──\n');

  const signalKeys = ['spread_variance_slope', 'si_zipf_velocity'];

  // Rank-based composite on holdout
  const ranks = {};
  for (const key of signalKeys) {
    const vals = holdoutRows.map(r => r[key]);
    const validIndices = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0);
    const validVals = validIndices.map(i => vals[i]);
    const r = assignRanks(validVals);
    const n = validVals.length;
    ranks[key] = new Array(vals.length).fill(null);
    validIndices.forEach((idx, j) => { ranks[key][idx] = r[j] / n; });
  }

  const compositeScores = holdoutRows.map((_, i) => {
    const vals = signalKeys.map(k => ranks[k][i]).filter(v => v != null);
    return vals.length === signalKeys.length ? mean(vals) : null;
  });

  // Filter to cases with complete data
  const validIdx = compositeScores.map((s, i) => s != null ? i : -1).filter(i => i >= 0);
  const vs = validIdx.map(i => compositeScores[i]);
  const vo = validIdx.map(i => holdoutRows[i].outcome_num);
  const vAlpha = validIdx.map(i => holdoutRows[i].alpha_3yr);

  console.log(`  N with complete signal data: ${vs.length}`);
  console.log(`  Winners: ${vo.filter(o => o === 1).length}, Traps: ${vo.filter(o => o === 0).length}`);

  const corr = spearman(vs, vo);
  const quints = quintileAnalysis(vs, vo);
  const topDec = topDecilePrecision(vs, vo);

  console.log(`\n  BUY COMPOSITE PERFORMANCE`);
  console.log(`    r with outcome: ${corr.r}`);
  console.log(`    Top-decile precision: ${topDec}%`);
  console.log(`    Quintile win rates: Q1=${quints[0].winRate}% Q2=${quints[1].winRate}% Q3=${quints[2].winRate}% Q4=${quints[3].winRate}% Q5=${quints[4].winRate}%`);
  console.log(`    Q5-Q1 spread: ${(quints[4].winRate - quints[0].winRate).toFixed(1)}pp`);

  // Training comparison (from Part 1)
  const trainR = 0.1147;
  const trainQ5 = 55.3;

  console.log(`\n  Comparison to training:`);
  console.log(`    Training r: ${trainR}  |  Holdout r: ${corr.r}  |  Gap: ${Math.abs(trainR - corr.r).toFixed(3)}`);
  console.log(`    Training Q5: ${trainQ5}%  |  Holdout Q5: ${quints[4].winRate}%  |  Gap: ${Math.abs(trainQ5 - quints[4].winRate).toFixed(1)}pp`);

  // ============================================================
  // TEST 2: Individual signals on holdout
  // ============================================================

  console.log('\n── INDIVIDUAL SIGNALS ON HOLDOUT ──\n');

  for (const key of ['spread_variance_slope', 'si_zipf_velocity']) {
    const valid2 = holdoutRows.filter(r => r[key] != null);
    const scores2 = valid2.map(r => r[key]);
    const outcomes2 = valid2.map(r => r.outcome_num);
    const c2 = spearman(scores2, outcomes2);
    console.log(`  ${key.padEnd(25)} r=${c2.r.toFixed(3).padStart(7)}, n=${c2.n}`);
  }

  // ============================================================
  // TEST 3: No-filter baseline
  // ============================================================

  console.log('\n── NO-FILTER BASELINE ──\n');

  const allHoldoutAlpha = holdoutWT.map(c => c.outcome?.alpha_3yr || 0);
  const meanAlpha = mean(allHoldoutAlpha);
  const allWinRate = holdoutWT.filter(c => c.outcome.classification === 'winner').length / holdoutWT.length;
  console.log(`  All holdout cases: mean alpha=${(meanAlpha*100).toFixed(1)}%, win rate=${(allWinRate*100).toFixed(1)}%`);

  // Compare: top half of composite vs bottom half
  const topHalf = validIdx.filter(i => compositeScores[i] >= 0.5);
  const botHalf = validIdx.filter(i => compositeScores[i] < 0.5);
  const topAlpha = mean(topHalf.map(i => holdoutRows[i].alpha_3yr));
  const botAlpha = mean(botHalf.map(i => holdoutRows[i].alpha_3yr));
  const topWinRate = topHalf.filter(i => holdoutRows[i].outcome_num === 1).length / topHalf.length;
  const botWinRate = botHalf.filter(i => holdoutRows[i].outcome_num === 1).length / botHalf.length;

  console.log(`  Top half composite: alpha=${(topAlpha*100).toFixed(1)}%, win rate=${(topWinRate*100).toFixed(1)}%, n=${topHalf.length}`);
  console.log(`  Bottom half composite: alpha=${(botAlpha*100).toFixed(1)}%, win rate=${(botWinRate*100).toFixed(1)}%, n=${botHalf.length}`);
  console.log(`  Delta: alpha=${((topAlpha-botAlpha)*100).toFixed(1)}pp, win rate=${((topWinRate-botWinRate)*100).toFixed(1)}pp`);

  // ============================================================
  // PORTFOLIO SIMULATION
  // ============================================================

  console.log('\n── PORTFOLIO SIMULATION ──\n');

  // Strategy: BUY composite top half
  const annualize = r3yr => Math.pow(1 + r3yr, 1/3) - 1;

  const noFilter = holdoutWT.map(c => c.outcome?.forward_return_3yr || 0);
  const buyOnly = topHalf.map(i => holdoutRows[i].forward_return);

  const noFilterAnnReturn = annualize(mean(noFilter));
  const buyOnlyAnnReturn = annualize(mean(buyOnly));

  // VOO benchmark: assume mean alpha=0, so VOO return = forward_return - alpha
  const vooReturns = holdoutWT.map(c => (c.outcome?.forward_return_3yr || 0) - (c.outcome?.alpha_3yr || 0));
  const vooAnnReturn = annualize(mean(vooReturns));

  const noFilterAlpha = noFilterAnnReturn - vooAnnReturn;
  const buyOnlyAlpha = buyOnlyAnnReturn - vooAnnReturn;

  console.log('  Strategy                          | Ann. Return | Ann. Alpha | Win Rate');
  console.log('  ' + '─'.repeat(75));
  console.log(`  VOO benchmark                      | ${(vooAnnReturn*100).toFixed(1).padStart(10)}% | ${(0).toFixed(1).padStart(9)}% | —`);
  console.log(`  No filter (all holdout)             | ${(noFilterAnnReturn*100).toFixed(1).padStart(10)}% | ${(noFilterAlpha*100).toFixed(1).padStart(9)}% | ${(allWinRate*100).toFixed(1)}%`);
  console.log(`  BUY composite (top half)            | ${(buyOnlyAnnReturn*100).toFixed(1).padStart(10)}% | ${(buyOnlyAlpha*100).toFixed(1).padStart(9)}% | ${(topWinRate*100).toFixed(1)}%`);

  // ============================================================
  // VERDICT
  // ============================================================

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  VERDICT');
  console.log('══════════════════════════════════════════════════════════════\n');

  const holdoutAlphaPct = buyOnlyAlpha * 100;
  let verdict;
  if (holdoutAlphaPct >= 8) verdict = 'STRONG PASS — methodology validated';
  else if (holdoutAlphaPct >= 5) verdict = 'PASS — methodology works, modest edge';
  else if (holdoutAlphaPct >= 3) verdict = 'MARGINAL — edge exists but small';
  else verdict = 'FAIL — insufficient edge to justify complexity over VOO';

  const rGap = Math.abs(trainR - corr.r);
  const generalizes = rGap < 0.10 ? 'YES' : 'NO';
  const beatsNoFilter = buyOnlyAlpha > noFilterAlpha ? 'YES' : 'NO';

  console.log(`  Holdout alpha: ${holdoutAlphaPct.toFixed(1)}% annualized`);
  console.log(`  Rating: ${verdict}`);
  console.log('');
  console.log(`  BUY composite generalizes:    ${generalizes} (holdout r=${corr.r}, training r=${trainR}, gap=${rGap.toFixed(3)})`);
  console.log(`  SELL signal adds value:       NOT TESTED (insufficient T+12 filing data)`);
  console.log(`  System beats no-filter:       ${beatsNoFilter} (buy alpha=${holdoutAlphaPct.toFixed(1)}% vs no-filter alpha=${(noFilterAlpha*100).toFixed(1)}%)`);
  console.log('');

  let recommendation;
  if (holdoutAlphaPct >= 5 && generalizes === 'YES') recommendation = 'DEPLOY';
  else if (holdoutAlphaPct >= 3 && generalizes === 'YES') recommendation = 'DEPLOY BUY ONLY (supplement with AI analysis)';
  else if (corr.r > 0 && generalizes === 'YES') recommendation = 'NEEDS MORE RESEARCH (signal present but small)';
  else recommendation = 'DO NOT DEPLOY (does not generalize)';

  console.log(`  FINAL RECOMMENDATION: ${recommendation}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Save report
  const reportData = {
    test_id: `holdout-final-${new Date().toISOString().split('T')[0]}`,
    holdout_n: holdoutWT.length,
    holdout_with_data: vs.length,
    composite: { method: 'D-rank', signals: signalKeys },
    holdout_r: corr.r,
    training_r: trainR,
    r_gap: +rGap.toFixed(4),
    top_decile: topDec,
    quintiles: quints,
    portfolio: {
      voo_annual: +(vooAnnReturn * 100).toFixed(1),
      no_filter_alpha: +(noFilterAlpha * 100).toFixed(1),
      buy_composite_alpha: +(holdoutAlphaPct).toFixed(1),
    },
    verdict,
    recommendation,
    generalizes,
  };
  writeJSON(join(RESULTS_DIR, 'holdout-final-test-2026-03-26.json'), reportData);

  // Generate markdown
  let md = `# HOLDOUT TEST — Final Results\n\n`;
  md += `**Date**: ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Composite**: D-rank (spread_variance_slope + si_zipf_velocity)\n`;
  md += `**Holdout N**: ${vs.length} winner/trap cases with complete signals\n\n`;
  md += `## Results\n\n`;
  md += `| Metric | Training | Holdout | Gap |\n|---|---|---|---|\n`;
  md += `| r | ${trainR} | ${corr.r} | ${rGap.toFixed(3)} |\n`;
  md += `| Q5 win rate | ${trainQ5}% | ${quints[4].winRate}% | ${Math.abs(trainQ5 - quints[4].winRate).toFixed(1)}pp |\n`;
  md += `| Top-decile | 62.1% | ${topDec}% | |\n\n`;
  md += `## Portfolio\n\n`;
  md += `| Strategy | Ann. Alpha | Win Rate |\n|---|---|---|\n`;
  md += `| No filter | ${(noFilterAlpha*100).toFixed(1)}% | ${(allWinRate*100).toFixed(1)}% |\n`;
  md += `| BUY composite | ${holdoutAlphaPct.toFixed(1)}% | ${(topWinRate*100).toFixed(1)}% |\n\n`;
  md += `## Verdict\n\n**${verdict}**\n\n**Recommendation: ${recommendation}**\n`;

  writeFileSync(join(RESULTS_DIR, 'holdout-final-test-2026-03-26.md'), md);
  console.log('  Results saved to holdout-final-test-2026-03-26.json/.md');
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
