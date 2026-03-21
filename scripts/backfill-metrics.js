#!/usr/bin/env node
// One-time backfill: populate market_cap, revenue_growth_3y, gross_margin_pct
// for all stocks via Finnhub /stock/metric endpoint.
//
// Finnhub free tier: 60 calls/minute
// Strategy: 55 stocks per batch, 62-second pause between batches
// ~1,100 stocks = ~20 batches = ~21 minutes

const API_BASE = 'https://odieseyeball.com';
const BATCH_SIZE = 55;
const PAUSE_MS = 62000; // 62 seconds between batches (safety margin)

async function main() {
  console.log('=== Finnhub Metrics Backfill ===');
  console.log(`Target: All stocks missing market_cap, revenue_growth_3y, or gross_margin_pct`);
  console.log(`Batch size: ${BATCH_SIZE}, pause: ${PAUSE_MS / 1000}s`);
  console.log('');

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let batch = 0;
  let hasMore = true;

  while (hasMore) {
    batch++;
    const offset = (batch - 1) * BATCH_SIZE;

    process.stdout.write(`Batch ${batch}: offset=${offset}, fetching... `);

    try {
      const res = await fetch(`${API_BASE}/api/fill-metrics?limit=${BATCH_SIZE}&offset=${offset}`, {
        method: 'POST',
      });

      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        // If we get a 500/timeout, the batch partially completed — continue
        if (res.status >= 500) {
          console.log('  Server error — pausing and continuing...');
          await sleep(PAUSE_MS);
          continue;
        }
        break;
      }

      const data = await res.json();
      const updated = data.updated || 0;
      const skipped = data.skipped || 0;
      const errors = data.errors || 0;
      const total = data.total || 0;

      totalUpdated += updated;
      totalSkipped += skipped;
      totalErrors += errors;

      console.log(`${updated} updated, ${skipped} skipped, ${errors} errors (total so far: ${totalUpdated})`);

      // If we got fewer stocks than BATCH_SIZE, we've reached the end
      if (total < BATCH_SIZE) {
        hasMore = false;
        console.log('  Reached end of stock list.');
      }

      // If nothing was returned at all, stop
      if (total === 0) {
        hasMore = false;
        console.log('  No more stocks to process.');
      }

    } catch (err) {
      console.log(`Error: ${err.message}`);
      totalErrors++;
    }

    if (hasMore) {
      process.stdout.write(`  Pausing ${PAUSE_MS / 1000}s for rate limit...`);
      await sleep(PAUSE_MS);
      console.log(' done');
    }
  }

  console.log('');
  console.log('=== Backfill Complete ===');
  console.log(`Batches: ${batch}`);
  console.log(`Updated: ${totalUpdated}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);
  console.log('');

  // Now run the pre-screen
  console.log('=== Running Tier 3 Pre-Screen ===');
  let totalScanned = 0;
  let totalPasses = 0;
  let allCandidates = [];
  let screenOffset = 0;
  let screenMore = true;

  while (screenMore) {
    try {
      const res = await fetch(`${API_BASE}/api/screen/tier3?limit=500&offset=${screenOffset}`, {
        method: 'POST',
      });
      const data = await res.json();

      totalScanned += data.scanned || 0;
      totalPasses += data.passes || 0;
      if (data.candidates) allCandidates.push(...data.candidates);
      screenMore = data.has_more || false;
      screenOffset += 500;
    } catch (err) {
      console.log(`Pre-screen error: ${err.message}`);
      screenMore = false;
    }
  }

  console.log(`Stocks scanned: ${totalScanned}`);
  console.log(`Pre-screen passes: ${totalPasses}`);
  console.log(`Candidates stored: ${allCandidates.length}`);
  console.log('');

  if (allCandidates.length > 0) {
    // Sort by revenue CAGR
    allCandidates.sort((a, b) => (b.revenue_cagr_3yr || 0) - (a.revenue_cagr_3yr || 0));

    console.log('Top 30 candidates by revenue CAGR:');
    console.log('Ticker   MCap(M)    CAGR%   Margin%  Track              Sector');
    console.log('-'.repeat(85));

    for (const c of allCandidates.slice(0, 30)) {
      const cagr = c.revenue_cagr_3yr ? (c.revenue_cagr_3yr * 100).toFixed(1) : '?';
      const margin = c.gross_margin_estimate ? (c.gross_margin_estimate * 100).toFixed(1) : '?';
      const mcap = c.market_cap || '?';
      const ticker = (c.ticker || '?').padEnd(8);
      const mcapStr = String(mcap).padStart(8);
      const cagrStr = String(cagr).padStart(7);
      const marginStr = String(margin).padStart(7);
      const track = (c.growth_track || '?').padEnd(18);
      console.log(`${ticker} ${mcapStr}M  ${cagrStr}%  ${marginStr}%  ${track}  ${c.sector || '?'}`);
    }
  }

  // Trigger bulk analysis on all candidates
  if (allCandidates.length > 0) {
    console.log('');
    console.log('=== Triggering Bulk Analysis (Sonnet) ===');
    try {
      const res = await fetch(`${API_BASE}/api/admin/bulk-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: 'tier3',
          concurrency: 3,
          model: 'claude-sonnet-4-20250514',
        }),
      });
      const data = await res.json();
      console.log(`Bulk analysis started: ${data.total || 0} candidates, model: ${data.model}`);
      console.log('Monitor progress at: https://odieseyeball.com/admin');
      console.log('Or poll: curl https://odieseyeball.com/api/admin/bulk-analyze/progress');
    } catch (err) {
      console.log(`Bulk analysis trigger error: ${err.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
