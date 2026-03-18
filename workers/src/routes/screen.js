import { getDynamicPECeiling } from '../services/screeningEngine.js';

export async function screenRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    // Include current AAA yield and dynamic P/E ceiling for UI display
    const bondRow = await env.DB.prepare(
      "SELECT price, fetched_at FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
    ).first();

    const aaaBondYield = bondRow?.price || null;
    const dynamicPECeiling = aaaBondYield != null
      ? parseFloat(getDynamicPECeiling(aaaBondYield).toFixed(1))
      : 15;

    // Try full screen results first
    const results = await env.DB.prepare(
      `SELECT sr.*, s.company_name, s.sector, md.price, md.pe_ratio, md.pb_ratio,
              v.graham_intrinsic_value, v.adjusted_intrinsic_value, v.buy_below_price,
              v.discount_to_iv_pct, v.fat_tail_discount, v.margin_of_safety_required
       FROM screen_results sr
       JOIN stocks s ON sr.ticker = s.ticker
       LEFT JOIN market_data md ON sr.ticker = md.ticker
       LEFT JOIN valuations v ON sr.ticker = v.ticker
       WHERE sr.screen_date = (
         SELECT MAX(sr2.screen_date) FROM screen_results sr2 WHERE sr2.ticker = sr.ticker
       )
       ORDER BY
         CASE sr.tier
           WHEN 'full_pass' THEN 0
           WHEN 'near_miss' THEN 1
           ELSE 2
         END,
         v.discount_to_iv_pct DESC,
         sr.ticker`
    ).all();

    const screenedStocks = results.results || [];

    // If we have screened stocks, return them
    if (screenedStocks.length > 0) {
      // Compute tier counts
      const fullPassCount = screenedStocks.filter(s => s.tier === 'full_pass').length;
      const nearMissCount = screenedStocks.filter(s => s.tier === 'near_miss').length;
      const failCount = screenedStocks.length - fullPassCount - nearMissCount;

      // Get sector P/B thresholds from the most recent screen results
      const sectorPBRows = await env.DB.prepare(
        `SELECT DISTINCT s.sector, sr.sector_pb_threshold
         FROM screen_results sr
         JOIN stocks s ON sr.ticker = s.ticker
         WHERE sr.sector_pb_threshold IS NOT NULL AND s.sector IS NOT NULL
         ORDER BY s.sector`
      ).all();
      const sectorPBThresholds = {};
      for (const row of (sectorPBRows.results || [])) {
        sectorPBThresholds[row.sector] = row.sector_pb_threshold;
      }

      return jsonResponse({
        stocks: screenedStocks,
        meta: {
          aaa_bond_yield: aaaBondYield,
          dynamic_pe_ceiling: dynamicPECeiling,
          bond_yield_date: bondRow?.fetched_at || null,
          full_pass_count: fullPassCount,
          near_miss_count: nearMissCount,
          fail_count: failCount,
          sector_pb_thresholds: sectorPBThresholds,
        },
      });
    }

    // Fallback: show all stocks with market data (preliminary view while fundamentals load)
    const preliminary = await env.DB.prepare(
      `SELECT s.ticker, s.company_name, s.sector,
              md.price, md.pe_ratio, md.pb_ratio,
              v.graham_intrinsic_value, v.adjusted_intrinsic_value, v.buy_below_price,
              v.discount_to_iv_pct,
              CASE WHEN md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ? THEN 1 ELSE 0 END as passes_pe,
              CASE WHEN md.pb_ratio IS NOT NULL AND md.pb_ratio <= 1.5 THEN 1 ELSE 0 END as passes_pb,
              CASE WHEN md.pe_ratio IS NOT NULL AND md.pb_ratio IS NOT NULL AND (md.pe_ratio * md.pb_ratio) <= 22.5 THEN 1 ELSE 0 END as passes_pe_x_pb,
              CASE WHEN EXISTS (SELECT 1 FROM financials f WHERE f.ticker = s.ticker) THEN 1 ELSE 0 END as has_fundamentals,
              0 as passes_debt_equity, 0 as passes_current_ratio,
              0 as passes_earnings_stability, 0 as passes_dividend_record,
              0 as passes_earnings_growth, 0 as passes_all_hard
       FROM stocks s
       INNER JOIN market_data md ON s.ticker = md.ticker
       LEFT JOIN valuations v ON s.ticker = v.ticker
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND md.price IS NOT NULL
       ORDER BY
         (CASE WHEN md.pe_ratio > 0 AND md.pe_ratio <= ? AND md.pb_ratio <= 1.5 THEN 1 ELSE 0 END) DESC,
         md.pe_ratio ASC
       LIMIT 500`
    ).bind(dynamicPECeiling, dynamicPECeiling).all();

    const fundCount = await env.DB.prepare(
      "SELECT COUNT(DISTINCT ticker) as count FROM financials"
    ).first();

    return jsonResponse({
      stocks: preliminary.results || [],
      meta: {
        aaa_bond_yield: aaaBondYield,
        dynamic_pe_ceiling: dynamicPECeiling,
        bond_yield_date: bondRow?.fetched_at || null,
        preliminary: true,
        note: `Showing preliminary data. ${fundCount?.count || 0} stocks have full fundamentals. Fundamentals are fetched at 6/day — full screening will appear once data is available.`,
      },
    });
  }

  return errorResponse('Method not allowed', 405);
}
