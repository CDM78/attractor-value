#!/usr/bin/env node
// Full US market expansion: pull Finnhub stock list, backfill metrics,
// run Tier 3+4 pre-screens, bulk Sonnet analysis.
// Expected runtime: ~60 minutes total.

const API_BASE = 'https://odieseyeball.com';
const METRICS_BATCH = 55;
const METRICS_PAUSE = 62000; // 62 seconds between Finnhub batches

async function main() {
  const startTime = Date.now();

  // ============================================================
  // STEP 1: Pull Finnhub US stock list and add new tickers
  // ============================================================
  console.log('=== STEP 1: Pull US stock list from Finnhub ===');

  // Get existing tickers
  const existingRes = await fetch(`${API_BASE}/api/fill-metrics`);
  const existingData = await existingRes.json();
  const existingCount = existingData.total_stocks || 0;
  console.log(`Existing stocks in DB: ${existingCount}`);

  // Fetch Finnhub US stock list via a worker endpoint
  // We need to add this capability — use the quote endpoint to add stocks one by one
  // Actually, let's create a bulk add via the refresh mechanism

  // The full US stock list is large. Let me use a curated approach:
  // Fetch stocks from Finnhub via the worker, add to DB, then backfill metrics.

  // Step 1a: Get the stock list from Finnhub via a new endpoint
  console.log('Fetching US stock list from Finnhub...');
  const listRes = await fetch(`${API_BASE}/api/admin/fetch-stock-list`, { method: 'POST' });
  let newTickers = [];

  if (listRes.ok) {
    const listData = await listRes.json();
    newTickers = listData.new_tickers || [];
    console.log(`Finnhub returned ${listData.total_from_finnhub || '?'} US stocks`);
    console.log(`After filtering (common stock only): ${listData.filtered || '?'}`);
    console.log(`New tickers added: ${newTickers.length}`);
    console.log(`Already existed: ${listData.already_existed || '?'}`);
  } else {
    console.log(`Stock list endpoint not available (${listRes.status})`);
    console.log('Will use existing universe only.');
  }

  // ============================================================
  // STEP 2: Backfill Finnhub metrics for all stocks missing data
  // ============================================================
  console.log('\n=== STEP 2: Backfill Finnhub metrics ===');

  let totalMetricsUpdated = 0;
  let batch = 0;
  let hasMore = true;

  while (hasMore) {
    batch++;
    const offset = (batch - 1) * METRICS_BATCH;
    process.stdout.write(`Batch ${batch} (offset ${offset})... `);

    try {
      const res = await fetch(`${API_BASE}/api/fill-metrics?limit=${METRICS_BATCH}&offset=${offset}`, {
        method: 'POST',
      });

      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      const updated = data.updated || 0;
      const total = data.total || 0;
      totalMetricsUpdated += updated;

      console.log(`${updated} updated (cumulative: ${totalMetricsUpdated})`);

      if (total < METRICS_BATCH) {
        hasMore = false;
        console.log('  Reached end of missing stocks.');
      }
      if (total === 0) {
        hasMore = false;
      }
    } catch (err) {
      console.log(`Error: ${err.message}`);
      break;
    }

    if (hasMore) {
      process.stdout.write(`  Pausing ${METRICS_PAUSE / 1000}s... `);
      await sleep(METRICS_PAUSE);
      console.log('done');
    }
  }

  console.log(`\nMetrics backfill complete: ${totalMetricsUpdated} stocks updated in ${batch} batches`);

  // Count stocks with complete data above $500M
  const statsRes = await fetch(`${API_BASE}/api/fill-metrics`);
  const stats = await statsRes.json();
  console.log(`Total stocks: ${stats.total_stocks}`);
  console.log(`With ratios: ${stats.with_ratios}`);

  // ============================================================
  // STEP 3: Run Tier 3 pre-screen on expanded universe
  // ============================================================
  console.log('\n=== STEP 3: Tier 3 pre-screen ===');

  let t3Scanned = 0, t3Passes = 0;
  let screenOffset = 0;
  let screenMore = true;

  while (screenMore) {
    const res = await fetch(`${API_BASE}/api/screen/tier3?limit=500&offset=${screenOffset}`, {
      method: 'POST',
    });
    const data = await res.json();
    t3Scanned += data.scanned || 0;
    t3Passes += data.passes || 0;
    screenMore = data.has_more || false;
    screenOffset += 500;
    if (data.scanned > 0) {
      process.stdout.write(`  Scanned: ${t3Scanned}, passes: ${t3Passes}\r`);
    }
  }

  console.log(`Tier 3: scanned ${t3Scanned}, passes ${t3Passes}`);

  // Print top candidates
  const t3Res = await fetch(`${API_BASE}/api/screen/tier3`);
  const t3Data = await t3Res.json();
  const t3Candidates = t3Data.candidates || [];
  const t3Sorted = t3Candidates
    .filter(c => c.revenue_cagr_3yr || c.prescreen_data)
    .sort((a, b) => {
      const aCAGR = a.revenue_cagr_3yr || (JSON.parse(a.prescreen_data || '{}').revenue_cagr_3yr) || 0;
      const bCAGR = b.revenue_cagr_3yr || (JSON.parse(b.prescreen_data || '{}').revenue_cagr_3yr) || 0;
      return bCAGR - aCAGR;
    });

  console.log(`\nTop 30 Tier 3 candidates by revenue CAGR:`);
  for (const c of t3Sorted.slice(0, 30)) {
    const pd = typeof c.prescreen_data === 'string' ? JSON.parse(c.prescreen_data) : (c.prescreen_data || {});
    const cagr = pd.revenue_cagr_3yr || 0;
    const gm = pd.gross_margin_estimate || 0;
    const mcap = pd.market_cap_m || c.market_cap || '?';
    console.log(`  ${c.ticker.padEnd(8)} mcap=${String(mcap).padStart(8)}M  CAGR=${(cagr*100).toFixed(1).padStart(6)}%  GM=${(gm*100).toFixed(1).padStart(5)}%`);
  }

  // ============================================================
  // STEP 4: Run Tier 4 pre-screen against all active regimes
  // ============================================================
  console.log('\n=== STEP 4: Tier 4 regime screen ===');

  const envRes = await fetch(`${API_BASE}/api/environment`);
  const envData = await envRes.json();
  const regimes = envData.regimes?.active || [];
  console.log(`Active regimes: ${regimes.length}`);

  let t4Total = 0;
  for (const r of regimes) {
    const res = await fetch(`${API_BASE}/api/screen/tier4?limit=500&regime_id=${r.id}`, {
      method: 'POST',
    });
    const data = await res.json();
    console.log(`  ${r.name}: scanned=${data.scanned || 0}, passes=${data.passes || 0}`);
    t4Total += data.passes || 0;
  }

  const t4Res = await fetch(`${API_BASE}/api/screen/tier4`);
  const t4Data = await t4Res.json();
  console.log(`Total Tier 4 candidates: ${t4Data.count || 0}`);

  // ============================================================
  // STEP 5: Bulk Sonnet analysis on all pending candidates
  // ============================================================
  console.log('\n=== STEP 5: Bulk Sonnet analysis ===');

  // Count pending
  let totalPending = 0;
  for (const tier of ['tier3', 'tier4']) {
    const res = await fetch(`${API_BASE}/api/screen/${tier}`);
    const data = await res.json();
    const pending = (data.candidates || []).filter(c => !c.attractor_analysis_date);
    totalPending += pending.length;
    console.log(`  ${tier}: ${pending.length} pending analysis`);
  }

  if (totalPending === 0) {
    console.log('No pending candidates. Skipping analysis.');
  } else {
    console.log(`\nStarting analysis of ${totalPending} candidates...`);
    console.log('Using Sonnet, concurrency 3. This may take 15-20 minutes.');

    // Set model to Sonnet
    await fetch(`${API_BASE}/api/portfolio/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deep_analysis_model: 'claude-sonnet-4-20250514' }),
    });

    // Get all pending candidates and analyze one by one
    const allPending = [];
    for (const tier of ['tier3', 'tier4']) {
      const res = await fetch(`${API_BASE}/api/screen/${tier}`);
      const data = await res.json();
      for (const c of (data.candidates || [])) {
        if (!c.attractor_analysis_date) {
          allPending.push(c);
        }
      }
    }

    let analyzed = 0, buys = 0, notYets = 0, passes = 0, errors = 0;
    for (const c of allPending) {
      process.stdout.write(`[${analyzed + 1}/${allPending.length}] ${c.ticker}... `);
      try {
        const res = await fetch(`${API_BASE}/api/candidates/${c.id}/deep-analyze`, {
          method: 'POST',
        });
        if (!res.ok) {
          console.log(`HTTP ${res.status}`);
          errors++;
        } else {
          const data = await res.json();
          const sig = data.new_signal || 'PASS';
          console.log(`score=${data.attractor_score?.toFixed(1) || '?'} signal=${sig}`);
          if (sig === 'BUY') buys++;
          else if (sig === 'NOT_YET') notYets++;
          else passes++;
        }
        analyzed++;
      } catch (err) {
        console.log(`Error: ${err.message}`);
        errors++;
      }
      await sleep(3000);
    }

    // Restore Opus
    await fetch(`${API_BASE}/api/portfolio/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deep_analysis_model: 'claude-opus-4-20250514' }),
    });

    // Refresh signals to populate IV/buy_below
    console.log('\nRefreshing signals...');
    await fetch(`${API_BASE}/api/signals/refresh`, { method: 'POST' });

    console.log(`\nAnalysis complete: ${analyzed} analyzed, ${buys} BUY, ${notYets} NOT_YET, ${passes} PASS, ${errors} errors`);
  }

  // ============================================================
  // FINAL SUMMARY
  // ============================================================
  console.log('\n=== FINAL SUMMARY ===');
  const finalSigs = await (await fetch(`${API_BASE}/api/signals`)).json();
  console.log(`BUY signals: ${finalSigs.buy_count || 0}`);
  for (const s of (finalSigs.buy_signals || [])) {
    console.log(`  BUY: ${s.ticker} tier=${s.discovery_tier} price=$${s.current_price} IV=$${s.intrinsic_value} buy_below=$${s.buy_below_price} shares=${s.recommended_shares} $=${s.recommended_dollars}`);
  }
  console.log(`NOT_YET signals: ${finalSigs.not_yet_count || 0}`);
  for (const s of (finalSigs.not_yet || [])) {
    const pct = s.current_price && s.buy_below_price ? ((s.current_price - s.buy_below_price) / s.current_price * 100).toFixed(1) : '?';
    console.log(`  NOT_YET: ${s.ticker} tier=${s.discovery_tier} price=$${s.current_price} buy_below=$${s.buy_below_price} needs ${pct}% decline`);
  }

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\nTotal time: ${elapsed} minutes`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
