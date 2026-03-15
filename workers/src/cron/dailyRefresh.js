import { fetchQuote, fetchBulkQuotes, getSP500Tickers } from '../services/yahooFinance.js';
import { fetchAllFundamentals } from '../services/alphaVantage.js';
import { getOrFetchBondYield } from '../services/fred.js';
import { upsertStock, upsertMarketData, upsertFinancials, getFinancialsForTicker, saveScreenResult } from '../db/queries.js';
import { runLayer1Screen } from '../services/screeningEngine.js';
import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { upsertValuation } from '../db/queries.js';
import { getInsiderTransactions, getInsiderSentiment, computeInsiderSignalFromSentiment, getBasicMetrics, getFinancialsReported, parseFinancialsReported } from '../services/finnhub.js';
import { getDynamicPECeiling } from '../services/screeningEngine.js';
import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

const FINNHUB_TICKERS_PER_RUN = 10;

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
  let tickers = getSP500Tickers();
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

  // Rotate through remaining tickers in chunks of 150
  const CHUNK = tickerLimit || 150;
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

      stats.pricesUpdated++;
    } catch (err) {
      console.error(`Error storing ${quote.ticker}:`, err.message);
      stats.errors++;
    }
  }

  // Save progress offset (only tracks the rotating non-priority tickers)
  await saveRefreshOffset(env.DB, offset + chunk.length >= remainingTickers.length ? 0 : offset + chunk.length);

  // Step 3a: Fill P/E and P/B ratios from Finnhub for stocks missing them
  stats.metricsFilled = 0;
  if (env.FINNHUB_API_KEY) {
    const missingRatios = await env.DB.prepare(
      `SELECT s.ticker FROM stocks s
       LEFT JOIN market_data md ON s.ticker = md.ticker
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND (md.pe_ratio IS NULL OR md.pb_ratio IS NULL)
       LIMIT 40`
    ).all();

    for (const row of (missingRatios.results || [])) {
      try {
        const metrics = await getBasicMetrics(row.ticker, env.FINNHUB_API_KEY);
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
      }
    }
    console.log(`Finnhub metrics filled: ${stats.metricsFilled}`);
  }

  // Step 3b: Fetch fundamentals via Finnhub (no daily cap, 60 calls/min)
  // Prioritize promising stocks (low P/E + P/B) first
  if (env.FINNHUB_API_KEY) {
    const peCeiling = getDynamicPECeiling(bondYield?.yield);

    // Priority queue: stocks that pass P/E and P/B but lack fundamentals
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

    // If priority queue is empty, fall back to any stock missing fundamentals
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

    if (batch.length > 0) {
      console.log(`Fetching fundamentals via Finnhub (priority): ${batch.join(', ')}`);
    }

    for (const ticker of batch) {
      try {
        const reports = await getFinancialsReported(ticker, env.FINNHUB_API_KEY);
        const financials = parseFinancialsReported(ticker, reports);

        if (financials.length === 0) {
          console.log(`No financials-reported data for ${ticker}, skipping`);
          continue;
        }

        for (const fin of financials) {
          await upsertFinancials(env.DB, fin);
        }

        stats.fundamentalsFetched++;
        console.log(`Finnhub fundamentals stored for ${ticker}: ${financials.length} years`);
      } catch (err) {
        console.error(`Error fetching Finnhub fundamentals for ${ticker}:`, err.message);
        stats.errors++;
        stats.lastFundamentalsError = `${ticker}: ${err.message}`;
        if (err.message.includes('rate limit')) break;
      }
    }
  }

  // Step 4: Run Layer 1 screening on stocks that have fundamentals
  const screenDate = new Date().toISOString().split('T')[0];
  const stocksWithData = await env.DB.prepare(
    `SELECT s.* FROM stocks s
     INNER JOIN market_data md ON s.ticker = md.ticker
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND EXISTS (SELECT 1 FROM financials f WHERE f.ticker = s.ticker)
     LIMIT 50`
  ).all();

  for (const stock of (stocksWithData.results || [])) {
    try {
      const financials = await getFinancialsForTicker(env.DB, stock.ticker);
      const marketData = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(stock.ticker).first();
      if (!marketData || financials.length === 0) continue;

      const screenResults = runLayer1Screen(stock, financials, marketData, {
        aaa_bond_yield: bondYield?.yield,
      });
      await saveScreenResult(env.DB, stock.ticker, screenDate, screenResults);
      stats.screened++;
    } catch (err) {
      console.error(`Screening error for ${stock.ticker}:`, err.message);
    }
  }

  // Step 5: Compute valuations for stocks that passed screening
  const passedStocks = await env.DB.prepare(
    `SELECT DISTINCT ticker FROM screen_results
     WHERE passes_all_hard = 1 AND screen_date = ?`
  ).bind(screenDate).all();

  stats.valuations = 0;
  for (const row of (passedStocks.results || [])) {
    try {
      const fins = await getFinancialsForTicker(env.DB, row.ticker);
      const md = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(row.ticker).first();
      const attractorData = await env.DB.prepare(
        'SELECT attractor_stability_score, network_regime FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
      ).bind(row.ticker).first();
      const val = calculateGrahamValuation(fins, md, bondYield?.yield, attractorData);
      if (val) {
        await upsertValuation(env.DB, val);
        stats.valuations++;
      }
    } catch (err) {
      console.error(`Valuation error for ${row.ticker}:`, err.message);
    }
  }

  // Step 6: Fetch insider transactions for watchlist stocks (via Finnhub)
  stats.insiderUpdated = 0;
  if (env.FINNHUB_API_KEY) {
    // Limit to 20 watchlist tickers per run to stay within subrequest budget
    const watchlistTickers = await env.DB.prepare(
      'SELECT ticker FROM watchlist LIMIT 20'
    ).all();

    const today = new Date().toISOString().split('T')[0];
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const row of (watchlistTickers.results || [])) {
      try {
        // Fetch transactions
        const txns = await getInsiderTransactions(row.ticker, ninetyDaysAgo, today, env.FINNHUB_API_KEY);
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

        // Fetch sentiment and compute signal
        const sentiment = await getInsiderSentiment(row.ticker, ninetyDaysAgo, today, env.FINNHUB_API_KEY);
        const signal = computeInsiderSignalFromSentiment(sentiment);

        // Count buys/sells from stored transactions
        const buys = await env.DB.prepare(
          `SELECT COUNT(*) as cnt, SUM(total_value) as val, COUNT(DISTINCT insider_name) as unique_buyers
           FROM insider_transactions
           WHERE ticker = ? AND transaction_type = 'buy' AND filing_date >= ?`
        ).bind(row.ticker, ninetyDaysAgo).first();

        const sells = await env.DB.prepare(
          `SELECT COUNT(*) as cnt, SUM(total_value) as val
           FROM insider_transactions
           WHERE ticker = ? AND transaction_type = 'sell' AND filing_date >= ?`
        ).bind(row.ticker, ninetyDaysAgo).first();

        await env.DB.prepare(
          `INSERT OR REPLACE INTO insider_signals
           (ticker, signal_date, trailing_90d_buys, trailing_90d_buy_value, trailing_90d_sells, trailing_90d_sell_value, unique_buyers_90d, signal, signal_details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          row.ticker, today,
          buys?.cnt || 0, buys?.val || 0,
          sells?.cnt || 0, sells?.val || 0,
          buys?.unique_buyers || 0,
          signal.signal, signal.details
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
