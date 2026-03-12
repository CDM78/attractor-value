import { dailyRefresh } from '../cron/dailyRefresh.js';

export async function refreshRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);

  if (request.method === 'POST') {
    // Option to run a subset for testing: POST /api/refresh?limit=10
    const limit = parseInt(url.searchParams.get('limit')) || 0;

    try {
      // Run in the background so we don't timeout the HTTP request
      // (full refresh of 500 stocks takes a while)
      const refreshPromise = dailyRefresh(env, limit > 0 ? limit : undefined);

      if (url.searchParams.get('wait') === 'true') {
        const stats = await refreshPromise;
        return jsonResponse({ message: 'Data refresh completed', stats });
      } else {
        ctx.waitUntil(refreshPromise);
        return jsonResponse({ message: 'Data refresh triggered in background' });
      }
    } catch (err) {
      return errorResponse(`Refresh failed: ${err.message}`);
    }
  }

  // GET /api/refresh — show status/stats
  if (request.method === 'GET') {
    const stockCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
    ).first();
    const marketDataCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM market_data'
    ).first();
    const screenCount = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM screen_results WHERE screen_date = (SELECT MAX(screen_date) FROM screen_results)'
    ).first();
    const latestScreen = await env.DB.prepare(
      'SELECT MAX(screen_date) as date FROM screen_results'
    ).first();

    return jsonResponse({
      stocks: stockCount?.count || 0,
      market_data: marketDataCount?.count || 0,
      latest_screen_date: latestScreen?.date || null,
      screened_stocks: screenCount?.count || 0,
    });
  }

  return errorResponse('Method not allowed', 405);
}
