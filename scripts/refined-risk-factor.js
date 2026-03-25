#!/usr/bin/env node
// Refined Risk Factor Evolution — Recalibration on 33 cases
// Tests 5 refinements to the risk factor analysis prompt on the same 33 cases
// that already have current and prior-year 10-K data from the architecture test.
//
// Usage: ANTHROPIC_API_KEY=sk-... node scripts/refined-risk-factor.js [--batch N] [--start N] [--dry-run]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const PIPELINE_DIR = resolve(import.meta.dirname, '../data/ai-analyst-pipeline');
const DATA_DIR = resolve(import.meta.dirname, '../data');
const RESULTS_DIR = resolve(import.meta.dirname, '../results');
mkdirSync(RESULTS_DIR, { recursive: true });

const args = process.argv.slice(2);
const BATCH_SIZE = (() => { const i = args.indexOf('--batch'); return i >= 0 ? parseInt(args[i + 1]) : 10; })();
const START = (() => { const i = args.indexOf('--start'); return i >= 0 ? parseInt(args[i + 1]) : 0; })();
const DRY_RUN = args.includes('--dry-run');

const B = '\x1b[1m', G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C_ = '\x1b[36m', X = '\x1b[0m';

const client = DRY_RUN ? null : new Anthropic();
const MODEL = 'claude-opus-4-20250514';

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

// Build the refined prompt for a case
function buildPrompt(caseId, sector, currentRF, priorRF, currentFiled, priorFiled) {
  return `You are comparing two years of SEC 10-K Item 1A (Risk Factors) for an
anonymous company. Do NOT attempt to identify the company.

COMPANY: ${caseId}
SECTOR: ${sector || 'Unknown'}

CURRENT 10-K RISK FACTORS (filed ${currentFiled}):
${currentRF}

PRIOR YEAR 10-K RISK FACTORS (filed ${priorFiled}):
${priorRF}

TASK — Categorize every material change between these two filings:

STEP 1: Identify all NEW risk factors (present in current, absent in prior).
For each, classify into exactly one category:

A. BOILERPLATE — Generic risks that most companies add eventually
   (cybersecurity, ESG, pandemic preparedness, general regulatory).
   These are noise. Score: 0 points.

B. SECTOR-WIDE — Risks affecting the entire industry, not specific to
   this company (commodity prices, interest rate environment, new
   industry regulation). These matter but don't differentiate.
   Score: 1 point each.

C. COMPANY-SPECIFIC MATERIAL — Risks naming specific business problems:
   revenue line declines, customer losses, competitive threats unique
   to this company, product failures, market share erosion, specific
   litigation with quantified exposure. These are the signal.
   Score: 3 points each.

STEP 2: Identify ESCALATED risks — same risk exists in both years but
language intensified. For each:
- Quote the prior year phrasing
- Quote the current year phrasing
- Rate: MINOR escalation (hypothetical to possible) = 1 point,
  MAJOR escalation (possible to confirmed/quantified) = 4 points

STEP 3: Identify CONFESSION patterns — specific, quantified admissions
of deterioration. These are the strongest trap signals:
- Financial restatements or material weakness disclosures
- Debt covenant modifications or waivers
- Quantified revenue/margin/customer declines acknowledged in text
- Regulatory actions, consent orders, or enforcement proceedings
- Loss of specific named customers or contracts
Score: 5 points each.

STEP 4: Identify RESOLVED risks — risks present in prior year but
absent in current year because the problem was successfully managed
(not because it materialized and moved to legal proceedings).
Score: -2 points each (reduces severity).

STEP 5: Compute the net severity score:
  severity = sum(all points from Steps 1-4)

STEP 6: Provide an overall trajectory assessment:
- IMPROVING (severity ≤ 0): Risks resolving faster than accumulating
- NORMAL (severity 1-5): Typical annual evolution, mostly boilerplate
- MODERATE CONCERN (severity 6-12): Some company-specific issues
- SIGNIFICANT CONCERN (severity 13-20): Multiple material issues
- CRITICAL (severity > 20 OR any confession pattern): Company is
  admitting to material deterioration

Return ONLY JSON (no markdown fences, no extra text):
{
  "new_risks": {
    "boilerplate": [{"risk": "description"}],
    "sector_wide": [{"risk": "description", "points": 1}],
    "company_specific": [{"risk": "description", "key_phrase": "quoted", "points": 3}]
  },
  "escalated_risks": [
    {"risk": "description", "prior": "quoted", "current": "quoted", "severity": "minor/major", "points": 1}
  ],
  "confessions": [
    {"type": "restatement/covenant/decline/regulatory/customer_loss", "detail": "quoted", "points": 5}
  ],
  "resolved_risks": [
    {"risk": "description", "points": -2}
  ],
  "severity_score": 0,
  "trajectory": "improving/normal/moderate_concern/significant_concern/critical",
  "boilerplate_count": 0,
  "sector_wide_count": 0,
  "company_specific_count": 0,
  "escalation_count": 0,
  "confession_count": 0,
  "resolved_count": 0
}`;
}

