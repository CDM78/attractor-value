import { fetchQuote, fetchBulkQuotes, getSP500Tickers } from '../services/yahooFinance.js';
import { fetchAllFundamentals } from '../services/alphaVantage.js';
import { getOrFetchBondYield } from '../services/fred.js';
import { upsertStock, upsertMarketData, upsertFinancials, getFinancialsForTicker, saveScreenResult } from '../db/queries.js';
import { runLayer1Screen } from '../services/screeningEngine.js';

const AV_TICKERS_PER_DAY = 6;

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

  // Step 2: Fetch prices — limited batch per invocation
  let tickers = getSP500Tickers();
  if (tickerLimit) tickers = tickers.slice(0, tickerLimit);

  // Process in smaller batches (max ~50 per invocation to stay within Worker CPU limits)
  const CHUNK = tickerLimit || 50;
  const offset = await getRefreshOffset(env.DB, tickers.length);
  const chunk = tickers.slice(offset, offset + CHUNK);

  console.log(`Fetching prices for chunk ${offset}-${offset + chunk.length} of ${tickers.length}`);

  const quotes = await fetchBulkQuotes(chunk, 5, 1000);

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
        pe_ratio: existingMd?.pe_ratio || null,
        pb_ratio: existingMd?.pb_ratio || null,
        earnings_yield: existingMd?.earnings_yield || null,
        dividend_yield: existingMd?.dividend_yield || null,
        insider_ownership_pct: existingMd?.insider_ownership_pct || null,
      });

      stats.pricesUpdated++;
    } catch (err) {
      console.error(`Error storing ${quote.ticker}:`, err.message);
      stats.errors++;
    }
  }

  // Save progress offset
  await saveRefreshOffset(env.DB, offset + chunk.length >= tickers.length ? 0 : offset + chunk.length);

  // Step 3: Fetch fundamentals (only when we've cycled back to offset 0, i.e., once per full cycle)
  if (offset === 0) {
    const tickersNeedingFundamentals = [];
    const allTickers = tickerLimit ? chunk : tickers;
    for (const ticker of allTickers) {
      const existing = await getFinancialsForTicker(env.DB, ticker, 1);
      if (existing.length === 0) {
        tickersNeedingFundamentals.push(ticker);
      }
    }

    const avBatch = tickersNeedingFundamentals.slice(0, AV_TICKERS_PER_DAY);
    if (avBatch.length > 0) {
      console.log(`Fetching fundamentals for ${avBatch.length} tickers: ${avBatch.join(', ')}`);
    }

    for (const ticker of avBatch) {
      try {
        const data = await fetchAllFundamentals(ticker, env.ALPHA_VANTAGE_API_KEY);
        await upsertStock(env.DB, data.stock);

        const existingMd = await env.DB.prepare('SELECT price FROM market_data WHERE ticker = ?').bind(ticker).first();
        await upsertMarketData(env.DB, {
          ticker,
          price: existingMd?.price || null,
          pe_ratio: data.marketData.pe_ratio,
          pb_ratio: data.marketData.pb_ratio,
          earnings_yield: data.marketData.earnings_yield,
          dividend_yield: data.marketData.dividend_yield,
          insider_ownership_pct: data.marketData.insider_ownership_pct,
        });

        for (const fin of data.financials) {
          await upsertFinancials(env.DB, fin);
        }

        stats.fundamentalsFetched++;
        console.log(`Fundamentals stored for ${ticker}: ${data.financials.length} years`);
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`Error fetching fundamentals for ${ticker}:`, err.message);
        stats.errors++;
        // Stop on rate limit to save remaining quota
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
