export async function portfolioRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const holdings = await env.DB.prepare(
      `SELECT h.*, s.company_name, s.sector, md.price,
              (md.price * h.shares) as current_value,
              ((md.price - h.cost_basis_per_share) / h.cost_basis_per_share * 100) as gain_loss_pct,
              aa.attractor_stability_score
       FROM holdings h
       JOIN stocks s ON h.ticker = s.ticker
       LEFT JOIN market_data md ON h.ticker = md.ticker
       LEFT JOIN attractor_analysis aa ON h.ticker = aa.ticker
         AND aa.analysis_date = (SELECT MAX(analysis_date) FROM attractor_analysis WHERE ticker = h.ticker)
       ORDER BY current_value DESC`
    ).all();
    return jsonResponse(holdings.results || []);
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const { ticker, tier, shares, cost_basis_per_share, purchase_date, purchase_thesis, attractor_score_at_purchase, time_horizon_months } = body;

    if (!ticker || !tier || !shares || !cost_basis_per_share || !purchase_date) {
      return errorResponse('Missing required fields', 400);
    }

    await env.DB.prepare(
      `INSERT INTO holdings (ticker, tier, shares, cost_basis_per_share, purchase_date, purchase_thesis, attractor_score_at_purchase, time_horizon_months)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ticker, tier, shares, cost_basis_per_share, purchase_date, purchase_thesis || null, attractor_score_at_purchase || null, time_horizon_months || null).run();

    // Also log the transaction
    await env.DB.prepare(
      `INSERT INTO transactions (ticker, action, shares, price_per_share, transaction_date, reason)
       VALUES (?, 'buy', ?, ?, ?, ?)`
    ).bind(ticker, shares, cost_basis_per_share, purchase_date, purchase_thesis || null).run();

    return jsonResponse({ message: 'Position added', ticker });
  }

  return errorResponse('Method not allowed', 405);
}
