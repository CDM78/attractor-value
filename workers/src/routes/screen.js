import { getDynamicPECeiling } from '../services/screeningEngine.js';

export async function screenRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const results = await env.DB.prepare(
      `SELECT sr.*, s.company_name, s.sector, md.price, md.pe_ratio, md.pb_ratio,
              v.graham_intrinsic_value, v.adjusted_intrinsic_value, v.buy_below_price,
              v.discount_to_iv_pct, v.fat_tail_discount, v.margin_of_safety_required
       FROM screen_results sr
       JOIN stocks s ON sr.ticker = s.ticker
       LEFT JOIN market_data md ON sr.ticker = md.ticker
       LEFT JOIN valuations v ON sr.ticker = v.ticker
       WHERE sr.screen_date = (SELECT MAX(screen_date) FROM screen_results)
       ORDER BY sr.passes_all_hard DESC, v.discount_to_iv_pct DESC, sr.ticker`
    ).all();

    // Include current AAA yield and dynamic P/E ceiling for UI display
    const bondRow = await env.DB.prepare(
      "SELECT price, fetched_at FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
    ).first();

    const aaaBondYield = bondRow?.price || null;
    const dynamicPECeiling = aaaBondYield != null
      ? parseFloat(getDynamicPECeiling(aaaBondYield).toFixed(1))
      : 15;

    return jsonResponse({
      stocks: results.results || [],
      meta: {
        aaa_bond_yield: aaaBondYield,
        dynamic_pe_ceiling: dynamicPECeiling,
        bond_yield_date: bondRow?.fetched_at || null,
      },
    });
  }

  return errorResponse('Method not allowed', 405);
}
