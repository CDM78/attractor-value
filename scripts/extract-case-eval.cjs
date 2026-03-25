#!/usr/bin/env node
// Extract one case from a batch file for evaluation
// Usage: node extract-case-eval.cjs <batch_num> <case_id> [buy|sell|info]

const fs = require('fs');
const path = require('path');

const BATCH_DIR = path.resolve(__dirname, '../data/prompt-optimization/eval-batches');
const batchNum = process.argv[2];
const caseId = process.argv[3];
const mode = process.argv[4] || 'info';

if (!batchNum || !caseId) {
  console.log('Usage: node extract-case-eval.cjs <batch_num> <case_id> [info|buy|sell|all]');
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, `train_batch_${batchNum}.json`)));
const c = batch.find(x => x.case_id === caseId);
if (!c) { console.log('Case not found in batch'); process.exit(1); }

if (mode === 'info') {
  console.log(JSON.stringify({
    case_id: c.case_id,
    sector: c.sector,
    entry_date: c.entry_date,
    outcome: c.binary_outcome,
    alpha: c.alpha,
    has_buy_data: !!(c.buy?.current_rf && c.buy?.prior_rf),
    has_sell_data: !!c.sell,
    sell_checkpoint: c.sell?.time_since_entry || 'none',
  }, null, 2));
} else if (mode === 'buy') {
  // Output truncated risk factors for BUY evaluation (further truncated for readability)
  const maxChars = 8000;
  const cur = (c.buy?.current_rf || '').slice(0, maxChars);
  const pri = (c.buy?.prior_rf || '').slice(0, maxChars);
  console.log(`=== BUY EVALUATION: ${c.case_id} (${c.sector}) ===`);
  console.log(`Entry date: ${c.entry_date}`);
  console.log(`\n--- CURRENT 10-K RISK FACTORS (filed ${c.buy?.current_filed}) ---`);
  console.log(cur);
  console.log(`\n--- PRIOR 10-K RISK FACTORS (filed ${c.buy?.prior_filed}) ---`);
  console.log(pri);
} else if (mode === 'sell') {
  if (!c.sell) { console.log('No sell checkpoint data'); process.exit(0); }
  const maxChars = 8000;
  const entry = (c.sell?.entry_rf || '').slice(0, maxChars);
  const checkpoint = (c.sell?.checkpoint_rf || '').slice(0, maxChars);
  console.log(`=== SELL EVALUATION: ${c.case_id} (${c.sector}) ===`);
  console.log(`Time since entry: ${c.sell.time_since_entry}`);
  console.log(`\n--- RISK FACTORS AT ENTRY (filed ${c.buy?.current_filed}) ---`);
  console.log(entry);
  console.log(`\n--- CHECKPOINT RISK FACTORS (filed ${c.sell.checkpoint_filed}) ---`);
  console.log(checkpoint);
} else if (mode === 'all') {
  // List all case IDs in this batch
  console.log(batch.map(x => x.case_id).join('\n'));
}
