import { dailyRefresh } from '../cron/dailyRefresh.js';

export async function refreshRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'POST') {
    try {
      await dailyRefresh(env);
      return jsonResponse({ message: 'Data refresh triggered' });
    } catch (err) {
      return errorResponse(`Refresh failed: ${err.message}`);
    }
  }

  return errorResponse('Method not allowed', 405);
}
