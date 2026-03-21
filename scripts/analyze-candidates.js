#!/usr/bin/env node
// Analyze all pending candidates using Sonnet (default model).
// Uses the bulk-analyze endpoint which runs Sonnet by default.
// NEVER uses the deep-analyze endpoint — that's Opus-only, user-triggered.

const API_BASE = 'https://odieseyeball.com';

async function main() {
  console.log('=== Analyzing Pending Candidates (Sonnet) ===');

  // Check how many candidates are pending
  let totalPending = 0;
  for (const tier of ['tier2', 'tier3', 'tier4']) {
    const res = await fetch(`${API_BASE}/api/screen/${tier}`);
    const data = await res.json();
    const pending = (data.candidates || []).filter(c => !c.attractor_analysis_date);
    totalPending += pending.length;
    console.log(`${tier}: ${data.count || 0} total, ${pending.length} pending`);
  }

  if (totalPending === 0) {
    console.log('\nNo pending candidates. Nothing to analyze.');
    return;
  }

  console.log(`\nTotal pending: ${totalPending}`);
  console.log('Starting bulk analysis with Sonnet...\n');

  // Trigger bulk analysis (Sonnet is default)
  const res = await fetch(`${API_BASE}/api/admin/bulk-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tier: 'all',
      concurrency: 3,
      model: 'claude-sonnet-4-20250514',
    }),
  });
  const data = await res.json();
  console.log(`Bulk analysis started: ${data.total || 0} candidates, model: ${data.model}`);

  // Poll for progress
  let complete = false;
  while (!complete) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const progRes = await fetch(`${API_BASE}/api/admin/bulk-analyze/progress`);
      const prog = await progRes.json();
      if (!prog) continue;
      process.stdout.write(`\r  Progress: ${prog.analyzed || 0}/${prog.total || '?'} analyzed, BUY=${prog.buy || 0}, NOT_YET=${prog.not_yet || 0}, PASS=${prog.pass || 0}, errors=${prog.errors || 0}`);
      if (prog.complete) {
        complete = true;
        console.log('\n');
      }
    } catch { /* ignore polling errors */ }
  }

  // Final signal check
  console.log('=== Dashboard Signals ===');
  const sigRes = await fetch(`${API_BASE}/api/signals`);
  const sigData = await sigRes.json();
  console.log(`BUY: ${sigData.buy_count || 0}`);
  console.log(`NOT_YET: ${sigData.not_yet_count || 0}`);
  for (const s of (sigData.buy_signals || [])) {
    console.log(`  BUY: ${s.ticker} price=$${s.current_price} IV=$${s.intrinsic_value} buy_below=$${s.buy_below_price}`);
  }
  for (const s of (sigData.not_yet || [])) {
    console.log(`  NOT_YET: ${s.ticker} price=$${s.current_price} target=$${s.buy_below_price}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
