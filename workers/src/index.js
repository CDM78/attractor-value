import { screenRoutes } from './routes/screen.js';
import { valuateRoutes } from './routes/valuate.js';
import { analyzeRoutes } from './routes/analyze.js';
import { watchlistRoutes } from './routes/watchlist.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { alertsRoutes } from './routes/alerts.js';
import { refreshRoutes } from './routes/refresh.js';
import { fillMetricsRoutes, fillFundamentalsRoutes, backfillRoutes } from './routes/fillMetrics.js';
import { transactionsRoutes } from './routes/transactions.js';
import { reportRoutes } from './routes/report.js';
import { quoteRoutes } from './routes/quote.js';
import { priceCheckRoutes } from './routes/priceCheck.js';
import { dailyRefresh, finnhubRefresh, edgarRefresh } from './cron/dailyRefresh.js';
import { alertsCheck } from './cron/alertsCheck.js';
import { dailyAttractorCheck } from './cron/attractorCheck.js';
import { fetchBulkQuotes } from './services/yahooFinance.js';

// Auto-detect population vs maintenance mode
async function determineMode(db) {
  // Check for manual override first
  const override = await db.prepare(
    "SELECT value FROM system_config WHERE key = 'cron_mode'"
  ).first();
  if (override?.value === 'maintenance') return 'maintenance';
  if (override?.value === 'population') {
    // Check if population is actually complete
    const total = await db.prepare(
      "SELECT COUNT(*) as cnt FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
    ).first();
    const withFundamentals = await db.prepare(
      "SELECT COUNT(DISTINCT ticker) as cnt FROM financials"
    ).first();
    const withScreening = await db.prepare(
      "SELECT COUNT(DISTINCT ticker) as cnt FROM screen_results WHERE sector_pb_threshold IS NOT NULL"
    ).first();

    const totalCount = total?.cnt || 0;
    const threshold = totalCount * 0.10;
    const missingFundamentals = totalCount - (withFundamentals?.cnt || 0);
    const missingScreening = totalCount - (withScreening?.cnt || 0);

    if (missingFundamentals <= threshold && missingScreening <= threshold) {
      // Auto-transition to maintenance
      console.log(`Population complete. ${withFundamentals?.cnt} fundamentals, ${withScreening?.cnt} screened of ${totalCount}. Switching to maintenance.`);
      await db.prepare(
        "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('cron_mode', 'maintenance', datetime('now'))"
      ).run();
      return 'maintenance';
    }
  }
  return 'population';
}

// Lightweight intraday price check for watchlist + portfolio stocks only
async function watchlistPriceCheck(env) {
  const watchlistRows = await env.DB.prepare(
    `SELECT w.ticker, w.target_buy_price FROM watchlist w
     UNION
     SELECT DISTINCT h.ticker, NULL FROM holdings h`
  ).all();

  const tickers = (watchlistRows.results || []).map(r => r.ticker);
  if (tickers.length === 0) return;

  const quotes = await fetchBulkQuotes(tickers, 5, 1000);

  for (const q of quotes) {
    // Update price in market_data
    await env.DB.prepare(
      "UPDATE market_data SET price = ?, fetched_at = ? WHERE ticker = ?"
    ).bind(q.price, new Date().toISOString(), q.ticker).run();

    // Check against buy-below price
    const val = await env.DB.prepare(
      "SELECT buy_below_price, adjusted_intrinsic_value FROM valuations WHERE ticker = ?"
    ).bind(q.ticker).first();

    if (val?.buy_below_price && q.price <= val.buy_below_price) {
      // Fire buy opportunity alert (dedup within 24h handled by alertsCheck)
      const existing = await env.DB.prepare(
        "SELECT id FROM alerts WHERE ticker = ? AND alert_type = 'buy_opportunity' AND dismissed = 0 AND created_at > datetime('now', '-24 hours')"
      ).bind(q.ticker).first();
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO alerts (alert_type, ticker, message, created_at) VALUES (?, ?, ?, ?)"
        ).bind(
          'buy_opportunity', q.ticker,
          `${q.ticker} is now at $${q.price.toFixed(2)}, below buy-below of $${val.buy_below_price.toFixed(2)}`,
          new Date().toISOString()
        ).run();
      }
    }
  }
  console.log(`Watchlist price check: ${quotes.length} prices updated`);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

