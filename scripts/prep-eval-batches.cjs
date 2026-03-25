#!/usr/bin/env node
// Prepare compact evaluation batches for sub-agent processing
// Extracts and truncates risk factors, groups cases into batches

const fs = require('fs');
const path = require('path');

const OPT_DIR = path.resolve(__dirname, '../data/prompt-optimization');
const CASES_DIR = path.join(OPT_DIR, 'cases');
const BATCH_DIR = path.join(OPT_DIR, 'eval-batches');
fs.mkdirSync(BATCH_DIR, { recursive: true });

const TRUNC = 12000; // chars per risk factor section - balances detail vs context limits
const BATCH_SIZE = 5; // cases per batch

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n[...truncated...]';
}

// Load training cases
const training = JSON.parse(fs.readFileSync(path.join(OPT_DIR, 'training-cases.json')));
console.log(`Preparing ${training.length} training cases into batches of ${BATCH_SIZE}`);

const batches = [];
let currentBatch = [];

for (const tc of training) {
  const casePath = path.join(CASES_DIR, `${tc.case_id}.json`);
  if (!fs.existsSync(casePath)) continue;

  const raw = JSON.parse(fs.readFileSync(casePath));

  // Extract compact evaluation data
  const compact = {
    case_id: tc.case_id,
    sector: raw.sector || tc.sector || 'Unknown',
    entry_date: raw.entry_date || tc.entry_date,
    binary_outcome: tc.binary_outcome,
    alpha: tc.alpha,
    return_3yr: tc.return_3yr,
    sp500_return_3yr: tc.sp500_return_3yr,

    // BUY data
    buy: {
      current_filed: raw.entry_10k?.current?.filed || 'unknown',
      prior_filed: raw.entry_10k?.prior?.filed || 'unknown',
      current_rf: truncate(raw.entry_10k?.current?.riskFactors, TRUNC),
      prior_rf: truncate(raw.entry_10k?.prior?.riskFactors, TRUNC),
    },

    // SELL data (Year 1 preferred, then Year 2)
    sell: null,
  };

  if (raw.year1_10k?.riskFactors) {
    compact.sell = {
      checkpoint_filed: raw.year1_10k.filed || 'unknown',
      time_since_entry: '1 year',
      entry_rf: truncate(raw.entry_10k?.current?.riskFactors, TRUNC),
      checkpoint_rf: truncate(raw.year1_10k.riskFactors, TRUNC),
    };
  } else if (raw.year2_10k?.riskFactors) {
    compact.sell = {
      checkpoint_filed: raw.year2_10k.filed || 'unknown',
      time_since_entry: '2 years',
      entry_rf: truncate(raw.entry_10k?.current?.riskFactors, TRUNC),
      checkpoint_rf: truncate(raw.year2_10k.riskFactors, TRUNC),
    };
  }

  currentBatch.push(compact);

  if (currentBatch.length >= BATCH_SIZE) {
    batches.push(currentBatch);
    currentBatch = [];
  }
}
if (currentBatch.length > 0) batches.push(currentBatch);

// Write batch files
for (let i = 0; i < batches.length; i++) {
  const batchFile = path.join(BATCH_DIR, `train_batch_${i}.json`);
  fs.writeFileSync(batchFile, JSON.stringify(batches[i], null, 2));
  const caseIds = batches[i].map(c => c.case_id).join(', ');
  console.log(`Batch ${i}: ${batches[i].length} cases (${caseIds}) -> ${batchFile}`);
}

// Also write a batch index
const index = batches.map((b, i) => ({
  batch: i,
  cases: b.map(c => c.case_id),
  file: `train_batch_${i}.json`,
}));
fs.writeFileSync(path.join(BATCH_DIR, 'batch-index.json'), JSON.stringify(index, null, 2));

console.log(`\nTotal: ${batches.length} batches, ${training.length} cases`);

// Write the prompt templates in a compact format for sub-agents
const prompts = JSON.parse(fs.readFileSync(path.join(OPT_DIR, 'prompt-variants.json')));
const compactPrompts = {
  buy: {},
  sell: {},
};

for (const [key, p] of Object.entries(prompts.buy_prompts)) {
  compactPrompts.buy[key] = { name: p.name, system: p.system, template: p.user_template };
}
for (const [key, p] of Object.entries(prompts.sell_prompts)) {
  compactPrompts.sell[key] = { name: p.name, system: p.system, template: p.user_template };
}
fs.writeFileSync(path.join(BATCH_DIR, 'prompt-templates.json'), JSON.stringify(compactPrompts, null, 2));
console.log('Prompt templates saved to prompt-templates.json');
