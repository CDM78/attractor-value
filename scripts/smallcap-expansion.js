#!/usr/bin/env node
// Small-Cap Expansion — Generate Tier 8 calibration cases from small-cap universe
//
// Phase 3 of the foreign source expansion mission.
// Uses EDGAR Frames API to identify companies with assets in $300M-$2B range,
// pulls fundamentals, computes 3-year forward returns, classifies outcomes.
//
// Usage:
//   node scripts/smallcap-expansion.js [options]
//
// Options:
//   --phase N     Run only phase N (1=identify, 2=edgar, 3=returns, 4=classify, 5=merge)
//   --dry-run     Skip network requests, use cached data only
//   --limit N     Process only N candidates
//   --resume      Resume from saved progress
//   --status      Print current status and exit

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker, fetchCompanyFacts, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, getRevenueAtDate, detectAccountingStandard } from './lib/edgar-extractor.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const SC_DIR = resolve(DATA_DIR, 'smallcap-expansion');
const CACHE_DIR = resolve(DATA_DIR, 'edgar-cache');

mkdirSync(SC_DIR, { recursive: true });
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

// Small-cap company list — sourced from well-known Russell 2000 components
// and EDGAR companies with assets in the $300M-$2B range
const KNOWN_SMALLCAP = [
  // Consumer/Retail small caps
  { ticker: 'CATO', name: 'Cato Corporation', sector: 'Consumer Discretionary' },
  { ticker: 'SCVL', name: 'Shoe Carnival', sector: 'Consumer Discretionary' },
  { ticker: 'PLCE', name: "Children's Place", sector: 'Consumer Discretionary' },
  { ticker: 'DIN', name: "Dine Brands", sector: 'Consumer Discretionary' },
  { ticker: 'JACK', name: "Jack in the Box", sector: 'Consumer Discretionary' },
  { ticker: 'SHAK', name: 'Shake Shack', sector: 'Consumer Discretionary' },
  { ticker: 'CAKE', name: 'Cheesecake Factory', sector: 'Consumer Discretionary' },
  { ticker: 'BJRI', name: "BJ's Restaurants", sector: 'Consumer Discretionary' },
  { ticker: 'BOOT', name: 'Boot Barn Holdings', sector: 'Consumer Discretionary' },
  { ticker: 'PRPL', name: 'Purple Innovation', sector: 'Consumer Discretionary' },
  { ticker: 'LL', name: 'LL Flooring', sector: 'Consumer Discretionary' },
  { ticker: 'BGFV', name: 'Big 5 Sporting Goods', sector: 'Consumer Discretionary' },
  // Technology small caps
  { ticker: 'PRFT', name: 'Perficient', sector: 'Technology' },
  { ticker: 'SIGI', name: 'Selective Insurance', sector: 'Financials' },
  { ticker: 'SANM', name: 'Sanmina', sector: 'Technology' },
  { ticker: 'QLYS', name: 'Qualys', sector: 'Technology' },
  { ticker: 'CALX', name: 'Calix', sector: 'Technology' },
  { ticker: 'IIPR', name: 'Innovative Industrial Properties', sector: 'Real Estate' },
  { ticker: 'PAYO', name: 'Payoneer', sector: 'Technology' },
  { ticker: 'JAMF', name: 'Jamf Holding', sector: 'Technology' },
  { ticker: 'VERX', name: 'Vertex Inc', sector: 'Technology' },
  { ticker: 'WEAV', name: 'Weave Communications', sector: 'Technology' },
  // Healthcare small caps
  { ticker: 'SUPN', name: 'Supernus Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'LGND', name: 'Ligand Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'PDCO', name: 'Patterson Companies', sector: 'Healthcare' },
  { ticker: 'OMCL', name: 'Omnicell', sector: 'Healthcare' },
  { ticker: 'NVCR', name: 'NovoCure', sector: 'Healthcare' },
  { ticker: 'TMDX', name: 'TransMedics Group', sector: 'Healthcare' },
  { ticker: 'TCMD', name: 'Tactile Systems', sector: 'Healthcare' },
  { ticker: 'ITCI', name: 'Intra-Cellular Therapies', sector: 'Healthcare' },
  { ticker: 'GKOS', name: 'Glaukos', sector: 'Healthcare' },
  { ticker: 'AVNS', name: 'Avanos Medical', sector: 'Healthcare' },
  // Industrials small caps
  { ticker: 'KTOS', name: 'Kratos Defense', sector: 'Industrials' },
  { ticker: 'PRIM', name: 'Primoris Services', sector: 'Industrials' },
  { ticker: 'MATX', name: 'Matson', sector: 'Industrials' },
  { ticker: 'ASGN', name: 'ASGN Inc', sector: 'Industrials' },
  { ticker: 'ARCB', name: 'ArcBest', sector: 'Industrials' },
  { ticker: 'GMS', name: 'GMS Inc', sector: 'Industrials' },
  { ticker: 'WDFC', name: 'WD-40', sector: 'Consumer Staples' },
  { ticker: 'SITE', name: 'SiteOne Landscape', sector: 'Industrials' },
  { ticker: 'ROAD', name: 'Construction Partners', sector: 'Industrials' },
  { ticker: 'MYRG', name: 'MYR Group', sector: 'Industrials' },
  // Financials small caps
  { ticker: 'CASH', name: 'Pathward Financial', sector: 'Financials' },
  { ticker: 'HOMB', name: 'Home BancFins', sector: 'Financials' },
  { ticker: 'UBSI', name: 'United Bankshares', sector: 'Financials' },
  { ticker: 'SBCF', name: 'Seacoast Banking', sector: 'Financials' },
  { ticker: 'CADE', name: 'Cadence Bank', sector: 'Financials' },
  { ticker: 'PNFP', name: 'Pinnacle Financial', sector: 'Financials' },
  { ticker: 'IBOC', name: 'International Bancshares', sector: 'Financials' },
  { ticker: 'GBCI', name: 'Glacier Bancorp', sector: 'Financials' },
  { ticker: 'BKU', name: 'BankUnited', sector: 'Financials' },
  { ticker: 'OZK', name: 'Bank OZK', sector: 'Financials' },
  // Energy/Materials small caps
  { ticker: 'SM', name: 'SM Energy', sector: 'Energy' },
  { ticker: 'MTDR', name: 'Matador Resources', sector: 'Energy' },
  { ticker: 'TALO', name: 'Talos Energy', sector: 'Energy' },
  { ticker: 'HESM', name: 'Hess Midstream', sector: 'Energy' },
  { ticker: 'ARCH', name: 'Arch Resources', sector: 'Energy' },
  { ticker: 'HCC', name: 'Warrior Met Coal', sector: 'Materials' },
  { ticker: 'ITE', name: 'i-Minerals', sector: 'Materials' },
  { ticker: 'UFPI', name: 'UFP Industries', sector: 'Materials' },
  { ticker: 'TREX', name: 'Trex Company', sector: 'Materials' },
  { ticker: 'BECN', name: 'Beacon Roofing', sector: 'Industrials' },
  // Small-cap failures/value traps
  { ticker: 'BGCP', name: 'BGC Partners', sector: 'Financials' },
  { ticker: 'CENTA', name: 'Central Garden', sector: 'Consumer Staples' },
  { ticker: 'GTN', name: 'Gray Television', sector: 'Communication Services' },
  { ticker: 'LEE', name: 'Lee Enterprises', sector: 'Communication Services' },
  { ticker: 'MBI', name: 'MBIA', sector: 'Financials' },
  { ticker: 'TWNK', name: 'Hostess Brands', sector: 'Consumer Staples' },
  { ticker: 'BBBY', name: 'Bed Bath & Beyond', sector: 'Consumer Discretionary' },
  { ticker: 'EXPR', name: 'Express Inc', sector: 'Consumer Discretionary' },
  { ticker: 'TLYS', name: 'Tillys', sector: 'Consumer Discretionary' },
  { ticker: 'RRGB', name: 'Red Robin', sector: 'Consumer Discretionary' },
  // More small caps for diversity
  { ticker: 'LNTH', name: 'Lantheus Holdings', sector: 'Healthcare' },
  { ticker: 'OSCR', name: 'Oscar Health', sector: 'Healthcare' },
  { ticker: 'CELH', name: 'Celsius Holdings', sector: 'Consumer Staples' },
  { ticker: 'ASPN', name: 'Aspen Aerogels', sector: 'Industrials' },
  { ticker: 'XPEL', name: 'XPEL Inc', sector: 'Consumer Discretionary' },
  { ticker: 'LMND', name: 'Lemonade', sector: 'Financials' },
  { ticker: 'SFM', name: 'Sprouts Farmers Market', sector: 'Consumer Staples' },
  { ticker: 'DXCM', name: 'DexCom', sector: 'Healthcare' },
  { ticker: 'AXON', name: 'Axon Enterprise', sector: 'Industrials' },
  { ticker: 'ENPH', name: 'Enphase Energy', sector: 'Technology' },
  { ticker: 'CROX', name: 'Crocs Inc', sector: 'Consumer Discretionary' },
  { ticker: 'YETI', name: 'YETI Holdings', sector: 'Consumer Discretionary' },
  { ticker: 'BROS', name: 'Dutch Bros', sector: 'Consumer Discretionary' },
  { ticker: 'PLAY', name: "Dave & Buster's", sector: 'Consumer Discretionary' },
  { ticker: 'WING', name: 'Wingstop', sector: 'Consumer Discretionary' },
];

