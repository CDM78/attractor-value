#!/usr/bin/env node

// SI Checkpoints — Full Dataset (460 companies)
// Uses extended SI cache (entry-2yr to entry+3yr).
// Computes SI dynamics at 12 checkpoints (T+3 through T+36 months).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const SI_EXT_DIR = join(CAL, 'warehouse/macro/market-dynamics-cache/si-extended');
const CP_DIR = join(CAL, 'cases/si-checkpoints');
const RESULTS_DIR = join(CAL, 'tests/results');

mkdirSync(CP_DIR, { recursive: true });

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

// Inline SI signal computations (avoid import issues)
function siDerivatives(series) {
  const valid = series.filter(s => s.short_position > 0);
  if (valid.length < 6) return null;
  const d1 = [];
  for (let i = 1; i < valid.length; i++) {
    d1.push((valid[i].short_position - valid[i - 1].short_position) / valid[i - 1].short_position);
  }
  const d2 = [];
  for (let i = 1; i < d1.length; i++) d2.push(d1[i] - d1[i - 1]);
  const recentD1 = d1.length >= 4 ? mean(d1.slice(-4)) : mean(d1);
  const recentD2 = d2.length >= 4 ? mean(d2.slice(-4)) : mean(d2);
  let phase;
  if (recentD1 > 0.05 && recentD2 > 0) phase = 'SHORTS_ACCELERATING';
  else if (recentD1 > 0.05 && recentD2 <= 0) phase = 'SHORTS_PEAKING';
  else if (recentD1 < -0.05 && recentD2 < 0) phase = 'SHORTS_COLLAPSING';
  else if (recentD1 < -0.05 && recentD2 >= 0) phase = 'SHORTS_BOTTOMING';
  else phase = 'STABLE';
  return { recentD1, recentD2, phase, n: valid.length };
}

function ornsteinUhlenbeckFit(series) {
  const n = series.length;
  if (n < 8) return null;
  let sumX = 0, sumXnext = 0, sumX2 = 0, sumXXnext = 0;
  for (let i = 0; i < n - 1; i++) {
    sumX += series[i]; sumXnext += series[i + 1];
    sumX2 += series[i] ** 2; sumXXnext += series[i] * series[i + 1];
  }
  const m = n - 1;
  const denom = m * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  const a = (m * sumXXnext - sumX * sumXnext) / denom;
  const theta = -Math.log(Math.max(a, 0.01));
  const mu = (sumXnext - a * sumX) / (m * (1 - Math.max(a, 0.001)));
  return { theta, mu, halfLife: theta > 0 ? Math.log(2) / theta : Infinity, meanReverting: theta > 0.5 };
}

function rollingAutocorrelation(series, windowSize) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const w = series.slice(i - windowSize, i);
    const m = mean(w);
    let num = 0, den = 0;
    for (let j = 0; j < w.length - 1; j++) { num += (w[j] - m) * (w[j + 1] - m); den += (w[j] - m) ** 2; }
    results.push(den > 0 ? num / den : 0);
  }
  return results;
}

