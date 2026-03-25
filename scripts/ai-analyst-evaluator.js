#!/usr/bin/env node
/**
 * AI Analyst Evaluator — Phases 2-3
 * Generates evaluation prompts from pipeline data for sub-agent processing.
 * Outputs structured JSON prompts that can be fed to Claude sub-agents.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const PIPELINE_DIR = resolve(DATA_DIR, 'ai-analyst-pipeline');
const RESULTS_DIR = resolve(PIPELINE_DIR, 'eval-results');
mkdirSync(RESULTS_DIR, { recursive: true });

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

// Build Job 1 prompt: Management Credibility Score
function buildJob1Prompt(blindId, sector, mdaQuarters) {
  if (!mdaQuarters || mdaQuarters.length < 2) return null;

  const quarterTexts = mdaQuarters
    .sort((a, b) => a.quarter.localeCompare(b.quarter))
    .map((q, i) => `--- Quarter ${i+1} (filed ${q.quarter}) ---\n${q.text?.slice(0, 8000) || '[No text available]'}`)
    .join('\n\n');

  return `You are analyzing management's track record of delivering on commitments.
You will be given MD&A sections from sequential quarters for an anonymous company.
Do NOT attempt to identify the company.

COMPANY: ${blindId}
SECTOR: ${sector}

QUARTERLY MD&A DOCUMENTS (in chronological order):
${quarterTexts}

TASK:
1. Identify every SPECIFIC, TRACKABLE commitment management made in earlier
   quarters. Examples: revenue growth targets, margin expansion plans, product
   launch timelines, cost reduction goals, market share claims.

2. For each commitment, check whether subsequent quarters' documents confirm
   delivery, partial delivery, or failure. Only count commitments where a
   later document provides evidence either way.

3. Compute: commitments_delivered / total_trackable_commitments

4. Flag any pattern of language shifts: specific guidance becoming vague,
   confident statements becoming hedged, or topics being dropped entirely.

Return ONLY valid JSON (no markdown, no code fences):
{
  "total_commitments_tracked": X,
  "commitments_delivered": X,
  "commitments_missed": X,
  "credibility_score": X.XX,
  "language_shifts": [
    {"quarter": "QX", "shift": "description of linguistic change"}
  ],
  "red_flags": ["flag1", "flag2"]
}`;
}

// Build Job 2 prompt: Risk Factor Evolution
function buildJob2Prompt(blindId, sector, tenK, priorTenK) {
  if (!tenK?.riskFactors || !priorTenK?.riskFactors) return null;

  return `You are analyzing changes in a company's SEC risk factor disclosures.
Do NOT attempt to identify the company.

COMPANY: ${blindId}
SECTOR: ${sector}

CURRENT 10-K RISK FACTORS (Item 1A, filed ${tenK.filed}):
${tenK.riskFactors.slice(0, 20000)}

PRIOR YEAR 10-K RISK FACTORS (Item 1A, filed ${priorTenK.filed}):
${priorTenK.riskFactors.slice(0, 20000)}

TASK:
1. Identify NEW risk factors that appear in the current filing but were
   NOT present in the prior year. Quote the key phrase.

2. Identify risk factors where LANGUAGE ESCALATED — e.g., "may face" became
   "are experiencing," "could impact" became "has materially impacted."
   Quote both versions.

3. Identify risk factors that DISAPPEARED from the prior year.

4. Count total risk factors in each year.

Return ONLY valid JSON (no markdown, no code fences):
{
  "current_risk_count": X,
  "prior_risk_count": X,
  "new_risks": [
    {"risk": "description", "key_phrase": "quoted text", "severity": "high/medium/low"}
  ],
  "escalated_risks": [
    {"risk": "description", "prior_language": "quoted", "current_language": "quoted"}
  ],
  "disappeared_risks": [
    {"risk": "description", "likely_reason": "resolved/materialized/unclear"}
  ],
  "overall_trajectory": "improving/stable/deteriorating"
}`;
}

// Build Job 3 prompt: Competitive Cross-Reference
function buildJob3Prompt(blindId, sector, tenK, competitors) {
  if (!tenK?.mda || !competitors || competitors.length === 0) return null;

  const compTexts = competitors.map((c, i) => {
    return `COMPETITOR ${String.fromCharCode(65 + i)} 10-K MD&A EXCERPT (filed ${c.filed}):\n${(c.mda || c.riskFactors || '[No competitive data]').slice(0, 8000)}`;
  }).join('\n\n');

  return `You are analyzing competitive dynamics by cross-referencing SEC filings
from a target company and its direct competitors.
Do NOT attempt to identify any company.

TARGET COMPANY: ${blindId}
SECTOR: ${sector}

TARGET 10-K MD&A (Item 7) EXCERPT — key competitive claims:
${tenK.mda.slice(0, 12000)}

${compTexts}

TASK:
1. Identify any CONTRADICTIONS between the target's claims and competitors'
   claims about market position, share, or competitive dynamics.

2. Identify any CORROBORATIONS — where competitors' filings support the
   target's claims.

3. Assess whether the target's competitive language is SPECIFIC (quantified
   claims, named market positions) or VAGUE (generic "strong position" claims).

Return ONLY valid JSON (no markdown, no code fences):
{
  "contradictions": [
    {"target_claim": "quoted", "competitor_claim": "quoted", "competitor": "A/B/C"}
  ],
  "corroborations": [
    {"claim": "description", "evidence": "quoted from competitor filing"}
  ],
  "target_language_quality": "specific/mixed/vague",
  "competitive_position_assessment": "strengthening/stable/weakening",
  "confidence": "high/medium/low"
}`;
}

// Build Job 4 prompt: Language Trajectory
function buildJob4Prompt(blindId, sector, mdaQuarters) {
  if (!mdaQuarters || mdaQuarters.length < 2) return null;

  const quarterTexts = mdaQuarters
    .sort((a, b) => a.quarter.localeCompare(b.quarter))
    .map((q, i) => `--- Quarter ${i+1} (filed ${q.quarter}) ---\n${q.text?.slice(0, 6000) || '[No text]'}`)
    .join('\n\n');

  return `You are analyzing how management's communication style has changed over
recent quarters. Do NOT attempt to identify the company.

COMPANY: ${blindId}

QUARTERLY MD&A DOCUMENTS (chronological):
${quarterTexts}

TASK — focus ONLY on linguistic patterns, not financial content:

1. GUIDANCE SPECIFICITY: Is management's forward-looking language becoming
   more specific or more vague over time?

2. HEDGING FREQUENCY: Count hedging language ("subject to," "depending on,"
   "uncertain," "cautiously") per quarter. Is the frequency increasing?

3. TOPIC AVOIDANCE: Are there topics discussed in earlier quarters that
   management stops mentioning?

4. CONFIDENCE MARKERS: Track phrases indicating confidence ("clearly,"
   "definitely," "strong momentum") vs uncertainty ("challenging environment,"
   "headwinds," "transitional period"). Which direction is the trend?

Return ONLY valid JSON (no markdown, no code fences):
{
  "guidance_trend": "more_specific/stable/more_vague",
  "hedging_trend": "decreasing/stable/increasing",
  "topics_dropped": ["topic1", "topic2"],
  "confidence_trend": "increasing/stable/decreasing",
  "quarters_analyzed": X,
  "overall_communication_trajectory": "improving/stable/deteriorating",
  "notable_shifts": [
    {"quarter": "QX", "observation": "description"}
  ]
}`;
}

// Build Opus synthesis prompt
function buildSynthesisPrompt(blindId, sector, job1, job2, job3, job4, quantContext) {
  const jobOutputs = [];
  if (job1) jobOutputs.push(`MANAGEMENT CREDIBILITY REPORT:\n${JSON.stringify(job1, null, 2)}`);
  else jobOutputs.push('MANAGEMENT CREDIBILITY REPORT: [Not available — insufficient quarterly data]');

  if (job2) jobOutputs.push(`RISK FACTOR EVOLUTION REPORT:\n${JSON.stringify(job2, null, 2)}`);
  else jobOutputs.push('RISK FACTOR EVOLUTION REPORT: [Not available — missing 10-K data]');

  if (job3) jobOutputs.push(`COMPETITIVE CROSS-REFERENCE REPORT:\n${JSON.stringify(job3, null, 2)}`);
  else jobOutputs.push('COMPETITIVE CROSS-REFERENCE REPORT: [Not available — no competitor filings]');

  if (job4) jobOutputs.push(`EARNINGS CALL LANGUAGE TRAJECTORY:\n${JSON.stringify(job4, null, 2)}`);
  else jobOutputs.push('EARNINGS CALL LANGUAGE TRAJECTORY: [Not available — insufficient quarterly data]');

  return `You are a senior investment analyst reviewing research on an anonymous company.
Research reports have been prepared by a junior analyst. Your job is to
synthesize these findings into a single investment assessment.

Do NOT attempt to identify the company. Base your assessment SOLELY on the
research findings below.

COMPANY: ${blindId}
SECTOR: ${sector}

${jobOutputs.join('\n\n')}

QUANTITATIVE CONTEXT:
${quantContext}

TASK:
Based on the evidence above — not on any external knowledge — assess:

1. Is this more likely a GENUINE OPPORTUNITY (temporarily mispriced quality
   business) or a VALUE TRAP (cheap for good reason)?

2. What is the single strongest piece of evidence for each side?

3. What is your confidence level?

Return ONLY valid JSON (no markdown, no code fences):
{
  "assessment": "opportunity/trap/uncertain",
  "confidence": "high/medium/low",
  "opportunity_evidence": "strongest evidence this is a genuine opportunity",
  "trap_evidence": "strongest evidence this is a trap",
  "key_concern": "the single thing that would change your mind",
  "management_credibility_weight": "how much did credibility factor into your assessment",
  "recommendation": "proceed/caution/avoid"
}`;
}

// ============================================
// MAIN — Generate all prompts and save
// ============================================
async function main() {
  const pipeline = loadJSON(resolve(PIPELINE_DIR, 'pipeline-data.json'));
  const answerKey = loadJSON(resolve(PIPELINE_DIR, 'answer-key.json'));

  if (!pipeline || !answerKey) {
    console.error('Missing pipeline data or answer key');
    process.exit(1);
  }

  const allPrompts = {};

  for (const [blindId, pkg] of Object.entries(pipeline)) {
    const ak = answerKey[blindId];
    if (!ak) continue;

    const sector = pkg.sector || 'Unknown';

    const prompts = {
      blindId,
      sector,
      job1: buildJob1Prompt(blindId, sector, pkg.mdaQuarters),
      job2: buildJob2Prompt(blindId, sector, pkg.tenK, pkg.priorTenK),
      job3: buildJob3Prompt(blindId, sector, pkg.tenK, pkg.competitors),
      job4: buildJob4Prompt(blindId, sector, pkg.mdaQuarters),
      quantContext: `Short interest days-to-cover: ${pkg.historicalSI?.days_to_cover || 'N/A'}\nInsider Form 4 filings (12mo): ${pkg.insiders?.form4Count || 'N/A'}`,
    };

    // Count available jobs
    const available = [prompts.job1, prompts.job2, prompts.job3, prompts.job4].filter(Boolean).length;
    prompts.available_jobs = available;

    allPrompts[blindId] = prompts;

    console.log(`${blindId}: ${available}/4 jobs available` +
      ` (J1:${prompts.job1?'Y':'N'} J2:${prompts.job2?'Y':'N'} J3:${prompts.job3?'Y':'N'} J4:${prompts.job4?'Y':'N'})`);
  }

  writeFileSync(resolve(PIPELINE_DIR, 'eval-prompts.json'), JSON.stringify(allPrompts, null, 2));

  // Summary
  const total = Object.keys(allPrompts).length;
  const j1 = Object.values(allPrompts).filter(p => p.job1).length;
  const j2 = Object.values(allPrompts).filter(p => p.job2).length;
  const j3 = Object.values(allPrompts).filter(p => p.job3).length;
  const j4 = Object.values(allPrompts).filter(p => p.job4).length;
  const totalCalls = j1 + j2 + j3 + j4 + total; // +total for opus synthesis

  console.log(`\n=== PROMPT GENERATION SUMMARY ===`);
  console.log(`Total cases: ${total}`);
  console.log(`Job 1 (Credibility): ${j1} cases`);
  console.log(`Job 2 (Risk Evolution): ${j2} cases`);
  console.log(`Job 3 (Competitive): ${j3} cases`);
  console.log(`Job 4 (Language): ${j4} cases`);
  console.log(`Total sub-agent calls needed: ${totalCalls} (${j1+j2+j3+j4} Sonnet + ${total} Opus)`);
}

main().catch(e => { console.error(e); process.exit(1); });
