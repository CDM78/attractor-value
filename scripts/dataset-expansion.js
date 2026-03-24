#!/usr/bin/env node
// Dataset Expansion — Generate calibration cases from S&P 500 constituent changes
//
// Parses sp500_ticker_start_end.csv to identify additions (winners) and removals (traps),
// pulls EDGAR data, computes 3-year forward returns via Yahoo Finance, classifies outcomes,
// and outputs cases in the calibration dataset format.
//
// Usage:
//   node scripts/dataset-expansion.js [options]
//
// Options:
//   --phase N        Run only phase N (1=parse, 2=edgar, 3=returns, 4=classify, 5=merge)
//   --dry-run        Skip network requests, use cached data only
//   --limit N        Process only N candidates
//   --resume         Resume from saved progress
//   --status         Print current status and exit

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { ensureCikCache, getCikForTicker, fetchFactsForTicker, hasCachedFacts } from './lib/edgar-fetcher.js';
import { extractQuarterlyMetrics, getRevenueAtDate } from './lib/edgar-extractor.js';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const SP500_DIR = resolve(DATA_DIR, 'sp500-constituents');
const EXPANSION_DIR = resolve(DATA_DIR, 'expansion');
const CAL_DIR = resolve(import.meta.dirname, '../../av-calibration-tool/data');
const STATUS_FILE = resolve(DATA_DIR, 'expansion-session-status.md');

mkdirSync(EXPANSION_DIR, { recursive: true });

// CLI
const args = process.argv.slice(2);
function hasFlag(name) { return args.includes(`--${name}`); }
function getArg(name) { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; }

const PHASE = getArg('phase') ? parseInt(getArg('phase')) : null;
const DRY_RUN = hasFlag('dry-run');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const RESUME = hasFlag('resume');
const STATUS_ONLY = hasFlag('status');

const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', DIM = '\x1b[2m', RESET = '\x1b[0m';

// ============================================
// PHASE 1: Parse S&P 500 constituent changes
// ============================================
function phase1_parseSP500() {
  console.log(`\n${BOLD}${CYAN}Phase 1: Parse S&P 500 Constituent Changes${RESET}`);

  const csv = readFileSync(resolve(SP500_DIR, 'sp500_ticker_start_end.csv'), 'utf-8');
  const lines = csv.trim().split('\n').slice(1); // skip header

  const entries = [];
  for (const line of lines) {
    const [ticker, start_date, end_date] = line.split(',').map(s => s.trim());
    if (!ticker || !start_date) continue;
    entries.push({ ticker, start_date, end_date: end_date || null });
  }

  console.log(`  Total entries: ${entries.length}`);

  // Additions 2010-2024: companies with start_date in range
  const additions = entries.filter(e => {
    const year = parseInt(e.start_date.substring(0, 4));
    return year >= 2010 && year <= 2024;
  });

  // Removals 2010-2024: companies with end_date in range
  const removals = entries.filter(e => {
    if (!e.end_date) return false;
    const year = parseInt(e.end_date.substring(0, 4));
    return year >= 2010 && year <= 2024;
  });

  console.log(`  Additions 2010-2024: ${additions.length}`);
  console.log(`  Removals 2010-2024: ${removals.length}`);

  // Build candidate list
  // For additions: event_date = start_date, type = 'addition'
  // For removals: event_date = end_date, type = 'removal'
  // Deduplicate: same ticker can have multiple entries
  const candidates = [];
  const seen = new Set();

  for (const e of additions) {
    const key = `${e.ticker}-add-${e.start_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      ticker: e.ticker,
      event_date: e.start_date,
      event_type: 'addition',
      sp500_start: e.start_date,
      sp500_end: e.end_date,
    });
  }

  for (const e of removals) {
    const key = `${e.ticker}-rem-${e.end_date}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Check if this removal was followed by a re-addition (suggests M&A/restructuring)
    const reAdded = entries.some(e2 =>
      e2.ticker === e.ticker && e2.start_date > e.end_date
    );

    candidates.push({
      ticker: e.ticker,
      event_date: e.end_date,
      event_type: 'removal',
      sp500_start: e.start_date,
      sp500_end: e.end_date,
      reAdded,
    });
  }

  // Filter out likely M&A exits from removals (re-added tickers or known patterns)
  // Keep re-added ones flagged but don't exclude — we'll filter by forward returns later
  console.log(`  Total candidates: ${candidates.length}`);
  console.log(`    Additions: ${candidates.filter(c => c.event_type === 'addition').length}`);
  console.log(`    Removals: ${candidates.filter(c => c.event_type === 'removal').length}`);
  console.log(`    Removals re-added later: ${candidates.filter(c => c.reAdded).length}`);

  // Remove tickers already in existing calibration dataset
  const existingTickers = loadExistingTickers();
  const newCandidates = candidates.filter(c => !existingTickers.has(c.ticker));
  console.log(`  After removing existing calibration tickers: ${newCandidates.length}`);

  // 3-year forward return requires event_date before 2023-03-23 (3 years before today)
  const cutoff = '2023-03-23';
  const viable = newCandidates.filter(c => c.event_date <= cutoff);
  console.log(`  Viable (event before ${cutoff} for 3yr return): ${viable.length}`);

  writeFileSync(resolve(EXPANSION_DIR, 'candidates.json'), JSON.stringify(viable, null, 2));
  console.log(`  ${GREEN}Saved ${viable.length} candidates to expansion/candidates.json${RESET}`);

  return viable;
}

function loadExistingTickers() {
  const tickers = new Set();
  const files = ['tier1-stable-value.json', 'tier2-crisis-dislocation.json', 'tier3-emerging-dks.json', 'tier4-regime-transition.json'];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(CAL_DIR, file), 'utf-8'));
      for (const c of data.cases || []) {
        tickers.add(c.ticker);
      }
    } catch { /* skip */ }
  }
  return tickers;
}

