import { screenRoutes } from './routes/screen.js';
import { valuateRoutes } from './routes/valuate.js';
import { analyzeRoutes } from './routes/analyze.js';
import { watchlistRoutes } from './routes/watchlist.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { alertsRoutes } from './routes/alerts.js';
import { refreshRoutes } from './routes/refresh.js';
import { fillMetricsRoutes, fillFundamentalsRoutes } from './routes/fillMetrics.js';
import { dailyRefresh } from './cron/dailyRefresh.js';
import { alertsCheck } from './cron/alertsCheck.js';

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
    ctx.waitUntil(dailyRefresh(env));
    ctx.waitUntil(alertsCheck(env));
  },
};
