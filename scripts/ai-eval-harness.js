#!/usr/bin/env node
// AI Evaluation Harness — runs all 3 approaches on blinded profiles using Sonnet 4
// (matching the production model). Results saved incrementally.
//
// Usage: node scripts/ai-eval-harness.js [--limit N] [--start N]
// Requires ANTHROPIC_API_KEY env variable.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const EVAL_DIR = resolve(import.meta.dirname, '../data/agent/eval-phase2');
const RESULTS_FILE = resolve(EVAL_DIR, 'eval-results.json');

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1]) : 50; })();
const START = (() => { const i = args.indexOf('--start'); return i >= 0 ? parseInt(args[i + 1]) : 0; })();

const client = new Anthropic();
const MODEL = 'claude-sonnet-4-20250514';
const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C_ = '\x1b[36m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

async function evaluate(profile) {
  const m = profile.metrics;
  const prompt = `You are evaluating THREE aspects of an anonymous company. Do NOT attempt to identify it. Use ONLY the data provided below. Score based solely on the financial information given.

COMPANY: ${profile.caseId}
SECTOR: ${profile.sector}
ENTRY DATE: ${profile.entryQ}

FINANCIAL HISTORY:
${profile.financialHistory}

KEY METRICS:
  D/E Ratio: ${m.de_ratio ?? 'N/A'}
  ROIC: ${m.roic ?? 'N/A'}%
  Gross Margin: ${m.gross_margin ?? 'N/A'}%
  Operating Margin: ${m.operating_margin ?? 'N/A'}%
  Revenue CAGR 3yr: ${m.revenue_cagr_3yr ?? 'N/A'}%
  Earnings Stability: ${m.earnings_stability}

BUSINESS: ${profile.description}

Complete ALL THREE tasks:

TASK 1 (6-Factor Attractor Scoring):
Score each factor 1-5:
1. Revenue Durability — How recurring and switching-cost-protected?
2. Competitive Reinforcement — Do advantages compound?
3. Industry Structure — Rational or destructive competition?
4. Demand Feedback — Customer network effects?
5. Adaptation Capacity — Track record of surviving disruption?
6. Capital Allocation — Disciplined reinvestment?

First give optimistic (bull) scores, then pessimistic (bear) scores.
Composite = bull_avg * 0.4 + bear_avg * 0.6

TASK 2 (Win Probability):
Estimate 0-100% probability this stock outperforms the S&P 500 over 3 years.

TASK 3 (Value Trap Detection):
List red flags. Is this a value trap? (true/false) Confidence? (high/medium/low)

Return ONLY this JSON (no markdown, no explanation):
{"bull_scores":[x,x,x,x,x,x],"bull_avg":0.0,"bear_scores":[x,x,x,x,x,x],"bear_avg":0.0,"composite":0.0,"win_probability":50,"is_trap":false,"trap_confidence":"medium","red_flags":["flag1"]}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0]?.text || '';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return null;
}

async function main() {
  console.log(`${B}${C_}AI Evaluation Harness — Sonnet 4 (production model)${X}`);

  const profiles = loadJSON(resolve(EVAL_DIR, 'blinded-profiles.json'));
  const prompts = loadJSON(resolve(EVAL_DIR, 'eval-prompts-50.json'));

  if (!profiles) { console.log('No blinded profiles found.'); return; }

  // Load existing results for resume
  let results = loadJSON(RESULTS_FILE) || {};
  const toEval = profiles.slice(START, START + LIMIT).filter(p => !results[p.caseId]);

  console.log(`  Profiles: ${profiles.length}, To evaluate: ${toEval.length} (skipping ${LIMIT - toEval.length} already done)`);

  let ok = 0, failed = 0;
  for (let i = 0; i < toEval.length; i++) {
    const p = toEval[i];
    try {
      const scores = await evaluate(p);
      if (scores) {
        results[p.caseId] = scores;
        ok++;
      } else {
        // Retry once
        const retry = await evaluate(p);
        if (retry) { results[p.caseId] = retry; ok++; }
        else { failed++; console.log(`  ${R}Failed: ${p.caseId}${X}`); }
      }
    } catch (e) {
      failed++;
      console.log(`  ${R}Error on ${p.caseId}: ${e.message?.slice(0, 60)}${X}`);
    }

    // Save after every case
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    process.stdout.write(`\r  Progress: ${i + 1}/${toEval.length} (${G}${ok}${X} ok, ${R}${failed}${X} failed)`);

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n\n  ${G}Done: ${ok} evaluated, ${failed} failed${X}`);
  console.log(`  Total results: ${Object.keys(results).length}`);
  console.log(`  Run: node scripts/ai-eval-analysis.js  to analyze`);
}

main().catch(e => { console.error(e); process.exit(1); });