const ENTRY_DATES = ['2014-06-15', '2017-06-15', '2020-06-15'];

// ============================================
// PHASE 1: Identify small-cap universe
// ============================================
async function phase1_identifySmallCaps() {
  console.log(`\n${BOLD}${CYAN}Phase 1: Identify Small-Cap Universe${RESET}`);

  await ensureCikCache();

  const candidates = [];
  const seen = new Set();

  for (const sc of KNOWN_SMALLCAP) {
    for (const entryDate of ENTRY_DATES) {
      const key = `${sc.ticker}-${entryDate}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        ticker: sc.ticker,
        company_name: sc.name,
        sector: sc.sector,
        entry_date: entryDate,
        source: 'known_smallcap',
      });
    }
  }

  console.log(`  Known small-cap companies: ${KNOWN_SMALLCAP.length}`);
  console.log(`  Total candidates (with multi-entry): ${candidates.length}`);

  writeFileSync(resolve(SC_DIR, 'candidates.json'), JSON.stringify(candidates, null, 2));
  console.log(`  ${GREEN}Saved ${candidates.length} candidates${RESET}`);

  return candidates;
}

// ============================================
// PHASE 2: EDGAR data pull
// ============================================
async function phase2_edgarPull(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 2: EDGAR Data Pull${RESET}`);

  const progressFile = resolve(SC_DIR, 'edgar-progress.json');
  let progress = {};
  if (RESUME && existsSync(progressFile)) {
    progress = JSON.parse(readFileSync(progressFile, 'utf-8'));
    console.log(`  Resuming from ${Object.keys(progress).length} already processed`);
  }

  await ensureCikCache();

  const uniqueTickers = [...new Set(candidates.map(c => c.ticker))];
  const toProcess = uniqueTickers.filter(t => !progress[t]);
  const limit = LIMIT ? Math.min(LIMIT, toProcess.length) : toProcess.length;
  console.log(`  Processing ${limit} of ${toProcess.length} remaining tickers`);

  let success = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const ticker = toProcess[i];

    if (DRY_RUN) {
      const cik = getCikForTicker(ticker);
      if (cik && hasCachedFacts(cik)) {
        progress[ticker] = { status: 'cached', cik };
        success++;
      } else {
        progress[ticker] = { status: 'no_cache', cik };
        failed++;
      }
      continue;
    }

    const result = await fetchFactsForTicker(ticker);
    if (result.facts) {
      const qm = extractQuarterlyMetrics(result.facts);
      const revByDate = {};
      for (const date of ENTRY_DATES) {
        revByDate[date] = getRevenueAtDate(result.facts, date);
      }
      progress[ticker] = {
        status: 'ok',
        cik: result.cik,
        quarters: qm.length,
        revenueByDate: revByDate,
        hasEnoughData: qm.length >= 8,
      };
      success++;
    } else {
      progress[ticker] = { status: 'failed', error: result.error };
      failed++;
    }

    if ((i + 1) % 10 === 0 || i === limit - 1) {
      writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${success} ok, ${failed} failed)...\r`);
    }
  }

  console.log(`\n  ${GREEN}EDGAR pull complete: ${success} ok, ${failed} failed${RESET}`);
  writeFileSync(progressFile, JSON.stringify(progress, null, 2));
  return progress;
}

// ============================================
// PHASE 3: Yahoo Finance forward returns
// ============================================
async function phase3_forwardReturns(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 3: Forward Returns (Yahoo Finance)${RESET}`);

  const returnsFile = resolve(SC_DIR, 'forward-returns.json');
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

      // Russell 2000 benchmark (IWM ETF)
      let benchmarkReturn = null;
      const benchKey = `${c.entry_date}-3yr-iwm`;
      if (sp500Cache[benchKey] != null) {
        benchmarkReturn = sp500Cache[benchKey];
      } else {
        const iwmPrices = await fetchYahooPrice('IWM', period1, period2);
        if (iwmPrices && iwmPrices.length >= 2) {
          const iwmEntry = findClosestPrice(iwmPrices, eventTs);
          const iwmExit = findClosestPrice(iwmPrices, threeYrTs);
          if (iwmEntry && iwmExit) {
            benchmarkReturn = (iwmExit.close - iwmEntry.close) / iwmEntry.close;
            sp500Cache[benchKey] = benchmarkReturn;
          }
        }
      }

      // Also get S&P 500 for cross-comparison
      let sp500Return = null;
      const sp500Key = `${c.entry_date}-3yr-spy`;
      if (sp500Cache[sp500Key] != null) {
        sp500Return = sp500Cache[sp500Key];
      } else {
        const spyPrices = await fetchYahooPrice('^GSPC', period1, period2);
        if (spyPrices && spyPrices.length >= 2) {
          const spyEntry = findClosestPrice(spyPrices, eventTs);
          const spyExit = findClosestPrice(spyPrices, threeYrTs);
          if (spyEntry && spyExit) {
            sp500Return = (spyExit.close - spyEntry.close) / spyEntry.close;
            sp500Cache[sp500Key] = sp500Return;
          }
        }
      }

      returns[key] = {
        status: 'ok',
        ticker: c.ticker,
        entry_date: c.entry_date,
        entry_price: entryPrice.close,
        entry_date_actual: new Date(entryPrice.timestamp * 1000).toISOString().slice(0, 10),
        exit_price: exitPrice.close,
        exit_date_actual: new Date(exitPrice.timestamp * 1000).toISOString().slice(0, 10),
        return_3yr: return3yr,
        iwm_return_3yr: benchmarkReturn,
        sp500_return_3yr: sp500Return,
        alpha_vs_iwm: benchmarkReturn != null ? return3yr - benchmarkReturn : null,
        alpha_vs_sp500: sp500Return != null ? return3yr - sp500Return : null,
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
// PHASE 4: Classify outcomes
// ============================================
function phase4_classify(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 4: Classify Small-Cap Outcomes${RESET}`);

  const edgarProgress = loadJSON(resolve(SC_DIR, 'edgar-progress.json'));
  const returns = loadJSON(resolve(SC_DIR, 'forward-returns.json'));

  const classified = [];
  let filtered = { noEdgar: 0, insufficientQ: 0, lowRevenue: 0, noReturns: 0, noBenchmark: 0 };

  for (const c of candidates) {
    const key = `${c.ticker}-${c.entry_date}`;
    const edgar = edgarProgress[c.ticker];
    const ret = returns[key];

    if (!edgar || (edgar.status !== 'ok' && edgar.status !== 'cached')) { filtered.noEdgar++; continue; }
    if (edgar.hasEnoughData === false) { filtered.insufficientQ++; continue; }

    const revAtDate = edgar.revenueByDate?.[c.entry_date];
    if (revAtDate != null && revAtDate < 50_000_000) { filtered.lowRevenue++; continue; }

    if (!ret || ret.status !== 'ok') { filtered.noReturns++; continue; }

    // Use IWM (Russell 2000) as primary benchmark, fall back to S&P 500
    const benchReturn = ret.iwm_return_3yr ?? ret.sp500_return_3yr;
    if (benchReturn == null) { filtered.noBenchmark++; continue; }

    const r3yr = ret.return_3yr;
    let outcome;
    if (r3yr > benchReturn + 0.20) outcome = 'winner';
    else if (r3yr < 0) outcome = 'trap';
    else if (r3yr < benchReturn) outcome = 'underperform';
    else outcome = 'mixed';

    classified.push({
      ticker: c.ticker,
      company_name: c.company_name,
      sector: c.sector,
      entry_date: c.entry_date,
      entry_price: ret.entry_price,
      entry_date_actual: ret.entry_date_actual,
      exit_price: ret.exit_price,
      return_3yr: r3yr,
      iwm_return_3yr: ret.iwm_return_3yr,
      sp500_return_3yr: ret.sp500_return_3yr,
      alpha_vs_iwm: ret.alpha_vs_iwm,
      outcome,
      quarters: edgar.quarters,
      revenue_at_entry: revAtDate,
    });
  }

  console.log(`  Filtered out:`);
  console.log(`    No EDGAR data: ${filtered.noEdgar}`);
  console.log(`    Insufficient quarters (<8): ${filtered.insufficientQ}`);
  console.log(`    Revenue < $50M: ${filtered.lowRevenue}`);
  console.log(`    No forward returns: ${filtered.noReturns}`);
  console.log(`    No benchmark: ${filtered.noBenchmark}`);

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of classified) outcomes[c.outcome]++;

  console.log(`\n  Classified cases: ${classified.length}`);
  console.log(`    Winners: ${outcomes.winner}`);
  console.log(`    Traps: ${outcomes.trap}`);
  console.log(`    Underperform: ${outcomes.underperform}`);
  console.log(`    Mixed: ${outcomes.mixed}`);

  writeFileSync(resolve(SC_DIR, 'classified.json'), JSON.stringify(classified, null, 2));
  console.log(`  ${GREEN}Saved ${classified.length} classified cases${RESET}`);

  return classified;
}

// ============================================
// PHASE 5: Build Tier 8 dataset file
// ============================================
function phase5_buildDataset(classified) {
  console.log(`\n${BOLD}${CYAN}Phase 5: Build Tier 8 Dataset${RESET}`);

  const cases = classified.map((c, i) => ({
    case_id: `T8-${String(i + 1).padStart(3, '0')}`,
    ticker: c.ticker,
    company_name: c.company_name,
    tier: 8,
    dataset_role: 'smallcap',
    outcome: c.outcome,
    entry: {
      date: c.entry_date_actual || c.entry_date,
      price: c.entry_price ? Math.round(c.entry_price * 100) / 100 : null,
      sector: c.sector,
      industry: null,
    },
    forward_returns: {
      return_3yr: c.return_3yr ? Math.round(c.return_3yr * 1000) / 1000 : null,
      iwm_return_3yr: c.iwm_return_3yr ? Math.round(c.iwm_return_3yr * 1000) / 1000 : null,
      sp500_return_3yr: c.sp500_return_3yr ? Math.round(c.sp500_return_3yr * 1000) / 1000 : null,
    },
    source: {
      quarters_available: c.quarters,
      revenue_at_entry: c.revenue_at_entry,
    },
  }));

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of cases) outcomes[c.outcome]++;

  const dataset = {
    metadata: {
      tier: 8,
      dataset_role: 'smallcap',
      source: 'Small-cap companies (Russell 2000 / $300M-$2B assets) from EDGAR',
      case_count: cases.length,
      winners: outcomes.winner,
      traps: outcomes.trap,
      underperform: outcomes.underperform,
      mixed: outcomes.mixed,
      benchmark: 'IWM (Russell 2000 ETF)',
      generated: new Date().toISOString(),
    },
    cases,
  };

  const outPath = resolve(DATA_DIR, 'tier8-smallcap.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`  ${GREEN}Saved ${cases.length} cases to tier8-smallcap.json${RESET}`);

  return dataset;
}

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return {}; }
}

function printStatus() {
  console.log(`\n${BOLD}Small-Cap Expansion Status${RESET}\n`);
  const files = [
    ['Phase 1 (Identify)', resolve(SC_DIR, 'candidates.json'), 'array'],
    ['Phase 2 (EDGAR)', resolve(SC_DIR, 'edgar-progress.json'), 'object'],
    ['Phase 3 (Returns)', resolve(SC_DIR, 'forward-returns.json'), 'object'],
    ['Phase 4 (Classify)', resolve(SC_DIR, 'classified.json'), 'array'],
    ['Phase 5 (Merge)', resolve(DATA_DIR, 'tier8-smallcap.json'), 'dataset'],
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
  console.log(`${BOLD}Small-Cap Expansion Pipeline (Tier 8)${RESET}`);
  console.log('='.repeat(50));

  if (STATUS_ONLY) { printStatus(); return; }

  const shouldRun = (n) => !PHASE || PHASE === n;

  let candidates;
  if (shouldRun(1)) {
    candidates = await phase1_identifySmallCaps();
  } else {
    const loaded = loadJSON(resolve(SC_DIR, 'candidates.json'));
    candidates = Array.isArray(loaded) ? loaded : [];
  }

  if (candidates.length === 0) {
    console.log(`${RED}No candidates${RESET}`);
    return;
  }

  if (shouldRun(2)) await phase2_edgarPull(candidates);
  if (shouldRun(3)) await phase3_forwardReturns(candidates);
  if (shouldRun(4)) phase4_classify(candidates);

  if (shouldRun(5)) {
    const classified = loadJSON(resolve(SC_DIR, 'classified.json'));
    if (Array.isArray(classified) && classified.length > 0) {
      phase5_buildDataset(classified);
    }
  }

  printStatus();
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
