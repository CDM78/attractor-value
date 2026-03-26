#!/usr/bin/env node

// Session 4: Narrative Transition Mapping
// Requires ANTHROPIC_API_KEY environment variable.
// Usage: ANTHROPIC_API_KEY=sk-... node test-narrative-transitions.js [--pilot] [--full]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { analyze, registerTest } from './testing-framework.js';
import { classifyNarrative, computePathMetrics, NARRATIVE_ARCHETYPES } from '../services/narrative-classifier.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const CACHE_DIR = resolve(import.meta.dirname, '../warehouse/macro/market-dynamics-cache/narrative');

function readJSON(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; }
function writeJSON(p, d) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(d, null, 2)); }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('ERROR: Set ANTHROPIC_API_KEY environment variable');
  console.error('Usage: ANTHROPIC_API_KEY=sk-... node test-narrative-transitions.js --pilot');
  process.exit(1);
}

const isPilot = process.argv.includes('--pilot') || !process.argv.includes('--full');
const PILOT_SIZE = 200;

function loadCases() {
  const u = readJSON(resolve(import.meta.dirname, '../cases/universe.json'));
  return Object.values(u.cases);
}

function selectPilotCases(cases) {
  const eligible = cases.filter(c => {
    const o = c.outcome?.classification;
    return o === 'winner' || o === 'trap';
  });

  const winners = eligible.filter(c => c.outcome.classification === 'winner');
  const traps = eligible.filter(c => c.outcome.classification === 'trap');

  // Stratified sample: 100 winners, 100 traps
  const half = PILOT_SIZE / 2;
  const selected = [
    ...winners.sort(() => Math.random() - 0.5).slice(0, half),
    ...traps.sort(() => Math.random() - 0.5).slice(0, half),
  ];

  return selected;
}

async function classifyBatch(cases) {
  const results = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const cacheFile = join(CACHE_DIR, `${c.ticker}-${c.entry_date}.json`);

    // Check cache
    const cached = readJSON(cacheFile);
    if (cached) {
      results.push(cached);
      ok++;
      process.stdout.write(`\r  [${i + 1}/${cases.length}] ${ok} classified, ${fail} failed (cached: ${c.ticker})    `);
      continue;
    }

    try {
      const narrative = await classifyNarrative(API_KEY, c);
      const metrics = computePathMetrics(narrative);

      const result = {
        ticker: c.ticker,
        entry_date: c.entry_date,
        outcome: c.outcome.classification,
        alpha_3yr: c.outcome.alpha_3yr || 0,
        current_narrative: narrative.current_narrative,
        narrative_confidence: narrative.narrative_confidence,
        transition_asymmetry: narrative.transition_asymmetry,
        dominant_transition_mode: narrative.dominant_transition_mode,
        transitions: narrative.plausible_transitions,
        ...metrics,
      };

      writeJSON(cacheFile, result);
      results.push(result);
      ok++;

      // Rate limit: ~2 seconds between calls
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      fail++;
      console.warn(`  WARN: ${c.ticker} failed: ${e.message}`);
    }

    process.stdout.write(`\r  [${i + 1}/${cases.length}] ${ok} classified, ${fail} failed    `);
  }

  console.log('');
  return results;
}

