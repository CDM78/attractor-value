#!/usr/bin/env node
// Analyze AI evaluation results from sub-agent runs.
// Reads eval-results.json, merges with answer-key.json, computes all metrics.
//
// Usage: node scripts/ai-eval-analysis.js

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { spearmanCorrelation, mean, median, stddev } from './lib/statistics.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const EVAL_DIR = resolve(DATA_DIR, 'agent/eval-phase2');
const RESULTS_DIR = resolve(import.meta.dirname, '../results');

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function fN(v, d = 3) { return v == null ? 'N/A' : v.toFixed(d); }
function fP(v, d = 1) { return v == null ? 'N/A' : (v * 100).toFixed(d) + '%'; }
function winRate(arr) { return arr.length ? arr.filter(c => c.outcome === 1).length / arr.length : 0; }

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C_ = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';
function hdr(t) { console.log(`\n${B}${C_}${'='.repeat(70)}${X}\n${B}${C_}  ${t}${X}\n${B}${C_}${'='.repeat(70)}${X}`); }
function sub(t) { console.log(`\n${B}${t}${X}`); }

function main() {
  hdr('AI DEFINITIVE TEST — ANALYSIS');

  const results = loadJSON(resolve(EVAL_DIR, 'eval-results.json'));
  const answerKey = loadJSON(resolve(EVAL_DIR, 'answer-key.json'));

  if (!results || !answerKey) {
    console.log('  Missing results or answer key files.');
    return;
  }

  // Merge results with answers
  const cases = [];
  for (const [caseId, scores] of Object.entries(results)) {
    const answer = answerKey[caseId];
    if (!answer || !scores) continue;
    cases.push({
      caseId,
      outcome: answer.outcome,
      forward_return_3yr: answer.forward_return_3yr,
      sp500_return_3yr: answer.sp500_return_3yr,
      u160: answer.u160,
      // Approach A scores
      composite: scores.composite,
      bull_avg: scores.bull_avg,
      bear_avg: scores.bear_avg,
      // Approach B
      win_probability: scores.win_probability,
      // Approach C
      is_trap: scores.is_trap,
      trap_confidence: scores.trap_confidence,
      red_flag_count: scores.red_flag_count,
    });
  }

  console.log(`  Total evaluated cases: ${cases.length}`);
  console.log(`  Winners: ${cases.filter(c => c.outcome === 1).length}, Traps: ${cases.filter(c => c.outcome === 0).length}`);

  if (cases.length < 10) {
    console.log('  Insufficient cases for meaningful analysis. Need at least 10.');
    return;
  }

  // ===== APPROACH A: 6-Factor Attractor =====
  hdr('APPROACH A: 6-Factor Attractor Scoring');

  const withComposite = cases.filter(c => c.composite != null);
  if (withComposite.length >= 5) {
    const spA = spearmanCorrelation(withComposite.map(c => c.composite), withComposite.map(c => c.outcome));
    console.log(`  r(composite, outcome) = ${fN(spA?.rho)}, p = ${fN(spA?.p, 4)}, N = ${withComposite.length}`);
    console.log(`  Winner mean composite: ${fN(mean(withComposite.filter(c => c.outcome === 1).map(c => c.composite)))}`);
    console.log(`  Trap mean composite:   ${fN(mean(withComposite.filter(c => c.outcome === 0).map(c => c.composite)))}`);

    // Precision at 3.0 threshold
    const buyA = withComposite.filter(c => c.composite >= 3.0);
    const passA = withComposite.filter(c => c.composite < 3.0);
    console.log(`  At ≥3.0 threshold: ${buyA.length} cases, precision ${fP(winRate(buyA))}`);
    console.log(`  Below 3.0: ${passA.length} cases, win rate ${fP(winRate(passA))}`);

    // Quintile analysis
    sub('Approach A Quintiles:');
    const sorted = [...withComposite].sort((a, b) => a.composite - b.composite);
    const qSize = Math.max(Math.floor(sorted.length / 5), 1);
    for (let q = 0; q < 5; q++) {
      const qCases = sorted.slice(q * qSize, q === 4 ? sorted.length : (q + 1) * qSize);
      const scoreRange = `${fN(qCases[0]?.composite)}-${fN(qCases[qCases.length - 1]?.composite)}`;
      console.log(`  Q${q + 1}: N=${qCases.length}, WR=${fP(winRate(qCases))}, score range ${scoreRange}`);
    }
  }

  // ===== APPROACH B: Win Probability =====
  hdr('APPROACH B: Simple Win Probability');

  const withProb = cases.filter(c => c.win_probability != null);
  if (withProb.length >= 5) {
    const spB = spearmanCorrelation(withProb.map(c => c.win_probability), withProb.map(c => c.outcome));
    console.log(`  r(win_probability, outcome) = ${fN(spB?.rho)}, p = ${fN(spB?.p, 4)}, N = ${withProb.length}`);
    console.log(`  Winner mean probability: ${fN(mean(withProb.filter(c => c.outcome === 1).map(c => c.win_probability)))}%`);
    console.log(`  Trap mean probability:   ${fN(mean(withProb.filter(c => c.outcome === 0).map(c => c.win_probability)))}%`);

    const buyB = withProb.filter(c => c.win_probability >= 60);
    console.log(`  At ≥60% threshold: ${buyB.length} cases, precision ${fP(winRate(buyB))}`);
  }

  // ===== APPROACH C: Red Flag Detection =====
  hdr('APPROACH C: Red Flag / Trap Detection');

  const withTrap = cases.filter(c => c.is_trap != null);
  if (withTrap.length >= 5) {
    const actualTraps = withTrap.filter(c => c.outcome === 0);
    const actualWinners = withTrap.filter(c => c.outcome === 1);
    const flaggedTraps = withTrap.filter(c => c.is_trap === true);
    const flaggedCorrect = flaggedTraps.filter(c => c.outcome === 0);
    const flaggedFalse = flaggedTraps.filter(c => c.outcome === 1);
    const missedTraps = actualTraps.filter(c => c.is_trap !== true);

    console.log(`  Trap detection rate: ${flaggedCorrect.length}/${actualTraps.length} actual traps flagged (${fP(flaggedCorrect.length / Math.max(actualTraps.length, 1))})`);
    console.log(`  False alarm rate: ${flaggedFalse.length}/${actualWinners.length} winners flagged as traps (${fP(flaggedFalse.length / Math.max(actualWinners.length, 1))})`);
    console.log(`  Precision of trap flag: ${fP(flaggedCorrect.length / Math.max(flaggedTraps.length, 1))}`);

    // Use is_trap=false as BUY signal
    const buyC = withTrap.filter(c => c.is_trap !== true);
    console.log(`  BUY (not flagged): ${buyC.length} cases, precision ${fP(winRate(buyC))}`);
  }

  // ===== RETURNS COMPARISON =====
  hdr('RETURNS VS VOO (Primary Pass/Fail)');

  for (const [label, buyCases] of [
    ['Approach A (composite ≥3.0)', cases.filter(c => c.composite != null && c.composite >= 3.0)],
    ['Approach B (prob ≥60%)', cases.filter(c => c.win_probability != null && c.win_probability >= 60)],
    ['Approach C (not trapped)', cases.filter(c => c.is_trap != null && c.is_trap !== true)],
  ]) {
    const withRet = buyCases.filter(c => c.forward_return_3yr != null);
    if (withRet.length < 3) { console.log(`  ${label}: N=${withRet.length} insufficient`); continue; }
    const ret = mean(withRet.map(c => c.forward_return_3yr));
    const voo = mean(withRet.map(c => c.sp500_return_3yr));
    const alpha = Math.pow(1 + ret, 1/3) - 1 - (Math.pow(1 + voo, 1/3) - 1);
    console.log(`  ${label}: N=${withRet.length}, WR=${fP(winRate(buyCases))}, 3yr ret=${fP(ret)}, alpha=${fP(alpha)} ${alpha >= 0.03 ? G + 'PASS' : R + 'FAIL'}${X}`);
  }

  // ===== DOES AI ADD VALUE BEYOND CREDIT SPREAD? =====
  hdr('DOES AI ADD VALUE BEYOND CREDIT SPREAD?');

  // Cases in credit spread top quintile
  const withU160 = cases.filter(c => c.u160 != null);
  if (withU160.length >= 10) {
    const u160sorted = [...withU160].sort((a, b) => b.u160 - a.u160);
    const topQ = u160sorted.slice(0, Math.floor(u160sorted.length * 0.2));
    console.log(`  Credit spread top quintile: ${topQ.length} cases, base WR=${fP(winRate(topQ))}`);

    for (const [label, filterFn] of [
      ['+ Approach A ≥3.0', c => c.composite != null && c.composite >= 3.0],
      ['+ Approach B ≥60%', c => c.win_probability != null && c.win_probability >= 60],
      ['+ Approach C no trap', c => c.is_trap != null && c.is_trap !== true],
    ]) {
      const filtered = topQ.filter(filterFn);
      if (filtered.length >= 2) {
        console.log(`  ${label}: N=${filtered.length}, WR=${fP(winRate(filtered))}`);
      } else {
        console.log(`  ${label}: N=${filtered.length} insufficient`);
      }
    }
  }

  // ===== APPROACH COMPARISON =====
  hdr('APPROACH COMPARISON SUMMARY');

  const spA = withComposite.length >= 5 ? spearmanCorrelation(withComposite.map(c => c.composite), withComposite.map(c => c.outcome)) : null;
  const spB = withProb.length >= 5 ? spearmanCorrelation(withProb.map(c => c.win_probability), withProb.map(c => c.outcome)) : null;

  console.log(`\n  ${'Approach'.padEnd(18)} | ${'r'.padStart(7)} | ${'BUY WR'.padStart(8)} | ${'N'.padStart(4)} | Verdict`);
  console.log('  ' + '-'.repeat(55));

  const buyA = cases.filter(c => c.composite != null && c.composite >= 3.0);
  const buyB = cases.filter(c => c.win_probability != null && c.win_probability >= 60);
  const buyC = cases.filter(c => c.is_trap != null && c.is_trap !== true);

  console.log(`  ${'A (6-Factor)'.padEnd(18)} | ${fN(spA?.rho).padStart(7)} | ${fP(winRate(buyA)).padStart(8)} | ${String(buyA.length).padStart(4)} | ${spA?.p < 0.05 ? G + 'SIGNIFICANT' : R + 'NOT SIG'}${X}`);
  console.log(`  ${'B (Simple Prob)'.padEnd(18)} | ${fN(spB?.rho).padStart(7)} | ${fP(winRate(buyB)).padStart(8)} | ${String(buyB.length).padStart(4)} | ${spB?.p < 0.05 ? G + 'SIGNIFICANT' : R + 'NOT SIG'}${X}`);
  console.log(`  ${'C (Red Flag)'.padEnd(18)} | ${'N/A'.padStart(7)} | ${fP(winRate(buyC)).padStart(8)} | ${String(buyC.length).padStart(4)} |`);

  // ===== FINAL VERDICT =====
  hdr('FINAL VERDICT');

  const bestR = Math.max(Math.abs(spA?.rho || 0), Math.abs(spB?.rho || 0));
  const bestApproach = Math.abs(spA?.rho || 0) >= Math.abs(spB?.rho || 0) ? 'A' : 'B';
  const anySignificant = (spA?.p < 0.05) || (spB?.p < 0.05);

  if (!anySignificant) {
    console.log(`\n  ${R}${B}AI adds NO measurable signal on ${cases.length} blinded cases.${X}`);
    console.log(`  Neither approach reaches significance. The AI cannot distinguish winners from traps`);
    console.log(`  when presented only with anonymized financial data and sector descriptions.`);
    console.log(`\n  ${B}AI verdict: DROP. Best approach: None.${X}`);
    console.log(`  Recommended architecture: Remove AI gate from screening pipeline.`);
    console.log(`  Keep Claude as optional "explain this company" tool, not as decision gate.`);
  } else if (bestR < 0.15) {
    console.log(`\n  ${Y}${B}AI shows weak signal (best r=${fN(bestR)}) — not enough to justify API cost.${X}`);
    console.log(`\n  ${B}AI verdict: DROP. Marginal signal doesn't clear the 3% alpha hurdle.${X}`);
  } else if (bestR < 0.25) {
    console.log(`\n  ${Y}${B}AI shows moderate signal (best r=${fN(bestR)}) via Approach ${bestApproach}.${X}`);
    console.log(`  Worth keeping as confirmation signal, not primary gate.`);
    console.log(`\n  ${B}AI verdict: MODIFY. Best approach: ${bestApproach}.${X}`);
  } else {
    console.log(`\n  ${G}${B}AI shows strong signal (best r=${fN(bestR)}) via Approach ${bestApproach}.${X}`);
    console.log(`\n  ${B}AI verdict: KEEP. Best approach: ${bestApproach}.${X}`);
  }

  // Save report
  const report = generateReport(cases, spA, spB, buyA, buyB, buyC, withComposite, withProb, withTrap, bestR, bestApproach, anySignificant);
  writeFileSync(resolve(RESULTS_DIR, 'ai-definitive-test-2026-03-24.md'), report);
  console.log(`\n${G}Report saved to results/ai-definitive-test-2026-03-24.md${X}`);
}

