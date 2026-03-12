export async function portfolioRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const holdings = await env.DB.prepare(
      `SELECT h.*, s.company_name, s.sector, md.price,
              (md.price * h.shares) as current_value,
              ((md.price - h.cost_basis_per_share) / h.cost_basis_per_share * 100) as gain_loss_pct,
              aa.attractor_stability_score,
              v.adjusted_intrinsic_value, v.buy_below_price, v.discount_to_iv_pct
       FROM holdings h
       JOIN stocks s ON h.ticker = s.ticker
       LEFT JOIN market_data md ON h.ticker = md.ticker
       LEFT JOIN attractor_analysis aa ON h.ticker = aa.ticker
         AND aa.analysis_date = (SELECT MAX(analysis_date) FROM attractor_analysis WHERE ticker = h.ticker)
       LEFT JOIN valuations v ON h.ticker = v.ticker
       ORDER BY current_value DESC`
    ).all();

    // Portfolio summary
    const rows = holdings.results || [];
    const totalValue = rows.reduce((s, h) => s + (h.current_value || 0), 0);
    const totalCost = rows.reduce((s, h) => s + (h.cost_basis_per_share * h.shares), 0);
    const coreValue = rows.filter(h => h.tier === 'core').reduce((s, h) => s + (h.current_value || 0), 0);
    const asymValue = rows.filter(h => h.tier === 'asymmetric').reduce((s, h) => s + (h.current_value || 0), 0);

    // Sector breakdown
    const sectors = {};
    for (const h of rows) {
      const sec = h.sector || 'Unknown';
      sectors[sec] = (sectors[sec] || 0) + (h.current_value || 0);
    }

    return jsonResponse({
      holdings: rows,
      summary: {
        total_value: totalValue,
        total_cost: totalCost,
        total_gain_pct: totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : 0,
        positions_count: rows.length,
        core_pct: totalValue > 0 ? (coreValue / totalValue * 100) : 0,
        asymmetric_pct: totalValue > 0 ? (asymValue / totalValue * 100) : 0,
        sectors,
      },
    });
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

    await env.DB.prepare(
      `INSERT INTO transactions (ticker, action, shares, price_per_share, transaction_date, reason)
       VALUES (?, 'buy', ?, ?, ?, ?)`
    ).bind(ticker, shares, cost_basis_per_share, purchase_date, purchase_thesis || null).run();

    return jsonResponse({ message: 'Position added', ticker });
  }

  // PUT: sell or trim a position
  if (request.method === 'PUT') {
    const body = await request.json();
    const { id, action, shares_to_sell, price_per_share, reason } = body;

    if (!id || !action || !shares_to_sell || !price_per_share) {
      return errorResponse('Missing required fields (id, action, shares_to_sell, price_per_share)', 400);
    }

    const holding = await env.DB.prepare('SELECT * FROM holdings WHERE id = ?').bind(id).first();
    if (!holding) return errorResponse('Holding not found', 404);

    if (shares_to_sell > holding.shares) {
      return errorResponse('Cannot sell more shares than held', 400);
    }

    // Log the transaction
    await env.DB.prepare(
      `INSERT INTO transactions (ticker, action, shares, price_per_share, transaction_date, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(holding.ticker, action, shares_to_sell, price_per_share, new Date().toISOString().split('T')[0], reason || null).run();

    if (shares_to_sell >= holding.shares) {
      // Full sell — remove the holding
      await env.DB.prepare('DELETE FROM holdings WHERE id = ?').bind(id).run();
    } else {
      // Trim — reduce shares
      await env.DB.prepare(
        'UPDATE holdings SET shares = shares - ? WHERE id = ?'
      ).bind(shares_to_sell, id).run();
    }

    return jsonResponse({ message: `${action} executed`, ticker: holding.ticker, shares_sold: shares_to_sell });
  }

  return errorResponse('Method not allowed', 405);
}
