#!/usr/bin/env node

// Combined Holdout Validation: S&P 500 + Mid-Cap
// Tests whether adding mid-caps to the universe improves the composite.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { getCreditSpreadForCase } from '../warehouse/connectors/fred-credit-spread.js';
import { creditSpreadCSD } from '../warehouse/connectors/market-dynamics.js';

const CAL = resolve(import.meta.dirname, '..');
const RESULTS_DIR = join(CAL, 'tests', 'results');

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
  if (n < 10) return { r: 0, n };
  const rx = assignRanks(x), ry = assignRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rx[i] - ry[i]) ** 2;
  return { r: +(1 - (6 * sumD2) / (n * (n * n - 1))).toFixed(4), n };
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
  return +(top.filter(t => t.o === 1).length / top.length * 100).toFixed(1);
}

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  COMBINED HOLDOUT VALIDATION: S&P 500 + MID-CAP');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Load S&P 500 holdout
  const universe = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
  const sp500Holdout = Object.values(universe.cases)
    .filter(c => c.partition === 'holdout' && (c.outcome?.classification === 'winner' || c.outcome?.classification === 'trap'));

  // Load mid-cap signals (use all as "holdout" — they were never used for training)
  const mcSignals = JSON.parse(readFileSync(join(CAL, 'midcap-signals-merged.json'), 'utf-8'));
  const mcCases = mcSignals.results
    .filter(r => r.classification === 'winner' || r.classification === 'trap');

  // Load S&P 500 market dynamics by ticker
  const mdResults = JSON.parse(readFileSync(join(RESULTS_DIR, 'market-dynamics-expanded-2026-03-26.json'), 'utf-8'));
  const mdByTicker = {};
  for (const c of (mdResults?.case_details || [])) mdByTicker[c.ticker] = c;

  console.log(`  S&P 500 holdout (winner/trap): ${sp500Holdout.length}`);
  console.log(`  Mid-cap (winner/trap): ${mcCases.length}\n`);

  // Build unified rows
  const rows = [];

  // S&P 500 holdout
  for (const c of sp500Holdout) {
    const spread = getCreditSpreadForCase(c.entry_date, 3);
    let spreadVar = null;
    if (spread.length >= 25) {
      const csd = creditSpreadCSD(spread, 10);
      spreadVar = csd?.varianceSlope ?? null;
    }
    const md = mdByTicker[c.ticker];

    rows.push({
      case_id: c.case_id,
      ticker: c.ticker,
      universe: 'SP500',
      outcome: c.outcome.classification === 'winner' ? 1 : 0,
      alpha: c.outcome.alpha_3yr || 0,
      forward_return: c.outcome.forward_return_3yr || 0,
      spread_variance_slope: spreadVar,
      si_csd: md?.scores?.si_csd ?? null,
      si_d1: md?.scores?.si_d1 ?? null,
      composite: md?.scores?.composite ?? null,
      fisher: null, // Not available for holdout
    });
  }

  // Mid-cap cases
  for (const c of mcCases) {
    rows.push({
      case_id: c.case_id,
      ticker: c.ticker,
      universe: 'MIDCAP',
      outcome: c.classification === 'winner' ? 1 : 0,
      alpha: c.alpha_3yr || 0,
      forward_return: c.forward_return_3yr || 0,
      spread_variance_slope: c.signals.spread_variance_slope ?? null,
      si_csd: c.signals.si_csd ?? null,
      si_d1: c.signals.si_d1 ?? null,
      composite: c.signals.composite ?? null,
      fisher: c.signals.fisher ?? null,
    });
  }

  console.log(`  Total combined rows: ${rows.length}\n`);

  // ============================================================
  // TEST 1: S&P 500 holdout only (baseline — already validated)
  // ============================================================

  function runTest(label, subset) {
    const signalKeys = ['spread_variance_slope', 'si_csd'];
    const ranks = {};
    for (const k of signalKeys) {
      const vals = subset.map(r => r[k]);
      const validIdx = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0);
      const validVals = validIdx.map(i => vals[i]);
      const r = assignRanks(validVals);
      ranks[k] = new Array(vals.length).fill(null);
      validIdx.forEach((idx, j) => { ranks[k][idx] = r[j] / validVals.length; });
    }

    const compositeScores = subset.map((_, i) => {
      const vals = signalKeys.map(k => ranks[k][i]).filter(v => v != null);
      return vals.length === signalKeys.length ? mean(vals) : null;
    });

    const valid = compositeScores.map((s, i) => s != null ? i : -1).filter(i => i >= 0);
    const vs = valid.map(i => compositeScores[i]);
    const vo = valid.map(i => subset[i].outcome);
    const vAlpha = valid.map(i => subset[i].alpha);
    const vReturn = valid.map(i => subset[i].forward_return);

    if (vs.length < 30) return null;

    const corr = spearman(vs, vo);
    const quints = quintileAnalysis(vs, vo);
    const topDec = topDecilePrecision(vs, vo);

    // Portfolio sim
    const topHalf = valid.filter(i => compositeScores[i] >= 0.5);
    const allAlpha = mean(valid.map(i => subset[i].alpha));
    const topAlpha = mean(topHalf.map(i => subset[i].alpha));
    const topWinRate = topHalf.filter(i => subset[i].outcome === 1).length / topHalf.length;
    const allWinRate = valid.filter(i => subset[i].outcome === 1).length / valid.length;

    return { label, n: vs.length, r: corr.r, topDec, quints, topAlpha, allAlpha, topWinRate, allWinRate, topHalfN: topHalf.length };
  }

  const sp500Only = rows.filter(r => r.universe === 'SP500');
  const mcOnly = rows.filter(r => r.universe === 'MIDCAP');
  const combined = rows;

  const results = {
    sp500: runTest('S&P 500 Holdout', sp500Only),
    midcap: runTest('Mid-Cap', mcOnly),
    combined: runTest('Combined', combined),
  };

  console.log('  Universe         | n    | r     | Top-Dec | Q5 Win% | Q1 Win% | Top½ α   | All α    | Top½ WR');
  console.log('  ' + '─'.repeat(95));

  for (const [key, r] of Object.entries(results)) {
    if (!r) continue;
    const annAlpha = ((1 + r.topAlpha) ** (1/3) - 1) * 100;
    const annAllAlpha = ((1 + r.allAlpha) ** (1/3) - 1) * 100;
    console.log(`  ${r.label.padEnd(18)} | ${String(r.n).padStart(4)} | ${r.r.toFixed(3).padStart(6)} | ${String(r.topDec).padStart(6)}% | ${String(r.quints[4]?.winRate).padStart(6)}% | ${String(r.quints[0]?.winRate).padStart(6)}% | ${annAlpha.toFixed(1).padStart(7)}% | ${annAllAlpha.toFixed(1).padStart(7)}% | ${(r.topWinRate*100).toFixed(1)}%`);
  }

  // Fisher on mid-cap (bonus — new signal)
  console.log('\n── FISHER INFORMATION (Mid-Cap Only) ──\n');
  const fisherCases = mcOnly.filter(r => r.fisher != null && isFinite(r.fisher));
  if (fisherCases.length >= 30) {
    const fCorr = spearman(fisherCases.map(r => r.fisher), fisherCases.map(r => r.outcome));
    console.log(`  Fisher on mid-cap: r=${fCorr.r}, n=${fCorr.n}`);
    console.log(`  (Compare: Fisher on S&P 500 = 0.169)`);
  }

  // Verdict
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  VERDICT');
  console.log('══════════════════════════════════════════════════════════════\n');

  const sp = results.sp500;
  const mc = results.midcap;
  const cb = results.combined;

  if (cb && sp) {
    const rImproved = cb.r >= sp.r;
    const alphaImproved = cb.topAlpha >= sp.topAlpha;
    console.log(`  Combined r (${cb.r}) vs S&P-only r (${sp.r}): ${rImproved ? 'IMPROVED' : 'DEGRADED'}`);
    console.log(`  Combined top-half alpha vs S&P-only: ${alphaImproved ? 'IMPROVED' : 'DEGRADED'}`);
    console.log(`  Mid-cap standalone r: ${mc?.r || 'N/A'}`);

    if (mc?.r >= 0.15) {
      console.log('\n  DECISION: EXPAND UNIVERSE — mid-cap signals are strong');
    } else if (cb.r >= sp.r * 0.9) {
      console.log('\n  DECISION: EXPAND — no degradation from adding mid-caps');
    } else {
      console.log('\n  DECISION: DO NOT EXPAND — adding mid-caps dilutes signal');
    }
  }

  // Save
  const report = { results, timestamp: new Date().toISOString() };
  writeFileSync(join(RESULTS_DIR, 'combined-holdout-validation-2026-03-27.json'), JSON.stringify(report, null, 2));
  console.log(`\n  Saved to combined-holdout-validation-2026-03-27.json`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