function siCSD(siSeries, windowSize = 8) {
  const series = siSeries.map(s => s.short_position).filter(v => v > 0);
  if (series.length < windowSize + 5) return null;
  const logR = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) logR.push(Math.log(series[i] / series[i - 1]));
  }
  if (logR.length < windowSize + 3) return null;
  const ac = rollingAutocorrelation(logR, windowSize);
  if (ac.length < 3) return null;
  // Trend in autocorrelation
  const x = ac.map((_, i) => i);
  const mx = mean(x), my = mean(ac);
  let num = 0, den = 0;
  for (let i = 0; i < ac.length; i++) { num += (x[i] - mx) * (ac[i] - my); den += (x[i] - mx) ** 2; }
  const acSlope = den > 0 ? num / den : 0;
  const rawScore = acSlope * 50;
  const csdIndex = 1 / (1 + Math.exp(-rawScore));
  return { acSlope, csdIndex, interpretation: csdIndex > 0.6 ? 'CONSENSUS_FORMING' : csdIndex < 0.4 ? 'STABLE_REGIME' : 'NEUTRAL' };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SI CHECKPOINT ANALYSIS — FULL DATASET');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const universe = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
  const allCases = Object.values(universe.cases).filter(c => c.entry_date >= '2018-03-15');

  // Load extended SI data
  const siFiles = readdirSync(SI_EXT_DIR).filter(f => f.endsWith('.json'));
  const siByTicker = {};
  for (const f of siFiles) {
    const data = JSON.parse(readFileSync(join(SI_EXT_DIR, f), 'utf-8'));
    siByTicker[data.ticker] = data;
  }

  console.log(`  Universe cases (entry >= 2018-03-15): ${allCases.length}`);
  console.log(`  Extended SI cached tickers: ${siFiles.length}\n`);

  // Match cases to SI data
  const MONTHS = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
  const allResults = [];
  let processed = 0, skipped = 0;

  for (const c of allCases) {
    const si = siByTicker[c.ticker];
    if (!si?.series?.length) { skipped++; continue; }

    const preEntry = si.series.filter(s => s.date <= c.entry_date);
    if (preEntry.length < 6) { skipped++; continue; }

    const checkpoints = [];
    for (const months of MONTHS) {
      const cpDate = addMonths(c.entry_date, months);
      const truncated = si.series.filter(s => s.date <= cpDate);
      if (truncated.length < 6) continue;

      const derivs = siDerivatives(truncated);
      const dtcSeries = truncated.filter(s => s.days_to_cover > 0).map(s => s.days_to_cover);
      const ouFit = dtcSeries.length >= 8 ? ornsteinUhlenbeckFit(dtcSeries) : null;
      const csd = siCSD(truncated);

      checkpoints.push({
        months,
        date: cpDate,
        si_data_points: truncated.length,
        si_level: truncated[truncated.length - 1]?.short_position || 0,
        si_d1: derivs?.recentD1 ?? null,
        si_d2: derivs?.recentD2 ?? null,
        si_phase: derivs?.phase ?? null,
        si_theta: ouFit?.theta ?? null,
        si_half_life: ouFit?.halfLife ?? null,
        si_mean_reverting: ouFit?.meanReverting ?? null,
        si_csd_index: csd?.csdIndex ?? null,
        si_csd_interp: csd?.interpretation ?? null,
      });
    }

    if (checkpoints.length < 4) { skipped++; continue; }

    const result = {
      case_id: c.case_id,
      ticker: c.ticker,
      entry_date: c.entry_date,
      outcome: c.outcome?.classification,
      alpha_3yr: c.outcome?.alpha_3yr,
      checkpoints,
    };

    writeFileSync(join(CP_DIR, `${c.case_id}.json`), JSON.stringify(result, null, 2));
    allResults.push(result);
    processed++;
  }

  console.log(`  Processed: ${processed}, Skipped: ${skipped}\n`);

  // ============================================================
  // ANALYSIS
  // ============================================================

  const winners = allResults.filter(r => r.outcome === 'winner');
  const traps = allResults.filter(r => r.outcome === 'trap');
  const mixed = allResults.filter(r => r.outcome === 'mixed');
  const under = allResults.filter(r => r.outcome === 'underperform');

  console.log(`  Winners: ${winners.length}, Traps: ${traps.length}, Mixed: ${mixed.length}, Underperform: ${under.length}\n`);

  // Sell signal analysis: when does SI first warn about traps?
  console.log('  ═══ SELL SIGNAL ANALYSIS ═══\n');

  const signals = [
    { name: 'SI D1 > +3% (2 consec)', field: 'si_d1', pred: v => v > 0.03, consec: 2 },
    { name: 'SI D1 > +5% (2 consec)', field: 'si_d1', pred: v => v > 0.05, consec: 2 },
    { name: 'SI D1 > +3% (3 consec)', field: 'si_d1', pred: v => v > 0.03, consec: 3 },
    { name: 'Phase = ACCELERATING', field: 'si_phase', pred: v => v === 'SHORTS_ACCELERATING', consec: 1 },
    { name: 'Phase = ACCEL (2 consec)', field: 'si_phase', pred: v => v === 'SHORTS_ACCELERATING', consec: 2 },
    { name: 'CSD = CONSENSUS_FORMING', field: 'si_csd_interp', pred: v => v === 'CONSENSUS_FORMING', consec: 1 },
    { name: 'Theta declining (2 consec)', field: 'si_theta', pred: null, consec: 2, custom: 'theta_decline' },
  ];

  const windowsToTest = [12, 18, 24, 36];

  console.log('  Signal                        | Window | Trap catch | Winner FA | Net    | Trap n | Win n');
  console.log('  ' + '─'.repeat(95));

  const bestSignals = [];

  for (const sig of signals) {
    for (const window of windowsToTest) {
      let trapCatch = 0, trapTotal = traps.length;
      let winFA = 0, winTotal = winners.length;

      for (const group of [traps, winners]) {
        for (const c of group) {
          const cps = c.checkpoints.filter(cp => cp.months <= window && cp[sig.field] != null);
          let triggered = false;

          if (sig.custom === 'theta_decline') {
            // Theta declining: current theta < entry theta * 0.8 for N consecutive
            if (cps.length < 2) continue;
            const entryTheta = cps[0]?.si_theta;
            if (entryTheta == null || entryTheta <= 0) continue;
            let streak = 0;
            for (const cp of cps) {
              if (cp.si_theta != null && cp.si_theta < entryTheta * 0.8) {
                streak++;
                if (streak >= sig.consec) { triggered = true; break; }
              } else { streak = 0; }
            }
          } else {
            let streak = 0;
            for (const cp of cps) {
              if (sig.pred(cp[sig.field])) {
                streak++;
                if (streak >= sig.consec) { triggered = true; break; }
              } else { streak = 0; }
            }
          }

          if (triggered) {
            if (group === traps) trapCatch++;
            else winFA++;
          }
        }
      }

      const trapPct = trapTotal > 0 ? (trapCatch / trapTotal * 100) : 0;
      const winPct = winTotal > 0 ? (winFA / winTotal * 100) : 0;
      const net = trapPct - winPct;

      console.log(`  ${sig.name.padEnd(31)} | T+${String(window).padStart(2)}   | ${trapPct.toFixed(1).padStart(9)}% | ${winPct.toFixed(1).padStart(8)}% | ${net >= 0 ? '+' : ''}${net.toFixed(1).padStart(5)}pp | ${trapCatch}/${trapTotal} | ${winFA}/${winTotal}`);

      bestSignals.push({ name: sig.name, window, trapPct, winPct, net, trapCatch, trapTotal, winFA, winTotal });
    }
  }

  // Best signal
  bestSignals.sort((a, b) => b.net - a.net);
  const best = bestSignals[0];
  console.log(`\n  Best signal: ${best.name} within T+${best.window}`);
  console.log(`    Catches ${best.trapPct.toFixed(1)}% of traps with ${best.winPct.toFixed(1)}% false alarm rate (net +${best.net.toFixed(1)}pp)\n`);

  // Phase distribution at T+12 by outcome
  console.log('  ═══ PHASE DISTRIBUTION AT T+12 ═══\n');
  const phases = {};
  for (const group of [{ label: 'Winners', cases: winners }, { label: 'Traps', cases: traps }]) {
    for (const c of group.cases) {
      const cp12 = c.checkpoints.find(cp => cp.months === 12);
      if (!cp12?.si_phase) continue;
      if (!phases[cp12.si_phase]) phases[cp12.si_phase] = { w: 0, t: 0 };
      if (group.label === 'Winners') phases[cp12.si_phase].w++;
      else phases[cp12.si_phase].t++;
    }
  }
  console.log('  Phase                  | Winners | Traps | Trap rate');
  for (const [phase, counts] of Object.entries(phases).sort((a, b) => (b[1].t / (b[1].w + b[1].t)) - (a[1].t / (a[1].w + a[1].t)))) {
    const total = counts.w + counts.t;
    console.log(`  ${phase.padEnd(24)} | ${String(counts.w).padStart(7)} | ${String(counts.t).padStart(5)} | ${(counts.t / total * 100).toFixed(1)}%`);
  }

  // SI theta trajectory: winners vs traps at T+12, T+24, T+36
  console.log('\n  ═══ SI THETA TRAJECTORY ═══\n');
  console.log('  Checkpoint | Winner θ (mean) | Trap θ (mean) | Delta');
  for (const months of [0, 6, 12, 18, 24, 30, 36]) {
    const mo = months === 0 ? 3 : months; // Use T+3 as "entry"
    const wThetas = winners.map(c => c.checkpoints.find(cp => cp.months === mo)?.si_theta).filter(v => v != null);
    const tThetas = traps.map(c => c.checkpoints.find(cp => cp.months === mo)?.si_theta).filter(v => v != null);
    if (wThetas.length < 5 || tThetas.length < 5) continue;
    const wMean = mean(wThetas);
    const tMean = mean(tThetas);
    console.log(`  T+${String(months).padStart(2)}       | ${wMean.toFixed(3).padStart(15)} | ${tMean.toFixed(3).padStart(13)} | ${(wMean - tMean >= 0 ? '+' : '') + (wMean - tMean).toFixed(3)}`);
  }

  // Save report
  const reportPath = join(RESULTS_DIR, `si-checkpoints-full-${new Date().toISOString().split('T')[0]}.json`);
  writeFileSync(reportPath, JSON.stringify({
    test_id: `si-checkpoints-full-${new Date().toISOString().split('T')[0]}`,
    n_processed: processed,
    n_winners: winners.length,
    n_traps: traps.length,
    best_signal: best,
    top_5_signals: bestSignals.slice(0, 5),
    phase_distribution_t12: phases,
  }, null, 2));

  console.log(`\n  Results saved: ${reportPath}`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