const routeMap = {
  '/api/screen': screenRoutes,
  '/api/valuate': valuateRoutes,
  '/api/analyze': analyzeRoutes,
  '/api/watchlist': watchlistRoutes,
  '/api/portfolio': portfolioRoutes,
  '/api/alerts': alertsRoutes,
  '/api/refresh': refreshRoutes,
  '/api/fill-metrics': fillMetricsRoutes,
  '/api/fill-fundamentals': fillFundamentalsRoutes,
  '/api/backfill': backfillRoutes,
  '/api/transactions': transactionsRoutes,
  '/api/report': reportRoutes,
  '/api/quote': quoteRoutes,
  '/api/price-check': priceCheckRoutes,
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/api/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Economic snapshot
    if (path === '/api/economic-snapshot') {
      try {
        const { getOrFetchEconomicSnapshot } = await import('./services/fred.js');
        const snapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
        return jsonResponse(snapshot);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Admin: mode switch
    if (path === '/api/admin/mode') {
      if (request.method === 'GET') {
        const mode = await determineMode(env.DB);
        return jsonResponse({ mode });
      }
      if (request.method === 'POST') {
        const body = await request.json();
        if (!['population', 'maintenance'].includes(body.mode)) {
          return errorResponse('mode must be "population" or "maintenance"', 400);
        }
        await env.DB.prepare(
          "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('cron_mode', ?, datetime('now'))"
        ).bind(body.mode).run();
        return jsonResponse({ mode: body.mode, message: `Switched to ${body.mode} mode` });
      }
    }

    // Route matching
    for (const [prefix, handler] of Object.entries(routeMap)) {
      if (path.startsWith(prefix)) {
        try {
          return await handler(request, env, ctx, { path, jsonResponse, errorResponse });
        } catch (err) {
          console.error(`Error in ${prefix}:`, err);
          return errorResponse(err.message);
        }
      }
    }

    return errorResponse('Not found', 404);
  },

  async scheduled(event, env, ctx) {
    const mode = await determineMode(env.DB);
    const scheduledTime = new Date(event.scheduledTime);
    const minute = scheduledTime.getUTCMinutes();
    const utcHour = scheduledTime.getUTCHours();
    const dayOfWeek = scheduledTime.getUTCDay(); // 0=Sun, 6=Sat

    if (mode === 'population') {
      // Aggressive schedule: every minute, alternating
      if (minute % 3 === 0) {
        ctx.waitUntil(dailyRefresh(env).then(() => alertsCheck(env)));
      } else if (minute % 3 === 1) {
        ctx.waitUntil(edgarRefresh(env));
      } else {
        ctx.waitUntil(finnhubRefresh(env));
      }
      return;
    }

    // Maintenance mode — ET is UTC-4 (EDT) or UTC-5 (EST)
    // Using UTC-4 (EDT, March-November)
    const etHour = (utcHour - 4 + 24) % 24;
    const isMarketDay = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isMarketHours = etHour >= 10 && etHour < 16; // 10 AM to 4 PM ET (conservative)
    const isSaturday = dayOfWeek === 6;

    // Daily post-market jobs (market days only)
    if (isMarketDay && etHour === 16 && minute === 45) {
      // 4:45 PM ET — full price refresh
      ctx.waitUntil(dailyRefresh(env));
    }
    if (isMarketDay && etHour === 17 && minute === 0) {
      // 5:00 PM ET — EDGAR fundamentals refresh + screening (uses updated prices)
      ctx.waitUntil(edgarRefresh(env).then(() => dailyRefresh(env)));
    }
    if (isMarketDay && etHour === 17 && minute === 15) {
      // 5:15 PM ET — attractor analysis for stale/missing scores (caching policy)
      ctx.waitUntil(dailyAttractorCheck(env));
    }
    if (isMarketDay && etHour === 17 && minute === 30) {
      // 5:30 PM ET — alerts check
      ctx.waitUntil(alertsCheck(env));
    }

    // Intraday watchlist price check (every 15 min during market hours)
    if (isMarketDay && isMarketHours && minute % 15 === 0) {
      ctx.waitUntil(watchlistPriceCheck(env));
    }

    // Earnings season override: extra morning screen in Jan, Apr, Jul, Oct
    const month = scheduledTime.getUTCMonth(); // 0-indexed
    const isEarningsSeason = [0, 3, 6, 9].includes(month); // Jan, Apr, Jul, Oct
    if (isEarningsSeason && isMarketDay && etHour === 9 && minute === 30) {
      // 9:30 AM ET — catch pre-market earnings releases
      ctx.waitUntil(dailyRefresh(env));
    }

    // Weekly Saturday refresh
    if (isSaturday && utcHour === 10 && minute === 0) {
      // Saturday 6 AM ET — Finnhub fallback (sectors, insider ownership, dividend yield)
      ctx.waitUntil(finnhubRefresh(env));
    }
    if (isSaturday && utcHour === 11 && minute === 0) {
      // Saturday 7 AM ET — EDGAR fundamentals catch-up
      ctx.waitUntil(edgarRefresh(env));
    }
    if (isSaturday && utcHour === 12 && minute === 0) {
      // Saturday 8 AM ET — insider data refresh
      ctx.waitUntil(dailyRefresh(env));
    }
  },
};
