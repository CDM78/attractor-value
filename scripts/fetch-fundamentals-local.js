#!/usr/bin/env node
// Fetches fundamentals from Alpha Vantage locally and inserts into D1 via wrangler
// Usage: node scripts/fetch-fundamentals-local.js [limit]

const AV_KEY = 'RPWGI533GR32YPRM';
const BASE_URL = 'https://www.alphavantage.co/query';
const DB_NAME = 'attractor-value-db';

const limit = parseInt(process.argv[2] || '6');

// All promising tickers in priority order (lowest P/E x P/B first)
// Script auto-skips any already loaded in D1
const PRIORITY_QUEUE = [
  'LNC', 'HPQ', 'CMCSA', 'EIX', 'CAG', 'BIO',
  'TFC', 'MTB', 'GPN', 'APA', 'FISV', 'KEY',
  'CFG', 'C', 'BAC', 'AIG', 'LKQ', 'STT', 'L', 'DVN'
];

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function parseNum(v) {
  const n = parseFloat(v);
  return isNaN(n) || v === 'None' || v === '-' || v === undefined ? null : n;
}

async function fetchAV(func, ticker) {
  const url = `${BASE_URL}?function=${func}&symbol=${encodeURIComponent(ticker)}&apikey=${AV_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AV HTTP ${res.status}`);
  const data = await res.json();
  if (data['Error Message']) throw new Error(`AV Error: ${data['Error Message']}`);
  if (data['Note']) throw new Error(`AV rate limit: ${data['Note']}`);
  if (data['Information']) throw new Error(`AV info: ${data['Information']}`);
  return data;
}

