#!/usr/bin/env node

// Build mid-cap universe: SEC company tickers → filter to $2B-$15B not in S&P 500
// Then pull EDGAR companyfacts for each, compute quarterly fundamentals.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const CAL = resolve(import.meta.dirname, '..');
const EDGAR_RAW_DIR = join(CAL, 'midcap-edgar-raw');
mkdirSync(EDGAR_RAW_DIR, { recursive: true });

const UA = 'Bolin & Troy LLC charles@bolinandtroy.com';

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  console.log('Building mid-cap universe...\n');

  // Step 1: Load existing S&P 500 tickers from universe
  const universe = JSON.parse(readFileSync(join(CAL, 'cases/universe.json'), 'utf-8'));
  const sp500Tickers = new Set();
  for (const c of Object.values(universe.cases)) {
    if (c.ticker) sp500Tickers.add(c.ticker);
  }
  console.log(`S&P 500 tickers in calibration: ${sp500Tickers.size}`);

  // Step 2: Load CIK cache (has all SEC-filing companies)
  const cikCache = JSON.parse(readFileSync('/home/cm/attractor-value/data/cik-cache.json', 'utf-8'));
  const allTickers = Object.keys(cikCache);
  console.log(`Total SEC tickers in CIK cache: ${allTickers.length}`);

  // Step 3: Use EDGAR Frames API to get companies by market cap
  // Fetch shares outstanding from EDGAR Frames
  console.log('\nFetching shares outstanding from EDGAR Frames API...');
  let sharesData;
  // EntityCommonStockSharesOutstanding is in 'dei' namespace, not 'us-gaap'
  for (const url of [
    'https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY2024Q4I.json',
    'https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY2024Q3I.json',
    'https://data.sec.gov/api/xbrl/frames/us-gaap/CommonStockSharesOutstanding/shares/CY2024Q3I.json',
  ]) {
    try { sharesData = await fetchJSON(url); break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  if (!sharesData) throw new Error('Cannot fetch shares outstanding from EDGAR');

  console.log(`Shares outstanding entries: ${sharesData.data?.length || 0}`);

  // Build CIK → shares map
  const sharesByCIK = {};
  for (const entry of (sharesData.data || [])) {
    const cik = entry.cik;
    if (entry.val > 0) {
      sharesByCIK[cik] = { shares: entry.val, name: entry.entityName };
    }
  }

  // Step 4: Get revenue data from Frames API to filter by revenue > $100M
  console.log('Fetching revenue from EDGAR Frames API...');
  await new Promise(r => setTimeout(r, 200));
  let revenueData;
  try {
    revenueData = await fetchJSON('https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2024Q4I.json');
  } catch {
    try {
      revenueData = await fetchJSON('https://data.sec.gov/api/xbrl/frames/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax/USD/CY2024Q4I.json');
    } catch {
      revenueData = { data: [] };
    }
  }

  const revenueByCIK = {};
  for (const entry of (revenueData.data || [])) {
    if (entry.val > 0) revenueByCIK[entry.cik] = entry.val;
  }
  console.log(`Revenue entries: ${Object.keys(revenueByCIK).length}`);

  // Step 5: Get recent stock prices via Yahoo for market cap estimation
  // We need price × shares = market cap
  // For efficiency, we'll estimate market cap from EDGAR data where possible
  // and use a price lookup for the top candidates

  // Build candidate list: all tickers NOT in S&P 500 with shares data
  const candidates = [];
  for (const [ticker, info] of Object.entries(cikCache)) {
    if (sp500Tickers.has(ticker)) continue;
    const cik = parseInt(info.cik, 10);
    const shares = sharesByCIK[cik];
    if (!shares) continue;

    candidates.push({
      ticker,
      name: shares.name || info.name || ticker,
      cik: cik,
      cik_padded: String(cik).padStart(10, '0'),
      shares_outstanding: shares.shares,
    });
  }

  console.log(`\nCandidates (non-S&P with shares data): ${candidates.length}`);

  // Step 6: Fetch prices for candidates to compute market cap
  // Yahoo v7 quote is blocked — use v8 chart API (1 call per ticker, get latest close)
  console.log('Fetching prices for market cap computation (v8 chart API)...');

  const midcapCompanies = [];
  const CONCURRENCY_PRICE = 10;
  let priceOk = 0, priceFail = 0;

  async function fetchPrice(cand) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cand.ticker}?range=5d&interval=1d`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AV-Research)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { priceFail++; return; }
      const data = await res.json();
      const result = data.chart?.result?.[0];
      if (!result) { priceFail++; return; }

      const closes = result.indicators?.quote?.[0]?.close || [];
      const price = closes.filter(c => c != null).pop();
      if (!price) { priceFail++; return; }

      const marketCap = price * cand.shares_outstanding;
      if (marketCap < 2e9 || marketCap > 15e9) return; // Outside mid-cap range

      // Revenue filter
      const rev = revenueByCIK[cand.cik];
      if (rev && rev < 100e6) return;

      midcapCompanies.push({
        ticker: cand.ticker,
        name: cand.name,
        cik: cand.cik,
        cik_padded: cand.cik_padded,
        shares_outstanding: cand.shares_outstanding,
        price: +price.toFixed(2),
        market_cap: Math.round(marketCap),
        sector: 'Unknown', // v8 doesn't return sector — we'll get from EDGAR SIC later
        revenue: rev || null,
      });
      priceOk++;
    } catch { priceFail++; }
  }

  for (let i = 0; i < candidates.length; i += CONCURRENCY_PRICE) {
    const batch = candidates.slice(i, i + CONCURRENCY_PRICE);
    await Promise.all(batch.map(c => fetchPrice(c)));

    if ((i + CONCURRENCY_PRICE) % 100 === 0) {
      process.stdout.write(`\r  ${i + CONCURRENCY_PRICE}/${candidates.length} — ${midcapCompanies.length} mid-caps found (${priceFail} price fails)    `);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n\nMid-cap companies found: ${midcapCompanies.length}`);

  // Filter out SPACs/shells (SIC 6726, 6770) — we'd need SIC codes
  // For now, filter by having revenue data
  const filtered = midcapCompanies.filter(c => c.revenue == null || c.revenue > 100e6);

  // Sort by market cap descending
  filtered.sort((a, b) => b.market_cap - a.market_cap);

  // Sector distribution
  const sectors = {};
  filtered.forEach(c => { sectors[c.sector] = (sectors[c.sector] || 0) + 1; });
  console.log('\nSector distribution:');
  for (const [s, n] of Object.entries(sectors).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(30)} ${n}`);
  }

  // Save universe
  const universeData = {
    generated: new Date().toISOString().split('T')[0],
    source: 'SEC_EDGAR_frames minus SP500, market_cap 2B-15B',
    market_cap_range: { min: 2e9, max: 15e9 },
    count: filtered.length,
    companies: filtered,
  };

  writeFileSync(join(CAL, 'midcap-universe.json'), JSON.stringify(universeData, null, 2));
  console.log(`\nSaved midcap-universe.json (${filtered.length} companies)`);

  // Write flag for Unit 1B
  writeFileSync(join(CAL, 'midcap-universe-ready.flag'), `ready ${new Date().toISOString()}`);

  // Step 7: Pull EDGAR companyfacts for each mid-cap ticker
  console.log('\nPulling EDGAR companyfacts...');

  const CONCURRENCY = 5;
  let fetched = 0, failed = 0;

  async function fetchCompany(company) {
    const path = join(EDGAR_RAW_DIR, `${company.ticker}.json`);
    if (existsSync(path)) { fetched++; return; }

    try {
      await new Promise(r => setTimeout(r, 200));
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik_padded}.json`;
      const data = await fetchJSON(url);

      // Extract key quarterly data
      const gaap = data.facts?.['us-gaap'] || {};
      const extracted = {
        ticker: company.ticker,
        cik: company.cik,
        name: data.entityName || company.name,
        facts: {},
      };

      const concepts = [
        'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet',
        'NetIncomeLoss', 'EarningsPerShareDiluted', 'EarningsPerShareBasic',
        'Assets', 'StockholdersEquity', 'LiabilitiesAndStockholdersEquity',
        'EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding',
        'AssetsCurrent', 'LiabilitiesCurrent', 'LongTermDebt',
        'OperatingCashFlow', 'NetCashProvidedByOperatingActivities',
        'Goodwill', 'ResearchAndDevelopmentExpense',
      ];

      for (const concept of concepts) {
        if (gaap[concept]?.units) {
          const units = gaap[concept].units;
          const key = Object.keys(units)[0]; // USD, shares, USD/shares
          if (key && units[key]) {
            extracted.facts[concept] = units[key]
              .filter(e => e.form === '10-Q' || e.form === '10-K')
              .map(e => ({ end: e.end, val: e.val, form: e.form, fy: e.fy, fp: e.fp, frame: e.frame }));
          }
        }
      }

      writeFileSync(path, JSON.stringify(extracted, null, 2));
      fetched++;
    } catch {
      failed++;
    }
  }

  // Process in concurrent batches
  for (let i = 0; i < filtered.length; i += CONCURRENCY) {
    const batch = filtered.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(c => fetchCompany(c)));

    if ((i + CONCURRENCY) % 50 === 0) {
      process.stdout.write(`\r  EDGAR: ${fetched} ok, ${failed} fail, ${i + CONCURRENCY}/${filtered.length}    `);
    }
  }

  console.log(`\n\nEDGAR fetch complete: ${fetched} ok, ${failed} failed`);
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
