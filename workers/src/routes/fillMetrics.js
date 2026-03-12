import { getBasicMetrics } from '../services/finnhub.js';
import { getDynamicPECeiling } from '../services/screeningEngine.js';
import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

// POST /api/fill-metrics?limit=50&offset=0
// Fills market_data ratios (P/E, P/B, etc.) from Finnhub for stocks missing them
// This runs much faster than Alpha Vantage (50 calls/min vs 6/day)
export async function fillMetricsRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'POST') {
    // GET: return fill status
    if (request.method === 'GET') {
      const total = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
      ).first();
      const withRatios = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM market_data WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\' AND pe_ratio IS NOT NULL"
      ).first();
      const withFundamentals = await env.DB.prepare(
        "SELECT COUNT(DISTINCT ticker) as cnt FROM financials"
      ).first();

      // Stocks that look promising (have ratios, might pass P/E + P/B)
      const bondRow = await env.DB.prepare(
        "SELECT price FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
      ).first();
      const peCeiling = bondRow?.price ? getDynamicPECeiling(bondRow.price) : 15;

      const promising = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM market_data
         WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
           AND pe_ratio IS NOT NULL AND pe_ratio > 0 AND pe_ratio <= ?
           AND pb_ratio IS NOT NULL AND pb_ratio <= ?
           AND ticker NOT IN (SELECT DISTINCT ticker FROM financials)`
      ).bind(peCeiling, SCREEN_DEFAULTS.pb_max).first();

      return jsonResponse({
        total_stocks: total?.cnt || 0,
        with_ratios: withRatios?.cnt || 0,
        with_fundamentals: withFundamentals?.cnt || 0,
        promising_without_fundamentals: promising?.cnt || 0,
        dynamic_pe_ceiling: peCeiling.toFixed(1),
      });
    }
    return errorResponse('Method not allowed', 405);
  }

  if (!env.FINNHUB_API_KEY) {
    return errorResponse('FINNHUB_API_KEY not configured', 500);
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Find stocks missing P/E ratios in market_data
  const missing = await env.DB.prepare(
    `SELECT s.ticker FROM stocks s
     LEFT JOIN market_data md ON s.ticker = md.ticker
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND (md.pe_ratio IS NULL OR md.pb_ratio IS NULL)
     ORDER BY s.ticker
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const tickers = (missing.results || []).map(r => r.ticker);
  const stats = { updated: 0, skipped: 0, errors: 0, total: tickers.length };

  for (const ticker of tickers) {
    try {
      const metrics = await getBasicMetrics(ticker, env.FINNHUB_API_KEY);

      if (!metrics.pe_ratio && !metrics.pb_ratio) {
        stats.skipped++;
        continue;
      }

      // Merge with existing market data (preserve price)
      const existing = await env.DB.prepare(
        'SELECT * FROM market_data WHERE ticker = ?'
      ).bind(ticker).first();

      await env.DB.prepare(
        `INSERT OR REPLACE INTO market_data
         (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ticker,
        existing?.price || null,
        metrics.pe_ratio || existing?.pe_ratio || null,
        metrics.pb_ratio || existing?.pb_ratio || null,
        metrics.earnings_yield || existing?.earnings_yield || null,
        metrics.dividend_yield || existing?.dividend_yield || null,
        metrics.insider_ownership_pct || existing?.insider_ownership_pct || null,
        new Date().toISOString()
      ).run();

      stats.updated++;
    } catch (err) {
      console.error(`Finnhub metrics error for ${ticker}:`, err.message);
      stats.errors++;
      if (err.message.includes('rate limit')) {
        stats.rateLimited = true;
        break;
      }
    }
  }

  return jsonResponse(stats);
}

// POST /api/fill-fundamentals?limit=6
// Prioritized Alpha Vantage fetch: promising stocks first (low P/E + P/B)
export async function fillFundamentalsRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    // Show the priority queue
    const bondRow = await env.DB.prepare(
      "SELECT price FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
    ).first();
    const peCeiling = bondRow?.price ? getDynamicPECeiling(bondRow.price) : 15;

    const queue = await env.DB.prepare(
      `SELECT md.ticker, s.company_name, md.pe_ratio, md.pb_ratio,
              (md.pe_ratio * md.pb_ratio) as pe_x_pb
       FROM market_data md
       JOIN stocks s ON md.ticker = s.ticker
       WHERE md.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ?
         AND md.pb_ratio IS NOT NULL AND md.pb_ratio <= ?
         AND md.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
       ORDER BY (md.pe_ratio * md.pb_ratio) ASC
       LIMIT 20`
    ).bind(peCeiling, SCREEN_DEFAULTS.pb_max).first() ? await env.DB.prepare(
      `SELECT md.ticker, s.company_name, md.pe_ratio, md.pb_ratio,
              (md.pe_ratio * md.pb_ratio) as pe_x_pb
       FROM market_data md
       JOIN stocks s ON md.ticker = s.ticker
       WHERE md.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ?
         AND md.pb_ratio IS NOT NULL AND md.pb_ratio <= ?
         AND md.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
       ORDER BY (md.pe_ratio * md.pb_ratio) ASC
       LIMIT 20`
    ).bind(peCeiling, SCREEN_DEFAULTS.pb_max).all() : { results: [] };

    return jsonResponse({
      priority_queue: queue.results || [],
      pe_ceiling: peCeiling.toFixed(1),
    });
  }

  return errorResponse('Use POST /api/refresh to trigger fundamentals fetch', 400);
}