function escSQL(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return isNaN(v) ? 'NULL' : String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function fetchAndStore(ticker) {
  console.log(`\n--- Fetching ${ticker} ---`);

  // 1. Overview
  const overview = await fetchAV('OVERVIEW', ticker);
  console.log(`  Overview: ${overview.Name}`);
  await delay(1300);

  // 2. Income Statement
  const incomeData = await fetchAV('INCOME_STATEMENT', ticker);
  const income = incomeData.annualReports || [];
  console.log(`  Income: ${income.length} years`);
  await delay(1300);

  // 3. Balance Sheet
  const balanceData = await fetchAV('BALANCE_SHEET', ticker);
  const balance = balanceData.annualReports || [];
  console.log(`  Balance: ${balance.length} years`);
  await delay(1300);

  // 4. Cash Flow
  const cashData = await fetchAV('CASH_FLOW', ticker);
  const cashflow = cashData.annualReports || [];
  console.log(`  Cashflow: ${cashflow.length} years`);

  // Parse into financials records
  const years = {};
  for (const stmt of income) {
    const year = parseInt(stmt.fiscalDateEnding?.substring(0, 4));
    if (!year) continue;
    if (!years[year]) years[year] = { ticker, fiscal_year: year };
    years[year].revenue = parseNum(stmt.totalRevenue);
    years[year].net_income = parseNum(stmt.netIncome);
    const eps = parseNum(stmt.reportedEPS);
    if (eps != null) years[year].eps = eps;
  }

  for (const stmt of balance) {
    const year = parseInt(stmt.fiscalDateEnding?.substring(0, 4));
    if (!year) continue;
    if (!years[year]) years[year] = { ticker, fiscal_year: year };
    years[year].total_debt = (parseNum(stmt.longTermDebt) || 0) + (parseNum(stmt.shortTermDebt) || 0) + (parseNum(stmt.currentLongTermDebt) || 0);
    years[year].shareholder_equity = parseNum(stmt.totalShareholderEquity);
    years[year].current_assets = parseNum(stmt.totalCurrentAssets);
    years[year].current_liabilities = parseNum(stmt.totalCurrentLiabilities);
    const shares = parseNum(stmt.commonStockSharesOutstanding);
    if (shares) {
      years[year].shares_outstanding = shares;
      if (years[year].shareholder_equity) {
        years[year].book_value_per_share = years[year].shareholder_equity / shares;
      }
      if (years[year].net_income && !years[year].eps) {
        years[year].eps = years[year].net_income / shares;
      }
    }
  }

  for (const stmt of cashflow) {
    const year = parseInt(stmt.fiscalDateEnding?.substring(0, 4));
    if (!year) continue;
    if (!years[year]) years[year] = { ticker, fiscal_year: year };
    const opCashflow = parseNum(stmt.operatingCashflow) || 0;
    const capex = parseNum(stmt.capitalExpenditures) || 0;
    years[year].free_cash_flow = opCashflow - Math.abs(capex);
    const dividendsPaid = parseNum(stmt.dividendPayout) || parseNum(stmt.dividendPayoutCommonStock) || 0;
    years[year].dividend_paid = dividendsPaid > 0 ? 1 : 0;
    const nopat = years[year].net_income;
    const investedCapital = (years[year].shareholder_equity || 0) + (years[year].total_debt || 0);
    if (nopat && investedCapital > 0) {
      years[year].roic = (nopat / investedCapital) * 100;
    }
  }

  const financials = Object.values(years).sort((a, b) => b.fiscal_year - a.fiscal_year);

  // Build SQL statements
  const sqls = [];

  // Update stock info
  sqls.push(
    `INSERT OR REPLACE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated) VALUES (${escSQL(ticker)}, ${escSQL(overview.Name)}, ${escSQL(overview.Sector)}, ${escSQL(overview.Industry)}, ${escSQL(parseNum(overview.MarketCapitalization))}, '${new Date().toISOString()}');`
  );

  // Update market data with AV's ratios
  const pe = parseNum(overview.TrailingPE);
  const pb = parseNum(overview.PriceToBookRatio);
  const ey = pe ? ((1 / pe) * 100) : null;
  const dy = parseNum(overview.DividendYield) ? parseFloat(overview.DividendYield) * 100 : null;
  const insiderPct = parseNum(overview.PercentInsiders);

  sqls.push(
    `UPDATE market_data SET pe_ratio = COALESCE(${escSQL(pe)}, pe_ratio), pb_ratio = COALESCE(${escSQL(pb)}, pb_ratio), earnings_yield = COALESCE(${escSQL(ey)}, earnings_yield), dividend_yield = COALESCE(${escSQL(dy)}, dividend_yield), insider_ownership_pct = COALESCE(${escSQL(insiderPct)}, insider_ownership_pct), fetched_at = '${new Date().toISOString()}' WHERE ticker = ${escSQL(ticker)};`
  );

  // Insert financials
  for (const f of financials) {
    sqls.push(
      `INSERT OR REPLACE INTO financials (ticker, fiscal_year, eps, book_value_per_share, total_debt, shareholder_equity, current_assets, current_liabilities, free_cash_flow, dividend_paid, shares_outstanding, revenue, net_income, roic) VALUES (${escSQL(f.ticker)}, ${escSQL(f.fiscal_year)}, ${escSQL(f.eps)}, ${escSQL(f.book_value_per_share)}, ${escSQL(f.total_debt)}, ${escSQL(f.shareholder_equity)}, ${escSQL(f.current_assets)}, ${escSQL(f.current_liabilities)}, ${escSQL(f.free_cash_flow)}, ${escSQL(f.dividend_paid)}, ${escSQL(f.shares_outstanding)}, ${escSQL(f.revenue)}, ${escSQL(f.net_income)}, ${escSQL(f.roic)});`
    );
  }

  console.log(`  Parsed ${financials.length} years of financials`);
  console.log(`  Years: ${financials.map(f => f.fiscal_year).join(', ')}`);

  // Execute via wrangler d1
  const { execSync } = await import('child_process');
  const sqlBatch = sqls.join('\n');
  const tmpFile = `/tmp/av_${ticker}.sql`;
  const { writeFileSync } = await import('fs');
  writeFileSync(tmpFile, sqlBatch);

  try {
    const result = execSync(
      `cd /home/cm/attractor-value/workers && npx wrangler d1 execute ${DB_NAME} --remote --file=${tmpFile} 2>&1`,
      { timeout: 30000 }
    ).toString();
    console.log(`  DB insert: OK`);
  } catch (err) {
    console.error(`  DB insert FAILED:`, err.stdout?.toString() || err.message);
    throw err;
  }

  return { ticker, years: financials.length };
}

async function getAlreadyLoaded() {
  const { execSync } = await import('child_process');
  try {
    const result = execSync(
      `cd /home/cm/attractor-value/workers && npx wrangler d1 execute ${DB_NAME} --remote --command="SELECT DISTINCT ticker FROM financials" --json 2>/dev/null`,
      { timeout: 15000 }
    ).toString();
    const parsed = JSON.parse(result);
    const rows = parsed[0]?.results || [];
    return new Set(rows.map(r => r.ticker));
  } catch {
    return new Set();
  }
}

async function main() {
  const loaded = await getAlreadyLoaded();
  console.log(`Already loaded in D1: ${loaded.size} tickers (${[...loaded].join(', ')})`);

  const remaining = PRIORITY_QUEUE.filter(t => !loaded.has(t));
  const tickers = remaining.slice(0, limit);

  if (tickers.length === 0) {
    console.log('All priority queue tickers already loaded!');
    return;
  }

  console.log(`Fetching fundamentals for ${tickers.length} tickers: ${tickers.join(', ')}`);
  console.log(`Skipping ${PRIORITY_QUEUE.length - remaining.length} already loaded`);
  console.log(`AV calls needed: ${tickers.length * 4} (limit: 25/day)\n`);

  const results = [];
  for (const ticker of tickers) {
    try {
      const r = await fetchAndStore(ticker);
      results.push(r);
      if (tickers.indexOf(ticker) < tickers.length - 1) {
        console.log('  Waiting 2s before next ticker...');
        await delay(2000);
      }
    } catch (err) {
      console.error(`  FAILED for ${ticker}:`, err.message);
      if (err.message.includes('rate limit') || err.message.includes('AV info')) {
        console.error('  Rate limited — stopping.');
        break;
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Successfully loaded: ${results.map(r => `${r.ticker} (${r.years}yr)`).join(', ')}`);
  console.log(`Total: ${results.length}/${tickers.length} tickers`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
