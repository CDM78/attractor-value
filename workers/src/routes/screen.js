import { getDynamicPECeiling, runLayer1Screen, computeSectorPBThresholds } from '../services/screeningEngine.js';
import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { getFinancialsForTicker, saveScreenResult } from '../db/queries.js';
import { getOrFetchBondYield } from '../services/fred.js';

export async function screenRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);

  // POST /api/screen/batch — batch screen stocks (small caps or by tier)
  if (request.method === 'POST' && path.startsWith('/api/screen/batch')) {
    return await batchScreen(env, url, jsonResponse, errorResponse);
  }

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
              v.discount_to_iv_pct, v.fat_tail_discount, v.margin_of_safety_required,
              aa.attractor_stability_score, aa.adjusted_attractor_score,
              aa.network_regime as attractor_regime, aa.analysis_date as attractor_date
       FROM screen_results sr
       JOIN stocks s ON sr.ticker = s.ticker
       LEFT JOIN market_data md ON sr.ticker = md.ticker
       LEFT JOIN valuations v ON sr.ticker = v.ticker
       LEFT JOIN attractor_analysis aa ON sr.ticker = aa.ticker
         AND aa.id = (SELECT id FROM attractor_analysis WHERE ticker = sr.ticker ORDER BY analysis_date DESC, id DESC LIMIT 1)
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
              CASE WHEN md.pe_ratio IS NOT NULL AND md.pb_ratio IS NOT NULL AND (md.pe_ratio * md.pb_ratio) <= 40 THEN 1 ELSE 0 END as passes_pe_x_pb,
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

/**
 * Batch screen stocks that have fundamentals but no recent screen results.
 * POST /api/screen/batch?tier=small&limit=50
 */
async function batchScreen(env, url, jsonResponse, errorResponse) {
  const tier = url.searchParams.get('tier') || 'small';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  try {
    // Get bond yield for dynamic P/E ceiling
    let bondYield;
    try {
      bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
    } catch {
      bondYield = { yield: 5.0 };
    }

    const screenDate = new Date().toISOString().split('T')[0];

    // Build tier filter
    const tierFilter = tier === 'small'
      ? "AND s.cap_tier = 'small'"
      : tier === 'all'
        ? ''
        : `AND s.cap_tier = '${tier === 'mid' ? 'mid' : 'large'}'`;

    // Find stocks with fundamentals but no recent screen results
    const candidates = await env.DB.prepare(
      `SELECT s.* FROM stocks s
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         ${tierFilter}
         AND EXISTS (SELECT 1 FROM financials f WHERE f.ticker = s.ticker)
         AND EXISTS (SELECT 1 FROM market_data md WHERE md.ticker = s.ticker AND md.price > 0)
         AND NOT EXISTS (
           SELECT 1 FROM screen_results sr
           WHERE sr.ticker = s.ticker AND sr.screen_date >= date('now', '-7 days')
         )
       ORDER BY s.ticker
       LIMIT ?`
    ).bind(limit).all();

    const stocks = candidates.results || [];
    if (stocks.length === 0) {
      return jsonResponse({ screened: 0, message: 'No unscreened stocks with fundamentals found' });
    }

    // Compute sector P/B thresholds
    const allPB = await env.DB.prepare(
      `SELECT s.sector, md.pb_ratio FROM stocks s
       JOIN market_data md ON s.ticker = md.ticker
       WHERE md.pb_ratio IS NOT NULL AND md.pb_ratio > 0 AND s.sector IS NOT NULL`
    ).all();
    const sectorPBThresholds = computeSectorPBThresholds(allPB.results || []);

    const results = [];
    for (const stock of stocks) {
      try {
        const financials = await getFinancialsForTicker(env.DB, stock.ticker);
        const marketData = await env.DB.prepare(
          'SELECT * FROM market_data WHERE ticker = ?'
        ).bind(stock.ticker).first();
        if (!marketData || financials.length === 0) continue;

        const isSmallCap = stock.cap_tier === 'small' ||
          (stock.market_cap && stock.market_cap >= 300000000 && stock.market_cap <= 2000000000);

        const screenResult = runLayer1Screen(stock, financials, marketData, {
          aaa_bond_yield: bondYield?.yield,
          sector_pb_thresholds: sectorPBThresholds,
          is_small_cap: isSmallCap,
        });

        await saveScreenResult(env.DB, stock.ticker, screenDate, screenResult);

        // Quick Graham IV estimate for candidates that pass
        let buyBelowEstimate = null;
        if (screenResult.tier === 'full_pass' || screenResult.tier === 'near_miss') {
          const val = calculateGrahamValuation(
            financials, marketData, bondYield?.yield, null,
            { tier: screenResult.tier, miss_severity: screenResult.miss_severity, is_small_cap: isSmallCap },
            null
          );
          buyBelowEstimate = val?.buy_below_price || null;
        }

        results.push({
          ticker: stock.ticker,
          name: stock.company_name,
          sector: stock.sector,
          market_cap: stock.market_cap,
          cap_tier: stock.cap_tier,
          price: marketData.price,
          pe: marketData.pe_ratio,
          pb: marketData.pb_ratio,
          pass_count: screenResult.pass_count,
          tier: screenResult.tier,
          buy_below_estimate: buyBelowEstimate,
          accruals_ratio: screenResult.accruals_ratio,
          goodwill_ratio: screenResult.goodwill_ratio,
          liquidity_flag: screenResult.liquidity_flag,
          revenue_quality_flag: screenResult.revenue_quality_flag,
        });
      } catch (err) {
        console.error(`Batch screen error for ${stock.ticker}:`, err.message);
      }
    }

    // Sort: full_pass first, then near_miss, then by pass count desc
    results.sort((a, b) => {
      const tierOrder = { full_pass: 0, near_miss: 1, fail: 2 };
      const tierDiff = (tierOrder[a.tier] || 2) - (tierOrder[b.tier] || 2);
      return tierDiff !== 0 ? tierDiff : (b.pass_count - a.pass_count);
    });

    return jsonResponse({
      screened: results.length,
      candidates: results.filter(r => r.tier !== 'fail').length,
      results,
      meta: {
        tier_filter: tier,
        screen_date: screenDate,
        bond_yield: bondYield?.yield,
      },
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}
