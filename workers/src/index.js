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
import { universeRoutes } from './routes/universe.js';
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
  '/api/universe': universeRoutes,
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

    // Economic snapshot (legacy)
    if (path === '/api/economic-snapshot') {
      try {
        const { getOrFetchEconomicSnapshot } = await import('./services/fred.js');
        const snapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
        return jsonResponse(snapshot);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Full environment status (crisis + regimes + economic snapshot)
    if (path === '/api/environment') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { getEnvironmentStatus } = await import('./services/regimeDetector.js');
        const status = await getEnvironmentStatus(env.DB, env);
        return jsonResponse(status);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Get all current signals (BUY, NOT_YET) with position sizing
    if (path === '/api/signals') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { getCurrentSignals } = await import('./services/signalEngine.js');
        const { sizeAllBuySignals } = await import('./services/positionSizer.js');

        // Size all BUY signals
        const positions = await sizeAllBuySignals(env.DB);
        const signals = await getCurrentSignals(env.DB);

        return jsonResponse({ ...signals, positions });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Refresh all candidate signals
    if (path === '/api/signals/refresh' && request.method === 'POST') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { refreshAllSignals } = await import('./services/signalEngine.js');
        const result = await refreshAllSignals(env.DB, env);
        return jsonResponse(result);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Position sizing for a specific ticker
    if (path === '/api/position-size') {
      try {
        const { computePositionSize } = await import('./services/positionSizer.js');
        const ticker = url.searchParams.get('ticker');
        if (!ticker) return errorResponse('ticker parameter required', 400);

        const candidate = await env.DB.prepare(
          "SELECT * FROM candidates WHERE ticker = ? AND signal = 'BUY' AND status = 'active' ORDER BY discovered_date DESC LIMIT 1"
        ).bind(ticker.toUpperCase()).first();

        if (!candidate) return errorResponse(`No active BUY signal for ${ticker}`, 404);

        const price = await env.DB.prepare(
          'SELECT price FROM market_data WHERE ticker = ?'
        ).bind(ticker.toUpperCase()).first();

        const position = await computePositionSize(env.DB, {
          ticker: candidate.ticker,
          discovery_tier: candidate.discovery_tier,
          current_price: price?.price,
          signal_confidence: candidate.signal_confidence,
        });

        return jsonResponse(position);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Portfolio config get/set
    if (path === '/api/portfolio/config') {
      const { ensureMultiTierTables, getPortfolioConfig, setPortfolioConfig } = await import('./db/queries.js');
      await ensureMultiTierTables(env.DB);

      if (request.method === 'GET') {
        const config = await getPortfolioConfig(env.DB);
        return jsonResponse(config);
      }
      if (request.method === 'POST') {
        const body = await request.json();
        for (const [key, value] of Object.entries(body)) {
          await setPortfolioConfig(env.DB, key, value);
        }
        const config = await getPortfolioConfig(env.DB);
        return jsonResponse({ updated: true, config });
      }
    }

    // Manual regime scan trigger
    if (path === '/api/regime-scan' && request.method === 'POST') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { scanForRegimes } = await import('./services/regimeDetector.js');
        const result = await scanForRegimes(env, env.DB);
        return jsonResponse(result);
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
    // Ensure small cap tables exist (runs once, no-ops after)
    try {
      const { ensureSmallCapTables } = await import('./db/queries.js');
      await ensureSmallCapTables(env.DB);
    } catch (err) {
      console.error('ensureSmallCapTables error:', err.message);
    }

    // Ensure multi-tier pipeline tables exist
    try {
      const { ensureMultiTierTables } = await import('./db/queries.js');
      await ensureMultiTierTables(env.DB);
    } catch (err) {
      console.error('ensureMultiTierTables error:', err.message);
    }

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

    // Monthly universe rebuild (1st of month, 2 AM ET = 6 AM UTC)
    const dayOfMonth = scheduledTime.getUTCDate();
    if (dayOfMonth === 1 && utcHour === 6 && minute === 0) {
      const { buildSmallCapUniverse } = await import('./services/edgarFrames.js');
      ctx.waitUntil(
        // Reset and restart the build process
        env.DB.prepare("DELETE FROM system_config WHERE key = 'universe_build_step'").run()
          .then(() => buildSmallCapUniverse(env.DB, env))
      );
    }

    // Continue universe build if in progress (every 5 min on Saturdays)
    if (isSaturday && minute % 5 === 0) {
      const buildStep = await env.DB.prepare(
        "SELECT value FROM system_config WHERE key = 'universe_build_step'"
      ).first();
      if (buildStep?.value && buildStep.value !== 'complete') {
        const { buildSmallCapUniverse } = await import('./services/edgarFrames.js');
        ctx.waitUntil(buildSmallCapUniverse(env.DB, env));
      }
    }

    // Weekly Saturday refresh (overnight — data ready before morning)
    if (isSaturday && utcHour === 4 && minute === 0) {
      // Saturday 12:00 AM ET — Finnhub fallback (sectors, insider ownership, dividend yield)
      ctx.waitUntil(finnhubRefresh(env));
    }
    if (isSaturday && utcHour === 5 && minute === 0) {
      // Saturday 1:00 AM ET — EDGAR fundamentals catch-up
      ctx.waitUntil(edgarRefresh(env));
    }
    if (isSaturday && utcHour === 6 && minute === 0) {
      // Saturday 2:00 AM ET — insider data refresh
      ctx.waitUntil(dailyRefresh(env));
    }
  },
};
