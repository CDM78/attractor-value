#!/usr/bin/env node
// Extract validation case data for evaluation
const fs = require('fs');
const path = require('path');
const BATCH_DIR = path.resolve(__dirname, '../data/prompt-optimization/eval-batches');
const batchNum = process.argv[2];
const caseId = process.argv[3];
const mode = process.argv[4] || 'info';

if (!batchNum || !caseId) { console.log('Usage: node extract-val-case.cjs <batch> <case_id> [info|buy|sell|all]'); process.exit(1); }

const batch = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, `holdout_batch_${batchNum}.json`)));
const c = batch.find(x => x.case_id === caseId);
if (!c) { console.log('Case not found'); process.exit(1); }

if (mode === 'all') { console.log(batch.map(x => x.case_id).join('\n')); }
else if (mode === 'info') {
  console.log(JSON.stringify({ case_id: c.case_id, sector: c.sector, entry_date: c.entry_date, has_sell: !!c.sell }, null, 2));
} else if (mode === 'buy') {
  console.log(`=== BUY EVAL: ${c.case_id} (${c.sector}) entry=${c.entry_date} ===`);
  console.log(`\n--- CURRENT 10-K (filed ${c.buy.current_filed}) ---`);
  console.log(c.buy.current_rf.slice(0, 8000));
  console.log(`\n--- PRIOR 10-K (filed ${c.buy.prior_filed}) ---`);
  console.log(c.buy.prior_rf.slice(0, 8000));
} else if (mode === 'sell') {
  if (!c.sell) { console.log('No sell data'); process.exit(0); }
  console.log(`=== SELL EVAL: ${c.case_id} (${c.sector}) ${c.sell.time_since_entry} since entry ===`);
  console.log(`\n--- ENTRY RISK FACTORS (filed ${c.buy.current_filed}) ---`);
  console.log(c.sell.entry_rf.slice(0, 8000));
  console.log(`\n--- CHECKPOINT (filed ${c.sell.checkpoint_filed}) ---`);
  console.log(c.sell.checkpoint_rf.slice(0, 8000));
}
