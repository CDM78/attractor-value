#!/usr/bin/env node
// Autonomous research agent — blind signal discovery using Sonnet 4.6.
// Feeds anonymized samples to a Sonnet agent that tests hypotheses about which
// numerical features predict binary outcomes. Agent never sees tickers, names,
// or real feature labels.
//
// Usage: node scripts/research-agent.js [--resume] [--budget N] [--max-iterations N]
//
// Requires ANTHROPIC_API_KEY environment variable.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const AGENT_DIR = resolve(import.meta.dirname, '../data/agent');
const RESULTS_DIR = resolve(AGENT_DIR, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

const args = process.argv.slice(2);
const RESUME = args.includes('--resume');
const MAX_BUDGET = (() => { const i = args.indexOf('--budget'); return i >= 0 ? parseFloat(args[i + 1]) : 50.0; })();
const MAX_ITERATIONS = (() => { const i = args.indexOf('--max-iterations'); return i >= 0 ? parseInt(args[i + 1]) : 200; })();

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

// ============================================
// COST TRACKING
// ============================================
const SONNET_INPUT_COST = 3.00 / 1_000_000;
const SONNET_OUTPUT_COST = 15.00 / 1_000_000;

let totalInputTokens = 0;
let totalOutputTokens = 0;
let iterationCount = 0;

function estimateCost() {
  return (totalInputTokens * SONNET_INPUT_COST) + (totalOutputTokens * SONNET_OUTPUT_COST);
}

function budgetRemaining() {
  return MAX_BUDGET - estimateCost();
}

// ============================================
// SYSTEM PROMPT
// ============================================
const SYSTEM_PROMPT = `You are a quantitative research agent testing investment signal hypotheses.

## Your mission
Find numerical features (or combinations of features) that predict outcome (1=good, 0=bad) better than random chance. You are looking for patterns in anonymized data that separate cases with good outcomes from those with bad outcomes.

## What you have
- 5 independent samples of ~330 anonymized cases each (A through E)
- Each case has features from two groups: "features" (f-prefixed, from financial statements) and "unconventional" (u-prefixed, from alternative data)
- Each case has a binary outcome: 1 (good) or 0 (bad)
- Feature names are coded — you don't know what they represent
- Sector codes (S____) group cases in the same industry
- Period codes (P___) group cases entered at the same time window
- Coverage flags tell you which alternative data pools are available for each case
- A feature dictionary gives vague categorical descriptions (but not real names)

## Your protocol
1. Start with Sample A. Examine the data structure, check feature coverage, compute basic stats.
2. Test hypotheses on Sample A using statistical tests. Record p-values and effect sizes.
3. For any hypothesis with p < 0.05 on Sample A, IMMEDIATELY test on Sample B. Do NOT refine the hypothesis between A and B — test the EXACT same specification.
4. If it holds on B (p < 0.10), test on C, D, E.
5. Report only findings that hold on at least 3 of 5 samples.
6. After exhausting starting hypotheses, generate NEW hypotheses based on what you've learned.

## Statistical methods you should use
You will output JavaScript code blocks that I will execute for you. Write self-contained analysis code that:
- Computes Mann-Whitney U tests (or Welch's t-test) for continuous features vs binary outcome
- Computes Spearman rank correlation for continuous associations
- Uses logistic regression (simple: just feature coefficient significance) for multi-feature tests
- Always reports: N (cases with non-null data), effect size (r or Cohen's d), p-value, and direction

Here is a helper library you can use in your code blocks:

\`\`\`javascript
// AVAILABLE: 'samples' object with keys A-E, each an array of case objects
// AVAILABLE: 'featureDict' object mapping feature codes to descriptions
// Each case: { case_id, outcome, sector, period, features: {f001:...}, unconventional: {u150:...}, _coverage: {...} }

// Helper: extract feature values paired with outcomes (filters nulls)
function getPairs(sample, featureKey) {
  return sample
    .map(c => ({ val: c.features[featureKey] ?? c.unconventional[featureKey], outcome: c.outcome }))
    .filter(p => p.val != null && typeof p.val === 'number');
}

// Helper: Mann-Whitney U test (returns {U, z, p, r})
function mannWhitneyU(group1, group2) {
  const n1 = group1.length, n2 = group2.length;
  if (n1 < 5 || n2 < 5) return { U: null, z: null, p: 1, r: 0 };
  const combined = [...group1.map(v => ({v, g: 1})), ...group2.map(v => ({v, g: 2}))];
  combined.sort((a, b) => a.v - b.v);
  // Assign ranks (handle ties)
  const ranks = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + j + 1) / 2; // 1-based
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }
  let R1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].g === 1) R1 += ranks[k];
  }
  const U1 = R1 - n1 * (n1 + 1) / 2;
  const U = Math.min(U1, n1 * n2 - U1);
  const muU = n1 * n2 / 2;
  const sigmaU = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
  const z = sigmaU > 0 ? (U1 - muU) / sigmaU : 0;
  // Two-tailed p-value from z (normal approximation)
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  const r = Math.abs(z) / Math.sqrt(n1 + n2);
  return { U, z, p: Math.max(p, 1e-10), r: Math.round(r * 1000) / 1000 };
}

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// Helper: Spearman rank correlation
function spearmanCorr(x, y) {
  if (x.length !== y.length || x.length < 5) return { rho: 0, p: 1 };
  const n = x.length;
  const rankX = getRanks(x), rankY = getRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rankX[i] - rankY[i]) ** 2;
  const rho = 1 - (6 * sumD2) / (n * (n * n - 1));
  // t-test for significance
  const t = rho * Math.sqrt((n - 2) / (1 - rho * rho));
  const p = 2 * (1 - tCDF(Math.abs(t), n - 2));
  return { rho: Math.round(rho * 1000) / 1000, p: Math.max(p, 1e-10) };
}

function getRanks(arr) {
  const indexed = arr.map((v, i) => ({v, i})).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avg;
    i = j;
  }
  return ranks;
}

// Approximate t-distribution CDF
function tCDF(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
}

function incompleteBeta(a, b, x) {
  // Simple numerical approximation
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;
  // Continued fraction
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    let m = Math.floor(i / 2);
    let num;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;
    if (Math.abs(d * c - 1) < 1e-8) break;
  }
  return front * f;
}

function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -5.395239384953e-06];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
\`\`\`

## Output format for findings
When you discover a signal, format it EXACTLY as:
FINDING: ID | features: f001,u002 | test: correlation | r=0.12 | p=0.003 | N=156 | samples: A(p=0.008),B(p=0.034),... | validated: 3/5 | direction: positive

When you discover a near-miss:
NEAR_MISS: ID | features: u162 | test: correlation | r=0.089 | p=0.041 | N=180 | samples: A(p=0.041),B(p=0.112),... | validated: 2/5 | direction: positive | note: may work in subset

## Rules
- You CANNOT see company names, tickers, or real feature names. Do not try to infer them.
- You MUST test on an independent sample before declaring any finding.
- Track EVERYTHING in a running log.
- Budget awareness: report estimated iterations remaining when asked.
- Write JavaScript code that I will execute. Output it in \`\`\`javascript blocks.
- After each code block, I will run it and give you the output. Then propose your next test.
- Be systematic: test the most promising features first, kill dead ends quickly.`;

// ============================================
// HYPOTHESIS DEFINITIONS
// ============================================
function buildHypotheses() {
  return [
    // Price/Volume hypotheses
    { id: 'H01', desc: '12-month momentum predicts winners', code: `testFeature('u151', 'positive')` },
    { id: 'H02', desc: '6-month momentum predicts winners', code: `testFeature('u150', 'positive')` },
    { id: 'H03', desc: 'Lower volatility predicts winners', code: `testFeature('u153', 'negative')` },
    { id: 'H04', desc: 'Higher up-weeks pct predicts winners', code: `testFeature('u155', 'positive')` },
    { id: 'H05', desc: 'Smaller drawdown predicts winners', code: `testFeature('u156', 'positive')` },
    { id: 'H06', desc: 'Higher relative volume predicts winners', code: `testFeature('u154', 'positive')` },
    // Short interest
    { id: 'H07', desc: 'Lower short ratio predicts winners', code: `testFeature('u158', 'negative')` },
    { id: 'H08', desc: 'Lower short pct float predicts winners', code: `testFeature('u159', 'negative')` },
    // Macro
    { id: 'H09', desc: 'VIX at entry predicts outcomes', code: `testFeature('u162', 'any')` },
    { id: 'H10', desc: 'Yield curve slope at entry predicts outcomes', code: `testFeature('u161', 'any')` },
    { id: 'H11', desc: 'Credit spread at entry predicts outcomes', code: `testFeature('u160', 'any')` },
    { id: 'H12', desc: 'S&P trailing return at entry predicts outcomes', code: `testFeature('u165', 'any')` },
    // Filing quality
    { id: 'H13', desc: 'Late filings predict traps', code: `testFeature('u020', 'negative')` },
    { id: 'H14', desc: 'Amendments predict traps', code: `testFeature('u021', 'negative')` },
    { id: 'H15', desc: 'Filing size growth predicts traps', code: `testFeature('u022', 'negative')` },
    // Customer concentration
    { id: 'H16', desc: 'Higher customer concentration predicts traps', code: `testFeature('u081', 'negative')` },
    { id: 'H17', desc: 'Concentration disclosed flag predicts traps', code: `testFeature('u080', 'any')` },
    // Exec comp
    { id: 'H18', desc: 'Higher CEO comp predicts winners (bigger companies)', code: `testFeature('u070', 'positive')` },
    { id: 'H19', desc: 'Higher salary pct (less performance pay) predicts traps', code: `testFeature('u072', 'negative')` },
    { id: 'H20', desc: 'Higher equity pct predicts winners', code: `testFeature('u073', 'positive')` },
    // Fundamentals
    { id: 'H21', desc: 'Revenue growth predicts winners', code: `testFeature('f001', 'positive')` },
    { id: 'H22', desc: 'Operating margin predicts winners', code: `testFeature('f010', 'positive')` },
    { id: 'H23', desc: 'ROIC predicts winners', code: `testFeature('f014', 'positive')` },
    { id: 'H24', desc: 'Asset growth predicts winners', code: `testFeature('f021', 'positive')` },
    { id: 'H25', desc: 'Better earnings quality (lower accruals) predicts winners', code: `testFeature('f040', 'negative')` },
    { id: 'H26', desc: 'FCF/NI ratio predicts winners', code: `testFeature('f043', 'positive')` },
    { id: 'H27', desc: 'Lower leverage predicts winners', code: `testFeature('f050', 'negative')` },
    { id: 'H28', desc: 'Revenue acceleration predicts winners', code: `testFeature('f004', 'positive')` },
    { id: 'H29', desc: 'Margin improvement predicts winners', code: `testFeature('f011', 'positive')` },
    { id: 'H30', desc: 'Zipf velocity predicts winners', code: `testFeature('f060', 'positive')` },
    { id: 'H31', desc: 'Flywheel momentum predicts winners', code: `testFeature('f061', 'positive')` },
    // Interactions
    { id: 'H32', desc: 'Momentum + margin interaction', code: `testInteraction('u151', 'f010')` },
    { id: 'H33', desc: 'Revenue growth + quality interaction', code: `testInteraction('f001', 'f040')` },
    { id: 'H34', desc: 'Filing quality + fundamentals interaction', code: `testInteraction('u024', 'f001')` },
    { id: 'H35', desc: 'Short interest + momentum interaction', code: `testInteraction('u158', 'u151')` },
  ];
}

// ============================================
// AGENT EXECUTION ENGINE
// ============================================
const client = new Anthropic();

// State
let conversationHistory = [];
let researchLog = [];
let findings = [];

async function sendToAgent(userMessage) {
  if (budgetRemaining() < 0.50) {
    console.log(`\n${R}Budget limit approaching ($${budgetRemaining().toFixed(2)} remaining). Wrapping up.${X}`);
    return null;
  }

  conversationHistory.push({ role: 'user', content: userMessage });

  // Trim history if it gets too long (keep system context + last N turns)
  if (conversationHistory.length > 40) {
    // Keep first 4 messages (initial data + context) and last 20
    const head = conversationHistory.slice(0, 4);
    const tail = conversationHistory.slice(-20);
    conversationHistory = [...head, { role: 'user', content: '[Earlier conversation trimmed for context. Continue from your most recent analysis.]' }, ...tail];
    // Ensure alternating roles
    const fixed = [];
    for (let i = 0; i < conversationHistory.length; i++) {
      if (i > 0 && conversationHistory[i].role === conversationHistory[i-1].role) {
        if (conversationHistory[i].role === 'user') {
          fixed.push({ role: 'assistant', content: 'Understood, continuing.' });
        }
      }
      fixed.push(conversationHistory[i]);
    }
    conversationHistory = fixed;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: conversationHistory,
    });

    const text = response.content.map(c => c.text || '').join('');
    conversationHistory.push({ role: 'assistant', content: text });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    iterationCount++;

    const cost = estimateCost();
    console.log(`  ${C}Iteration ${iterationCount}${X} | Cost: $${cost.toFixed(2)} | Budget left: $${budgetRemaining().toFixed(2)} | Tokens: ${response.usage.input_tokens}in/${response.usage.output_tokens}out`);

    // Save progress
    if (iterationCount % 5 === 0) saveProgress();

    return text;
  } catch (e) {
    console.error(`${R}API Error: ${e.message}${X}`);
    conversationHistory.pop(); // Remove the user message that failed
    return null;
  }
}

