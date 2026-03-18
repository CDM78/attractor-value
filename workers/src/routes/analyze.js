import { analyzeAttractorStability, buildFinancialContext } from '../services/claude.js';
import { fetch10K, extractMDA } from '../services/edgar.js';
import { getCompanyNews, formatNewsForPrompt } from '../services/finnhub.js';
import { getFinancialsForTicker } from '../db/queries.js';

export async function analyzeRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');

  if (!ticker) return errorResponse('ticker parameter required', 400);

  // GET: retrieve most recent analysis
  if (request.method === 'GET') {
    const analysis = await env.DB.prepare(
      'SELECT * FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
    ).bind(ticker).first();

    if (!analysis) return errorResponse('No analysis found', 404);

    // Also fetch concentration risk
    const cr = await env.DB.prepare(
      'SELECT * FROM concentration_risk WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
    ).bind(ticker).first();

    return jsonResponse({ analysis, concentration_risk: cr || null });
  }

  // POST: trigger new analysis via Claude API
  if (request.method === 'POST') {
    if (!env.ANTHROPIC_API_KEY) {
      return errorResponse('ANTHROPIC_API_KEY not configured', 500);
    }

    // Gather context data
    const stock = await env.DB.prepare(
      'SELECT * FROM stocks WHERE ticker = ?'
    ).bind(ticker).first();
    if (!stock) return errorResponse('Stock not found in database', 404);

    const financials = await getFinancialsForTicker(env.DB, ticker);
    const marketData = await env.DB.prepare(
      'SELECT * FROM market_data WHERE ticker = ?'
    ).bind(ticker).first();
    const valuation = await env.DB.prepare(
      'SELECT * FROM valuations WHERE ticker = ?'
    ).bind(ticker).first();

    const financialContext = buildFinancialContext(stock, financials, marketData, valuation);

    // Fetch 10-K MD&A (best effort — don't fail if unavailable)
    let mdaText = null;
    try {
      const filingUrl = await fetch10K(ticker);
      if (filingUrl) {
        mdaText = await extractMDA(filingUrl);
        console.log(`EDGAR: extracted ${mdaText?.length || 0} chars of MD&A for ${ticker}`);
      }
    } catch (err) {
      console.error(`EDGAR fetch failed for ${ticker}:`, err.message);
    }

    // Fetch recent news via Finnhub (best effort)
    let newsContext = '';
    try {
      if (env.FINNHUB_API_KEY) {
        const today = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const news = await getCompanyNews(ticker, thirtyDaysAgo, today, env.FINNHUB_API_KEY);
        newsContext = formatNewsForPrompt(news);
      }
    } catch (err) {
      console.error(`News fetch failed for ${ticker}:`, err.message);
    }

    // Run Claude analysis
    const result = await analyzeAttractorStability(
      ticker, stock.company_name, financialContext, mdaText, newsContext, env.ANTHROPIC_API_KEY
    );

    // Store attractor analysis
    await env.DB.prepare(
      `INSERT INTO attractor_analysis
       (ticker, analysis_date, revenue_durability_score, competitive_reinforcement_score,
        industry_structure_score, demand_feedback_score, adaptation_capacity_score,
        capital_allocation_score, attractor_stability_score, network_regime,
        red_flags, analysis_text, sources_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      result.ticker, result.analysis_date,
      result.revenue_durability_score, result.competitive_reinforcement_score,
      result.industry_structure_score, result.demand_feedback_score,
      result.adaptation_capacity_score, result.capital_allocation_score,
      result.attractor_stability_score, result.network_regime,
      result.red_flags, result.analysis_text, result.sources_used
    ).run();

    // Store concentration risk if extracted
    const cr = result.concentration_risk;
    if (cr) {
      await env.DB.prepare(
        `INSERT INTO concentration_risk
         (ticker, analysis_date, largest_customer_pct, largest_customer_name,
          customers_above_10pct, single_source_supplier, supplier_details,
          largest_geo_market_pct, largest_geo_market_name,
          regulatory_dependency_pct, regulatory_details,
          concentration_penalty, analysis_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ticker, result.analysis_date,
        cr.largest_customer_pct || null, cr.largest_customer_name || null,
        cr.customers_above_10pct || 0, cr.single_source_supplier ? 1 : 0,
        cr.supplier_details || null,
        cr.largest_geo_market_pct || null, cr.largest_geo_market_name || null,
        cr.regulatory_dependency_pct || null, cr.regulatory_details || null,
        cr.concentration_penalty || 0, result.analysis_text
      ).run();
    }

    // Update valuation with attractor-adjusted margin of safety (full near-miss matrix)
    if (result.attractor_stability_score != null && valuation && marketData) {
      const { MARGIN_OF_SAFETY } = await import('../../../shared/constants.js');

      // Fetch screen tier info for this ticker
      const screenRow = await env.DB.prepare(
        `SELECT tier, miss_severity FROM screen_results
         WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1`
      ).bind(ticker).first();
      const isNearMiss = screenRow?.tier === 'near_miss';
      const missSeverity = screenRow?.miss_severity;
      const score = result.attractor_stability_score;
      const isHardNetwork = result.network_regime === 'hard_network';

      let margin;
      if (score < 2.0) {
        margin = 1.0; // dissolving attractor — effectively block
      } else if (isNearMiss) {
        if (missSeverity === 'clear') {
          margin = MARGIN_OF_SAFETY.near_miss_clear;
        } else if (score >= 3.5) {
          margin = isHardNetwork
            ? MARGIN_OF_SAFETY.near_miss_stable_hard_network
            : MARGIN_OF_SAFETY.near_miss_stable_classical;
        } else {
          margin = MARGIN_OF_SAFETY.near_miss_transitional;
        }
      } else {
        // Full pass
        if (score >= 3.5) {
          margin = isHardNetwork
            ? MARGIN_OF_SAFETY.stable_hard_network_non_leader
            : MARGIN_OF_SAFETY.stable_classical;
        } else {
          margin = MARGIN_OF_SAFETY.transitional_any;
        }
      }

      const adjustedBuyBelow = valuation.adjusted_intrinsic_value * (1 - margin);
      await env.DB.prepare(
        `UPDATE valuations SET margin_of_safety_required = ?, buy_below_price = ?,
         discount_to_iv_pct = ? WHERE ticker = ?`
      ).bind(
        margin, Math.round(adjustedBuyBelow * 100) / 100,
        Math.round(((valuation.adjusted_intrinsic_value - marketData.price) / valuation.adjusted_intrinsic_value) * 1000) / 10,
        ticker
      ).run();
    }

    return jsonResponse({
      analysis: result,
      message: `Analysis complete for ${ticker}`,
    });
  }

  return errorResponse('Method not allowed', 405);
}