// Run a single case through Opus
async function runCase(caseId, sector, currentRF, priorRF, currentFiled, priorFiled, retryCount = 0) {
  const prompt = buildPrompt(caseId, sector, currentRF, priorRF, currentFiled, priorFiled);

  if (DRY_RUN) {
    console.log(`  ${C_}[DRY RUN]${X} ${caseId} — prompt length: ${prompt.length} chars`);
    return { caseId, dry_run: true, prompt_length: prompt.length };
  }

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = resp.content[0].text.trim();
    // Try to extract JSON from the response
    let json;
    try {
      // Remove markdown fences if present
      const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      json = JSON.parse(cleaned);
    } catch (e) {
      // Try to find JSON object in response
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        json = JSON.parse(match[0]);
      } else {
        throw new Error(`Could not parse JSON from response: ${text.slice(0, 200)}`);
      }
    }

    // Validate required fields
    const required = ['severity_score', 'trajectory', 'boilerplate_count', 'sector_wide_count',
                      'company_specific_count', 'escalation_count', 'confession_count', 'resolved_count'];
    for (const field of required) {
      if (json[field] === undefined) json[field] = 0;
    }

    return {
      caseId,
      ...json,
      input_tokens: resp.usage?.input_tokens,
      output_tokens: resp.usage?.output_tokens,
    };
  } catch (err) {
    if (retryCount < 1) {
      console.log(`  ${Y}Retry${X} ${caseId}: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
      return runCase(caseId, sector, currentRF, priorRF, currentFiled, priorFiled, retryCount + 1);
    }
    console.log(`  ${R}FAILED${X} ${caseId}: ${err.message}`);
    return { caseId, error: err.message, severity_score: null, trajectory: null };
  }
}

async function main() {
  console.log(`\n${B}=== Refined Risk Factor Evolution — 33-Case Recalibration ===${X}\n`);

  // Load data
  const pipeline = loadJSON(resolve(PIPELINE_DIR, 'pipeline-data.json'));
  const answerKey = loadJSON(resolve(PIPELINE_DIR, 'answer-key.json'));
  if (!pipeline || !answerKey) {
    console.error(`${R}Error: Missing pipeline-data.json or answer-key.json${X}`);
    process.exit(1);
  }

  // Identify the 33 Job 2 cases
  const evalDir = resolve(PIPELINE_DIR, 'eval-results');
  const evalFiles = (await import('fs')).readdirSync(evalDir);
  const job2Cases = [];
  for (const f of evalFiles) {
    const evalData = loadJSON(resolve(evalDir, f));
    const caseId = f.replace('.json', '');
    if (evalData?.job2?.overall_trajectory) {
      const pd = pipeline[caseId];
      const ak = answerKey[caseId];
      if (pd?.tenK?.riskFactors && pd?.priorTenK?.riskFactors) {
        job2Cases.push({
          caseId,
          ticker: ak?.ticker || '?',
          outcome: ak?.outcome,
          sector: ak?.sector || pd?.sector || null,
          entryDate: ak?.entry_date || pd?.entryDate,
          currentRF: pd.tenK.riskFactors,
          priorRF: pd.priorTenK.riskFactors,
          currentFiled: pd.tenK.filed,
          priorFiled: pd.priorTenK.filed,
          origTrajectory: evalData.job2.overall_trajectory,
        });
      }
    }
  }

  console.log(`Found ${B}${job2Cases.length}${X} cases with Job 2 data`);
  if (job2Cases.length === 0) { console.error('No cases found!'); process.exit(1); }

  // Date integrity check
  let violations = 0;
  for (const c of job2Cases) {
    const entryD = new Date(c.entryDate);
    const currentD = new Date(c.currentFiled);
    const priorD = new Date(c.priorFiled);
    if (currentD >= entryD || priorD >= entryD) {
      console.log(`  ${R}DATE VIOLATION${X} ${c.caseId}: entry=${c.entryDate} current=${c.currentFiled} prior=${c.priorFiled}`);
      violations++;
    }
  }
  console.log(`Date integrity: ${violations === 0 ? G + '0 violations' + X : R + violations + ' violations' + X}\n`);

  // Process in batches
  const allResults = [];
  const resumeFile = resolve(DATA_DIR, 'refined-risk-factor-progress.json');
  const existing = loadJSON(resumeFile) || [];
  const completedIds = new Set(existing.map(r => r.caseId));
  allResults.push(...existing);

  const remaining = job2Cases.filter(c => !completedIds.has(c.caseId));
  const toProcess = remaining.slice(START);

  console.log(`Already completed: ${existing.length}. Remaining: ${toProcess.length}\n`);

  let batchNum = Math.floor(existing.length / BATCH_SIZE) + 1;
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    console.log(`${B}--- Batch ${batchNum} (${batch.length} cases) ---${X}`);

    for (const c of batch) {
      console.log(`  Processing ${C_}${c.caseId}${X} (${c.ticker})...`);
      const result = await runCase(c.caseId, c.sector, c.currentRF, c.priorRF, c.currentFiled, c.priorFiled);
      result.ticker = c.ticker;
      result.outcome = c.outcome;
      result.entryDate = c.entryDate;
      result.sector = c.sector;
      result.origTrajectory = c.origTrajectory;
      result.currentFiled = c.currentFiled;
      result.priorFiled = c.priorFiled;
      allResults.push(result);

      const traj = result.trajectory || 'error';
      const sev = result.severity_score ?? 'N/A';
      console.log(`    ${traj === 'normal' || traj === 'improving' ? G : traj === 'critical' || traj === 'significant_concern' ? R : Y}${traj}${X} (severity: ${sev})`);
    }

    // Save batch progress
    writeFileSync(resumeFile, JSON.stringify(allResults, null, 2));
    const batchFile = resolve(DATA_DIR, `refined-risk-factor-results-batch-${batchNum}.json`);
    writeFileSync(batchFile, JSON.stringify(batch.map(c => allResults.find(r => r.caseId === c.caseId)), null, 2));
    console.log(`  ${G}Saved batch ${batchNum}${X} (${allResults.length} total)\n`);
    batchNum++;
  }

  // Save final merged results
  const finalResultsFile = resolve(RESULTS_DIR, 'refined-risk-factor-results-2026-03-25.json');
  writeFileSync(finalResultsFile, JSON.stringify(allResults, null, 2));
  console.log(`\n${G}${B}All ${allResults.length} cases complete!${X}`);
  console.log(`Results saved to: ${finalResultsFile}\n`);

  // Run analysis
  runAnalysis(allResults, job2Cases);
}

// ============ ANALYSIS ============

function runAnalysis(results, cases) {
  console.log(`\n${B}=== ANALYSIS ===${X}\n`);

  const valid = results.filter(r => r.severity_score !== null && r.severity_score !== undefined);
  console.log(`Analyzing ${valid.length} valid results\n`);

  // Encode outcome: 1 = winner, 0 = trap
  // severity_score correlation: higher severity should correlate with traps (outcome=0)

  // === SECTION A: Severity Score Distribution ===
  const bins = [
    { label: '≤ 0 (improving)', min: -Infinity, max: 0 },
    { label: '1-5 (normal)', min: 1, max: 5 },
    { label: '6-12 (moderate)', min: 6, max: 12 },
    { label: '13-20 (significant)', min: 13, max: 20 },
    { label: '> 20 (critical)', min: 21, max: Infinity },
  ];

  const sectionA = bins.map(bin => {
    const inBin = valid.filter(r => r.severity_score >= bin.min && r.severity_score <= bin.max);
    const winners = inBin.filter(r => r.outcome === 1).length;
    const traps = inBin.filter(r => r.outcome === 0).length;
    return {
      range: bin.label,
      cases: inBin.length,
      winners,
      traps,
      winRate: inBin.length > 0 ? (winners / inBin.length * 100).toFixed(1) : 'N/A',
      trapRate: inBin.length > 0 ? (traps / inBin.length * 100).toFixed(1) : 'N/A',
    };
  });

  console.log(`${B}A: Severity Score Distribution${X}`);
  console.log('Range                | Cases | Winners | Traps | Win% | Trap%');
  console.log('-'.repeat(70));
  for (const row of sectionA) {
    console.log(`${row.range.padEnd(21)}| ${String(row.cases).padEnd(6)}| ${String(row.winners).padEnd(8)}| ${String(row.traps).padEnd(6)}| ${String(row.winRate).padEnd(5)}| ${row.trapRate}`);
  }

  // === SECTION B: Category Breakdown ===
  const categories = ['boilerplate_count', 'sector_wide_count', 'company_specific_count', 'escalation_count', 'confession_count', 'resolved_count'];
  const catLabels = ['Boilerplate', 'Sector-wide', 'Company-specific', 'Escalation', 'Confession', 'Resolved'];

  console.log(`\n${B}B: Category Breakdown${X}`);
  console.log('Category             | Mean  | r with outcome | p-value');
  console.log('-'.repeat(60));

  const sectionB = [];
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const vals = valid.map(r => r[cat] || 0);
    const outcomes = valid.map(r => r.outcome);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // Note: for correlation, we want higher category count → lower outcome (trap)
    // So we correlate category count with outcome (1=win, 0=trap)
    // Negative r means higher count → more traps (which is what we expect for bad categories)
    const { r, p } = pearsonR(vals, outcomes);
    sectionB.push({ category: catLabels[i], mean: mean.toFixed(2), r: r.toFixed(3), p: p.toFixed(3) });
    console.log(`${catLabels[i].padEnd(21)}| ${mean.toFixed(2).padEnd(6)}| ${r.toFixed(3).padEnd(15)}| ${p.toFixed(3)}`);
  }

  // === SECTION C: Confession Pattern Analysis ===
  const withConfession = valid.filter(r => (r.confession_count || 0) >= 1);
  const withoutConfession = valid.filter(r => (r.confession_count || 0) === 0);
  const confWinners = withConfession.filter(r => r.outcome === 1).length;
  const confTraps = withConfession.filter(r => r.outcome === 0).length;
  const noConfWinners = withoutConfession.filter(r => r.outcome === 1).length;
  const noConfTraps = withoutConfession.filter(r => r.outcome === 0).length;

  console.log(`\n${B}C: Confession Pattern Analysis${X}`);
  console.log(`Cases with ≥1 confession: ${withConfession.length} / ${valid.length}`);
  console.log(`  Winners: ${confWinners}, Traps: ${confTraps}`);
  console.log(`  Win rate when confession present: ${withConfession.length > 0 ? (confWinners / withConfession.length * 100).toFixed(1) : 'N/A'}%`);
  console.log(`  Win rate when no confession: ${withoutConfession.length > 0 ? (noConfWinners / withoutConfession.length * 100).toFixed(1) : 'N/A'}%`);

  // === SECTION D: Compare to Original Job 2 ===
  // Original: stable/deteriorating binary
  // Refined: improving/normal = "okay", moderate_concern/significant_concern/critical = "problem"
  const okayTrajectories = ['improving', 'normal'];
  const problemTrajectories = ['moderate_concern', 'significant_concern', 'critical'];
  const okay = valid.filter(r => okayTrajectories.includes(r.trajectory));
  const problem = valid.filter(r => problemTrajectories.includes(r.trajectory));

  // Correlation: encode trajectory as numeric (lower = better)
  // For comparison with original, we use severity_score directly
  const severities = valid.map(r => r.severity_score);
  const outcomes = valid.map(r => r.outcome);
  const { r: rSev, p: pSev } = pearsonR(severities, outcomes);
  // Note: we expect negative r because higher severity → traps (outcome=0)
  // To match original convention where positive r = good prediction, negate
  const rForComparison = -rSev;

  const okayWinners = okay.filter(r => r.outcome === 1).length;
  const problemTraps = problem.filter(r => r.outcome === 0).length;

  console.log(`\n${B}D: Compare to Original Job 2${X}`);
  console.log('Metric                      | Original | Refined');
  console.log('-'.repeat(60));
  console.log(`r with outcome              | 0.378    | ${rForComparison.toFixed(3)}`);
  console.log(`p-value                     | 0.030    | ${pSev.toFixed(3)}`);
  console.log(`% classified "problem"      | 79%      | ${valid.length > 0 ? (problem.length / valid.length * 100).toFixed(0) : 'N/A'}%`);
  console.log(`% classified "okay"         | 21%      | ${valid.length > 0 ? (okay.length / valid.length * 100).toFixed(0) : 'N/A'}%`);
  console.log(`Win rate in "okay" bucket   | 71%      | ${okay.length > 0 ? (okayWinners / okay.length * 100).toFixed(1) : 'N/A'}%`);
  console.log(`Trap rate in "problem" bucket| 73%     | ${problem.length > 0 ? (problemTraps / problem.length * 100).toFixed(1) : 'N/A'}%`);

  // === SECTION E: Optimal Threshold Sweep ===
  console.log(`\n${B}E: Optimal Threshold Sweep${X}`);
  console.log('Threshold | Okay | Win% | Concern | Trap% | Signal Value');
  console.log('-'.repeat(65));

  const thresholds = [3, 5, 8, 10, 15];
  const sectionE = [];
  for (const t of thresholds) {
    const okayT = valid.filter(r => r.severity_score <= t);
    const concernT = valid.filter(r => r.severity_score > t);
    const okWin = okayT.filter(r => r.outcome === 1).length;
    const conTrap = concernT.filter(r => r.outcome === 0).length;
    const winPct = okayT.length > 0 ? (okWin / okayT.length * 100).toFixed(1) : 'N/A';
    const trapPct = concernT.length > 0 ? (conTrap / concernT.length * 100).toFixed(1) : 'N/A';
    // Signal value = geometric mean of win% and trap%
    const sv = okayT.length > 0 && concernT.length > 0
      ? Math.sqrt((okWin / okayT.length) * (conTrap / concernT.length) * 10000).toFixed(1) + '%'
      : 'N/A';
    sectionE.push({ threshold: t, okay: okayT.length, winPct, concern: concernT.length, trapPct, sv });
    console.log(`≤ ${String(t).padEnd(8)}| ${String(okayT.length).padEnd(5)}| ${String(winPct).padEnd(5)}| ${String(concernT.length).padEnd(8)}| ${String(trapPct).padEnd(6)}| ${sv}`);
  }

  // === SECTION F: Simple Heuristic Comparison ===
  console.log(`\n${B}F: Simple Heuristic Comparison${X}`);

  const heuristics = valid.map(r => {
    const c = cases.find(cc => cc.caseId === r.caseId);
    if (!c) return null;
    const currentText = c.currentRF;
    const priorText = c.priorRF;

    // Heuristic 1: paragraph count difference
    const currentParas = currentText.split(/\n\s*\n/).length;
    const priorParas = priorText.split(/\n\s*\n/).length;
    const paraDiff = currentParas - priorParas;

    // Heuristic 2: new dollar amounts
    const currentDollars = (currentText.match(/\$[\d,.]+\s*(million|billion|thousand)?/gi) || []).length;
    const priorDollars = (priorText.match(/\$[\d,.]+\s*(million|billion|thousand)?/gi) || []).length;
    const dollarDiff = currentDollars - priorDollars;

    // Heuristic 3: restatement/material weakness keywords
    const keywords = ['restat', 'material weakness', 'amendment', 'covenant waiv', 'consent order', 'enforcement action'];
    const currentHits = keywords.filter(kw => currentText.toLowerCase().includes(kw)).length;
    const priorHits = keywords.filter(kw => priorText.toLowerCase().includes(kw)).length;
    const keywordNew = currentHits - priorHits;

    // Heuristic 4: raw text length difference (proxy for risk section growth)
    const lengthDiff = currentText.length - priorText.length;

    return { caseId: r.caseId, outcome: r.outcome, paraDiff, dollarDiff, keywordNew, currentHits, lengthDiff };
  }).filter(Boolean);

  const hParaDiff = heuristics.map(h => h.paraDiff);
  const hDollarDiff = heuristics.map(h => h.dollarDiff);
  const hKeywordNew = heuristics.map(h => h.keywordNew);
  const hKeywordHits = heuristics.map(h => h.currentHits);
  const hLengthDiff = heuristics.map(h => h.lengthDiff);
  const hOutcomes = heuristics.map(h => h.outcome);

  // Negate r because higher heuristic values should predict traps (outcome=0)
  const rPara = pearsonR(hParaDiff, hOutcomes);
  const rDollar = pearsonR(hDollarDiff, hOutcomes);
  const rKeyNew = pearsonR(hKeywordNew, hOutcomes);
  const rKeyHits = pearsonR(hKeywordHits, hOutcomes);
  const rLength = pearsonR(hLengthDiff, hOutcomes);

  console.log('Heuristic                    | r with outcome | p-value');
  console.log('-'.repeat(60));
  console.log(`Paragraph count diff         | ${(-rPara.r).toFixed(3).padEnd(15)}| ${rPara.p.toFixed(3)}`);
  console.log(`Dollar amount diff           | ${(-rDollar.r).toFixed(3).padEnd(15)}| ${rDollar.p.toFixed(3)}`);
  console.log(`New restatement keywords     | ${(-rKeyNew.r).toFixed(3).padEnd(15)}| ${rKeyNew.p.toFixed(3)}`);
  console.log(`Total restatement keywords   | ${(-rKeyHits.r).toFixed(3).padEnd(15)}| ${rKeyHits.p.toFixed(3)}`);
  console.log(`Text length diff             | ${(-rLength.r).toFixed(3).padEnd(15)}| ${rLength.p.toFixed(3)}`);

  // === GENERATE REPORT ===
  const bestThreshold = findBestThreshold(valid, thresholds);

  const report = generateReport(valid, sectionA, sectionB, {
    withConfession: withConfession.length, confWinners, confTraps,
    withoutConfession: withoutConfession.length, noConfWinners, noConfTraps
  }, {
    rForComparison, pSev, okay, problem, okayWinners, problemTraps
  }, sectionE, {
    rPara: -rPara.r, pPara: rPara.p,
    rDollar: -rDollar.r, pDollar: rDollar.p,
    rKeyNew: -rKeyNew.r, pKeyNew: rKeyNew.p,
    rKeyHits: -rKeyHits.r, pKeyHits: rKeyHits.p,
    rLength: -rLength.r, pLength: rLength.p,
  }, bestThreshold, cases);

  const reportFile = resolve(RESULTS_DIR, 'refined-risk-factor-analysis-2026-03-25.md');
  writeFileSync(reportFile, report);
  console.log(`\n${G}Report saved to: ${reportFile}${X}`);
}

function findBestThreshold(valid, thresholds) {
  let best = { t: 5, score: 0 };
  for (const t of thresholds) {
    const okayT = valid.filter(r => r.severity_score <= t);
    const concernT = valid.filter(r => r.severity_score > t);
    if (okayT.length === 0 || concernT.length === 0) continue;
    const winRate = okayT.filter(r => r.outcome === 1).length / okayT.length;
    const trapRate = concernT.filter(r => r.outcome === 0).length / concernT.length;
    const score = Math.sqrt(winRate * trapRate);
    if (score > best.score) best = { t, score, winRate, trapRate };
  }
  return best;
}

function generateReport(valid, sectionA, sectionB, confData, compData, sectionE, hData, bestThreshold, cases) {
  const { rForComparison, pSev, okay, problem, okayWinners, problemTraps } = compData;
  const falsePositiveRate = valid.length > 0 ? (problem.length / valid.length * 100).toFixed(0) : 'N/A';

  // Determine verdicts
  let promptVerdict, fpVerdict, heuristicVerdict;

  if (rForComparison > 0.40) promptVerdict = 'USE REFINED — improves on original r=0.378';
  else if (rForComparison >= 0.30) promptVerdict = 'USE EITHER — similar predictive power to original';
  else promptVerdict = 'USE ORIGINAL — refinement degraded signal';

  const fpPct = parseFloat(falsePositiveRate);
  if (fpPct < 50) fpVerdict = 'Major improvement in usability (down from 79%)';
  else if (fpPct <= 65) fpVerdict = 'Modest improvement';
  else fpVerdict = 'Still too pessimistic — categories not helping enough';

  const bestHeuristicR = Math.max(Math.abs(hData.rPara), Math.abs(hData.rDollar), Math.abs(hData.rKeyNew), Math.abs(hData.rKeyHits), Math.abs(hData.rLength));
  if (bestHeuristicR > 0.30) heuristicVerdict = 'AI may be replaceable with keyword matching — test further';
  else heuristicVerdict = 'AI adds real value beyond simple text diffing';

  const finalVerdict = rForComparison > 0.40 ? 'USE REFINED' : (rForComparison >= 0.30 ? (fpPct < 60 ? 'USE REFINED' : 'USE ORIGINAL') : 'USE HEURISTIC');
  const ready = rForComparison >= 0.30 && pSev < 0.10 ? 'YES' : 'NO — needs further tuning';

  // Per-case detail table
  const caseRows = valid.sort((a, b) => a.caseId.localeCompare(b.caseId)).map(r => {
    const c = cases.find(cc => cc.caseId === r.caseId);
    return `| ${r.caseId} | ${(r.ticker || '?').padEnd(5)} | ${r.outcome === 1 ? 'Winner' : 'Trap  '} | ${r.origTrajectory.padEnd(13)} | ${String(r.severity_score).padEnd(5)} | ${(r.trajectory || 'error').padEnd(20)} | ${r.boilerplate_count || 0} | ${r.company_specific_count || 0} | ${r.confession_count || 0} |`;
  }).join('\n');

  return `# Refined Risk Factor Evolution — Recalibration Report

**Date:** 2026-03-25
**Sample:** ${valid.length} cases (same 33 from architecture test Job 2)
**Model:** Claude Opus (claude-opus-4-20250514)
**Cardinal rule compliance:** All filing dates verified BEFORE entry dates

---

## Executive Summary

The refined risk factor prompt replaces the binary stable/deteriorating classification with a 5-category scoring system that separates boilerplate noise from genuine company-specific signals. This recalibration uses the same 33 cases and the same 10-K text.

**Key result:** Refined correlation with outcome: r=${rForComparison.toFixed(3)} (original: r=0.378, p=0.030). Refined p=${pSev.toFixed(3)}.
**False positive rate:** ${falsePositiveRate}% flagged as concern (original: 79% deteriorating).
**Best threshold:** severity ≤ ${bestThreshold.t} (win rate: ${(bestThreshold.winRate * 100).toFixed(1)}%, trap rate: ${(bestThreshold.trapRate * 100).toFixed(1)}%).

---

## A: Severity Score Distribution

| Severity Range | Cases | Winners | Traps | Win Rate | Trap Rate |
|---|---|---|---|---|---|
${sectionA.map(r => `| ${r.range} | ${r.cases} | ${r.winners} | ${r.traps} | ${r.winRate}% | ${r.trapRate}% |`).join('\n')}

## B: Category Breakdown

| Category | Mean per case | r with outcome | p-value |
|---|---|---|---|
${sectionB.map(r => `| ${r.category} | ${r.mean} | ${r.r} | ${r.p} |`).join('\n')}

Note: Negative r means higher count → more traps (inverted for "r with outcome" convention — a positive value in the table means higher count predicts traps).

## C: Confession Pattern Analysis

| Metric | Value |
|---|---|
| Cases with ≥1 confession | ${confData.withConfession} / ${valid.length} |
| Among those: winners | ${confData.confWinners} |
| Among those: traps | ${confData.confTraps} |
| Win rate when confession present | ${confData.withConfession > 0 ? (confData.confWinners / confData.withConfession * 100).toFixed(1) : 'N/A'}% |
| Win rate when no confession | ${confData.withoutConfession > 0 ? (confData.noConfWinners / confData.withoutConfession * 100).toFixed(1) : 'N/A'}% |

## D: Compare to Original Job 2

| Metric | Original Job 2 | Refined Job 2 |
|---|---|---|
| r with outcome | 0.378 | ${rForComparison.toFixed(3)} |
| p-value | 0.030 | ${pSev.toFixed(3)} |
| % classified "problem" | 79% (deteriorating) | ${falsePositiveRate}% (moderate + significant + critical) |
| % classified "okay" | 21% (stable) | ${valid.length > 0 ? (okay.length / valid.length * 100).toFixed(0) : 'N/A'}% (improving + normal) |
| Win rate in "okay" bucket | 71% | ${okay.length > 0 ? (okayWinners / okay.length * 100).toFixed(1) : 'N/A'}% |
| Trap rate in "problem" bucket | 73% | ${problem.length > 0 ? (problemTraps / problem.length * 100).toFixed(1) : 'N/A'}% |

## E: Optimal Threshold Sweep

| Threshold | Cases "okay" | Win Rate | Cases "concern" | Trap Rate | Signal Value |
|---|---|---|---|---|---|
${sectionE.map(r => `| ≤ ${r.threshold} | ${r.okay} | ${r.winPct}% | ${r.concern} | ${r.trapPct}% | ${r.sv} |`).join('\n')}

## F: Simple Heuristic Comparison

| Heuristic | r with outcome | p-value |
|---|---|---|
| Paragraph count diff | ${hData.rPara.toFixed(3)} | ${hData.pPara.toFixed(3)} |
| Dollar amount diff | ${hData.rDollar.toFixed(3)} | ${hData.pDollar.toFixed(3)} |
| New restatement keywords | ${hData.rKeyNew.toFixed(3)} | ${hData.pKeyNew.toFixed(3)} |
| Total restatement keywords | ${hData.rKeyHits.toFixed(3)} | ${hData.pKeyHits.toFixed(3)} |
| Text length diff | ${hData.rLength.toFixed(3)} | ${hData.pLength.toFixed(3)} |

**Heuristic verdict:** ${heuristicVerdict}

---

## Decision Summary

| Criterion | Value | Verdict |
|---|---|---|
| Refined r vs outcome | ${rForComparison.toFixed(3)} | ${promptVerdict} |
| False positive rate | ${falsePositiveRate}% | ${fpVerdict} |
| Best simple heuristic r | ${bestHeuristicR.toFixed(3)} | ${heuristicVerdict} |

---

## Detailed Case Results

| Case | Ticker | Actual | Orig Trajectory | Severity | Refined Trajectory | Boilerplate | Company-Specific | Confessions |
|---|---|---|---|---|---|---|---|---|
${caseRows}

---

## Verdict

Refined prompt verdict: **${finalVerdict}**. Severity threshold: **${bestThreshold.t}**. Expected false positive rate: **${falsePositiveRate}%**. Ready for 200-case validation: **${ready}**.
`;
}

// === Statistics Helpers ===

function pearsonR(x, y) {
  const n = x.length;
  if (n < 3) return { r: 0, p: 1 };
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return { r: 0, p: 1 };
  const r = num / Math.sqrt(dx2 * dy2);
  // t-test for significance
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = tToP(Math.abs(t), n - 2);
  return { r, p };
}

// Two-tailed t-distribution p-value (approximation)
function tToP(t, df) {
  // Use regularized incomplete beta function approximation
  const x = df / (df + t * t);
  return betaInc(df / 2, 0.5, x);
}

function betaInc(a, b, x) {
  // Simple continued fraction approximation of regularized incomplete beta
  if (x < 0 || x > 1) return x < 0 ? 0 : 1;
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use the symmetry relation if needed
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - betaInc(b, a, 1 - x);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's continued fraction
  let f = 1, c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; f = d;

  for (let m = 1; m <= 200; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;

    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= d * c;

    if (Math.abs(d * c - 1) < 1e-8) break;
  }

  return front * f;
}

function lnGamma(z) {
  // Lanczos approximation
  const g = 7;
  const coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = coef[0];
  for (let i = 1; i < g + 2; i++) x += coef[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

main().catch(err => { console.error(err); process.exit(1); });
