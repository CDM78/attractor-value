#!/usr/bin/env node
// Bulk populate financial data from EDGAR Frames API.
// ~10 API calls → data for ~2,000+ companies in ~30 seconds.
// No API key needed. No per-stock calls.

const API_BASE = 'https://odieseyeball.com';
const EDGAR_UA = 'AV Framework contact@odieseyeball.com';

async function fetchFrames(tag, unit, period) {
  const url = `https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/${unit}/${period}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': EDGAR_UA } });
  if (!res.ok) {
    console.log(`  Frames ${tag}/${period}: HTTP ${res.status}`);
    return [];
  }
  const d = await res.json();
  return d.data || [];
}

async function main() {
  const startTime = Date.now();
  console.log('=== EDGAR Frames Bulk Populate ===\n');

  // Step 1: Fetch CIK → ticker mapping from SEC
  console.log('Fetching CIK → ticker mapping...');
  const tickerRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': EDGAR_UA },
  });
  const tickerData = await tickerRes.json();
  const cikToTicker = {};
  for (const entry of Object.values(tickerData)) {
    cikToTicker[entry.cik_str] = entry.ticker;
  }
  console.log(`  ${Object.keys(cikToTicker).length} CIK → ticker mappings\n`);

  // Step 2: Fetch financial data from Frames API
  console.log('Fetching EDGAR Frames data...');

  await sleep(500);
  const rev2024 = await fetchFrames('Revenues', 'USD', 'CY2024');
  console.log(`  Revenue CY2024: ${rev2024.length} companies`);

  await sleep(500);
  const rev2022 = await fetchFrames('Revenues', 'USD', 'CY2022');
  console.log(`  Revenue CY2022: ${rev2022.length} companies`);

  await sleep(500);
  const grossProfit2024 = await fetchFrames('GrossProfit', 'USD', 'CY2024');
  console.log(`  Gross Profit CY2024: ${grossProfit2024.length} companies`);

  await sleep(500);
  const shares = await fetchFrames('CommonStockSharesOutstanding', 'shares', 'CY2024Q3I');
  console.log(`  Shares Q3 2024: ${shares.length} companies`);

  // Also try RevenueFromContractWithCustomerExcludingAssessedTax as alternative revenue tag
  await sleep(500);
  const revAlt2024 = await fetchFrames('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', 'CY2024');
  console.log(`  Revenue (alt tag) CY2024: ${revAlt2024.length} companies`);

  await sleep(500);
  const revAlt2022 = await fetchFrames('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', 'CY2022');
  console.log(`  Revenue (alt tag) CY2022: ${revAlt2022.length} companies`);

  // Step 3: Build per-company financial profiles
  console.log('\nBuilding financial profiles...');

  // Index by CIK
  const byCik = {};

  function addData(entries, field) {
    for (const e of entries) {
      const cik = e.cik;
      if (!byCik[cik]) byCik[cik] = { cik, entityName: e.entityName };
      // Only keep the first/largest value per CIK (some have multiple filings)
      if (!byCik[cik][field] || Math.abs(e.val) > Math.abs(byCik[cik][field])) {
        byCik[cik][field] = e.val;
      }
    }
  }

  addData(rev2024, 'rev2024');
  addData(revAlt2024, 'rev2024'); // Merge alternative revenue tag
  addData(rev2022, 'rev2022');
  addData(revAlt2022, 'rev2022');
  addData(grossProfit2024, 'grossProfit2024');
  addData(shares, 'sharesOutstanding');

  console.log(`  ${Object.keys(byCik).length} unique companies with any data`);

  // Step 4: Compute metrics and map to tickers
  const updates = [];
  let matched = 0, unmatched = 0;

  for (const [cik, data] of Object.entries(byCik)) {
    const ticker = cikToTicker[cik];
    if (!ticker) { unmatched++; continue; }
    matched++;

    const rev24 = data.rev2024;
    const rev22 = data.rev2022;
    const gp24 = data.grossProfit2024;
    const shareCount = data.sharesOutstanding;

    // Revenue growth (annualized 2-year CAGR)
    let revenueGrowth = null;
    if (rev24 > 0 && rev22 > 0) {
      revenueGrowth = Math.round((Math.pow(rev24 / rev22, 0.5) - 1) * 10000) / 100; // as percentage
    }

    // Gross margin (as percentage)
    let grossMargin = null;
    if (gp24 != null && rev24 > 0) {
      grossMargin = Math.round((gp24 / rev24) * 10000) / 100;
    }

    // Market cap = shares × price (price from DB, shares from EDGAR)
    // We'll pass shares to the API and let it compute market cap
    const sharesMillion = shareCount ? Math.round(shareCount / 1e6 * 100) / 100 : null;

    updates.push({
      ticker,
      revenue_growth_3y: revenueGrowth,
      gross_margin_pct: grossMargin,
      shares_outstanding_m: sharesMillion,
      rev_latest: rev24,
    });
  }

  console.log(`  Matched to tickers: ${matched}`);
  console.log(`  No ticker mapping: ${unmatched}`);
  console.log(`  With revenue growth: ${updates.filter(u => u.revenue_growth_3y != null).length}`);
  console.log(`  With gross margin: ${updates.filter(u => u.gross_margin_pct != null).length}`);
  console.log(`  With shares: ${updates.filter(u => u.shares_outstanding_m != null).length}`);

  // Step 5: Push updates to the server
  console.log('\nPushing updates to database...');

  // Batch updates via a bulk endpoint
  const BATCH = 100;
  let pushed = 0;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const res = await fetch(`${API_BASE}/api/admin/bulk-update-stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: batch }),
    });

    if (res.ok) {
      const data = await res.json();
      pushed += data.updated || 0;
    } else {
      console.log(`  Batch ${Math.floor(i/BATCH)+1} error: HTTP ${res.status}`);
    }

    if (i % 500 === 0 && i > 0) {
      process.stdout.write(`  ${pushed} stocks updated...\r`);
    }
  }

  console.log(`  Total updated: ${pushed}`);

  // Step 6: Run pre-screen
  console.log('\n=== Re-running Tier 3 pre-screen ===');
  let scanned = 0, passes = 0;
  let offset = 0;
  let more = true;
  while (more) {
    const res = await fetch(`${API_BASE}/api/screen/tier3?limit=500&offset=${offset}`, { method: 'POST' });
    const data = await res.json();
    scanned += data.scanned || 0;
    passes += data.passes || 0;
    more = data.has_more || false;
    offset += 500;
  }
  console.log(`  Scanned: ${scanned}, Passes: ${passes}`);

  // Print top candidates
  const candRes = await fetch(`${API_BASE}/api/screen/tier3`);
  const candData = await candRes.json();
  const candidates = candData.candidates || [];
  const newCands = candidates.filter(c => !c.attractor_analysis_date);
  console.log(`  New candidates (unanalyzed): ${newCands.length}`);

  if (newCands.length > 0) {
    console.log('\n  Top 30 new candidates by growth:');
    const sorted = newCands.sort((a, b) => {
      const aGrowth = a.prescreen_data ? (JSON.parse(typeof a.prescreen_data === 'string' ? a.prescreen_data : '{}').revenue_cagr_3yr || 0) : 0;
      const bGrowth = b.prescreen_data ? (JSON.parse(typeof b.prescreen_data === 'string' ? b.prescreen_data : '{}').revenue_cagr_3yr || 0) : 0;
      return bGrowth - aGrowth;
    });
    for (const c of sorted.slice(0, 30)) {
      const pd = typeof c.prescreen_data === 'string' ? JSON.parse(c.prescreen_data) : (c.prescreen_data || {});
      console.log(`    ${c.ticker.padEnd(8)} mcap=${String(pd.market_cap_m || '?').padStart(8)}M  CAGR=${((pd.revenue_cagr_3yr||0)*100).toFixed(1).padStart(6)}%  GM=${((pd.gross_margin_estimate||0)*100).toFixed(1).padStart(5)}%`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nTotal time: ${elapsed} seconds`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
