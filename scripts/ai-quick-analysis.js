#!/usr/bin/env node
// Quick analysis of the 10-case pilot (5 winners + 5 traps).
// Run after collecting all results in eval-results.json.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const EVAL_DIR = resolve(import.meta.dirname, '../data/agent/eval-phase2');
function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function fN(v, d = 2) { return v == null ? 'N/A' : v.toFixed(d); }

const results = loadJSON(resolve(EVAL_DIR, 'eval-results.json'));
const key = loadJSON(resolve(EVAL_DIR, 'answer-key.json'));

if (!results || !key) { console.log('Missing data files.'); process.exit(1); }

const cases = [];
for (const [caseId, scores] of Object.entries(results)) {
  const k = key[caseId];
  if (!k) continue;
  cases.push({ caseId, ...scores, outcome: k.outcome, ticker: k.ticker, ret: k.forward_return_3yr });
}

const winners = cases.filter(c => c.outcome === 1);
const traps = cases.filter(c => c.outcome === 0);

console.log(`\n${'Case'.padEnd(10)} ${'Ticker'.padEnd(6)} ${'Actual'.padEnd(8)} ${'Comp'.padStart(5)} ${'WinP'.padStart(5)} ${'Trap?'.padStart(6)} ${'3yr Ret'.padStart(8)} ${'A ok?'.padStart(6)} ${'C ok?'.padStart(6)}`);
console.log('-'.repeat(68));
for (const c of cases.sort((a, b) => b.outcome - a.outcome || b.composite - a.composite)) {
  const actual = c.outcome === 1 ? 'WIN' : 'TRAP';
  const predA = c.composite >= 3.0 ? 'WIN' : 'TRAP';
  const predC = c.is_trap ? 'TRAP' : 'WIN';
  const okA = predA === actual ? '✓' : '✗';
  const okC = predC === actual ? '✓' : '✗';
  console.log(`${c.caseId.padEnd(10)} ${c.ticker.padEnd(6)} ${actual.padEnd(8)} ${fN(c.composite).padStart(5)} ${String(c.win_probability).padStart(4)}% ${String(c.is_trap).padStart(6)} ${fN(c.ret * 100, 0).padStart(7)}% ${okA.padStart(6)} ${okC.padStart(6)}`);
}

if (winners.length > 0 && traps.length > 0) {
  console.log('\n--- Approach A (Composite ≥3.0) ---');
  console.log(`  Winner mean composite: ${fN(mean(winners.map(c => c.composite)))}`);
  console.log(`  Trap mean composite:   ${fN(mean(traps.map(c => c.composite)))}`);
  console.log(`  Gap: ${fN(mean(winners.map(c => c.composite)) - mean(traps.map(c => c.composite)))}`);
  console.log(`  Direction: ${mean(winners.map(c => c.composite)) > mean(traps.map(c => c.composite)) ? 'CORRECT (winners higher)' : 'WRONG (traps higher)'}`);

  console.log('\n--- Approach B (Win Probability) ---');
  console.log(`  Winner mean prob: ${fN(mean(winners.map(c => c.win_probability)))}%`);
  console.log(`  Trap mean prob:   ${fN(mean(traps.map(c => c.win_probability)))}%`);
  console.log(`  Direction: ${mean(winners.map(c => c.win_probability)) > mean(traps.map(c => c.win_probability)) ? 'CORRECT' : 'WRONG'}`);

  console.log('\n--- Approach C (Trap Detection) ---');
  const trapsFlagged = traps.filter(c => c.is_trap === true).length;
  const winnersFlagged = winners.filter(c => c.is_trap === true).length;
  console.log(`  Actual traps correctly flagged: ${trapsFlagged}/${traps.length}`);
  console.log(`  Winners falsely flagged: ${winnersFlagged}/${winners.length}`);
}

function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
