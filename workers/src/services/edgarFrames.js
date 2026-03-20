// SEC EDGAR Frames API Service — Small Cap Universe Builder
// Uses the Frames endpoint to pull a single financial metric across ALL filers
// in one call, enabling efficient universe screening without bulk downloads.
//
// Also provides sector P/B computation from population-level data.

import { EDGAR_HEADERS, delay } from './edgarXbrl.js';
import { fetchBulkQuotes } from './yahooFinance.js';
import { SMALL_CAP } from '../../../shared/constants.js';

const FRAMES_BASE = 'https://data.sec.gov/api/xbrl/frames';
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';

/**
 * Fetch a single metric across all filers from the EDGAR Frames API.
 * Period format: 'CY2024Q4I' (instantaneous), 'CY2024' (annual duration).
 *
 * @returns {object} { taxonomy, tag, ccp, uom, pts, data: [{accn, cik, entityName, loc, end, val}] }
 */
export async function fetchFrameData(taxonomy, tag, unit, period) {
  const url = `${FRAMES_BASE}/${taxonomy}/${tag}/${unit}/${period}.json`;
  await delay(200); // SEC rate limit
  const res = await fetch(url, { headers: EDGAR_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Frames API HTTP ${res.status} for ${tag}/${period}`);
  return res.json();
}

/**
 * Get the most recent available Frames period.
 * Tries current quarter, then previous quarters until one returns data.
 */
function getRecentPeriods() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const periods = [];

  // Companies file 10-Ks 60-90 days after quarter end, so skip
  // the current quarter and start from 2 quarters back for reliable data.
  // Also include annual periods (CY20XX) as fallback.
  for (let i = 2; i < 6; i++) {
    let qYear = year;
    let q = Math.ceil((month + 1) / 3) - i;
    if (q <= 0) { q += 4; qYear--; }
    periods.push(`CY${qYear}Q${q}I`);
  }
  // Annual fallback (most complete data)
  periods.push(`CY${year - 1}`);
  periods.push(`CY${year - 2}`);
  return periods;
}

/**
 * Build the small cap universe. This is a multi-step resumable process:
 *
 * Step 1 (frames): Fetch Assets via Frames API, filter by size, store candidates
 * Step 2 (enrich): Fetch SIC codes from individual submissions for candidates
 * Step 3 (marketcap): Fetch market caps from Yahoo, apply final filters
 * Step 4 (promote): Move qualifying candidates to stocks table
 *
 * Each step is designed to stay within Cloudflare's 1000 subrequest limit.
 * Progress is tracked in system_config.
 *
 * @returns {{ step, processed, total, status }}
 */
export async function buildSmallCapUniverse(db, env, forceStep) {
  const { ensureSmallCapTables } = await import('../db/queries.js');
  await ensureSmallCapTables(db);

  // Determine current step
  const progress = await db.prepare(
    "SELECT value FROM system_config WHERE key = 'universe_build_step'"
  ).first();
  const step = forceStep || progress?.value || 'frames';

  switch (step) {
    case 'frames':
      return await stepFrames(db);
    case 'enrich':
      return await stepEnrich(db);
    case 'marketcap':
      return await stepMarketCap(db);
    case 'promote':
      return await stepPromote(db);
    default:
      return { step, status: 'unknown_step' };
  }
}

/**
 * Step 1: Fetch Assets from Frames API, rough-filter by size, store candidates.
 */
async function stepFrames(db) {
  // Try recent periods until one returns data
  const periods = getRecentPeriods();
  let framesData = null;
  let usedPeriod = null;

  for (const period of periods) {
    framesData = await fetchFrameData('us-gaap', 'Assets', 'USD', period);
    // Need a substantial dataset (>1000 filers) to build a meaningful universe
    if (framesData?.data?.length > 1000) {
      usedPeriod = period;
      break;
    }
    console.log(`Frames ${period}: only ${framesData?.data?.length || 0} entries, trying next period`);
    await delay(200);
  }

  if (!framesData?.data) {
    return { step: 'frames', status: 'no_frames_data', periods_tried: periods };
  }

  // Filter by asset size range (rough proxy for market cap)
  const candidates = framesData.data.filter(d =>
    d.val >= SMALL_CAP.frames_assets_min &&
    d.val <= SMALL_CAP.frames_assets_max
  );

  // Cross-reference with cik_map to get tickers
  // Build a CIK lookup set from DB
  const cikRows = await db.prepare(
    "SELECT ticker, cik, company_name, exchange FROM cik_map"
  ).all();
  const cikToTicker = {};
  for (const row of (cikRows.results || [])) {
    cikToTicker[row.cik] = row;
  }

  // Get existing large/mid cap tickers to exclude
  const existingLargeMid = await db.prepare(
    "SELECT ticker FROM stocks WHERE cap_tier IN ('large', 'mid') AND ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
  ).all();
  const existingSet = new Set((existingLargeMid.results || []).map(r => r.ticker));

  // Clear staging table for fresh build
  await db.prepare("DELETE FROM universe_candidates").run();

  // Insert candidates that have tickers and aren't already in large/mid universe
  let inserted = 0;
  const stmts = [];
  for (const d of candidates) {
    const padCik = String(d.cik).padStart(10, '0');
    const match = cikToTicker[padCik];
    if (!match?.ticker) continue;
    if (existingSet.has(match.ticker)) continue;

    // Filter out non-US exchanges
    const exchange = (match.exchange || '').toUpperCase();
    if (exchange && !['NYSE', 'NASDAQ', 'AMEX', 'BATS', 'NYSE ARCA', 'NYSE MKT'].includes(exchange)) continue;

    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO universe_candidates (cik, ticker, company_name, exchange, total_assets, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      ).bind(padCik, match.ticker, d.entityName || match.company_name, exchange, d.val)
    );
    inserted++;
  }

  // Batch insert (D1 limit 100 per batch)
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  // Save progress
  await setProgress(db, 'enrich');
  await db.prepare(
    "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('universe_build_period', ?, datetime('now'))"
  ).bind(usedPeriod).run();

  return {
    step: 'frames',
    status: 'complete',
    period: usedPeriod,
    frames_total: framesData.data.length,
    size_filtered: candidates.length,
    candidates_stored: inserted,
    next_step: 'enrich',
  };
}

/**
 * Step 2: Fetch SIC codes from individual submissions for candidates.
 * Processes a batch per invocation to stay within subrequest limits.
 */
async function stepEnrich(db) {
  const BATCH_SIZE = 40; // Conservative: SEC allows 10 req/sec, ~40 in a Worker invocation

  const pending = await db.prepare(
    "SELECT cik, ticker FROM universe_candidates WHERE sic IS NULL LIMIT ?"
  ).bind(BATCH_SIZE).all();

  const candidates = pending.results || [];
  if (candidates.length === 0) {
    // All enriched, move to next step
    await setProgress(db, 'marketcap');
    return { step: 'enrich', status: 'complete', next_step: 'marketcap' };
  }

  let enriched = 0;
  let errors = 0;

  for (const c of candidates) {
    try {
      await delay(300); // SEC rate limit: 10 req/sec, use 300ms for safety margin
      const url = `${SUBMISSIONS_BASE}/CIK${c.cik}.json`;
      const res = await fetch(url, { headers: EDGAR_HEADERS });
      if (!res.ok) {
        if (res.status === 429) { console.warn('SEC rate limit hit, stopping batch'); break; }
        errors++; continue;
      }

      const data = await res.json();
      const sic = data.sic || null;
      const exchange = data.exchanges?.[0] || null;

      // Check filing recency
      const recentFilings = data.filings?.recent;
      let lastAnnualFiling = null;
      let filingCount10K = 0;
      if (recentFilings?.form) {
        for (let i = 0; i < recentFilings.form.length; i++) {
          const form = recentFilings.form[i];
          if (form === '10-K' || form === '10-K/A') {
            filingCount10K++;
            if (!lastAnnualFiling) {
              lastAnnualFiling = recentFilings.filingDate?.[i] || null;
            }
          }
        }
      }

      // Determine status based on exclusion criteria
      let status = 'eligible';

      // SIC exclusions (SPACs, shells)
      if (sic && SMALL_CAP.sic_exclusions.includes(sic)) {
        status = 'excluded_sic';
      }
      // ADR/foreign private issuers (20-F filers)
      if (data.entityType === 'foreign' || recentFilings?.form?.includes('20-F')) {
        status = 'excluded_adr';
      }
      // Filing recency
      if (lastAnnualFiling) {
        const monthsSinceFiling = (Date.now() - new Date(lastAnnualFiling).getTime()) / (30 * 86400000);
        if (monthsSinceFiling > SMALL_CAP.filing_recency_months) {
          status = 'excluded_stale_filing';
        }
      } else {
        status = 'excluded_no_10k';
      }
      // Minimum filing history
      if (filingCount10K < SMALL_CAP.min_history_years) {
        status = 'excluded_insufficient_history';
      }

      await db.prepare(
        "UPDATE universe_candidates SET sic = ?, exchange = COALESCE(?, exchange), status = ? WHERE cik = ?"
      ).bind(sic, exchange, status, c.cik).run();

      // Also update cik_map with SIC for future use
      await db.prepare(
        "UPDATE cik_map SET sic = ?, exchange = COALESCE(?, exchange) WHERE cik = ?"
      ).bind(sic, exchange, c.cik).run();

      enriched++;
    } catch (err) {
      console.error(`Enrich error for ${c.ticker} (${c.cik}):`, err.message);
      errors++;
    }
  }

  return {
    step: 'enrich',
    status: 'in_progress',
    batch_size: candidates.length,
    enriched,
    errors,
    next_step: candidates.length < BATCH_SIZE ? 'marketcap' : 'enrich',
  };
}

/**
 * Step 3: Fetch market caps from Yahoo for eligible candidates.
 * Filters to $300M-$2B market cap range.
 */
async function stepMarketCap(db) {
  const BATCH_SIZE = 150; // Yahoo rate-limited batches of 5

  const eligible = await db.prepare(
    "SELECT cik, ticker FROM universe_candidates WHERE status = 'eligible' AND market_cap IS NULL LIMIT ?"
  ).bind(BATCH_SIZE).all();

  const candidates = eligible.results || [];
  if (candidates.length === 0) {
    await setProgress(db, 'promote');
    return { step: 'marketcap', status: 'complete', next_step: 'promote' };
  }

  const tickers = candidates.map(c => c.ticker);
  const quotes = await fetchBulkQuotes(tickers, 5, 1500);

  let updated = 0;
  let inRange = 0;
  for (const q of quotes) {
    if (!q.price) continue;

    // We need market cap — Yahoo v8 doesn't directly return it,
    // but we can check if Finnhub or the stocks table has it.
    // For now, store the price and mark for further enrichment.
    // The actual market cap will come from Finnhub profile or computed from shares outstanding.
    await db.prepare(
      "UPDATE universe_candidates SET market_cap = -1, status = 'needs_mcap' WHERE ticker = ?"
    ).bind(q.ticker).run();
    updated++;
  }

  // For tickers where we couldn't get a quote, mark as excluded
  const quotedTickers = new Set(quotes.map(q => q.ticker));
  for (const c of candidates) {
    if (!quotedTickers.has(c.ticker)) {
      await db.prepare(
        "UPDATE universe_candidates SET status = 'excluded_no_quote' WHERE cik = ?"
      ).bind(c.cik).run();
    }
  }

  // Now try to get market cap from shares outstanding (EDGAR) × price
  // This is more reliable than third-party market cap data
  const needMcap = await db.prepare(
    "SELECT uc.cik, uc.ticker FROM universe_candidates uc WHERE uc.status = 'needs_mcap' LIMIT 500"
  ).all();

  for (const c of (needMcap.results || [])) {
    // Check if we already have shares outstanding from financials
    const fin = await db.prepare(
      "SELECT shares_outstanding FROM financials WHERE ticker = ? AND shares_outstanding > 0 ORDER BY fiscal_year DESC LIMIT 1"
    ).bind(c.ticker).first();

    const md = await db.prepare(
      "SELECT price FROM market_data WHERE ticker = ?"
    ).bind(c.ticker).first();

    if (fin?.shares_outstanding && md?.price) {
      const mcap = fin.shares_outstanding * md.price;
      const inCapRange = mcap >= SMALL_CAP.market_cap_min && mcap <= SMALL_CAP.market_cap_max;

      await db.prepare(
        "UPDATE universe_candidates SET market_cap = ?, status = ? WHERE cik = ?"
      ).bind(mcap, inCapRange ? 'eligible' : 'excluded_mcap', c.cik).run();

      if (inCapRange) inRange++;
    } else {
      // No shares data yet — mark eligible for now, will refine when EDGAR data loads
      await db.prepare(
        "UPDATE universe_candidates SET status = 'eligible' WHERE cik = ?"
      ).bind(c.cik).run();
    }
  }

  const remaining = await db.prepare(
    "SELECT COUNT(*) as cnt FROM universe_candidates WHERE status = 'eligible' AND market_cap IS NULL"
  ).first();

  if ((remaining?.cnt || 0) === 0) {
    await setProgress(db, 'promote');
  }

  return {
    step: 'marketcap',
    status: remaining?.cnt > 0 ? 'in_progress' : 'complete',
    quotes_fetched: quotes.length,
    in_range: inRange,
    remaining: remaining?.cnt || 0,
    next_step: remaining?.cnt > 0 ? 'marketcap' : 'promote',
  };
}

/**
 * Step 4: Promote eligible candidates to the stocks table with cap_tier = 'small'.
 */
async function stepPromote(db) {
  // Final filter: eligible + has market cap in range (or marked eligible without mcap for deferred check)
  const eligible = await db.prepare(
    `SELECT * FROM universe_candidates
     WHERE status = 'eligible'
       AND sic NOT IN (${SMALL_CAP.sic_exclusions.map(() => '?').join(',')})
     ORDER BY ticker`
  ).bind(...SMALL_CAP.sic_exclusions).all();

  const candidates = eligible.results || [];
  let promoted = 0;

  const stmts = [];
  for (const c of candidates) {
    // Check financial sector minimum assets
    const isFinancial = c.sic && c.sic.startsWith('6');
    if (isFinancial && c.total_assets < SMALL_CAP.financial_min_assets) {
      continue; // Skip community banks/micro-insurers
    }

    stmts.push(
      db.prepare(
        `INSERT OR IGNORE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated, cap_tier)
         VALUES (?, ?, NULL, NULL, ?, datetime('now'), 'small')`
      ).bind(c.ticker, c.company_name, c.market_cap > 0 ? c.market_cap : null)
    );
    promoted++;
  }

  // Also update existing stocks that might have drifted into small cap range
  // (don't overwrite their sector/industry)
  const drifted = await db.prepare(
    `SELECT s.ticker FROM stocks s
     JOIN market_data md ON s.ticker = md.ticker
     JOIN financials f ON s.ticker = f.ticker
     WHERE s.cap_tier != 'small'
       AND f.shares_outstanding > 0
       AND md.price > 0
       AND (f.shares_outstanding * md.price) >= ? AND (f.shares_outstanding * md.price) <= ?
       AND f.fiscal_year = (SELECT MAX(fiscal_year) FROM financials WHERE ticker = s.ticker)
     LIMIT 100`
  ).bind(SMALL_CAP.market_cap_min, SMALL_CAP.market_cap_max).all();

  for (const row of (drifted.results || [])) {
    stmts.push(
      db.prepare("UPDATE stocks SET cap_tier = 'small' WHERE ticker = ?").bind(row.ticker)
    );
  }

  // Batch execute
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  // Mark build complete
  await setProgress(db, 'complete');
  await db.prepare(
    "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('universe_build_date', datetime('now'), datetime('now'))"
  ).run();

  // Get final counts
  const counts = await getUniverseCounts(db);

  return {
    step: 'promote',
    status: 'complete',
    promoted,
    drifted: (drifted.results || []).length,
    counts,
  };
}

/**
 * Get universe counts by cap tier.
 */
export async function getUniverseCounts(db) {
  let result;
  try {
    result = await db.prepare(
      `SELECT cap_tier, COUNT(*) as count FROM stocks
       WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       GROUP BY cap_tier`
    ).all();
  } catch {
    // cap_tier column may not exist yet
    const total = await db.prepare(
      "SELECT COUNT(*) as count FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
    ).first();
    result = { results: [{ cap_tier: 'unknown', count: total?.count || 0 }] };
  }

  const counts = {};
  for (const row of (result.results || [])) {
    counts[row.cap_tier || 'unknown'] = row.count;
  }

  // Build progress info
  const buildStep = await db.prepare(
    "SELECT value FROM system_config WHERE key = 'universe_build_step'"
  ).first();
  const buildDate = await db.prepare(
    "SELECT value FROM system_config WHERE key = 'universe_build_date'"
  ).first();

  // Staging table stats
  const staging = await db.prepare(
    `SELECT status, COUNT(*) as count FROM universe_candidates GROUP BY status`
  ).all();
  const stagingCounts = {};
  for (const row of (staging.results || [])) {
    stagingCounts[row.status] = row.count;
  }

  return {
    by_tier: counts,
    total: Object.values(counts).reduce((s, v) => s + v, 0),
    build_step: buildStep?.value || null,
    build_date: buildDate?.value || null,
    staging: stagingCounts,
  };
}

async function setProgress(db, step) {
  await db.prepare(
    "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('universe_build_step', ?, datetime('now'))"
  ).bind(step).run();
}

// --- SIC to Sector Mapping ---
// Maps 2-digit SIC division codes to framework sector names
const SIC_TO_SECTOR = {
  '01': 'Agriculture', '02': 'Agriculture', '07': 'Agriculture', '08': 'Agriculture', '09': 'Agriculture',
  '10': 'Mining', '12': 'Mining', '13': 'Energy', '14': 'Mining',
  '15': 'Construction', '16': 'Construction', '17': 'Construction',
  '20': 'Consumer Staples', '21': 'Consumer Staples', '22': 'Consumer Discretionary', '23': 'Consumer Discretionary',
  '24': 'Materials', '25': 'Consumer Discretionary', '26': 'Materials', '27': 'Communication Services',
  '28': 'Healthcare', '29': 'Energy', '30': 'Materials', '31': 'Consumer Discretionary',
  '32': 'Materials', '33': 'Materials', '34': 'Industrials', '35': 'Industrials',
  '36': 'Technology', '37': 'Industrials', '38': 'Technology', '39': 'Consumer Discretionary',
  '40': 'Industrials', '41': 'Industrials', '42': 'Industrials', '44': 'Industrials', '45': 'Industrials',
  '46': 'Industrials', '47': 'Industrials', '48': 'Communication Services', '49': 'Utilities',
  '50': 'Consumer Discretionary', '51': 'Consumer Staples', '52': 'Consumer Discretionary',
  '53': 'Consumer Discretionary', '54': 'Consumer Staples', '55': 'Consumer Discretionary',
  '56': 'Consumer Discretionary', '57': 'Consumer Discretionary', '58': 'Consumer Discretionary',
  '59': 'Consumer Discretionary',
  '60': 'Financial Services', '61': 'Financial Services', '62': 'Financial Services',
  '63': 'Financial Services', '64': 'Financial Services', '65': 'Real Estate', '67': 'Financial Services',
  '70': 'Consumer Discretionary', '72': 'Consumer Discretionary', '73': 'Technology',
  '75': 'Consumer Discretionary', '76': 'Industrials', '78': 'Communication Services',
  '79': 'Consumer Discretionary', '80': 'Healthcare', '81': 'Industrials', '82': 'Consumer Discretionary',
  '83': 'Consumer Discretionary', '84': 'Consumer Discretionary', '86': 'Consumer Discretionary',
  '87': 'Industrials', '89': 'Industrials',
  '91': 'Government', '92': 'Government', '93': 'Government', '94': 'Government',
  '95': 'Government', '96': 'Government', '97': 'Government', '99': 'Other',
};

function sicToSector(sic) {
  if (!sic) return 'Unknown';
  const prefix = sic.substring(0, 2);
  return SIC_TO_SECTOR[prefix] || 'Other';
}

/**
 * Compute actual 33rd percentile P/B by sector using EDGAR Frames API.
 * This replaces estimated sector thresholds with empirically computed ones
 * from the full population of filers.
 *
 * Uses: StockholdersEquity + CommonStockSharesOutstanding frames to compute BVPS,
 * then cross-references with stored prices to compute P/B per company.
 *
 * @returns {{ sectors: {[sector]: {p33: number, p50: number, count: number}}, period: string }}
 */
export async function computeSectorPBFromFrames(db) {
  // Find a period with sufficient data
  const periods = getRecentPeriods();
  let equityFrame = null;
  let sharesFrame = null;
  let usedPeriod = null;

  for (const period of periods) {
    equityFrame = await fetchFrameData('us-gaap', 'StockholdersEquity', 'USD', period);
    if (equityFrame?.data?.length > 1000) {
      sharesFrame = await fetchFrameData('us-gaap', 'CommonStockSharesOutstanding', 'shares', period);
      if (sharesFrame?.data?.length > 500) {
        usedPeriod = period;
        break;
      }
    }
    await delay(200);
  }

  if (!equityFrame?.data || !sharesFrame?.data) {
    return { status: 'no_frames_data', periods_tried: periods };
  }

  // Build CIK → equity and CIK → shares maps
  const equityByCik = {};
  for (const d of equityFrame.data) {
    const cik = String(d.cik).padStart(10, '0');
    equityByCik[cik] = d.val;
  }

  const sharesByCik = {};
  for (const d of sharesFrame.data) {
    const cik = String(d.cik).padStart(10, '0');
    sharesByCik[cik] = d.val;
  }

  // Get ticker → CIK mapping and sector data
  // Use two sources for sector: cik_map.sic (mapped to sector) and stocks.sector (from Finnhub)
  const cikRows = await db.prepare(
    "SELECT cm.ticker, cm.cik, cm.sic, s.sector FROM cik_map cm LEFT JOIN stocks s ON cm.ticker = s.ticker"
  ).all();

  // Get current prices from market_data
  const priceRows = await db.prepare(
    "SELECT ticker, price FROM market_data WHERE price > 0"
  ).all();
  const priceByTicker = {};
  for (const row of (priceRows.results || [])) {
    priceByTicker[row.ticker] = row.price;
  }

  // Compute P/B for each company and group by sector
  const sectorPBs = {};
  for (const row of (cikRows.results || [])) {
    const equity = equityByCik[row.cik];
    const shares = sharesByCik[row.cik];
    const price = priceByTicker[row.ticker];

    if (!equity || equity <= 0 || !shares || shares <= 0 || !price) continue;

    const bvps = equity / shares;
    const pb = price / bvps;

    // Filter out extreme values (likely data errors)
    if (pb <= 0 || pb > 50) continue;

    // Prefer Finnhub sector (more accurate), fall back to SIC-derived
    const sector = row.sector || (row.sic ? sicToSector(row.sic) : null);
    if (!sector || sector === 'Unknown' || sector === 'Other') continue;

    if (!sectorPBs[sector]) sectorPBs[sector] = [];
    sectorPBs[sector].push(pb);
  }

  // Compute percentiles and store in sector_pb_distribution
  const computedDate = new Date().toISOString().split('T')[0];
  const results = {};
  const stmts = [];

  for (const [sector, pbValues] of Object.entries(sectorPBs)) {
    if (pbValues.length < 5) continue; // need minimum sample

    pbValues.sort((a, b) => a - b);
    const p33Idx = Math.floor(pbValues.length * 0.33);
    const p50Idx = Math.floor(pbValues.length * 0.50);
    const p33 = Math.round(pbValues[p33Idx] * 100) / 100;
    const p50 = Math.round(pbValues[p50Idx] * 100) / 100;

    results[sector] = { p33, p50, count: pbValues.length };

    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO sector_pb_distribution (sector, computed_date, p33_pb, p50_pb, sample_size)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(sector, computedDate, p33, p50, pbValues.length)
    );
  }

  // Batch insert
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  return {
    status: 'complete',
    period: usedPeriod,
    equity_filers: equityFrame.data.length,
    shares_filers: sharesFrame.data.length,
    sectors_computed: Object.keys(results).length,
    sectors: results,
  };
}
