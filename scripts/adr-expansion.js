#!/usr/bin/env node
// ADR/International Expansion — Generate Tier 7 calibration cases from 20-F filers
//
// Phase 2 of the foreign source expansion mission.
// Identifies ADR companies filing Form 20-F with SEC EDGAR, pulls IFRS/US-GAAP data,
// computes 3-year forward returns via Yahoo Finance, classifies outcomes.
//
// Usage:
//   node scripts/adr-expansion.js [options]
//
// Options:
//   --phase N     Run only phase N (1=identify, 2=edgar, 3=returns, 4=classify, 5=merge)
//   --dry-run     Skip network requests, use cached data only
//   --limit N     Process only N candidates
//   --resume      Resume from saved progress
//   --status      Print current status and exit

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker, fetchCompanyFacts, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, getRevenueAtDate, detectAccountingStandard } from './lib/edgar-extractor.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const ADR_DIR = resolve(DATA_DIR, 'adr-expansion');
const CACHE_DIR = resolve(DATA_DIR, 'edgar-cache');

mkdirSync(ADR_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const PHASE = getArg('phase') ? parseInt(getArg('phase')) : null;
const DRY_RUN = hasFlag('dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const RESUME = hasFlag('resume');
const STATUS_ONLY = hasFlag('status');

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';

const USER_AGENT = 'AV-Framework charles@bolinandtroy.com';
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 110;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
}

// Well-known large ADR companies filing 20-F with EDGAR XBRL data
// These are verified to have companyfacts JSON available
const KNOWN_ADR_COMPANIES = [
  // European
  { ticker: 'ASML', cik: '0000937966', name: 'ASML Holding', country: 'Netherlands', sector: 'Technology' },
  { ticker: 'SAP', cik: '0001000184', name: 'SAP SE', country: 'Germany', sector: 'Technology' },
  { ticker: 'NVO', cik: '0000353278', name: 'Novo Nordisk', country: 'Denmark', sector: 'Healthcare' },
  { ticker: 'AZN', cik: '0000901832', name: 'AstraZeneca', country: 'UK', sector: 'Healthcare' },
  { ticker: 'UL', cik: '0000217410', name: 'Unilever', country: 'UK', sector: 'Consumer Staples' },
  { ticker: 'SHOP', cik: '0001594805', name: 'Shopify', country: 'Canada', sector: 'Technology' },
  { ticker: 'GSK', cik: '0000809509', name: 'GSK plc', country: 'UK', sector: 'Healthcare' },
  { ticker: 'DEO', cik: '0000835403', name: 'Diageo', country: 'UK', sector: 'Consumer Staples' },
  { ticker: 'RY', cik: '0001000275', name: 'Royal Bank of Canada', country: 'Canada', sector: 'Financials' },
  { ticker: 'BHP', cik: '0000811809', name: 'BHP Group', country: 'Australia', sector: 'Materials' },
  { ticker: 'RIO', cik: '0000863064', name: 'Rio Tinto', country: 'UK', sector: 'Materials' },
  { ticker: 'BP', cik: '0000313807', name: 'BP plc', country: 'UK', sector: 'Energy' },
  { ticker: 'SHEL', cik: '0001306965', name: 'Shell plc', country: 'UK', sector: 'Energy' },
  { ticker: 'TTE', cik: '0000879764', name: 'TotalEnergies', country: 'France', sector: 'Energy' },
  { ticker: 'SNY', cik: '0001121404', name: 'Sanofi', country: 'France', sector: 'Healthcare' },
  { ticker: 'HSBC', cik: '0000083246', name: 'HSBC Holdings', country: 'UK', sector: 'Financials' },
  { ticker: 'TD', cik: '0000947263', name: 'Toronto-Dominion Bank', country: 'Canada', sector: 'Financials' },
  { ticker: 'ENB', cik: '0000895728', name: 'Enbridge', country: 'Canada', sector: 'Energy' },
  { ticker: 'CNI', cik: '0001001085', name: 'Canadian National Railway', country: 'Canada', sector: 'Industrials' },
  { ticker: 'CP', cik: '0001001882', name: 'Canadian Pacific Kansas City', country: 'Canada', sector: 'Industrials' },
  { ticker: 'BTI', cik: '0000060714', name: 'British American Tobacco', country: 'UK', sector: 'Consumer Staples' },
  { ticker: 'ABB', cik: '0001091587', name: 'ABB Ltd', country: 'Switzerland', sector: 'Industrials' },
  { ticker: 'WCN', cik: '0001057058', name: 'Waste Connections', country: 'Canada', sector: 'Industrials' },
  { ticker: 'ING', cik: '0000052975', name: 'ING Groep', country: 'Netherlands', sector: 'Financials' },
  { ticker: 'RELX', cik: '0000772274', name: 'RELX plc', country: 'UK', sector: 'Industrials' },
  { ticker: 'MELI', cik: '0001099590', name: 'MercadoLibre', country: 'Argentina', sector: 'Technology' },
  // Asian
  { ticker: 'TM', cik: '0001094517', name: 'Toyota Motor', country: 'Japan', sector: 'Consumer Discretionary' },
  { ticker: 'SONY', cik: '0000313838', name: 'Sony Group', country: 'Japan', sector: 'Technology' },
  { ticker: 'HMC', cik: '0000715153', name: 'Honda Motor', country: 'Japan', sector: 'Consumer Discretionary' },
  { ticker: 'MUFG', cik: '0000067088', name: 'Mitsubishi UFJ Financial', country: 'Japan', sector: 'Financials' },
  { ticker: 'BABA', cik: '0001577552', name: 'Alibaba Group', country: 'China', sector: 'Technology' },
  { ticker: 'TSM', cik: '0001046179', name: 'Taiwan Semiconductor', country: 'Taiwan', sector: 'Technology' },
  { ticker: 'PDD', cik: '0001737806', name: 'PDD Holdings', country: 'China', sector: 'Technology' },
  { ticker: 'JD', cik: '0001549802', name: 'JD.com', country: 'China', sector: 'Technology' },
  { ticker: 'BIDU', cik: '0001329099', name: 'Baidu', country: 'China', sector: 'Technology' },
  { ticker: 'NIO', cik: '0001736541', name: 'NIO Inc', country: 'China', sector: 'Consumer Discretionary' },
  { ticker: 'SE', cik: '0001747748', name: 'Sea Limited', country: 'Singapore', sector: 'Technology' },
  { ticker: 'GRAB', cik: '0001855612', name: 'Grab Holdings', country: 'Singapore', sector: 'Technology' },
  { ticker: 'WIT', cik: '0001318220', name: 'Wipro', country: 'India', sector: 'Technology' },
  { ticker: 'INFY', cik: '0001067491', name: 'Infosys', country: 'India', sector: 'Technology' },
  { ticker: 'HDB', cik: '0001144967', name: 'HDFC Bank', country: 'India', sector: 'Financials' },
  // Latin America
  { ticker: 'NU', cik: '0001881551', name: 'Nu Holdings', country: 'Brazil', sector: 'Financials' },
  { ticker: 'VALE', cik: '0000917851', name: 'Vale S.A.', country: 'Brazil', sector: 'Materials' },
  { ticker: 'PBR', cik: '0001119639', name: 'Petrobras', country: 'Brazil', sector: 'Energy' },
  { ticker: 'ITUB', cik: '0001132260', name: 'Itau Unibanco', country: 'Brazil', sector: 'Financials' },
  { ticker: 'SBS', cik: '0001178879', name: 'SABESP', country: 'Brazil', sector: 'Utilities' },
  // Known failures/traps (ADR)
  { ticker: 'LK', cik: '0001767582', name: 'Luckin Coffee', country: 'China', sector: 'Consumer Discretionary' },
  { ticker: 'TAL', cik: '0001499620', name: 'TAL Education', country: 'China', sector: 'Consumer Discretionary' },
  { ticker: 'VNET', cik: '0001495231', name: 'VNET Group', country: 'China', sector: 'Technology' },
  { ticker: 'GSX', cik: '0001768259', name: 'Gaotu Techedu', country: 'China', sector: 'Consumer Discretionary' },
  { ticker: 'IQ', cik: '0001712184', name: 'iQIYI', country: 'China', sector: 'Communication Services' },
  // European failures/restructuring
  { ticker: 'NOK', cik: '0000804328', name: 'Nokia', country: 'Finland', sector: 'Technology' },
  { ticker: 'DB', cik: '0001159508', name: 'Deutsche Bank', country: 'Germany', sector: 'Financials' },
  { ticker: 'CS', cik: '0001053092', name: 'Credit Suisse', country: 'Switzerland', sector: 'Financials' },
  { ticker: 'PHG', cik: '0000313216', name: 'Philips', country: 'Netherlands', sector: 'Healthcare' },
];

// Entry dates for multi-entry expansion (3+ years apart, before 2023 cutoff for 3yr returns)
const ENTRY_DATES = ['2014-06-15', '2017-06-15', '2020-06-15'];

// ============================================
// PHASE 1: Identify ADR universe
// ============================================
async function phase1_identifyADR() {
  console.log(`\n${BOLD}${CYAN}Phase 1: Identify ADR Universe${RESET}`);

  // Also search EDGAR EFTS for additional 20-F filers
  let additionalTickers = [];
  if (!DRY_RUN) {
    try {
      console.log('  Searching EDGAR for 20-F filers...');
      const searchUrl = 'https://efts.sec.gov/LATEST/search-index?q=%2220-F%22&dateRange=custom&startdt=2020-01-01&enddt=2025-12-31&forms=20-F';
      const res = await rateLimitedFetch(searchUrl);
      if (res.ok) {
        const data = await res.json();
        console.log(`  EFTS returned ${data?.hits?.total?.value || 0} results`);
      }
    } catch (e) {
      console.log(`  EFTS search failed (non-critical): ${e.message}`);
    }
  }

  // Use CIK cache to find more ADR tickers
  await ensureCikCache();

  // Build candidate list from known ADR companies
  const candidates = [];
  const seen = new Set();

  for (const adr of KNOWN_ADR_COMPANIES) {
    for (const entryDate of ENTRY_DATES) {
      const key = `${adr.ticker}-${entryDate}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        ticker: adr.ticker,
        cik: adr.cik,
        company_name: adr.name,
        country: adr.country,
        sector: adr.sector,
        entry_date: entryDate,
        source: 'known_adr',
      });
    }
  }

  console.log(`  Known ADR companies: ${KNOWN_ADR_COMPANIES.length}`);
  console.log(`  Total candidates (with multi-entry): ${candidates.length}`);

  writeFileSync(resolve(ADR_DIR, 'candidates.json'), JSON.stringify(candidates, null, 2));
  console.log(`  ${GREEN}Saved ${candidates.length} candidates${RESET}`);

  return candidates;
}

// ============================================
// PHASE 2: EDGAR data pull
// ============================================
async function phase2_edgarPull(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 2: EDGAR Data Pull (IFRS + US GAAP)${RESET}`);

  const progressFile = resolve(ADR_DIR, 'edgar-progress.json');
  let progress = {};
  if (RESUME && existsSync(progressFile)) {
    progress = JSON.parse(readFileSync(progressFile, 'utf-8'));
    console.log(`  Resuming from ${Object.keys(progress).length} already processed`);
  }

  // Deduplicate tickers (multiple entry dates per ticker)
  const uniqueTickers = [...new Set(candidates.map(c => c.ticker))];
  const toProcess = uniqueTickers.filter(t => !progress[t]);
  const limit = LIMIT ? Math.min(LIMIT, toProcess.length) : toProcess.length;
  console.log(`  Processing ${limit} of ${toProcess.length} remaining tickers`);

  let success = 0, failed = 0, ifrsCount = 0, gaapCount = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = toProcess[i];
    const adr = KNOWN_ADR_COMPANIES.find(a => a.ticker === ticker);
    const cik = adr?.cik;

    if (!cik) {
      progress[ticker] = { status: 'no_cik' };
      failed++;
      continue;
    }

    if (DRY_RUN && !hasCachedFacts(cik)) {
      progress[ticker] = { status: 'no_cache', cik };
      failed++;
      continue;
    }

    try {
      const facts = await fetchCompanyFacts(cik);
      if (!facts) {
        progress[ticker] = { status: 'not_found', cik };
        failed++;
        continue;
      }

      const standard = detectAccountingStandard(facts);
      const qm = extractQuarterlyMetrics(facts);
      const revAtEntry = {};
      for (const date of ENTRY_DATES) {
        revAtEntry[date] = getRevenueAtDate(facts, date);
      }

      progress[ticker] = {
        status: 'ok',
        cik,
        accounting_standard: standard,
        quarters: qm.length,
        revenueByDate: revAtEntry,
        hasEnoughData: qm.length >= 8,
      };

      if (standard === 'ifrs') ifrsCount++;
      else gaapCount++;
      success++;

    } catch (e) {
      progress[ticker] = { status: 'error', cik, error: e.message };
      failed++;
    }

    if ((i + 1) % 10 === 0 || i === limit - 1) {
      writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${success} ok [${ifrsCount} IFRS, ${gaapCount} GAAP], ${failed} failed)...\r`);
    }
  }

  console.log(`\n  ${GREEN}EDGAR pull complete: ${success} ok (${ifrsCount} IFRS, ${gaapCount} GAAP), ${failed} failed${RESET}`);
  writeFileSync(progressFile, JSON.stringify(progress, null, 2));
  return progress;
}

// ============================================
// PHASE 3: Yahoo Finance forward returns
// ============================================
async function phase3_forwardReturns(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 3: Forward Returns (Yahoo Finance)${RESET}`);

  const returnsFile = resolve(ADR_DIR, 'forward-returns.json');
  let returns = {};
  if (RESUME && existsSync(returnsFile)) {
    returns = JSON.parse(readFileSync(returnsFile, 'utf-8'));
    console.log(`  Resuming from ${Object.keys(returns).length} already computed`);
  }

  const sp500Cache = {};
  const toProcess = candidates.filter(c => !returns[`${c.ticker}-${c.entry_date}`]);
  const limit = LIMIT ? Math.min(LIMIT, toProcess.length) : toProcess.length;
  console.log(`  Processing ${limit} of ${toProcess.length} remaining`);

  let success = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const c = toProcess[i];
    const key = `${c.ticker}-${c.entry_date}`;

    if (DRY_RUN) {
      returns[key] = { status: 'dry_run' };
      failed++;
      continue;
    }

    try {
      const eventDate = new Date(c.entry_date);
      const threeYearsLater = new Date(eventDate);
      threeYearsLater.setFullYear(threeYearsLater.getFullYear() + 3);

      const period1 = Math.floor(eventDate.getTime() / 1000) - 86400 * 7;
      const period2 = Math.floor(threeYearsLater.getTime() / 1000) + 86400 * 7;

      const tickerPrices = await fetchYahooPrice(c.ticker, period1, period2);
      if (!tickerPrices || tickerPrices.length < 2) {
        returns[key] = { status: 'no_price_data', ticker: c.ticker };
        failed++;
        continue;
      }

      const eventTs = eventDate.getTime() / 1000;
      const threeYrTs = threeYearsLater.getTime() / 1000;

      const entryPrice = findClosestPrice(tickerPrices, eventTs);
      const exitPrice = findClosestPrice(tickerPrices, threeYrTs);

      if (!entryPrice || !exitPrice) {
        returns[key] = { status: 'missing_price', ticker: c.ticker };
        failed++;
        continue;
      }

      const return3yr = (exitPrice.close - entryPrice.close) / entryPrice.close;

      // S&P 500 benchmark for same period
      let sp500Return = null;
      const sp500Key = `${c.entry_date}-3yr`;
      if (sp500Cache[sp500Key] != null) {
        sp500Return = sp500Cache[sp500Key];
      } else {
        const sp500Prices = await fetchYahooPrice('^GSPC', period1, period2);
        if (sp500Prices && sp500Prices.length >= 2) {
          const sp500Entry = findClosestPrice(sp500Prices, eventTs);
          const sp500Exit = findClosestPrice(sp500Prices, threeYrTs);
          if (sp500Entry && sp500Exit) {
            sp500Return = (sp500Exit.close - sp500Entry.close) / sp500Entry.close;
            sp500Cache[sp500Key] = sp500Return;
          }
        }
      }

      returns[key] = {
        status: 'ok',
        ticker: c.ticker,
        entry_date: c.entry_date,
        country: c.country,
        entry_price: entryPrice.close,
        entry_date_actual: new Date(entryPrice.timestamp * 1000).toISOString().slice(0, 10),
        exit_price: exitPrice.close,
        exit_date_actual: new Date(exitPrice.timestamp * 1000).toISOString().slice(0, 10),
        return_3yr: return3yr,
        sp500_return_3yr: sp500Return,
        alpha_3yr: sp500Return != null ? return3yr - sp500Return : null,
      };
      success++;

    } catch (e) {
      returns[key] = { status: 'error', error: e.message, ticker: c.ticker };
      failed++;
    }

    if ((i + 1) % 10 === 0 || i === limit - 1) {
      writeFileSync(returnsFile, JSON.stringify(returns, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${success} ok, ${failed} failed)...\r`);
    }
  }

  console.log(`\n  ${GREEN}Returns complete: ${success} ok, ${failed} failed${RESET}`);
  writeFileSync(returnsFile, JSON.stringify(returns, null, 2));
  return returns;
}

async function fetchYahooPrice(ticker, period1, period2) {
  await new Promise(r => setTimeout(r, 250));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.adjclose?.[0]?.adjclose) return null;
    const timestamps = result.timestamp;
    const closes = result.indicators.adjclose[0].adjclose;
    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) prices.push({ timestamp: timestamps[i], close: closes[i] });
    }
    return prices;
  } catch { return null; }
}

function findClosestPrice(prices, targetTs) {
  if (!prices || prices.length === 0) return null;
  let best = prices[0];
  let bestDiff = Math.abs(prices[0].timestamp - targetTs);
  for (const p of prices) {
    const diff = Math.abs(p.timestamp - targetTs);
    if (diff < bestDiff) { best = p; bestDiff = diff; }
  }
  if (bestDiff > 14 * 86400) return null;
  return best;
}

// ============================================
// PHASE 4: Classify outcomes and filter
// ============================================
function phase4_classify(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 4: Classify ADR Outcomes${RESET}`);

  const edgarProgress = loadJSON(resolve(ADR_DIR, 'edgar-progress.json'));
  const returns = loadJSON(resolve(ADR_DIR, 'forward-returns.json'));

  const classified = [];
  let filtered = { noEdgar: 0, insufficientQ: 0, lowRevenue: 0, noReturns: 0, noSP500: 0 };

  for (const c of candidates) {
    const key = `${c.ticker}-${c.entry_date}`;
    const edgar = edgarProgress[c.ticker];
    const ret = returns[key];

    if (!edgar || (edgar.status !== 'ok')) { filtered.noEdgar++; continue; }
    if (!edgar.hasEnoughData) { filtered.insufficientQ++; continue; }

    const revAtDate = edgar.revenueByDate?.[c.entry_date];
    if (revAtDate != null && revAtDate < 50_000_000) { filtered.lowRevenue++; continue; }

    if (!ret || ret.status !== 'ok') { filtered.noReturns++; continue; }
    if (ret.sp500_return_3yr == null) { filtered.noSP500++; continue; }

    const r3yr = ret.return_3yr;
    const sp3yr = ret.sp500_return_3yr;
    let outcome;
    if (r3yr > sp3yr + 0.20) outcome = 'winner';
    else if (r3yr < 0) outcome = 'trap';
    else if (r3yr < sp3yr) outcome = 'underperform';
    else outcome = 'mixed';

    classified.push({
      ticker: c.ticker,
      company_name: c.company_name,
      country: c.country,
      sector: c.sector,
      entry_date: c.entry_date,
      entry_price: ret.entry_price,
      entry_date_actual: ret.entry_date_actual,
      exit_price: ret.exit_price,
      return_3yr: r3yr,
      sp500_return_3yr: sp3yr,
      alpha_3yr: ret.alpha_3yr,
      outcome,
      accounting_standard: edgar.accounting_standard,
      quarters: edgar.quarters,
      revenue_at_entry: revAtDate,
    });
  }

  console.log(`  Filtered out:`);
  console.log(`    No EDGAR data: ${filtered.noEdgar}`);
  console.log(`    Insufficient quarters (<8): ${filtered.insufficientQ}`);
  console.log(`    Revenue < $50M: ${filtered.lowRevenue}`);
  console.log(`    No forward returns: ${filtered.noReturns}`);
  console.log(`    No S&P 500 benchmark: ${filtered.noSP500}`);

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of classified) outcomes[c.outcome]++;

  console.log(`\n  Classified cases: ${classified.length}`);
  console.log(`    Winners: ${outcomes.winner}`);
  console.log(`    Traps: ${outcomes.trap}`);
  console.log(`    Underperform: ${outcomes.underperform}`);
  console.log(`    Mixed: ${outcomes.mixed}`);

  const byCountry = {};
  for (const c of classified) {
    byCountry[c.country] = (byCountry[c.country] || 0) + 1;
  }
  console.log(`\n  By country:`);
  for (const [country, count] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${country}: ${count}`);
  }

  const byStandard = { ifrs: 0, 'us-gaap': 0 };
  for (const c of classified) byStandard[c.accounting_standard] = (byStandard[c.accounting_standard] || 0) + 1;
  console.log(`\n  Accounting standard: IFRS=${byStandard.ifrs}, US-GAAP=${byStandard['us-gaap']}`);

  writeFileSync(resolve(ADR_DIR, 'classified.json'), JSON.stringify(classified, null, 2));
  console.log(`  ${GREEN}Saved ${classified.length} classified cases${RESET}`);

  return classified;
}

// ============================================
// PHASE 5: Build Tier 7 dataset file
// ============================================
function phase5_buildDataset(classified) {
  console.log(`\n${BOLD}${CYAN}Phase 5: Build Tier 7 Dataset${RESET}`);

  const cases = classified.map((c, i) => ({
    case_id: `T7-${String(i + 1).padStart(3, '0')}`,
    ticker: c.ticker,
    company_name: c.company_name,
    country: c.country,
    tier: 7,
    dataset_role: 'adr_international',
    outcome: c.outcome,
    entry: {
      date: c.entry_date_actual || c.entry_date,
      price: c.entry_price ? Math.round(c.entry_price * 100) / 100 : null,
      sector: c.sector,
      industry: null,
    },
    forward_returns: {
      return_3yr: c.return_3yr ? Math.round(c.return_3yr * 1000) / 1000 : null,
      sp500_return_3yr: c.sp500_return_3yr ? Math.round(c.sp500_return_3yr * 1000) / 1000 : null,
    },
    source: {
      accounting_standard: c.accounting_standard,
      quarters_available: c.quarters,
      revenue_at_entry: c.revenue_at_entry,
    },
  }));

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of cases) outcomes[c.outcome]++;

  const dataset = {
    metadata: {
      tier: 7,
      dataset_role: 'adr_international',
      source: 'ADR/International companies filing 20-F with SEC EDGAR (IFRS + US GAAP)',
      case_count: cases.length,
      winners: outcomes.winner,
      traps: outcomes.trap,
      underperform: outcomes.underperform,
      mixed: outcomes.mixed,
      countries: [...new Set(classified.map(c => c.country))].sort(),
      generated: new Date().toISOString(),
    },
    cases,
  };

  const outPath = resolve(DATA_DIR, 'tier7-adr-international.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`  ${GREEN}Saved ${cases.length} cases to tier7-adr-international.json${RESET}`);

  return dataset;
}

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return {}; }
}

function printStatus() {
  console.log(`\n${BOLD}ADR Expansion Status${RESET}\n`);
  const files = [
    ['Phase 1 (Identify)', resolve(ADR_DIR, 'candidates.json'), 'array'],
    ['Phase 2 (EDGAR)', resolve(ADR_DIR, 'edgar-progress.json'), 'object'],
    ['Phase 3 (Returns)', resolve(ADR_DIR, 'forward-returns.json'), 'object'],
    ['Phase 4 (Classify)', resolve(ADR_DIR, 'classified.json'), 'array'],
    ['Phase 5 (Merge)', resolve(DATA_DIR, 'tier7-adr-international.json'), 'dataset'],
  ];
  for (const [label, path, type] of files) {
    if (!existsSync(path)) { console.log(`  ${label}: ${RED}NOT DONE${RESET}`); continue; }
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const count = type === 'array' ? data.length : type === 'dataset' ? data.cases?.length : Object.keys(data).length;
    console.log(`  ${label}: ${GREEN}${count} items${RESET}`);
  }
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}ADR/International Expansion Pipeline (Tier 7)${RESET}`);
  console.log('='.repeat(50));

  if (STATUS_ONLY) { printStatus(); return; }

  const shouldRun = (n) => !PHASE || PHASE === n;

  let candidates;
  if (shouldRun(1)) {
    candidates = await phase1_identifyADR();
  } else {
    candidates = loadJSON(resolve(ADR_DIR, 'candidates.json'));
    if (!Array.isArray(candidates)) candidates = [];
  }

  if (candidates.length === 0) {
    console.log(`${RED}No candidates${RESET}`);
    return;
  }

  if (shouldRun(2)) await phase2_edgarPull(candidates);
  if (shouldRun(3)) await phase3_forwardReturns(candidates);

  if (shouldRun(4)) {
    phase4_classify(candidates);
  }

  if (shouldRun(5)) {
    const classified = loadJSON(resolve(ADR_DIR, 'classified.json'));
    if (Array.isArray(classified) && classified.length > 0) {
      phase5_buildDataset(classified);
    }
  }

  printStatus();
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