function analyzeResults(results) {
  console.log(`\n  Total classified: ${results.length}`);
  const winners = results.filter(r => r.outcome === 'winner');
  const traps = results.filter(r => r.outcome === 'trap');
  console.log(`  Winners: ${winners.length}, Traps: ${traps.length}\n`);

  // 1. Transition Asymmetry
  const asymScores = results.map(r => r.transitionAsymmetry || r.transition_asymmetry || 0);
  const asymAnalysis = analyze(asymScores, results.map(r => r.outcome), results.map(r => r.alpha_3yr));
  console.log('  1. Transition Asymmetry:');
  console.log(`     Winners mean: ${mean(winners.map(r => r.transitionAsymmetry || r.transition_asymmetry || 0)).toFixed(3)}`);
  console.log(`     Traps mean:   ${mean(traps.map(r => r.transitionAsymmetry || r.transition_asymmetry || 0)).toFixed(3)}`);
  console.log(`     r = ${asymAnalysis.spearman_r?.toFixed(3)}, p = ${asymAnalysis.spearman_p?.toFixed(6)}, CV = ${asymAnalysis.cross_validation?.mean_r?.toFixed(3)}\n`);

  // 2. Path Coherence
  const cohScores = results.map(r => r.pathCoherence || 0);
  const cohAnalysis = analyze(cohScores, results.map(r => r.outcome), results.map(r => r.alpha_3yr));
  console.log('  2. Path Coherence:');
  console.log(`     r = ${cohAnalysis.spearman_r?.toFixed(3)}, p = ${cohAnalysis.spearman_p?.toFixed(6)}, CV = ${cohAnalysis.cross_validation?.mean_r?.toFixed(3)}\n`);

  // 3. Expected Value
  const evScores = results.map(r => r.expectedValue || 0);
  const evAnalysis = analyze(evScores, results.map(r => r.outcome), results.map(r => r.alpha_3yr));
  console.log('  3. Expected Value:');
  console.log(`     r = ${evAnalysis.spearman_r?.toFixed(3)}, p = ${evAnalysis.spearman_p?.toFixed(6)}, CV = ${evAnalysis.cross_validation?.mean_r?.toFixed(3)}\n`);

  // 4. Sequence Momentum (noncommutativity)
  const seqScores = results.map(r => r.sequenceMomentum || 0);
  const seqAnalysis = analyze(seqScores, results.map(r => r.outcome), results.map(r => r.alpha_3yr));
  console.log('  4. Sequence Momentum (noncommutativity test):');
  console.log(`     r = ${seqAnalysis.spearman_r?.toFixed(3)}, p = ${seqAnalysis.spearman_p?.toFixed(6)}, CV = ${seqAnalysis.cross_validation?.mean_r?.toFixed(3)}\n`);

  // 5. Narrative distribution
  console.log('  5. Current Narrative Distribution:');
  const narrCounts = {};
  for (const r of results) {
    const n = r.current_narrative || 'UNKNOWN';
    if (!narrCounts[n]) narrCounts[n] = { w: 0, t: 0 };
    if (r.outcome === 'winner') narrCounts[n].w++;
    else narrCounts[n].t++;
  }
  console.log('     Narrative             | W   | T   | Win%');
  for (const [n, c] of Object.entries(narrCounts).sort((a, b) => (b[1].w + b[1].t) - (a[1].w + a[1].t))) {
    const total = c.w + c.t;
    console.log(`     ${n.padEnd(22)} | ${String(c.w).padStart(3)} | ${String(c.t).padStart(3)} | ${(c.w / total * 100).toFixed(0)}%`);
  }

  // 6. Narrative dimensionality
  console.log(`\n  6. Narrative Dimensionality:`);
  console.log(`     Winners mean: ${mean(winners.map(r => r.narrativeDimensionality || 0)).toFixed(2)}`);
  console.log(`     Traps mean:   ${mean(traps.map(r => r.narrativeDimensionality || 0)).toFixed(2)}`);

  return { asymAnalysis, cohAnalysis, evAnalysis, seqAnalysis };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SESSION 4: NARRATIVE TRANSITION MAPPING');
  console.log(`  Mode: ${isPilot ? 'PILOT (200 cases)' : 'FULL'}`);
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allCases = loadCases();
  const cases = isPilot ? selectPilotCases(allCases) : allCases.filter(c => {
    const o = c.outcome?.classification;
    return o === 'winner' || o === 'trap';
  });

  console.log(`  Selected: ${cases.length} cases\n`);

  const results = await classifyBatch(cases);
  const analysis = analyzeResults(results);

  // Save
  const reportPath = join(RESULTS_DIR, `narrative-transitions-${isPilot ? 'pilot' : 'full'}-${new Date().toISOString().split('T')[0]}.json`);
  writeJSON(reportPath, {
    test_id: `narrative-${isPilot ? 'pilot' : 'full'}-${new Date().toISOString().split('T')[0]}`,
    n: results.length,
    results: results.map(r => ({
      ticker: r.ticker, entry_date: r.entry_date, outcome: r.outcome,
      current_narrative: r.current_narrative, transitionAsymmetry: r.transitionAsymmetry || r.transition_asymmetry,
      pathCoherence: r.pathCoherence, expectedValue: r.expectedValue,
      sequenceMomentum: r.sequenceMomentum, narrativeDimensionality: r.narrativeDimensionality,
      dominantMode: r.dominantMode || r.dominant_transition_mode,
    })),
    analysis: {
      asymmetry_r: analysis.asymAnalysis.spearman_r,
      coherence_r: analysis.cohAnalysis.spearman_r,
      ev_r: analysis.evAnalysis.spearman_r,
      sequence_r: analysis.seqAnalysis.spearman_r,
    },
  });

  console.log(`\n  Saved: ${reportPath}`);
  registerTest({ test_id: `narrative-${isPilot ? 'pilot' : 'full'}`, date: new Date().toISOString(), type: 'narrative' });
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