// ============================================
// PHASE 2: EDGAR data pull
// ============================================
async function phase2_edgarPull(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 2: EDGAR Data Pull${RESET}`);

  // Load progress if resuming
  const progressFile = resolve(EXPANSION_DIR, 'edgar-progress.json');
  let progress = {};
  if (RESUME && existsSync(progressFile)) {
    progress = JSON.parse(readFileSync(progressFile, 'utf-8'));
    console.log(`  Resuming from ${Object.keys(progress).length} already processed`);
  }

  await ensureCikCache();

  const toProcess = candidates.filter(c => !progress[c.ticker]);
  const limit = LIMIT ? Math.min(LIMIT, toProcess.length) : toProcess.length;
  console.log(`  Processing ${limit} of ${toProcess.length} remaining tickers`);

  let success = 0, failed = 0, noEdgar = 0;

  for (let i = 0; i < limit; i++) {
    const c = toProcess[i];
    const ticker = c.ticker;

    if (DRY_RUN) {
      const cik = getCikForTicker(ticker);
      if (cik && hasCachedFacts(cik)) {
        progress[ticker] = { status: 'cached', cik };
        success++;
      } else {
        progress[ticker] = { status: 'no_cache', cik };
        noEdgar++;
      }
    } else {
      const result = await fetchFactsForTicker(ticker);
      if (result.facts) {
        const qm = extractQuarterlyMetrics(result.facts);
        const revAtEvent = getRevenueAtDate(result.facts, c.event_date);
        progress[ticker] = {
          status: 'ok',
          cik: result.cik,
          quarters: qm.length,
          revenueAtEvent: revAtEvent,
          hasEnoughData: qm.length >= 8,
        };
        success++;
      } else {
        progress[ticker] = { status: 'failed', error: result.error };
        failed++;
      }
    }

    if ((i + 1) % 25 === 0 || i === limit - 1) {
      writeFileSync(progressFile, JSON.stringify(progress, null, 2));
      process.stdout.write(`  ${i + 1}/${limit} (${success} ok, ${failed} failed, ${noEdgar} no cache)...\r`);
    }
  }

  console.log(`\n  ${GREEN}EDGAR pull complete: ${success} ok, ${failed} failed, ${noEdgar} no cache${RESET}`);
  writeFileSync(progressFile, JSON.stringify(progress, null, 2));

  return progress;
}

// ============================================
// PHASE 3: Yahoo Finance forward returns
// ============================================
async function phase3_forwardReturns(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 3: Forward Returns (Yahoo Finance)${RESET}`);

  const returnsFile = resolve(EXPANSION_DIR, 'forward-returns.json');
  let returns = {};
  if (RESUME && existsSync(returnsFile)) {
    returns = JSON.parse(readFileSync(returnsFile, 'utf-8'));
    console.log(`  Resuming from ${Object.keys(returns).length} already computed`);
  }

  // Also need S&P 500 returns for the same periods
  const sp500Cache = {};

  const toProcess = candidates.filter(c => !returns[`${c.ticker}-${c.event_date}`]);
  const limit = LIMIT ? Math.min(LIMIT, toProcess.length) : toProcess.length;
  console.log(`  Processing ${limit} of ${toProcess.length} remaining`);

  let success = 0, failed = 0;

  for (let i = 0; i < limit; i++) {
    const c = toProcess[i];
    const key = `${c.ticker}-${c.event_date}`;

    if (DRY_RUN) {
      returns[key] = { status: 'dry_run' };
      failed++;
      continue;
    }

    try {
      // Fetch ticker price at event date and 3 years later
      const eventDate = new Date(c.event_date);
      const threeYearsLater = new Date(eventDate);
      threeYearsLater.setFullYear(threeYearsLater.getFullYear() + 3);

      // Yahoo Finance v8 API for historical prices
      const period1 = Math.floor(eventDate.getTime() / 1000) - 86400 * 7; // 7 days before
      const period2 = Math.floor(threeYearsLater.getTime() / 1000) + 86400 * 7; // 7 days after

      const tickerPrices = await fetchYahooPrice(c.ticker, period1, period2);

      if (!tickerPrices || tickerPrices.length < 2) {
        returns[key] = { status: 'no_price_data', ticker: c.ticker };
        failed++;
        continue;
      }

      // Find price closest to event date and 3yr later
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

      // Get S&P 500 return for same period
      let sp500Return = null;
      const sp500Key = `${c.event_date}-3yr`;
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
        event_date: c.event_date,
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
  // Rate limit
  await new Promise(r => setTimeout(r, 200));

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();

    const result = data?.chart?.result?.[0];
    if (!result?.timestamp || !result?.indicators?.adjclose?.[0]?.adjclose) return null;

    const timestamps = result.timestamp;
    const closes = result.indicators.adjclose[0].adjclose;

    const prices = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        prices.push({ timestamp: timestamps[i], close: closes[i] });
      }
    }
    return prices;
  } catch {
    return null;
  }
}