function generateReport(cases, spA, spB, buyA, buyB, buyC, wC, wP, wT, bestR, bestApp, anySig) {
  const L = [];
  L.push('# AI Definitive Test Report');
  L.push(`\n**Date:** 2026-03-24`);
  L.push(`**Cases evaluated:** ${cases.length} (${cases.filter(c=>c.outcome===1).length} winners, ${cases.filter(c=>c.outcome===0).length} traps)`);
  L.push(`**Blinding:** Anonymized profiles, sector-only description, no company names`);
  L.push(`**Date integrity:** All financial data verified pre-entry date\n`);
  L.push('---\n');

  L.push('## Approach Comparison\n');
  L.push('| Approach | r with outcome | p-value | BUY Precision | BUY N |');
  L.push('|----------|---------------|---------|---------------|-------|');
  L.push(`| A (6-Factor) | ${fN(spA?.rho)} | ${fN(spA?.p, 4)} | ${fP(winRate(buyA))} | ${buyA.length} |`);
  L.push(`| B (Simple Prob) | ${fN(spB?.rho)} | ${fN(spB?.p, 4)} | ${fP(winRate(buyB))} | ${buyB.length} |`);
  L.push(`| C (Red Flag) | N/A | N/A | ${fP(winRate(buyC))} | ${buyC.length} |\n`);

  L.push('## Verdict\n');
  L.push(`AI verdict: **${anySig ? (bestR >= 0.25 ? 'KEEP' : bestR >= 0.15 ? 'MODIFY' : 'DROP') : 'DROP'}**`);
  L.push(`Best approach: **${anySig ? 'Approach ' + bestApp : 'None'}**\n`);
  L.push('---\n*Generated by ai-eval-analysis.js*');
  return L.join('\n');
}

main();
