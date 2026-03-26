#!/usr/bin/env node
// Session 4.5 Part 2: SI Dynamics at Checkpoints
// Computes SI signals at each of 12 checkpoints for eligible cases (entry 2018+).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const SI_CP_DIR = join(CAL, 'cases', 'si-checkpoints');
const RESULTS_DIR = join(CAL, 'tests', 'results');

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('='.repeat(60));
  console.log('SESSION 4.5 PART 2: SI DYNAMICS AT CHECKPOINTS');
  console.log('='.repeat(60));

  // Import SI signal functions
  const md = await import('../warehouse/connectors/market-dynamics.js');
  const { fetchSITimeSeries } = await import('../warehouse/connectors/finra-si-series.js');
  const warehouse = (await import('../warehouse/warehouse.js')).default;

  // Load universe
  const universe = JSON.parse(readFileSync(join(CAL, 'cases', 'universe.json'), 'utf-8'));
  const allCases = Object.values(universe.cases);

  // Step 1: Find eligible cases (entry 2018+, with SI data)
  console.log('\n--- Step 1: Identifying eligible cases ---');
  const eligible = allCases.filter(c => c.entry_date >= '2018-03-15');
  console.log(`Cases with entry >= 2018-03-15: ${eligible.length}`);

  // Check which have existing SI data in warehouse
  const withSI = [];
  for (const c of eligible) {
    const siRecords = warehouse.queryCompanyData(c.ticker, 'short_interest', { before: addMonths(c.entry_date, 37) });
    if (siRecords.length > 0) {
      const series = siRecords[0]?.content?.series;
      if (series && series.length >= 6) {
        // Filter to before entry date for initial count
        const preEntry = series.filter(s => s.date <= c.entry_date);
        if (preEntry.length >= 6) {
          withSI.push({ case: c, fullSeries: series });
        }
      }
    }
  }
  console.log(`Cases with ≥6 SI data points before entry: ${withSI.length}`);

  if (withSI.length === 0) {
    // Try fetching SI data from FINRA for a sample
    console.log('\nNo warehouse SI data found. Attempting FINRA fetch for eligible cases...');
    let fetched = 0;
    for (const c of eligible.slice(0, 50)) {
      try {
        const series = await fetchSITimeSeries(c.ticker, addMonths(c.entry_date, 36), 5);
        if (series.length >= 6) {
          const preEntry = series.filter(s => s.date <= c.entry_date);
          if (preEntry.length >= 6) {
            withSI.push({ case: c, fullSeries: series });
            fetched++;
          }
        }
      } catch {}
      if (fetched >= 30) break;
    }
    console.log(`Fetched SI data for ${fetched} additional cases`);
  }

  if (withSI.length === 0) {
    console.log('No SI data available. Writing empty report.');
    writeEmptyReport();
    return;
  }

  // Step 2: Compute SI dynamics at each checkpoint
  console.log(`\n--- Step 2: Computing SI dynamics at ${withSI.length} cases ---`);
  if (!existsSync(SI_CP_DIR)) mkdirSync(SI_CP_DIR, { recursive: true });

  const MONTHS = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
  const allResults = [];

  for (let i = 0; i < withSI.length; i++) {
    const { case: c, fullSeries } = withSI[i];

    if ((i + 1) % 20 === 0) {
      process.stdout.write(`\r  Processing: ${i + 1}/${withSI.length}`);
    }

    const checkpoints = [];
    const entryDate = c.entry_date;

    for (const months of MONTHS) {
      const cpDate = addMonths(entryDate, months);

      // TEMPORAL INTEGRITY: only use SI data up to checkpoint date
      const truncated = fullSeries.filter(s => s.date <= cpDate);
      if (truncated.length < 6) continue;

      // Compute signals on truncated series
      const siLevel = truncated[truncated.length - 1]?.short_position || 0;
      const derivs = md.siDerivatives(truncated);
      const ouFit = md.siMeanReversion(truncated);
      const csd = md.siCSD(truncated);

      checkpoints.push({
        months,
        date: cpDate,
        si_data_points: truncated.length,
        si_level: siLevel,
        si_d1: derivs?.recentD1 ?? null,
        si_d2: derivs?.recentD2 ?? null,
        si_phase: derivs?.phase ?? null,
        si_theta: ouFit?.theta ?? null,
        si_half_life: ouFit?.halfLife ?? null,
        si_mean_reverting: ouFit?.meanReverting ?? null,
        si_csd_index: csd?.csdIndex ?? null,
        si_csd_interp: csd?.interpretation ?? null,
        si_autocorr_slope: csd?.autocorrSlope ?? null,
        si_variance_slope: csd?.varianceSlope ?? null,
      });
    }

    const result = {
      case_id: c.case_id,
      ticker: c.ticker,
      entry_date: entryDate,
      outcome: c.outcome?.classification,
      si_data_points_total: fullSeries.length,
      checkpoints,
    };

    writeFileSync(join(SI_CP_DIR, `${c.case_id}.json`), JSON.stringify(result, null, 2));
    allResults.push(result);
  }

  console.log(`\n\nSI checkpoints computed for ${allResults.length} cases`);

  // Step 3: Trajectory analysis
  console.log('\n--- Step 3: Sell-signal trajectory analysis ---');
  const analysis = analyzeTrajectories(allResults);

  const report = generateReport(allResults, analysis);
  writeFileSync(join(RESULTS_DIR, 'si-trajectory-analysis-2026-03-26.md'), report);
  console.log(report);
}