function findClosestPrice(prices, targetTs) {
  if (!prices || prices.length === 0) return null;
  let best = prices[0];
  let bestDiff = Math.abs(prices[0].timestamp - targetTs);
  for (const p of prices) {
    const diff = Math.abs(p.timestamp - targetTs);
    if (diff < bestDiff) { best = p; bestDiff = diff; }
  }
  // Only accept if within 14 days
  if (bestDiff > 14 * 86400) return null;
  return best;
}

// ============================================
// PHASE 4: Classify outcomes and filter
// ============================================
function phase4_classify(candidates) {
  console.log(`\n${BOLD}${CYAN}Phase 4: Classify Outcomes${RESET}`);

  const edgarProgress = loadJSON(resolve(EXPANSION_DIR, 'edgar-progress.json'));
  const returns = loadJSON(resolve(EXPANSION_DIR, 'forward-returns.json'));

  const classified = [];
  let filtered = { noEdgar: 0, insufficientQ: 0, lowRevenue: 0, noReturns: 0, noSP500: 0 };

  for (const c of candidates) {
    const key = `${c.ticker}-${c.event_date}`;
    const edgar = edgarProgress[c.ticker];
    const ret = returns[key];

    // Filter: EDGAR data
    if (!edgar || edgar.status !== 'ok') { filtered.noEdgar++; continue; }
    if (!edgar.hasEnoughData) { filtered.insufficientQ++; continue; }

    // Filter: Revenue > $50M
    if (edgar.revenueAtEvent != null && edgar.revenueAtEvent < 50_000_000) { filtered.lowRevenue++; continue; }

    // Filter: Forward returns
    if (!ret || ret.status !== 'ok') { filtered.noReturns++; continue; }
    if (ret.sp500_return_3yr == null) { filtered.noSP500++; continue; }

    // Classify outcome
    const r3yr = ret.return_3yr;
    const sp3yr = ret.sp500_return_3yr;
    let outcome;
    if (r3yr > sp3yr + 0.20) outcome = 'winner';
    else if (r3yr < 0) outcome = 'trap';
    else if (r3yr < sp3yr) outcome = 'underperform';
    else outcome = 'mixed';

    classified.push({
      ticker: c.ticker,
      event_type: c.event_type,
      event_date: c.event_date,
      entry_price: ret.entry_price,
      entry_date: ret.entry_date_actual,
      exit_price: ret.exit_price,
      return_3yr: r3yr,
      sp500_return_3yr: sp3yr,
      alpha_3yr: ret.alpha_3yr,
      outcome,
      quarters: edgar.quarters,
      revenue_at_event: edgar.revenueAtEvent,
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

  const byType = { addition: 0, removal: 0 };
  for (const c of classified) byType[c.event_type]++;
  console.log(`    From additions: ${byType.addition}`);
  console.log(`    From removals: ${byType.removal}`);

  writeFileSync(resolve(EXPANSION_DIR, 'classified.json'), JSON.stringify(classified, null, 2));
  console.log(`  ${GREEN}Saved ${classified.length} classified cases${RESET}`);

  return classified;
}

// ============================================
// PHASE 5: Build calibration dataset file
// ============================================
function phase5_buildDataset(classified) {
  console.log(`\n${BOLD}${CYAN}Phase 5: Build Merged Calibration Dataset${RESET}`);

  // Assign sectors from EDGAR or CIK cache
  // For now, use a simple SIC-to-sector mapping or leave as null
  // The calibration data loader will handle missing sectors

  const cases = classified.map((c, i) => ({
    case_id: `T5-${String(i + 1).padStart(3, '0')}`,
    ticker: c.ticker,
    company_name: c.ticker, // Will be enriched later
    tier: 5,
    dataset_role: 'expansion',
    outcome: c.outcome,
    entry: {
      date: c.entry_date || c.event_date,
      price: c.entry_price ? Math.round(c.entry_price * 100) / 100 : null,
      sector: null, // To be enriched
      industry: null,
    },
    forward_returns: {
      return_3yr: c.return_3yr ? Math.round(c.return_3yr * 1000) / 1000 : null,
      sp500_return_3yr: c.sp500_return_3yr ? Math.round(c.sp500_return_3yr * 1000) / 1000 : null,
    },
    source: {
      event_type: c.event_type,
      event_date: c.event_date,
      quarters_available: c.quarters,
      revenue_at_event: c.revenue_at_event,
    },
  }));

  const outcomes = { winner: 0, trap: 0, underperform: 0, mixed: 0 };
  for (const c of cases) outcomes[c.outcome]++;

  const dataset = {
    metadata: {
      tier: 5,
      dataset_role: 'expansion',
      source: 'S&P 500 constituent changes 2010-2024',
      case_count: cases.length,
      winners: outcomes.winner,
      traps: outcomes.trap,
      underperform: outcomes.underperform,
      mixed: outcomes.mixed,
      generated: new Date().toISOString(),
    },
    cases,
  };

  const outPath = resolve(CAL_DIR, 'tier5-sp500-expansion.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`  ${GREEN}Saved ${cases.length} cases to ${outPath}${RESET}`);

  // Enrich company names from CIK cache
  enrichCompanyNames(outPath);

  // Report total dataset size
  const existingCount = countExistingCases();
  console.log(`\n  ${BOLD}Dataset Summary:${RESET}`);
  console.log(`    Existing cases (tiers 1-4): ${existingCount}`);
  console.log(`    New expansion cases (tier 5): ${cases.length}`);
  console.log(`    ${BOLD}Total: ${existingCount + cases.length}${RESET}`);

  return dataset;
}

function enrichCompanyNames(filePath) {
  try {
    const cikCache = JSON.parse(readFileSync(resolve(DATA_DIR, 'cik-cache.json'), 'utf-8'));
    const dataset = JSON.parse(readFileSync(filePath, 'utf-8'));
    for (const c of dataset.cases) {
      const entry = cikCache[c.ticker];
      if (entry?.name) c.company_name = entry.name;
    }
    writeFileSync(filePath, JSON.stringify(dataset, null, 2));
  } catch { /* non-critical */ }
}

function countExistingCases() {
  let count = 0;
  const files = ['tier1-stable-value.json', 'tier2-crisis-dislocation.json', 'tier3-emerging-dks.json', 'tier4-regime-transition.json'];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(CAL_DIR, file), 'utf-8'));
      count += data.cases?.length || 0;
    } catch { /* skip */ }
  }
  return count;
}

function loadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return {}; }
}

// ============================================
// Update calibration-data.js to include tier 5
// ============================================
function phase5_updateLoader() {
  // Check if calibration-data.js already includes tier 5
  const loaderPath = resolve(import.meta.dirname, 'lib/calibration-data.js');
  const loaderContent = readFileSync(loaderPath, 'utf-8');

  if (loaderContent.includes('tier5-sp500-expansion.json')) {
    console.log(`  Calibration data loader already includes tier 5`);
    return;
  }

  const updated = loaderContent
    .replace(
      `'tier4-regime-transition.json',`,
      `'tier4-regime-transition.json',\n  'tier5-sp500-expansion.json',`
    )
    .replace(
      `4: 'Regime',`,
      `4: 'Regime',\n  5: 'SP500 Expansion',`
    );

  writeFileSync(loaderPath, updated);
  console.log(`  ${GREEN}Updated calibration-data.js to include tier 5${RESET}`);
}

// ============================================
// STATUS
// ============================================
function printStatus() {
  console.log(`\n${BOLD}Dataset Expansion Status${RESET}\n`);

  const candidatesFile = resolve(EXPANSION_DIR, 'candidates.json');
  const edgarFile = resolve(EXPANSION_DIR, 'edgar-progress.json');
  const returnsFile = resolve(EXPANSION_DIR, 'forward-returns.json');
  const classifiedFile = resolve(EXPANSION_DIR, 'classified.json');
  const tier5File = resolve(CAL_DIR, 'tier5-sp500-expansion.json');

  const exists = (f) => existsSync(f);
  const count = (f) => { try { return Object.keys(JSON.parse(readFileSync(f, 'utf-8'))).length; } catch { return 0; } };
  const countArr = (f) => { try { return JSON.parse(readFileSync(f, 'utf-8')).length; } catch { return 0; } };

  console.log(`  Phase 1 (Parse):     ${exists(candidatesFile) ? GREEN + countArr(candidatesFile) + ' candidates' + RESET : RED + 'NOT DONE' + RESET}`);
  console.log(`  Phase 2 (EDGAR):     ${exists(edgarFile) ? GREEN + count(edgarFile) + ' processed' + RESET : RED + 'NOT DONE' + RESET}`);
  console.log(`  Phase 3 (Returns):   ${exists(returnsFile) ? GREEN + count(returnsFile) + ' computed' + RESET : RED + 'NOT DONE' + RESET}`);
  console.log(`  Phase 4 (Classify):  ${exists(classifiedFile) ? GREEN + countArr(classifiedFile) + ' classified' + RESET : RED + 'NOT DONE' + RESET}`);
  console.log(`  Phase 5 (Merge):     ${exists(tier5File) ? GREEN + 'DONE' + RESET : RED + 'NOT DONE' + RESET}`);
}

