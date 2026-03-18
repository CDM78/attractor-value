export async function watchlistRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const items = await env.DB.prepare(
      `SELECT w.*, s.company_name, s.sector, md.price, v.buy_below_price, v.discount_to_iv_pct,
              v.adjusted_intrinsic_value, v.margin_of_safety_required,
              aa.attractor_stability_score, aa.network_regime,
              ins.signal as insider_signal, ins.signal_details as insider_details,
              ins.trailing_90d_buys, ins.trailing_90d_buy_value, ins.unique_buyers_90d
       FROM watchlist w
       JOIN stocks s ON w.ticker = s.ticker
       LEFT JOIN market_data md ON w.ticker = md.ticker
       LEFT JOIN valuations v ON w.ticker = v.ticker
       LEFT JOIN attractor_analysis aa ON w.ticker = aa.ticker
         AND aa.id = (SELECT id FROM attractor_analysis WHERE ticker = w.ticker ORDER BY analysis_date DESC, id DESC LIMIT 1)
       LEFT JOIN insider_signals ins ON w.ticker = ins.ticker
       ORDER BY v.discount_to_iv_pct DESC`
    ).all();
    return jsonResponse(items.results || []);
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const { ticker, notes, target_buy_price } = body;
    if (!ticker) return errorResponse('ticker required', 400);

    await env.DB.prepare(
      `INSERT OR REPLACE INTO watchlist (ticker, added_date, notes, target_buy_price, alert_enabled)
       VALUES (?, ?, ?, ?, 1)`
    ).bind(ticker, new Date().toISOString().split('T')[0], notes || null, target_buy_price || null).run();

    return jsonResponse({ message: 'Added to watchlist', ticker });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker');
    if (!ticker) return errorResponse('ticker required', 400);

    await env.DB.prepare('DELETE FROM watchlist WHERE ticker = ?').bind(ticker).run();
    return jsonResponse({ message: 'Removed from watchlist', ticker });
  }

  return errorResponse('Method not allowed', 405);
}