// ============================================================
// TRAJECTORY ANALYSIS
// ============================================================

function analyzeTrajectories(results) {
  const traps = results.filter(r => r.outcome === 'trap');
  const winners = results.filter(r => r.outcome === 'winner');

  // For traps: when did SI first signal deterioration?
  const trapD1early = countEarlySignal(traps, 'si_d1', v => v > 0.03, 2, 12);
  const trapThetaEarly = countEarlyThetaDecline(traps, 12);
  const trapD1any = countEarlySignal(traps, 'si_d1', v => v > 0.03, 2, 36);

  // For winners: false alarms
  const winD1false = countEarlySignal(winners, 'si_d1', v => v > 0.03, 2, 12);
  const winThetaFalse = countEarlyThetaDecline(winners, 12);

  // Find best early-warning signal
  const signals = [
    { name: 'SI D1 positive 2 consec', trapCatch: trapD1early.pct, falseAlarm: winD1false.pct },
    { name: 'SI theta decline 2 consec', trapCatch: trapThetaEarly.pct, falseAlarm: winThetaFalse.pct },
  ];

  return { traps, winners, trapD1early, trapThetaEarly, trapD1any, winD1false, winThetaFalse, signals };
}

function countEarlySignal(cases, field, predicate, consecutive, withinMonths) {
  let count = 0;
  const total = cases.length;
  if (total === 0) return { count: 0, total: 0, pct: 0 };

  for (const c of cases) {
    const cps = c.checkpoints.filter(cp => cp.months <= withinMonths && cp[field] != null);
    let streak = 0;
    let triggered = false;
    for (const cp of cps) {
      if (predicate(cp[field])) {
        streak++;
        if (streak >= consecutive) { triggered = true; break; }
      } else {
        streak = 0;
      }
    }
    if (triggered) count++;
  }

  return { count, total, pct: Math.round(100 * count / total) };
}

function countEarlyThetaDecline(cases, withinMonths) {
  let count = 0;
  const total = cases.length;
  if (total === 0) return { count: 0, total: 0, pct: 0 };

  for (const c of cases) {
    const cps = c.checkpoints.filter(cp => cp.months <= withinMonths && cp.si_theta != null);
    if (cps.length < 2) continue;
    const entryTheta = cps[0]?.si_theta;
    if (entryTheta == null) continue;

    let streak = 0;
    let triggered = false;
    for (const cp of cps) {
      if (cp.si_theta < entryTheta * 0.8) {
        streak++;
        if (streak >= 2) { triggered = true; break; }
      } else {
        streak = 0;
      }
    }
    if (triggered) count++;
  }

  return { count, total, pct: Math.round(100 * count / total) };
}

function generateReport(results, analysis) {
  const traps = analysis.traps;
  const winners = analysis.winners;

  const best = analysis.signals.reduce((best, s) => {
    const score = s.trapCatch - s.falseAlarm;
    return score > (best.trapCatch - best.falseAlarm) ? s : best;
  }, analysis.signals[0]);

  return `# SI Trajectory Analysis

**Date**: 2026-03-26

\`\`\`
SI TRAJECTORY ANALYSIS
=======================
Cases with SI checkpoint data: ${results.length}
  Winners: ${winners.length}
  Traps: ${traps.length}

Among traps (n=${traps.length}):
  SI D1 turned positive (2 consec) before T+12: ${analysis.trapD1early.pct}% (${analysis.trapD1early.count}/${analysis.trapD1early.total})
  SI theta declined below entry before T+12:    ${analysis.trapThetaEarly.pct}% (${analysis.trapThetaEarly.count}/${analysis.trapThetaEarly.total})
  SI D1 positive any time before T+36:          ${analysis.trapD1any.pct}% (${analysis.trapD1any.count}/${analysis.trapD1any.total})

Among winners (n=${winners.length}):
  SI D1 false alarm before T+12:    ${analysis.winD1false.pct}% (${analysis.winD1false.count}/${analysis.winD1false.total})
  SI theta false alarm before T+12: ${analysis.winThetaFalse.pct}% (${analysis.winThetaFalse.count}/${analysis.winThetaFalse.total})

Best early-warning signal: ${best.name}
  Catches ${best.trapCatch}% traps with ${best.falseAlarm}% false alarm rate
\`\`\`
`;
}

function writeEmptyReport() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, 'si-trajectory-analysis-2026-03-26.md'),
    `# SI Trajectory Analysis\n\n**Date**: 2026-03-26\n\nNo FINRA SI data available in warehouse for 2018+ entry cases.\nSI data must be imported first via import-market-data.js or FINRA bulk fetch.\n`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