// ============================================
// Save session status for resume
// ============================================
function saveSessionStatus(phase, detail) {
  const status = `# Dataset Expansion Session Status
Updated: ${new Date().toISOString()}

## Current Phase: ${phase}

${detail}

## Files
- candidates.json: ${existsSync(resolve(EXPANSION_DIR, 'candidates.json')) ? 'EXISTS' : 'MISSING'}
- edgar-progress.json: ${existsSync(resolve(EXPANSION_DIR, 'edgar-progress.json')) ? 'EXISTS' : 'MISSING'}
- forward-returns.json: ${existsSync(resolve(EXPANSION_DIR, 'forward-returns.json')) ? 'EXISTS' : 'MISSING'}
- classified.json: ${existsSync(resolve(EXPANSION_DIR, 'classified.json')) ? 'EXISTS' : 'MISSING'}

## Resume
\`\`\`bash
node scripts/dataset-expansion.js --resume
\`\`\`
`;
  writeFileSync(STATUS_FILE, status);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log(`${BOLD}Dataset Expansion Pipeline${RESET}`);
  console.log('='.repeat(50));

  if (STATUS_ONLY) { printStatus(); return; }

  const shouldRun = (n) => !PHASE || PHASE === n;

  // Phase 1: Parse candidates
  let candidates;
  if (shouldRun(1)) {
    candidates = phase1_parseSP500();
    saveSessionStatus(1, `Parsed ${candidates.length} candidates`);
  } else {
    candidates = loadJSON(resolve(EXPANSION_DIR, 'candidates.json'));
    if (!Array.isArray(candidates)) candidates = [];
  }

  if (candidates.length === 0) {
    console.log(`${RED}No candidates to process${RESET}`);
    return;
  }

  // Phase 2: EDGAR pull
  if (shouldRun(2)) {
    await phase2_edgarPull(candidates);
    saveSessionStatus(2, `EDGAR pull complete for ${candidates.length} candidates`);
  }

  // Phase 3: Forward returns
  if (shouldRun(3)) {
    await phase3_forwardReturns(candidates);
    saveSessionStatus(3, `Forward returns computed`);
  }

  // Phase 4: Classify
  if (shouldRun(4)) {
    const classified = phase4_classify(candidates);
    saveSessionStatus(4, `Classified ${classified.length} cases`);
  }

  // Phase 5: Build dataset
  if (shouldRun(5)) {
    const classified = loadJSON(resolve(EXPANSION_DIR, 'classified.json'));
    if (Array.isArray(classified) && classified.length > 0) {
      phase5_buildDataset(classified);
      phase5_updateLoader();
      saveSessionStatus(5, `Dataset built with ${classified.length} new cases`);
    }
  }

  printStatus();
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