// Execute JavaScript code blocks from agent's response
function extractCodeBlocks(text) {
  const blocks = [];
  const pattern = /```javascript\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function executeCode(code, samples, featureDict) {
  // Build execution context with helper functions
  const fullCode = `
    ${readFileSync(resolve(import.meta.dirname, '../data/agent/stat-helpers.js'), 'utf-8')}

    // Quick test helpers
    function testFeature(featureKey, direction) {
      const results = {};
      for (const [name, sample] of Object.entries(samples)) {
        const pairs = getPairs(sample, featureKey);
        if (pairs.length < 20) { results[name] = { N: pairs.length, skip: 'insufficient data' }; continue; }
        const winners = pairs.filter(p => p.outcome === 1).map(p => p.val);
        const traps = pairs.filter(p => p.outcome === 0).map(p => p.val);
        const mw = mannWhitneyU(winners, traps);
        const sp = spearmanCorr(pairs.map(p => p.val), pairs.map(p => p.outcome));
        results[name] = { N: pairs.length, Nw: winners.length, Nt: traps.length, ...mw, rho: sp.rho, sp_p: sp.p, meanW: mean(winners), meanT: mean(traps) };
      }
      return results;
    }

    function testInteraction(feat1, feat2) {
      const results = {};
      for (const [name, sample] of Object.entries(samples)) {
        const pairs = sample
          .map(c => ({
            v1: c.features[feat1] ?? c.unconventional[feat1],
            v2: c.features[feat2] ?? c.unconventional[feat2],
            outcome: c.outcome
          }))
          .filter(p => p.v1 != null && p.v2 != null);
        if (pairs.length < 20) { results[name] = { N: pairs.length, skip: 'insufficient data' }; continue; }
        // Test: product of z-scores
        const combo = pairs.map(p => ({ val: p.v1 * p.v2, outcome: p.outcome }));
        const winners = combo.filter(p => p.outcome === 1).map(p => p.val);
        const traps = combo.filter(p => p.outcome === 0).map(p => p.val);
        const mw = mannWhitneyU(winners, traps);
        // Also test 2x2: both above median
        const med1 = median(pairs.map(p => p.v1));
        const med2 = median(pairs.map(p => p.v2));
        const cells = { hh: { w: 0, t: 0 }, hl: { w: 0, t: 0 }, lh: { w: 0, t: 0 }, ll: { w: 0, t: 0 } };
        for (const p of pairs) {
          const k = (p.v1 >= med1 ? 'h' : 'l') + (p.v2 >= med2 ? 'h' : 'l');
          if (p.outcome === 1) cells[k].w++; else cells[k].t++;
        }
        results[name] = { N: pairs.length, ...mw, cells };
      }
      return results;
    }

    function mean(arr) { return arr.length ? arr.reduce((s,v) => s+v, 0) / arr.length : 0; }
    function median(arr) { const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length/2)]; }

    // Execute the agent's code
    ${code}
  `;

  try {
    const fn = new Function('samples', 'featureDict', fullCode);
    return fn(samples, featureDict);
  } catch (e) {
    return { error: e.message, stack: e.stack?.split('\n').slice(0, 3).join('\n') };
  }
}

// Extract FINDING/NEAR_MISS lines from agent response
function parseFindings(text) {
  const results = [];
  for (const line of text.split('\n')) {
    const findingMatch = line.match(/^(FINDING|NEAR_MISS):\s*(.+)/);
    if (findingMatch) {
      results.push({
        type: findingMatch[1],
        raw: findingMatch[2],
        iteration: iterationCount,
        timestamp: new Date().toISOString(),
      });
    }
  }
  return results;
}

// ============================================
// PROGRESS & RESULTS
// ============================================
function saveProgress() {
  const progress = {
    iteration: iterationCount,
    cost: estimateCost(),
    budgetRemaining: budgetRemaining(),
    tokensIn: totalInputTokens,
    tokensOut: totalOutputTokens,
    findingsCount: findings.length,
    findings,
    researchLog: researchLog.slice(-50),
    timestamp: new Date().toISOString(),
  };
  writeFileSync(resolve(RESULTS_DIR, 'progress.json'), JSON.stringify(progress, null, 2));
}

function saveFinalResults() {
  const robust = findings.filter(f => f.type === 'FINDING');
  const nearMiss = findings.filter(f => f.type === 'NEAR_MISS');

  writeFileSync(resolve(RESULTS_DIR, 'final-results.json'), JSON.stringify({
    totalIterations: iterationCount,
    totalCost: estimateCost(),
    totalTokensIn: totalInputTokens,
    totalTokensOut: totalOutputTokens,
    findings: robust,
    nearMisses: nearMiss,
    allTested: researchLog,
    timestamp: new Date().toISOString(),
  }, null, 2));

  // Human-readable summary
  let summary = `# Sonnet Research Agent — Final Results\n\n`;
  summary += `**Iterations:** ${iterationCount}\n`;
  summary += `**Cost:** $${estimateCost().toFixed(2)} of $${MAX_BUDGET} budget\n`;
  summary += `**Hypotheses tested:** ${researchLog.length}\n`;
  summary += `**Findings (3+ samples):** ${robust.length}\n`;
  summary += `**Near-misses (2 samples):** ${nearMiss.length}\n\n`;

  if (robust.length > 0) {
    summary += `## Robust Findings\n\n`;
    for (const f of robust) {
      summary += `- ${f.raw}\n`;
    }
    summary += '\n';
  }

  if (nearMiss.length > 0) {
    summary += `## Near-Misses\n\n`;
    for (const f of nearMiss) {
      summary += `- ${f.raw}\n`;
    }
    summary += '\n';
  }

  summary += `\n---\n*These findings use anonymous feature codes. De-anonymization required for interpretation.*\n`;
  summary += `*Generated: ${new Date().toISOString()}*\n`;

  writeFileSync(resolve(RESULTS_DIR, 'final-summary.md'), summary);
  console.log(`\n${G}Results saved to ${RESULTS_DIR}${X}`);
}

