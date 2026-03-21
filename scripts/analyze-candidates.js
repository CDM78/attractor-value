#!/usr/bin/env node
// Analyze all pending Tier 3 candidates one by one via the deep-analyze endpoint.
// Each call runs attractor analysis + signal computation.

const API_BASE = 'https://odieseyeball.com';
const PAUSE_MS = 5000; // 5 seconds between calls (Claude API rate limit)

async function main() {
  console.log('=== Analyzing Tier 3 Candidates ===');

  // Get all candidates
  const res = await fetch(`${API_BASE}/api/screen/tier3`);
  const data = await res.json();
  const candidates = data.candidates || [];
  const pending = candidates.filter(c => !c.attractor_analysis_date);

  console.log(`Total candidates: ${candidates.length}`);
  console.log(`Pending analysis: ${pending.length}`);
  console.log('');

  let analyzed = 0;
  let buyCount = 0;
  let notYetCount = 0;
  let passCount = 0;

  for (const c of pending) {
    process.stdout.write(`[${analyzed + 1}/${pending.length}] ${c.ticker} (id=${c.id})... `);

    try {
      const analyzeRes = await fetch(`${API_BASE}/api/candidates/${c.id}/deep-analyze`, {
        method: 'POST',
      });

      if (!analyzeRes.ok) {
        const err = await analyzeRes.text();
        console.log(`HTTP ${analyzeRes.status}: ${err.slice(0, 100)}`);
      } else {
        const result = await analyzeRes.json();
        const signal = result.new_signal || 'PASS';
        const score = result.attractor_score;
        console.log(`score=${score?.toFixed(1) || '?'} signal=${signal} ${result.signal_changed ? '(CHANGED)' : ''}`);

        if (signal === 'BUY') buyCount++;
        else if (signal === 'NOT_YET') notYetCount++;
        else passCount++;
      }

      analyzed++;
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }

    if (analyzed < pending.length) {
      await new Promise(r => setTimeout(r, PAUSE_MS));
    }
  }

  console.log('');
  console.log('=== Analysis Complete ===');
  console.log(`Analyzed: ${analyzed}`);
  console.log(`BUY: ${buyCount}`);
  console.log(`NOT_YET: ${notYetCount}`);
  console.log(`PASS: ${passCount}`);

  // Show final signals
  console.log('');
  console.log('=== Dashboard Signals ===');
  const sigRes = await fetch(`${API_BASE}/api/signals`);
  const sigData = await sigRes.json();
  console.log(`BUY signals: ${sigData.buy_count || 0}`);
  console.log(`NOT_YET: ${sigData.not_yet_count || 0}`);

  for (const s of (sigData.buy_signals || [])) {
    console.log(`  BUY: ${s.ticker} price=$${s.current_price} buy_below=$${s.buy_below_price} IV=$${s.intrinsic_value} shares=${s.recommended_shares} $=${s.recommended_dollars}`);
  }
  for (const s of (sigData.not_yet || [])) {
    console.log(`  NOT_YET: ${s.ticker} price=$${s.current_price} target=$${s.buy_below_price}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
