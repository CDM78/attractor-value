export async function screenRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const results = await env.DB.prepare(
      `SELECT sr.*, s.company_name, s.sector, md.price, md.pe_ratio, md.pb_ratio
       FROM screen_results sr
       JOIN stocks s ON sr.ticker = s.ticker
       LEFT JOIN market_data md ON sr.ticker = md.ticker
       WHERE sr.screen_date = (SELECT MAX(screen_date) FROM screen_results)
       ORDER BY sr.passes_all_hard DESC, sr.ticker`
    ).all();

    return jsonResponse(results.results || []);
  }

  return errorResponse('Method not allowed', 405);
}
