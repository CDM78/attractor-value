import { fetchQuote, fetchBulkQuotes, getFullUniverse } from '../services/yahooFinance.js';
import { fetchAllFundamentals } from '../services/alphaVantage.js';
import { getOrFetchBondYield, getOrFetchEconomicSnapshot } from '../services/fred.js';
import { upsertStock, upsertMarketData, upsertFinancials, getFinancialsForTicker, saveScreenResult } from '../db/queries.js';
import { runLayer1Screen, computeSectorPBThresholds } from '../services/screeningEngine.js';
import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { upsertValuation } from '../db/queries.js';
import { getInsiderTransactions, getInsiderSentiment, computeInsiderSignalFromSentiment, getBasicMetrics, getFinancialsReported, parseFinancialsReported, getCompanyProfile, getCompanyOfficers } from '../services/finnhub.js';
import { computeInsiderSignal } from '../services/insiderSignals.js';
import { getDynamicPECeiling } from '../services/screeningEngine.js';
import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

const FINNHUB_TICKERS_PER_RUN = 5;

// Chunked refresh: processes a slice of tickers per invocation
// offset/limit allow processing the full universe across multiple calls
export async function dailyRefresh(env, tickerLimit) {
  const startTime = Date.now();
  console.log('Daily refresh started:', new Date().toISOString());

  const stats = { pricesUpdated: 0, fundamentalsFetched: 0, errors: 0, screened: 0 };

  // Step 1: Fetch AAA bond yield from FRED
  let bondYield;
  try {
    bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
    console.log(`Bond yield: ${bondYield.yield}% (${bondYield.date})`);
  } catch (err) {
    console.error('Failed to fetch bond yield:', err.message);
    bondYield = { yield: 5.0, date: 'fallback' };
  }

  // Step 2: Fetch prices
  // Priority: always refresh watchlist + passing stocks first, then rotate through the rest
  let tickers = getFullUniverse();

  // Merge small cap tickers from DB into the universe
  try {
    const smallCaps = await env.DB.prepare(
      "SELECT ticker FROM stocks WHERE cap_tier = 'small' AND ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
    ).all();
    const smallCapTickers = (smallCaps.results || []).map(r => r.ticker);
    if (smallCapTickers.length > 0) {
      const existing = new Set(tickers);
      for (const t of smallCapTickers) {
        if (!existing.has(t)) tickers.push(t);
      }
      console.log(`Universe: ${tickers.length} total (${smallCapTickers.length} small caps merged)`);
    }
  } catch { /* smallcap tables may not exist yet */ }

  if (tickerLimit) tickers = tickers.slice(0, tickerLimit);

  // Get priority tickers (watchlist + passing stocks) — these update every run
  const priorityRows = await env.DB.prepare(
    `SELECT ticker FROM watchlist
     UNION
     SELECT DISTINCT ticker FROM screen_results WHERE passes_all_hard = 1`
  ).all();
  const priorityTickers = new Set((priorityRows.results || []).map(r => r.ticker));

  // Separate priority from the rest
  const priorityList = tickers.filter(t => priorityTickers.has(t));
  const remainingTickers = tickers.filter(t => !priorityTickers.has(t));

  // Rotate through remaining tickers in chunks — sized to stay under Cloudflare's 1000 subrequest limit
  // Each ticker needs ~3 subrequests (fetch + 2 DB reads), plus Finnhub calls below
  const CHUNK = tickerLimit || 100;
  const offset = await getRefreshOffset(env.DB, remainingTickers.length);
  const chunk = remainingTickers.slice(offset, offset + CHUNK);

  const allToFetch = [...priorityList, ...chunk];
  console.log(`Fetching prices: ${priorityList.length} priority + ${chunk.length} rotating (offset ${offset}) = ${allToFetch.length} total`);

  const quotes = await fetchBulkQuotes(allToFetch, 5, 1000);

  for (const quote of quotes) {
    try {
      // Preserve existing sector/industry if we have it
      const existing = await env.DB.prepare('SELECT sector, industry, market_cap FROM stocks WHERE ticker = ?').bind(quote.ticker).first();

      await upsertStock(env.DB, {
        ticker: quote.ticker,
        company_name: quote.longName,
        sector: existing?.sector || null,
        industry: existing?.industry || null,
        market_cap: existing?.market_cap || null,
      });

      // Preserve existing fundamentals data in market_data
      const existingMd = await env.DB.prepare('SELECT pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct FROM market_data WHERE ticker = ?').bind(quote.ticker).first();

      await upsertMarketData(env.DB, {
        ticker: quote.ticker,
        price: quote.price,
        pe_ratio: existingMd?.pe_ratio ?? null,
        pb_ratio: existingMd?.pb_ratio ?? null,
        earnings_yield: existingMd?.earnings_yield ?? null,
        dividend_yield: existingMd?.dividend_yield ?? null,
        insider_ownership_pct: existingMd?.insider_ownership_pct ?? null,
      });

      // Store volume data for liquidity filter (small cap screening)
      if (quote.avgVolume != null) {
        try {
          await env.DB.prepare(
            "UPDATE market_data SET avg_volume = ?, avg_dollar_volume = ? WHERE ticker = ?"
          ).bind(quote.avgVolume, quote.avgDollarVolume, quote.ticker).run();
        } catch { /* avg_volume column may not exist yet */ }

        // Update rolling volume averages on stocks table for CSI computation
        try {
          const existing = await env.DB.prepare(
            "SELECT avg_volume_30d, avg_volume_180d FROM stocks WHERE ticker = ?"
          ).bind(quote.ticker).first();

          const newVol30 = quote.avgVolume;
          // Exponential moving average for 180-day: blend old (weight ~0.97) with new (~0.03)
          // This approximates a 180-day average updated daily
          const alpha180 = 1 / 30; // ~30 trading days per update cycle
          const oldVol180 = existing?.avg_volume_180d || newVol30;
          const newVol180 = Math.round(oldVol180 * (1 - alpha180) + newVol30 * alpha180);

          await env.DB.prepare(
            "UPDATE stocks SET avg_volume_30d = ?, avg_volume_180d = ? WHERE ticker = ?"
          ).bind(newVol30, newVol180, quote.ticker).run();
        } catch { /* columns may not exist yet */ }
      }

      stats.pricesUpdated++;
    } catch (err) {
      console.error(`Error storing ${quote.ticker}:`, err.message);
      stats.errors++;
    }
  }

  // Save progress offset (only tracks the rotating non-priority tickers)
  await saveRefreshOffset(env.DB, offset + chunk.length >= remainingTickers.length ? 0 : offset + chunk.length);

  // NOTE: Metrics + fundamentals fetching moved to separate cron (finnhubRefresh)
  // to stay within Cloudflare's 1000 subrequest limit per invocation.
  // The backfill endpoint (/api/backfill) can also be used for manual bulk fills.

  // Step 4: Compute sector P/B thresholds for sector-relative screening (Update 4)
  // Prefer Frames API-computed thresholds (Session C) if available and fresh (<30 days)
  let sectorPBThresholds = {};
  try {
    const framesThresholds = await env.DB.prepare(
      `SELECT sector, p33_pb FROM sector_pb_distribution
       WHERE computed_date >= date('now', '-30 days')`
    ).all();
    if (framesThresholds.results?.length > 0) {
      for (const row of framesThresholds.results) {
        sectorPBThresholds[row.sector] = row.p33_pb;
      }
      console.log('Using Frames-based sector P/B thresholds:', Object.keys(sectorPBThresholds).length, 'sectors');
    }
  } catch { /* sector_pb_distribution may not exist yet */ }

  // Fallback: compute from universe stocks if no Frames data
  if (Object.keys(sectorPBThresholds).length === 0) {
    const allStocksForPB = await env.DB.prepare(
      `SELECT s.ticker, s.sector, md.pb_ratio
       FROM stocks s
       JOIN market_data md ON s.ticker = md.ticker
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND md.pb_ratio IS NOT NULL AND md.pb_ratio > 0`
    ).all();
    sectorPBThresholds = computeSectorPBThresholds(allStocksForPB.results || []);
    console.log('Using universe-computed sector P/B thresholds:', JSON.stringify(sectorPBThresholds));
  }

  // Step 5: Run Layer 1 screening on stocks that have fundamentals
  // Priority: watchlist + previously passing stocks first, then rotate through the rest
  const screenDate = new Date().toISOString().split('T')[0];
  const stocksWithData = await env.DB.prepare(
    `SELECT s.* FROM stocks s
     INNER JOIN market_data md ON s.ticker = md.ticker
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND EXISTS (SELECT 1 FROM financials f WHERE f.ticker = s.ticker)
     ORDER BY
       CASE WHEN s.ticker IN (SELECT ticker FROM watchlist) THEN 0
            WHEN s.ticker IN (SELECT DISTINCT ticker FROM screen_results WHERE passes_all_hard = 1) THEN 1
            WHEN s.ticker NOT IN (SELECT ticker FROM screen_results WHERE screen_date = ?) THEN 2
            ELSE 3 END,
       s.ticker
     LIMIT 30`
  ).bind(screenDate).all();

  for (const stock of (stocksWithData.results || [])) {
    try {
      const financials = await getFinancialsForTicker(env.DB, stock.ticker);
      const marketData = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(stock.ticker).first();
      if (!marketData || financials.length === 0) continue;

      const isSmallCap = stock.cap_tier === 'small' ||
        (stock.market_cap && stock.market_cap >= 300000000 && stock.market_cap <= 2000000000);
      const screenResults = runLayer1Screen(stock, financials, marketData, {
        aaa_bond_yield: bondYield?.yield,
        sector_pb_thresholds: sectorPBThresholds,
        is_small_cap: isSmallCap,
      });
      await saveScreenResult(env.DB, stock.ticker, screenDate, screenResults);
      stats.screened++;
    } catch (err) {
      console.error(`Screening error for ${stock.ticker}:`, err.message);
    }
  }

  // Step 4b: Fetch economic snapshot for stress-adjusted valuations
  let economicEnvironment = null;
  try {
    if (env.FRED_API_KEY) {
      const snapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
      economicEnvironment = snapshot?.environment || null;
    }
  } catch (err) {
    console.error('Economic snapshot failed:', err.message);
  }

  // Step 5: Compute valuations for stocks that passed or near-missed screening
  const qualifyingStocks = await env.DB.prepare(
    `SELECT DISTINCT sr.ticker, sr.tier, sr.miss_severity FROM screen_results sr
     WHERE (sr.tier = 'full_pass' OR sr.tier = 'near_miss') AND sr.screen_date = ?`
  ).bind(screenDate).all();

  stats.valuations = 0;
  for (const row of (qualifyingStocks.results || [])) {
    try {
      const fins = await getFinancialsForTicker(env.DB, row.ticker);
      const md = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(row.ticker).first();
      const attractorData = await env.DB.prepare(
        'SELECT attractor_stability_score, network_regime FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
      ).bind(row.ticker).first();
      // Check if this is a small cap for MoS adjustment
      const stockInfo = await env.DB.prepare('SELECT cap_tier, market_cap FROM stocks WHERE ticker = ?').bind(row.ticker).first();
      const isSmall = stockInfo?.cap_tier === 'small' ||
        (stockInfo?.market_cap && stockInfo.market_cap >= 300000000 && stockInfo.market_cap <= 2000000000);
      const screenInfo = { tier: row.tier, miss_severity: row.miss_severity, is_small_cap: isSmall };
      const val = calculateGrahamValuation(fins, md, bondYield?.yield, attractorData, screenInfo, economicEnvironment);
      if (val) {
        await upsertValuation(env.DB, val);
        stats.valuations++;
      }
    } catch (err) {
      console.error(`Valuation error for ${row.ticker}:`, err.message);
    }
  }

  // Step 6: Fetch insider transactions for watchlist + portfolio stocks (via Finnhub)
  stats.insiderUpdated = 0;
  if (env.FINNHUB_API_KEY) {
    // Watchlist + portfolio tickers, limit 5 per run for subrequest budget
    const insiderTickers = await env.DB.prepare(
      `SELECT ticker FROM watchlist
       UNION
       SELECT DISTINCT ticker FROM holdings
       LIMIT 5`
    ).all();

    const today = new Date().toISOString().split('T')[0];
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const row of (insiderTickers.results || [])) {
      try {
        // Fetch transactions
        const txns = await getInsiderTransactions(row.ticker, sixMonthsAgo, today, env.FINNHUB_API_KEY);
        for (const tx of txns) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO insider_transactions
             (ticker, filing_date, insider_name, insider_title, transaction_type, shares, price_per_share, total_value, is_10b5_1, source_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            tx.ticker, tx.filing_date, tx.insider_name, tx.insider_title,
            tx.transaction_type, tx.shares, tx.price_per_share, tx.total_value,
            tx.is_10b5_1, tx.source_url
          ).run();
        }

        // Get officers for C-suite cross-referencing
        const officers = await getCompanyOfficers(row.ticker, env.FINNHUB_API_KEY);

        // Compute signal from all stored transactions using enhanced logic
        const allRecent = await env.DB.prepare(
          `SELECT * FROM insider_transactions
           WHERE ticker = ? AND filing_date >= date('now', '-180 days')`
        ).bind(row.ticker).all();

        const signal = computeInsiderSignal(allRecent.results || [], officers);

        await env.DB.prepare(
          `INSERT OR REPLACE INTO insider_signals
           (ticker, signal_date, trailing_90d_buys, trailing_90d_buy_value, trailing_90d_sells, trailing_90d_sell_value, unique_buyers_90d, signal, signal_details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          row.ticker, today,
          signal.trailing_90d_buys, signal.trailing_90d_buy_value,
          signal.trailing_90d_sells, signal.trailing_90d_sell_value,
          signal.unique_buyers_90d,
          signal.signal, signal.signal_details
        ).run();

        stats.insiderUpdated++;
        console.log(`Insider data updated for ${row.ticker}: ${signal.signal}`);
      } catch (err) {
        console.error(`Insider fetch error for ${row.ticker}:`, err.message);
        stats.errors++;
        if (err.message.includes('rate limit')) break;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Daily refresh completed in ${elapsed}s:`, JSON.stringify(stats));
  return stats;
}

// Separate cron for Finnhub data (metrics + fundamentals)
// Runs in its own invocation to avoid subrequest limits
export async function finnhubRefresh(env) {
  const startTime = Date.now();
  console.log('Finnhub refresh started:', new Date().toISOString());
  const stats = { sectorsFilled: 0, metricsFilled: 0, fundamentalsFetched: 0, errors: 0 };

  if (!env.FINNHUB_API_KEY) return stats;

  // Step 0: Fill sector data for stocks missing it (critical for sector-relative P/B)
  const missingSectors = await env.DB.prepare(
    `SELECT ticker, company_name, market_cap FROM stocks
     WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND sector IS NULL
     LIMIT 20`
  ).all();

  for (const row of (missingSectors.results || [])) {
    try {
      const profile = await getCompanyProfile(row.ticker, env.FINNHUB_API_KEY);
      if (!profile || !profile.sector) continue;

      await upsertStock(env.DB, {
        ticker: row.ticker,
        company_name: profile.company_name || row.company_name,
        sector: profile.sector,
        industry: profile.industry,
        market_cap: profile.market_cap || row.market_cap,
      });
      stats.sectorsFilled++;
    } catch (err) {
      if (err.message.includes('rate limit')) break;
      stats.errors++;
    }
  }

  // Step 1: Fill P/E and P/B ratios for stocks missing them
  const missingRatios = await env.DB.prepare(
    `SELECT s.ticker FROM stocks s
     LEFT JOIN market_data md ON s.ticker = md.ticker
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND (md.pe_ratio IS NULL OR md.pb_ratio IS NULL)
     LIMIT 30`
  ).all();

  for (const row of (missingRatios.results || [])) {
    try {
      const metrics = await getBasicMetrics(row.ticker, env.FINNHUB_API_KEY);
      // Validate suspicious values
      if (metrics.dividend_yield > 5.0) {
        const stockInfo = await env.DB.prepare('SELECT sector, industry FROM stocks WHERE ticker = ?').bind(row.ticker).first();
        const sectorLower = (stockInfo?.sector || '').toLowerCase();
        if (!sectorLower.includes('reit') && !sectorLower.includes('utilit') && !sectorLower.includes('real estate')) {
          console.warn(`SUSPICIOUS: ${row.ticker} dividend yield ${metrics.dividend_yield?.toFixed(2)}% in sector ${stockInfo?.sector}. Possible preferred/common confusion.`);
        }
      }
      if (metrics.roic > 100) {
        console.warn(`SUSPICIOUS: ${row.ticker} ROIC ${metrics.roic?.toFixed(0)}% — likely meaningless`);
      }
      if (metrics.pe_ratio || metrics.pb_ratio) {
        const existing = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(row.ticker).first();
        await upsertMarketData(env.DB, {
          ticker: row.ticker,
          price: existing?.price ?? null,
          pe_ratio: metrics.pe_ratio ?? existing?.pe_ratio ?? null,
          pb_ratio: metrics.pb_ratio ?? existing?.pb_ratio ?? null,
          earnings_yield: metrics.earnings_yield ?? existing?.earnings_yield ?? null,
          dividend_yield: metrics.dividend_yield ?? existing?.dividend_yield ?? null,
          insider_ownership_pct: metrics.insider_ownership_pct ?? existing?.insider_ownership_pct ?? null,
        });
        stats.metricsFilled++;
      }
    } catch (err) {
      if (err.message.includes('rate limit')) break;
      console.error(`Finnhub metrics error for ${row.ticker}:`, err.message);
      stats.errors++;
    }
  }

  // Step 2: Fetch fundamentals for stocks missing them
  let bondYield;
  try {
    bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
  } catch (err) {
    bondYield = { yield: 5.0, date: 'fallback' };
  }
  const peCeiling = getDynamicPECeiling(bondYield?.yield);

  // Priority: promising stocks first, then any missing
  const priorityQueue = await env.DB.prepare(
    `SELECT md.ticker FROM market_data md
     WHERE md.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ?
       AND md.pb_ratio IS NOT NULL AND md.pb_ratio <= ?
       AND md.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
     ORDER BY (md.pe_ratio * md.pb_ratio) ASC
     LIMIT ?`
  ).bind(peCeiling, SCREEN_DEFAULTS.pb_max, FINNHUB_TICKERS_PER_RUN).all();

  let batch = (priorityQueue.results || []).map(r => r.ticker);

  if (batch.length < FINNHUB_TICKERS_PER_RUN) {
    const remaining = FINNHUB_TICKERS_PER_RUN - batch.length;
    const fallback = await env.DB.prepare(
      `SELECT s.ticker FROM stocks s
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND s.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
         AND s.ticker NOT IN (${batch.map(() => '?').join(',') || "''"})
       LIMIT ?`
    ).bind(...batch, remaining).all();
    batch = batch.concat((fallback.results || []).map(r => r.ticker));
  }

  for (const ticker of batch) {
    try {
      const reports = await getFinancialsReported(ticker, env.FINNHUB_API_KEY);
      const financials = parseFinancialsReported(ticker, reports);
      if (financials.length === 0) continue;

      for (const fin of financials) {
        await upsertFinancials(env.DB, fin);
      }
      stats.fundamentalsFetched++;
      console.log(`Finnhub fundamentals stored for ${ticker}: ${financials.length} years`);
    } catch (err) {
      stats.errors++;
      if (err.message.includes('rate limit') || err.message.includes('subrequest')) break;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Finnhub refresh completed in ${elapsed}s:`, JSON.stringify(stats));
  return stats;
}

// EDGAR-based fundamentals refresh — primary data source
// Fetches XBRL data directly from SEC EDGAR, parses into financials table,
// then computes P/E and P/B from EDGAR fundamentals + live Yahoo price.
// Uses aggregator for EDGAR → Finnhub fallback chain.
export async function edgarRefresh(env) {
  const startTime = Date.now();
  console.log('EDGAR refresh started:', new Date().toISOString());
  const stats = { cikMapRefreshed: false, fundamentalsFetched: 0, ratiosComputed: 0, fallbacks: 0, errors: 0 };

  const { ensureEdgarTables } = await import('../db/queries.js');
  const { refreshCikMap } = await import('../services/edgarXbrl.js');
  const { fetchAndStoreFundamentals, computeAndStoreRatios } = await import('../services/aggregator.js');

  // Ensure tables exist
  await ensureEdgarTables(env.DB);

  // Step 0: Refresh CIK map if stale (>7 days)
  const cikAge = await env.DB.prepare(
    "SELECT updated_at FROM cik_map LIMIT 1"
  ).first();
  const cikStale = !cikAge || (Date.now() - new Date(cikAge.updated_at).getTime() > 7 * 86400000);
  if (cikStale) {
    try {
      await refreshCikMap(env.DB);
      stats.cikMapRefreshed = true;
    } catch (err) {
      console.error('CIK map refresh failed:', err.message);
      stats.errors++;
    }
  }

  // Step 1: Get tickers needing fundamentals
  // Priority: watchlist > passing screen > promising (low PE*PB) > any
  const tickersToFetch = await env.DB.prepare(
    `SELECT s.ticker FROM stocks s
     LEFT JOIN data_confidence dc ON s.ticker = dc.ticker AND dc.data_source IN ('edgar', 'finnhub_fallback')
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND (dc.fetch_date IS NULL OR dc.fetch_date < datetime('now', '-90 days'))
     ORDER BY
       CASE
         WHEN s.ticker IN (SELECT ticker FROM watchlist) THEN 0
         WHEN s.ticker IN (SELECT ticker FROM screen_results WHERE tier IN ('full_pass','near_miss')) THEN 1
         ELSE 2
       END,
       s.ticker
     LIMIT 20`
  ).all();

  const tickers = (tickersToFetch.results || []).map(r => r.ticker);

  // Step 2: Fetch fundamentals via aggregator (EDGAR → Finnhub fallback)
  for (const ticker of tickers) {
    try {
      const result = await fetchAndStoreFundamentals(env.DB, ticker, env.FINNHUB_API_KEY);
      if (result.source) {
        stats.fundamentalsFetched++;
        if (result.source === 'finnhub') stats.fallbacks++;
        console.log(`${result.source.toUpperCase()}: ${ticker} — ${result.yearsStored} years stored`);
      } else {
        console.log(`No data available for ${ticker} from any source`);
      }
    } catch (err) {
      console.error(`Fundamentals error for ${ticker}:`, err.message);
      stats.errors++;
    }
  }

  // Step 3: Compute derived ratios (P/E, P/B) from stored fundamentals + live price
  const needRatios = await env.DB.prepare(
    `SELECT DISTINCT f.ticker
     FROM financials f
     JOIN market_data md ON f.ticker = md.ticker
     WHERE md.price IS NOT NULL AND md.price > 0
       AND (md.ratio_source IS NULL
            OR md.ratio_source NOT IN ('edgar_computed', 'finnhub_computed')
            OR md.fetched_at < datetime('now', '-24 hours'))
     LIMIT 50`
  ).all();

  for (const row of (needRatios.results || [])) {
    try {
      const ratios = await computeAndStoreRatios(env.DB, row.ticker);
      if (ratios) stats.ratiosComputed++;
    } catch (err) {
      console.error(`Ratio computation error for ${row.ticker}:`, err.message);
      stats.errors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`EDGAR refresh completed in ${elapsed}s:`, JSON.stringify(stats));
  return stats;
}

// Track refresh progress across invocations using a simple key-value in market_data
async function getRefreshOffset(db, totalTickers) {
  const row = await db.prepare(
    "SELECT price FROM market_data WHERE ticker = '__REFRESH_OFFSET'"
  ).first();
  const offset = row ? Math.floor(row.price) : 0;
  return offset >= totalTickers ? 0 : offset;
}

async function saveRefreshOffset(db, offset) {
  await db.prepare(
    `INSERT OR REPLACE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
     VALUES ('__REFRESH_OFFSET', 'Refresh Progress', 'system', null, 0, ?)`
  ).bind(new Date().toISOString()).run();

  await db.prepare(
    `INSERT OR REPLACE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
     VALUES ('__REFRESH_OFFSET', ?, NULL, NULL, NULL, NULL, NULL, ?)`
  ).bind(offset, new Date().toISOString()).run();
}
