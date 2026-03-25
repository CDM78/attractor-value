#!/usr/bin/env node
// TEST 1: AI Score Stability
// Runs the exact deployed attractor scoring prompt 10 times on 10 companies
// to measure score variance, signal flip rate, and inter-run consistency.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const EDGAR_CACHE = resolve(DATA_DIR, 'edgar-cache');
const RESULTS_DIR = resolve(DATA_DIR, 'agent/results');
mkdirSync(RESULTS_DIR, { recursive: true });

const client = new Anthropic();
function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', Y = '\x1b[33m', X = '\x1b[0m';

const RUNS_PER_COMPANY = 10;
const BULL_WEIGHT = 0.4;
const BEAR_WEIGHT = 0.6;

// ============================================
// TEST COMPANIES
// ============================================
const TEST_COMPANIES = [
  // 3 BUY signals
  { ticker: 'META', name: 'Meta Platforms Inc', sector: 'Information Technology', category: 'BUY' },
  { ticker: 'PAYC', name: 'Paycom Software Inc', sector: 'Information Technology', category: 'BUY' },
  { ticker: 'BRBR', name: 'BellRing Brands Inc', sector: 'Consumer Staples', category: 'BUY' },
  // 4 near-boundary
  { ticker: 'IBM', name: 'International Business Machines Corp', sector: 'Information Technology', category: 'BOUNDARY' },
  { ticker: 'PFE', name: 'Pfizer Inc', sector: 'Health Care', category: 'BOUNDARY' },
  { ticker: 'DIS', name: 'Walt Disney Co', sector: 'Communication Services', category: 'BOUNDARY' },
  { ticker: 'FDX', name: 'FedEx Corp', sector: 'Industrials', category: 'BOUNDARY' },
  // 3 known traps
  { ticker: 'INTC', name: 'Intel Corp', sector: 'Information Technology', category: 'TRAP' },
  { ticker: 'WBA', name: 'Walgreens Boots Alliance Inc', sector: 'Consumer Staples', category: 'TRAP' },
  { ticker: 'T', name: 'AT&T Inc', sector: 'Communication Services', category: 'TRAP' },
];

// ============================================
// EDGAR DATA EXTRACTION
// ============================================
function getFactValues(facts, tags) {
  for (const ns of ['us-gaap', 'ifrs-full']) {
    const nsFacts = facts?.facts?.[ns];
    if (!nsFacts) continue;
    for (const tag of tags) {
      const concept = nsFacts[tag];
      if (!concept) continue;
      const vals = concept.units?.USD || concept.units?.['USD/shares'] || concept.units?.shares || Object.values(concept.units || {})[0];
      if (vals?.length) return vals;
    }
  }
  const dei = facts?.facts?.dei;
  if (dei) {
    for (const tag of tags) {
      const concept = dei[tag];
      if (!concept) continue;
      const vals = concept.units?.shares || Object.values(concept.units || {})[0];
      if (vals?.length) return vals;
    }
  }
  return [];
}

function getAnnualValues(values, n = 5) {
  const annual = values.filter(v => v.form === '10-K' || v.form === '20-F').sort((a, b) => b.end.localeCompare(a.end));
  const seen = new Set();
  return annual.filter(v => { const fy = v.fy || v.end.slice(0, 4); if (seen.has(fy)) return false; seen.add(fy); return true; }).slice(0, n).reverse();
}

function buildFinancialContextFromEdgar(ticker, name, sector, facts) {
  if (!facts) return `Company: ${name} (${ticker})\nSector: ${sector}\nNo financial data available.`;

  const lines = [];
  lines.push(`Company: ${name} (${ticker})`);
  lines.push(`Sector: ${sector}`);

  const revVals = getFactValues(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet']);
  const epsVals = getFactValues(facts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic']);
  const niVals = getFactValues(facts, ['NetIncomeLoss']);
  const equityVals = getFactValues(facts, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']);
  const debtVals = getFactValues(facts, ['LongTermDebt', 'LongTermDebtNoncurrent']);
  const ocfVals = getFactValues(facts, ['NetCashProvidedByOperatingActivities']);
  const capexVals = getFactValues(facts, ['PaymentsToAcquirePropertyPlantAndEquipment']);
  const assetsVals = getFactValues(facts, ['Assets']);
  const goodwillVals = getFactValues(facts, ['Goodwill']);

  const revAnnual = getAnnualValues(revVals, 5);
  const epsAnnual = getAnnualValues(epsVals, 5);
  const niAnnual = getAnnualValues(niVals, 5);
  const equityAnnual = getAnnualValues(equityVals, 5);
  const debtAnnual = getAnnualValues(debtVals, 5);
  const ocfAnnual = getAnnualValues(ocfVals, 5);
  const capexAnnual = getAnnualValues(capexVals, 5);

  lines.push(`\nFinancial History (${Math.max(revAnnual.length, epsAnnual.length)} years):`);
  for (let i = 0; i < Math.max(revAnnual.length, epsAnnual.length); i++) {
    const year = epsAnnual[i]?.fy || revAnnual[i]?.fy || '?';
    const eps = epsAnnual[i]?.val;
    const rev = revAnnual[i]?.val;
    const ni = niAnnual[i]?.val;
    const eq = equityAnnual[i]?.val;
    const debt = debtAnnual[i]?.val;
    const ocf = ocfAnnual[i]?.val;
    const capex = capexAnnual[i]?.val;
    const de = (debt != null && eq && eq > 0) ? (debt / eq).toFixed(2) : 'N/A';
    const fcf = (ocf != null && capex != null) ? ((ocf - Math.abs(capex)) / 1e6).toFixed(0) + 'M' : 'N/A';
    const roic = (ni != null && eq != null && debt != null && (eq + debt) > 0) ? ((ni / (eq + debt)) * 100).toFixed(1) + '%' : 'N/A';

    lines.push(`  ${year}: EPS=$${eps?.toFixed(2) || 'N/A'}, Rev=$${rev ? (rev / 1e9).toFixed(1) + 'B' : 'N/A'}, FCF=$${fcf}, D/E=${de}, ROIC=${roic}`);
  }

  // Earnings quality
  const latestNI = niAnnual.length ? niAnnual[niAnnual.length - 1].val : null;
  const latestOCF = ocfAnnual.length ? ocfAnnual[ocfAnnual.length - 1].val : null;
  const latestAssets = getAnnualValues(assetsVals, 1)[0]?.val;
  const latestGoodwill = getAnnualValues(goodwillVals, 1)[0]?.val;

  if (latestAssets) {
    lines.push('\nEARNINGS QUALITY METRICS:');
    if (latestNI != null && latestOCF != null) {
      const accruals = ((latestNI - latestOCF) / latestAssets * 100).toFixed(1);
      lines.push(`  Accruals Ratio: ${accruals}%${Math.abs(parseFloat(accruals)) > 10 ? ' ⚠ HIGH' : ''}`);
    }
    if (latestGoodwill != null) {
      const gw = (latestGoodwill / latestAssets * 100).toFixed(1);
      lines.push(`  Goodwill/Assets: ${gw}%${parseFloat(gw) > 40 ? ' ⚠ HIGH' : ''}`);
    }
    if (latestOCF != null) {
      lines.push(`  Operating Cash Flow: $${(latestOCF / 1e6).toFixed(0)}M`);
    }
  }

  return lines.join('\n');
}

// ============================================
// PROMPT BUILDERS (matching deployed code)
// ============================================
function buildBullPrompt(ticker, name, financialContext) {
  return `You are a value investing analyst using the Attractor Value Framework. Analyze ${name} (${ticker}) for attractor stability.

FRAMEWORK: A "stable attractor" is a business whose competitive position and earnings power are self-reinforcing — pulled back toward equilibrium after perturbation. Score each factor 1-5:

1. **Revenue Durability** (1-5): How recurring, diversified, and switching-cost-protected is revenue?
2. **Competitive Reinforcement** (1-5): Do competitive advantages compound over time (brand, scale, patents, network effects)?
3. **Industry Structure** (1-5): Is the industry consolidated with rational competition, or fragmented with price wars?
4. **Demand Feedback** (1-5): Does customer behavior create positive feedback loops (habit, ecosystem lock-in)?
5. **Adaptation Capacity** (1-5): Can the company adapt to disruption without destroying its core attractor?
6. **Capital Allocation** (1-5): Track record of disciplined capital deployment (returns > cost of capital, sensible M&A, buybacks at discount)?

NETWORK REGIME: Classify as one of:
- **classical**: Traditional competitive advantages (brand, scale, cost)
- **soft_network**: Mild network effects, switching costs
- **hard_network**: Strong network effects, winner-take-most
- **platform**: Multi-sided platform dynamics

IMPORTANT GUIDANCE ON ADAPTATION CAPACITY SCORING:
Score 4-5 ONLY if the company has previously navigated a major industry disruption and emerged stronger, AND current adaptations have a clear path to revenue growth.
Score 2-3 if adaptation efforts are credible but unproven, or primarily defensive.
Score 1 if adaptation efforts consist primarily of press releases, partnerships, and rebranding without measurable business model changes.

FINANCIAL DATA:
${financialContext}

No 10-K filing data available. Base analysis on financial data and public knowledge.

Respond in EXACTLY this JSON format (no markdown, no code fences):
{
  "revenue_durability_score": <1-5>,
  "competitive_reinforcement_score": <1-5>,
  "industry_structure_score": <1-5>,
  "demand_feedback_score": <1-5>,
  "adaptation_capacity_score": <1-5>,
  "capital_allocation_score": <1-5>,
  "network_regime": "<classical|soft_network|hard_network|platform>",
  "analysis_text": "<2-3 paragraph analysis>"
}`;
}

function buildBearPrompt(ticker, name, financialContext, bullOutput) {
  return `You are a skeptical analyst reviewing the following attractor stability assessment for ${name} (${ticker}). Your job is to argue against this assessment. For each factor, identify the strongest reason the score should be LOWER. Then provide your own revised factor scores (1-5 scale).

Be specific. Cite concrete risks: regulatory changes, competitive threats, technological disruption, customer concentration, management quality concerns, or financial structure weaknesses. Do not accept the bull case framing — find the weaknesses.

FINANCIAL DATA:
${financialContext}

BULL CASE ASSESSMENT TO CHALLENGE:
${bullOutput}

Respond in EXACTLY this JSON format (no markdown, no code fences):
{
  "revenue_durability_score": <1-5>,
  "competitive_reinforcement_score": <1-5>,
  "industry_structure_score": <1-5>,
  "demand_feedback_score": <1-5>,
  "adaptation_capacity_score": <1-5>,
  "capital_allocation_score": <1-5>,
  "attractor_stability_score": <1.0-5.0>,
  "analysis_text": "<2-3 paragraph bear case>"
}`;
}

// ============================================
// API CALLER
// ============================================
function parseJSON(text) {
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try extracting from markdown fences
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) try { return JSON.parse(match[1].trim()); } catch {}
  // Try finding { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) try { return JSON.parse(braceMatch[0]); } catch {}
  return null;
}

let totalTokens = { input: 0, output: 0 };
let callCount = 0;

async function callSonnet(prompt) {
  callCount++;
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });
  totalTokens.input += response.usage.input_tokens;
  totalTokens.output += response.usage.output_tokens;
  const text = response.content.map(c => c.text || '').join('');
  return { text, parsed: parseJSON(text) };
}

function computeComposite(bullScores, bearScores) {
  const factors = ['revenue_durability_score', 'competitive_reinforcement_score', 'industry_structure_score', 'demand_feedback_score', 'adaptation_capacity_score', 'capital_allocation_score'];
  const weighted = [];
  for (const f of factors) {
    const b = bullScores?.[f];
    const br = bearScores?.[f];
    if (b != null && br != null) {
      weighted.push(b * BULL_WEIGHT + br * BEAR_WEIGHT);
    }
  }
  return weighted.length > 0 ? Math.round(weighted.reduce((s, v) => s + v, 0) / weighted.length * 10) / 10 : null;
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${B}TEST 1: AI Score Stability${X}`);
  console.log('='.repeat(60));
  console.log(`Companies: ${TEST_COMPANIES.length}`);
  console.log(`Runs per company: ${RUNS_PER_COMPANY}`);
  console.log(`Total API calls: ~${TEST_COMPANIES.length * RUNS_PER_COMPANY * 2}`);
  console.log('');

  const cikCache = loadJSON(resolve(DATA_DIR, 'cik-cache.json')) || {};
  const allResults = {};

  for (const company of TEST_COMPANIES) {
    console.log(`\n${C}${company.ticker} (${company.category})${X}`);

    // Load EDGAR data
    const cikEntry = cikCache[company.ticker];
    const cik = cikEntry?.cik;
    const facts = cik ? loadJSON(resolve(EDGAR_CACHE, `${cik}.json`)) : null;
    const financialContext = buildFinancialContextFromEdgar(company.ticker, company.name, company.sector, facts);

    const runs = [];

    for (let run = 0; run < RUNS_PER_COMPANY; run++) {
      try {
        // Bull case
        const bull = await callSonnet(buildBullPrompt(company.ticker, company.name, financialContext));
        if (!bull.parsed) {
          console.log(`  Run ${run + 1}: Bull parse failed`);
          continue;
        }

        // Bear case
        const bear = await callSonnet(buildBearPrompt(company.ticker, company.name, financialContext, bull.text));
        if (!bear.parsed) {
          console.log(`  Run ${run + 1}: Bear parse failed`);
          continue;
        }

        const composite = computeComposite(bull.parsed, bear.parsed);
        const factors = ['revenue_durability_score', 'competitive_reinforcement_score', 'industry_structure_score', 'demand_feedback_score', 'adaptation_capacity_score', 'capital_allocation_score'];
        const bullAvg = factors.map(f => bull.parsed[f]).filter(v => v != null);
        const bearAvg = factors.map(f => bear.parsed[f]).filter(v => v != null);

        runs.push({
          run: run + 1,
          bullScores: factors.map(f => bull.parsed[f]),
          bearScores: factors.map(f => bear.parsed[f]),
          bullAvg: bullAvg.length ? Math.round(bullAvg.reduce((s, v) => s + v, 0) / bullAvg.length * 10) / 10 : null,
          bearAvg: bearAvg.length ? Math.round(bearAvg.reduce((s, v) => s + v, 0) / bearAvg.length * 10) / 10 : null,
          composite,
          signal: composite >= 3.0 ? 'BUY_ELIGIBLE' : 'PASS',
        });

        process.stdout.write(`  Run ${run + 1}: composite=${composite} (bull=${runs[runs.length-1].bullAvg} bear=${runs[runs.length-1].bearAvg}) → ${runs[runs.length-1].signal}\n`);

      } catch (e) {
        console.log(`  Run ${run + 1}: API error — ${e.message}`);
      }

      // Brief delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    // Compute statistics
    const composites = runs.map(r => r.composite).filter(v => v != null);
    const mean = composites.length ? composites.reduce((s, v) => s + v, 0) / composites.length : null;
    const sd = composites.length > 1
      ? Math.sqrt(composites.reduce((s, v) => s + (v - mean) ** 2, 0) / (composites.length - 1))
      : null;
    const signals = runs.map(r => r.signal);
    const buyCount = signals.filter(s => s === 'BUY_ELIGIBLE').length;
    const passCount = signals.filter(s => s === 'PASS').length;
    const flipRate = Math.min(buyCount, passCount) / signals.length;

    allResults[company.ticker] = {
      ...company,
      runs,
      stats: {
        mean: mean ? Math.round(mean * 100) / 100 : null,
        sd: sd ? Math.round(sd * 100) / 100 : null,
        min: composites.length ? Math.min(...composites) : null,
        max: composites.length ? Math.max(...composites) : null,
        range: composites.length ? Math.round((Math.max(...composites) - Math.min(...composites)) * 10) / 10 : null,
        flipRate: Math.round(flipRate * 100),
        buyEligibleCount: buyCount,
        passCount,
        validRuns: composites.length,
      },
    };

    console.log(`  ${B}Mean=${allResults[company.ticker].stats.mean} SD=${allResults[company.ticker].stats.sd} Range=${allResults[company.ticker].stats.range} FlipRate=${allResults[company.ticker].stats.flipRate}%${X}`);
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${B}TEST 1 RESULTS SUMMARY${X}`);
  console.log('='.repeat(60));
  console.log('Ticker   Category   Mean   SD    Range  FlipRate  Verdict');
  console.log('-'.repeat(60));

  let anyFail = false;
  let anyMarginal = false;

  for (const [ticker, data] of Object.entries(allResults)) {
    const s = data.stats;
    let verdict, color;
    if (s.sd > 0.4 || s.flipRate > 20) { verdict = 'FAIL'; color = R; anyFail = true; }
    else if (s.sd > 0.2) { verdict = 'MARGINAL'; color = Y; anyMarginal = true; }
    else { verdict = 'PASS'; color = G; }

    console.log(
      ticker.padEnd(9) +
      data.category.padEnd(11) +
      String(s.mean).padStart(4) + '   ' +
      (s.sd?.toFixed(2) || 'N/A').padStart(4) + '   ' +
      String(s.range).padStart(3) + '    ' +
      (s.flipRate + '%').padStart(5) + '     ' +
      color + verdict + X
    );
  }

  console.log('-'.repeat(60));
  console.log(`API calls: ${callCount} | Tokens: ${totalTokens.input}in/${totalTokens.output}out`);
  console.log(`Estimated cost: $${((totalTokens.input * 3 + totalTokens.output * 15) / 1e6).toFixed(2)}`);

  // Overall verdict
  console.log(`\n${B}OVERALL TEST 1 VERDICT:${X}`);
  if (anyFail) {
    console.log(`${R}FAIL — One or more companies have SD > 0.4 or flip rate > 20%. The scoring system is too noisy for threshold-based decisions.${X}`);
  } else if (anyMarginal) {
    console.log(`${Y}MARGINAL — Scores are noisy (SD 0.2-0.4). Threshold decisions near 3.0 are unreliable.${X}`);
  } else {
    console.log(`${G}PASS — All companies have SD < 0.2 and flip rate ≤ 20%. Scores are stable enough for threshold use.${X}`);
  }

  // Save results
  writeFileSync(resolve(RESULTS_DIR, 'test1-stability-results.json'), JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to ${RESULTS_DIR}/test1-stability-results.json`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
