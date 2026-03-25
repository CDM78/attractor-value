#!/usr/bin/env node
// Phase 2: Evaluate prompt variants on training/validation cases
// Uses Claude sub-agents to run each prompt variant against case data
//
// This script is called BY the main optimization orchestrator.
// It evaluates a single prompt variant on a set of cases and returns results.
//
// Usage: node scripts/prompt-optimization-evaluate.js --type buy|sell --variant <name> --partition train|validation|holdout [--start N] [--limit N]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const OPT_DIR = resolve(DATA_DIR, 'prompt-optimization');
const RESULTS_DIR = resolve(OPT_DIR, 'eval-results');
mkdirSync(RESULTS_DIR, { recursive: true });

const args = process.argv.slice(2);
function getArg(name) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; }

const TYPE = getArg('type') || 'buy';
const VARIANT = getArg('variant');
const PARTITION = getArg('partition') || 'train';
const START = parseInt(getArg('start') || '0');
const LIMIT = parseInt(getArg('limit') || '999');

if (!VARIANT) {
  console.error('Usage: --type buy|sell --variant <variant_name> --partition train|validation|holdout');
  process.exit(1);
}

function loadJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

async function main() {
  // Load prompt variants
  const prompts = loadJSON(resolve(OPT_DIR, 'prompt-variants.json'));
  const promptKey = TYPE === 'buy' ? 'buy_prompts' : 'sell_prompts';
  const prompt = prompts[promptKey][VARIANT];
  if (!prompt) {
    console.error(`Variant "${VARIANT}" not found in ${promptKey}`);
    console.error('Available:', Object.keys(prompts[promptKey]).join(', '));
    process.exit(1);
  }

  // Load partition
  const partitions = loadJSON(resolve(OPT_DIR, 'partitions.json'));
  const caseIds = partitions[PARTITION === 'train' ? 'train' : PARTITION === 'validation' ? 'validation' : 'holdout'];
  if (!caseIds) { console.error('Invalid partition'); process.exit(1); }

  // Load results file for resume
  const resultsFile = resolve(RESULTS_DIR, `${TYPE}_${VARIANT}_${PARTITION}.json`);
  const existing = loadJSON(resultsFile) || { variant: VARIANT, type: TYPE, partition: PARTITION, results: {}, metadata: {} };

  const casesToProcess = caseIds.slice(START, START + LIMIT);
  let processed = 0;
  let skipped = 0;

  console.log(`Evaluating ${TYPE} variant "${prompt.name}" on ${PARTITION} set (${casesToProcess.length} cases)\n`);

  for (const caseId of casesToProcess) {
    // Skip if already evaluated
    if (existing.results[caseId]) {
      skipped++;
      continue;
    }

    // Load case data
    const caseData = loadJSON(resolve(OPT_DIR, 'cases', `${caseId}.json`));
    if (!caseData) {
      console.log(`  ${caseId}: case file not found, skipping`);
      continue;
    }

    // Check required data
    if (TYPE === 'buy') {
      if (!caseData.entry_10k?.current?.riskFactors || !caseData.entry_10k?.prior?.riskFactors) {
        console.log(`  ${caseId}: missing entry 10-K data, skipping`);
        existing.results[caseId] = { status: 'missing_data', assessment: null };
        continue;
      }
    } else {
      // SELL evaluation needs entry + checkpoint risk factors
      if (!caseData.entry_10k?.current?.riskFactors) {
        console.log(`  ${caseId}: missing entry 10-K for sell eval, skipping`);
        existing.results[caseId] = { status: 'missing_data', assessment: null };
        continue;
      }
    }

    // Build the prompt
    let userMessage;
    if (TYPE === 'buy') {
      userMessage = prompt.user_template
        .replace('{sector}', caseData.sector || 'Unknown')
        .replace('{current_filed}', caseData.entry_10k.current.filed || 'unknown')
        .replace('{prior_filed}', caseData.entry_10k.prior?.filed || 'unknown')
        .replace('{current_risk_factors}', truncate(caseData.entry_10k.current.riskFactors, 20000))
        .replace('{prior_risk_factors}', truncate(caseData.entry_10k.prior?.riskFactors || '', 20000));
    } else {
      // Try Year 1 checkpoint first, then Year 2
      let checkpointRF = null;
      let checkpointFiled = null;
      let timeSinceEntry = '1 year';

      if (caseData.year1_10k?.riskFactors) {
        checkpointRF = caseData.year1_10k.riskFactors;
        checkpointFiled = caseData.year1_10k.filed;
        timeSinceEntry = '1 year';
      } else if (caseData.year2_10k?.riskFactors) {
        checkpointRF = caseData.year2_10k.riskFactors;
        checkpointFiled = caseData.year2_10k.filed;
        timeSinceEntry = '2 years';
      }

      if (!checkpointRF) {
        console.log(`  ${caseId}: no checkpoint 10-K for sell eval, skipping`);
        existing.results[caseId] = { status: 'missing_checkpoint', assessment: null };
        continue;
      }

      userMessage = prompt.user_template
        .replace(/{sector}/g, caseData.sector || 'Unknown')
        .replace(/{time_since_entry}/g, timeSinceEntry)
        .replace(/{entry_filed}/g, caseData.entry_10k.current.filed || 'unknown')
        .replace(/{current_filed}/g, checkpointFiled || 'unknown')
        .replace(/{entry_risk_factors}/g, truncate(caseData.entry_10k.current.riskFactors, 15000))
        .replace(/{current_risk_factors}/g, truncate(checkpointRF, 15000));
    }

    // Output the prompt for piping to sub-agent
    // The orchestrator will handle actually running this
    existing.results[caseId] = {
      status: 'pending',
      system: prompt.system,
      user_message: userMessage,
      case_id: caseId,
      outcome: caseData.outcome,
    };

    processed++;
    console.log(`  ${caseId}: prepared [${processed + skipped}/${casesToProcess.length}]`);

    // Save every 10 cases
    if (processed % 10 === 0) {
      writeFileSync(resultsFile, JSON.stringify(existing, null, 2));
    }
  }

  // Final save
  existing.metadata = {
    variant: VARIANT,
    type: TYPE,
    partition: PARTITION,
    prompt_name: prompt.name,
    total_cases: casesToProcess.length,
    processed,
    skipped,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(resultsFile, JSON.stringify(existing, null, 2));

  console.log(`\nDone: ${processed} prepared, ${skipped} already cached`);
}

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n[...truncated...]';
}

main().catch(e => { console.error(e); process.exit(1); });