// ============================================
// MAIN LOOP
// ============================================
async function main() {
  console.log(`${B}Autonomous Research Agent — Blind Signal Discovery${X}`);
  console.log('='.repeat(60));
  console.log(`Budget: $${MAX_BUDGET} | Max iterations: ${MAX_ITERATIONS}`);

  // Verify API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${R}Error: ANTHROPIC_API_KEY not set${X}`);
    process.exit(1);
  }

  // Load samples
  console.log(`\n${C}Loading anonymized samples...${X}`);
  const samples = {};
  for (const name of ['A', 'B', 'C', 'D', 'E']) {
    const path = resolve(AGENT_DIR, `sample-${name}.json`);
    if (!existsSync(path)) {
      console.error(`${R}Missing ${path}. Run anonymize-dataset.js first.${X}`);
      process.exit(1);
    }
    samples[name] = loadJSON(path);
    console.log(`  Sample ${name}: ${samples[name].length} cases`);
  }

  const featureDict = loadJSON(resolve(AGENT_DIR, 'feature-dictionary.json'));
  const coverage = loadJSON(resolve(AGENT_DIR, 'coverage-summary.json'));
  const hypotheses = buildHypotheses();

  // Write stat helpers file for code execution
  writeFileSync(resolve(AGENT_DIR, 'stat-helpers.js'), `
// Statistical helpers available to agent code
function getPairs(sample, featureKey) {
  return sample
    .map(c => ({ val: c.features[featureKey] ?? c.unconventional[featureKey], outcome: c.outcome }))
    .filter(p => p.val != null && typeof p.val === 'number');
}

function mannWhitneyU(group1, group2) {
  const n1 = group1.length, n2 = group2.length;
  if (n1 < 5 || n2 < 5) return { U: null, z: null, p: 1, r: 0 };
  const combined = [...group1.map(v => ({v, g: 1})), ...group2.map(v => ({v, g: 2}))];
  combined.sort((a, b) => a.v - b.v);
  const ranks = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].v === combined[i].v) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }
  let R1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].g === 1) R1 += ranks[k];
  }
  const U1 = R1 - n1 * (n1 + 1) / 2;
  const U = Math.min(U1, n1 * n2 - U1);
  const muU = n1 * n2 / 2;
  const sigmaU = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12);
  const z = sigmaU > 0 ? (U1 - muU) / sigmaU : 0;
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  const r = Math.abs(z) / Math.sqrt(n1 + n2);
  return { U, z: Math.round(z*1000)/1000, p: Math.max(p, 1e-10), r: Math.round(r * 1000) / 1000 };
}

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function spearmanCorr(x, y) {
  if (x.length !== y.length || x.length < 5) return { rho: 0, p: 1 };
  const n = x.length;
  const rankX = getRanks(x), rankY = getRanks(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) sumD2 += (rankX[i] - rankY[i]) ** 2;
  const rho = 1 - (6 * sumD2) / (n * (n * n - 1));
  const t = rho * Math.sqrt((n - 2) / (1 - rho * rho + 1e-10));
  const df = n - 2;
  const p = df > 0 ? 2 * (1 - tCDF(Math.abs(t), df)) : 1;
  return { rho: Math.round(rho * 1000) / 1000, p: Math.max(p, 1e-10) };
}

function getRanks(arr) {
  const indexed = arr.map((v, i) => ({v, i})).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avg;
    i = j;
  }
  return ranks;
}

function tCDF(t, df) {
  if (df <= 0) return 0.5;
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
}

function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnB) / a;
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    let m = Math.floor(i / 2), num;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2*m - 1) * (a + 2*m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2*m) * (a + 2*m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1/d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;
    if (Math.abs(d * c - 1) < 1e-8) break;
  }
  return front * f;
}

function lnGamma(x) {
  const c = [76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.001208650973866179,-5.395239384953e-06];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
`);

  // === PHASE 1: Initial exploration on Sample A ===
  console.log(`\n${B}Phase 1: Initial exploration${X}`);

  const sampleASummary = {
    cases: samples.A.length,
    winners: samples.A.filter(c => c.outcome === 1).length,
    traps: samples.A.filter(c => c.outcome === 0).length,
    sectors: [...new Set(samples.A.map(c => c.sector).filter(Boolean))].length,
    periods: [...new Set(samples.A.map(c => c.period).filter(Boolean))].length,
    sampleFeatureKeys: Object.keys(samples.A[0]?.features || {}),
    sampleUnconvKeys: Object.keys(samples.A[0]?.unconventional || {}).filter(k => !k.startsWith('_')),
  };

  let response = await sendToAgent(
    `Here is your task setup:\n\n` +
    `**Sample A summary:** ${JSON.stringify(sampleASummary)}\n\n` +
    `**Feature dictionary:** ${JSON.stringify(featureDict)}\n\n` +
    `**Data coverage:** ${JSON.stringify(coverage)}\n\n` +
    `**Starting hypotheses (${hypotheses.length}):**\n${hypotheses.map(h => `${h.id}: ${h.desc}`).join('\n')}\n\n` +
    `You have the full Sample A data loaded. Begin by writing JavaScript code to:\n` +
    `1. Check which features have sufficient non-null coverage (>50% of cases)\n` +
    `2. Run a quick scan: for every high-coverage feature, compute Mann-Whitney U test (winners vs traps) and Spearman correlation with outcome\n` +
    `3. Sort by p-value and report the top 20 most promising features\n\n` +
    `Output your code in a \`\`\`javascript block. I will execute it and return results.`
  );

  if (!response) { saveFinalResults(); return; }

  // Main agent loop
  while (iterationCount < MAX_ITERATIONS && budgetRemaining() > 0.50) {
    // Extract and run code blocks
    const codeBlocks = extractCodeBlocks(response);
    let executionResults = '';

    if (codeBlocks.length > 0) {
      for (let bi = 0; bi < codeBlocks.length; bi++) {
        console.log(`  ${Y}Executing code block ${bi + 1}/${codeBlocks.length}...${X}`);
        const result = executeCode(codeBlocks[bi], samples, featureDict);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        // Truncate very long results
        executionResults += `\n--- Code block ${bi + 1} result ---\n${resultStr.slice(0, 8000)}`;
        if (resultStr.length > 8000) executionResults += `\n[...truncated, ${resultStr.length} chars total]`;
      }
    }

    // Parse findings
    const newFindings = parseFindings(response);
    if (newFindings.length > 0) {
      findings.push(...newFindings);
      console.log(`  ${G}Found ${newFindings.length} new findings (total: ${findings.length})${X}`);
    }

    // Log any research notes
    researchLog.push({
      iteration: iterationCount,
      codeBlocks: codeBlocks.length,
      findings: newFindings.length,
      cost: estimateCost(),
    });

    // Construct next message
    let nextMessage = '';
    if (executionResults) {
      nextMessage = `Execution results:\n${executionResults}\n\n`;
      nextMessage += `Budget: $${budgetRemaining().toFixed(2)} remaining. Iteration ${iterationCount}/${MAX_ITERATIONS}.\n`;
      nextMessage += `Findings so far: ${findings.length} (${findings.filter(f => f.type === 'FINDING').length} robust, ${findings.filter(f => f.type === 'NEAR_MISS').length} near-miss).\n\n`;
      nextMessage += `Continue your analysis. What's your next test?`;
    } else {
      nextMessage += `No code blocks found in your response. Please write JavaScript code in a \`\`\`javascript block for me to execute, or report your final findings.`;
    }

    response = await sendToAgent(nextMessage);
    if (!response) break;

    // Check if agent is done
    if (response.includes('FINAL REPORT') || response.includes('research complete') || response.includes('no more hypotheses')) {
      const finalFindings = parseFindings(response);
      findings.push(...finalFindings);
      console.log(`\n${G}Agent declares research complete.${X}`);
      break;
    }
  }

  // Save final results
  saveFinalResults();

  console.log(`\n${B}Research Complete${X}`);
  console.log(`  Iterations: ${iterationCount}`);
  console.log(`  Total cost: $${estimateCost().toFixed(2)}`);
  console.log(`  Findings: ${findings.filter(f => f.type === 'FINDING').length} robust, ${findings.filter(f => f.type === 'NEAR_MISS').length} near-miss`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
