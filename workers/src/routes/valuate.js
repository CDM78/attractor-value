import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { getFinancialsForTicker, upsertValuation } from '../db/queries.js';
import { getOrFetchBondYield } from '../services/fred.js';

export async function valuateRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');

  // GET /api/valuate?ticker=AAPL — retrieve stored valuation
  if (request.method === 'GET') {
    if (!ticker) return errorResponse('ticker parameter required', 400);

    const valuation = await env.DB.prepare(
      'SELECT * FROM valuations WHERE ticker = ?'
    ).bind(ticker).first();

    if (!valuation) return errorResponse('No valuation found', 404);
    return jsonResponse(valuation);
  }

  // POST /api/valuate?ticker=AAPL — compute and store valuation
  // POST /api/valuate (no ticker) — batch compute for all screened stocks
  if (request.method === 'POST') {
    const bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
    const aaaBondYieldPct = bondYield?.yield || 5.0;

    if (ticker) {
      // Single ticker valuation
      const result = await computeAndStore(env.DB, ticker, aaaBondYieldPct);
      if (!result) return errorResponse('Insufficient data for valuation', 422);
      return jsonResponse(result);
    }

    // Batch: compute for all stocks that passed Layer 1 screening
    const passedStocks = await env.DB.prepare(
      `SELECT DISTINCT sr.ticker FROM screen_results sr
       WHERE sr.passes_all_hard = 1
       AND sr.screen_date = (SELECT MAX(screen_date) FROM screen_results)`
    ).all();

    const tickers = (passedStocks.results || []).map(r => r.ticker);
    const results = { computed: 0, skipped: 0, errors: 0 };

    for (const t of tickers) {
      try {
        const val = await computeAndStore(env.DB, t, aaaBondYieldPct);
        if (val) results.computed++;
        else results.skipped++;
      } catch (err) {
        console.error(`Valuation error for ${t}:`, err.message);
        results.errors++;
      }
    }

    return jsonResponse(results);
  }

  return errorResponse('Method not allowed', 405);
}

async function computeAndStore(db, ticker, aaaBondYieldPct) {
  const financials = await getFinancialsForTicker(db, ticker);
  const marketData = await db.prepare(
    'SELECT * FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  const valuation = calculateGrahamValuation(financials, marketData, aaaBondYieldPct);
  if (!valuation) return null;

  await upsertValuation(db, valuation);
  return valuation;
}
