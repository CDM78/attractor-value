#!/usr/bin/env node
// Prepare validation case batches for evaluation
const fs = require('fs');
const path = require('path');

const OPT_DIR = path.resolve(__dirname, '../data/prompt-optimization');
const CASES_DIR = path.join(OPT_DIR, 'cases');
const BATCH_DIR = path.join(OPT_DIR, 'eval-batches');
const TRUNC = 12000;
const BATCH_SIZE = 5;

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n[...truncated...]';
}

const validation = JSON.parse(fs.readFileSync(path.join(OPT_DIR, 'validation-cases.json')));
console.log(`Preparing ${validation.length} validation cases`);

const batches = [];
let currentBatch = [];

for (const vc of validation) {
  const casePath = path.join(CASES_DIR, `${vc.case_id}.json`);
  if (!fs.existsSync(casePath)) continue;
  const raw = JSON.parse(fs.readFileSync(casePath));

  const compact = {
    case_id: vc.case_id,
    sector: raw.sector || vc.sector || 'Unknown',
    entry_date: raw.entry_date || vc.entry_date,
    buy: {
      current_filed: raw.entry_10k?.current?.filed || 'unknown',
      prior_filed: raw.entry_10k?.prior?.filed || 'unknown',
      current_rf: truncate(raw.entry_10k?.current?.riskFactors, TRUNC),
      prior_rf: truncate(raw.entry_10k?.prior?.riskFactors, TRUNC),
    },
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

for (let i = 0; i < batches.length; i++) {
  const batchFile = path.join(BATCH_DIR, `val_batch_${i}.json`);
  fs.writeFileSync(batchFile, JSON.stringify(batches[i], null, 2));
  console.log(`Val batch ${i}: ${batches[i].length} cases (${batches[i].map(c => c.case_id).join(', ')})`);
}

console.log(`\nTotal: ${batches.length} validation batches, ${validation.length} cases`);
