import { fetchQuote } from '../services/yahooFinance.js';
import { SCREEN_DEFAULTS } from '../../../shared/constants.js';
import { runLayer1Screen, computeSectorPBThresholds, getDynamicPECeiling } from '../services/screeningEngine.js';
import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { getFinancialsForTicker } from '../db/queries.js';
import { getOrFetchBondYield, getOrFetchEconomicSnapshot } from '../services/fred.js';
import { computeDerivedRatios } from '../services/edgarXbrl.js';

/**
 * Price Check / Re-Screen / Full Refresh
 *
 * GET /api/price-check?ticker=CB                — price check (1 API call)
 * GET /api/price-check?ticker=CB&mode=rescreen  — live Layer 1 + Layer 2 (read-only)
 * GET /api/price-check?ticker=CB&mode=full      — re-screen + new attractor analysis
 */
export async function priceCheckRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return errorResponse('ticker parameter required', 400);

  const mode = url.searchParams.get('mode') || 'price_check';

  if (mode === 'rescreen' || mode === 'full') {
    return handleRescreen(ticker, mode, env, jsonResponse, errorResponse);
  }

  // === Price Check Mode (default) ===

  const valuation = await env.DB.prepare(
    'SELECT buy_below_price, adjusted_intrinsic_value, margin_of_safety_required, calculated_at FROM valuations WHERE ticker = ?'
  ).bind(ticker).first();

  if (!valuation || !valuation.buy_below_price) {
    return errorResponse(`No valuation data for ${ticker}. Generate a report first.`, 404);
  }

  const screenResult = await env.DB.prepare(
    'SELECT tier, pass_count, screen_date, sector_pb_threshold, pe_x_pb_ceiling_used FROM screen_results WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1'
  ).bind(ticker).first();

  const storedMarket = await env.DB.prepare(
    'SELECT pb_ratio, pe_ratio, price, fetched_at FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  const quote = await fetchQuote(ticker);
  if (!quote || quote.price == null) {
    return errorResponse(`Could not fetch live quote for ${ticker}`, 502);
  }

  const currentPrice = quote.price;
  const buyBelow = valuation.buy_below_price;
  const pctFromBuyBelow = ((currentPrice - buyBelow) / buyBelow) * 100;

  // Confidence band
  let confidenceBand = null;
  if (currentPrice <= buyBelow * 0.90) confidenceBand = 'STRONG';
  else if (currentPrice <= buyBelow) confidenceBand = 'STANDARD';
  else if (currentPrice <= buyBelow * 1.05) confidenceBand = 'MARGINAL';

  // Determine signal status
  let status, statusDetail;
  if (currentPrice <= buyBelow * 0.90) {
    status = 'WELL BELOW BUY-BELOW';
    statusDetail = `by ${Math.abs(pctFromBuyBelow).toFixed(1)}% — strong signal`;
  } else if (currentPrice <= buyBelow) {
    status = 'BELOW BUY-BELOW';
    statusDetail = `by ${Math.abs(pctFromBuyBelow).toFixed(1)}% — signal still active`;
  } else if (currentPrice <= buyBelow * 1.05) {
    status = 'MARGINALLY ABOVE BUY-BELOW';
    statusDetail = `by ${pctFromBuyBelow.toFixed(1)}% — signal fragile, may flip on small price moves`;
  } else {
    status = 'ABOVE BUY-BELOW';
    statusDetail = `by ${pctFromBuyBelow.toFixed(1)}%`;
  }

  // Check P/B drift using EDGAR BVPS + live price
  let pbWarning = null;
  if (screenResult?.sector_pb_threshold) {
    const pbThreshold = Math.min(screenResult.sector_pb_threshold, SCREEN_DEFAULTS.pb_absolute_backstop);
    const storedPB = storedMarket?.pb_ratio;
    const storedPBPassed = storedPB && storedPB <= pbThreshold;

    const latestFin = await env.DB.prepare(
      'SELECT book_value_per_share FROM financials WHERE ticker = ? AND book_value_per_share IS NOT NULL ORDER BY fiscal_year DESC LIMIT 1'
    ).bind(ticker).first();

    let currentPB = null;
    let pbSource = null;
    if (latestFin?.book_value_per_share > 0) {
      currentPB = currentPrice / latestFin.book_value_per_share;
      pbSource = 'edgar_bvps';
    } else if (storedPB && storedMarket?.price > 0) {
      currentPB = storedPB * (currentPrice / storedMarket.price);
      pbSource = 'estimated';
    }

    if (currentPB != null) {
      const currentPBPassed = currentPB <= pbThreshold;
      if (storedPBPassed && !currentPBPassed) {
        pbWarning = {
          message: 'P/B filter may now FAIL due to price increase',
          report_pb: round(storedPB, 2),
          current_pb: round(currentPB, 2),
          pb_source: pbSource,
          threshold: round(pbThreshold, 2),
          recommendation: 'Re-run full report to confirm signal',
        };
      } else if (!storedPBPassed && currentPBPassed) {
        pbWarning = {
          message: 'P/B filter may now PASS due to price decrease',
          report_pb: round(storedPB, 2),
          current_pb: round(currentPB, 2),
          pb_source: pbSource,
          threshold: round(pbThreshold, 2),
          recommendation: 'Re-run full report — screening result may have improved',
        };
      }
    }
  }

  // Check P/E × P/B drift
  let pexbWarning = null;
  const pexbCeiling = screenResult?.pe_x_pb_ceiling_used || SCREEN_DEFAULTS.pe_x_pb_max;
  if (storedMarket?.pe_ratio && storedMarket?.pb_ratio && storedMarket?.price > 0) {
    const storedPExPB = storedMarket.pe_ratio * storedMarket.pb_ratio;
    const estimatedPB = storedMarket.pb_ratio * (currentPrice / storedMarket.price);
    const estimatedPExPB = storedMarket.pe_ratio * estimatedPB;

    if (storedPExPB <= pexbCeiling && estimatedPExPB > pexbCeiling) {
      pexbWarning = {
        message: `P/E × P/B may now exceed ceiling of ${pexbCeiling}`,
        report_pexb: round(storedPExPB, 1),
        estimated_current_pexb: round(estimatedPExPB, 1),
        recommendation: 'Re-run full report to confirm',
      };
    }
  }

  return jsonResponse({
    mode: 'price_check',
    ticker,
    report_date: valuation.calculated_at?.split('T')[0] || screenResult?.screen_date || null,
    report_buy_below: round(buyBelow, 2),
    report_intrinsic_value: round(valuation.adjusted_intrinsic_value, 2),
    report_mos: round(valuation.margin_of_safety_required, 2),
    screen_tier: screenResult?.tier || null,
    screen_pass_count: screenResult?.pass_count || null,
    current_price: round(currentPrice, 2),
    pct_from_buy_below: round(pctFromBuyBelow, 1),
    confidence_band: confidenceBand,
    status,
    status_detail: statusDetail,
    pb_warning: pbWarning,
    pexb_warning: pexbWarning,
  });
}

/**
 * Re-screen mode: pull live price, recompute P/B from EDGAR BVPS,
 * re-run Layer 1 screening and Layer 2 valuation with live data.
 * Read-only — does not write to DB.
 *
 * Full mode: same as re-screen + triggers new attractor analysis.
 */
async function handleRescreen(ticker, mode, env, jsonResponse, errorResponse) {
  // Fetch live quote
  const quote = await fetchQuote(ticker);
  if (!quote || quote.price == null) {
    return errorResponse(`Could not fetch live quote for ${ticker}`, 502);
  }
  const livePrice = quote.price;

  // Load stock record
  const stock = await env.DB.prepare('SELECT * FROM stocks WHERE ticker = ?').bind(ticker).first();
  if (!stock) return errorResponse(`Stock ${ticker} not found`, 404);

  // Load financials
  const financials = await getFinancialsForTicker(env.DB, ticker);
  if (financials.length < 3) {
    return errorResponse(`Insufficient financial data for ${ticker} (${financials.length} years)`, 422);
  }

  // Load stored market data for P/E (can't recompute P/E without live EPS)
  const storedMarket = await env.DB.prepare(
    'SELECT * FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  // Compute live P/B from EDGAR BVPS
  const latestFin = financials[0];
  let livePB = storedMarket?.pb_ratio;
  let pbSource = 'stored';
  if (latestFin?.book_value_per_share > 0) {
    livePB = livePrice / latestFin.book_value_per_share;
    pbSource = 'edgar_bvps';
  }

  // Use stored P/E (TTM EPS doesn't change intraday)
  const livePE = storedMarket?.pe_ratio;

  // Build ephemeral market data for screening
  const liveMarketData = {
    ...storedMarket,
    ticker,
    price: livePrice,
    pb_ratio: livePB,
    pe_ratio: livePE,
  };

  // Recompute P/E and P/B from EDGAR if available
  if (latestFin?.eps > 0) {
    liveMarketData.pe_ratio = livePrice / latestFin.eps;
  }

  // Get bond yield and sector thresholds
  let bondYield;
  try {
    bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
  } catch {
    bondYield = { yield: 5.0 };
  }

  // Reuse stored sector P/B thresholds
  const storedScreen = await env.DB.prepare(
    'SELECT sector_pb_threshold FROM screen_results WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1'
  ).bind(ticker).first();
  const sectorPBThresholds = {};
  if (storedScreen?.sector_pb_threshold && stock.sector) {
    sectorPBThresholds[stock.sector] = storedScreen.sector_pb_threshold;
  }

  // Run Layer 1 screening with live data
  const liveScreen = runLayer1Screen(stock, financials, liveMarketData, {
    aaa_bond_yield: bondYield?.yield,
    sector_pb_thresholds: sectorPBThresholds,
  });

  // Run Layer 2 valuation
  const attractorData = await env.DB.prepare(
    'SELECT attractor_stability_score, network_regime FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
  ).bind(ticker).first();
  const screenInfo = { tier: liveScreen.tier, miss_severity: liveScreen.miss_severity };

  let economicEnvironment = null;
  try {
    if (env.FRED_API_KEY) {
      const snapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
      economicEnvironment = snapshot?.environment || null;
    }
  } catch { /* ignore */ }

  const liveValuation = calculateGrahamValuation(
    financials, liveMarketData, bondYield?.yield, attractorData, screenInfo, economicEnvironment
  );

  // Determine live signal
  let liveSignal = 'NO_SIGNAL';
  let confidenceBand = null;
  if (liveValuation && liveScreen.tier !== 'fail') {
    if (livePrice <= liveValuation.buy_below_price) {
      liveSignal = liveScreen.tier === 'near_miss' ? 'BUY (NEAR MISS)' : 'BUY';
      confidenceBand = livePrice <= liveValuation.buy_below_price * 0.90 ? 'STRONG' : 'STANDARD';
    } else if (livePrice <= liveValuation.buy_below_price * 1.05) {
      liveSignal = 'MARGINAL';
      confidenceBand = 'MARGINAL';
    } else if (liveValuation.discount_to_iv_pct > 0) {
      liveSignal = 'WAIT';
    } else {
      liveSignal = 'OVERVALUED';
    }
  }

  // Compare to stored
  const storedValuation = await env.DB.prepare(
    'SELECT * FROM valuations WHERE ticker = ?'
  ).bind(ticker).first();
  const storedScreenResult = await env.DB.prepare(
    'SELECT tier, pass_count FROM screen_results WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1'
  ).bind(ticker).first();

  const result = {
    mode,
    ticker,
    live_price: round(livePrice, 2),
    live_pb: round(livePB, 2),
    pb_source: pbSource,
    live_pe: round(liveMarketData.pe_ratio, 1),
    pe_source: latestFin?.eps > 0 ? 'edgar_eps' : 'stored',
    live_screen: {
      tier: liveScreen.tier,
      pass_count: liveScreen.pass_count,
      roe_5yr_avg: liveScreen.roe_5yr_avg,
      pe_x_pb_ceiling: liveScreen.pe_x_pb_ceiling_used,
    },
    live_valuation: liveValuation ? {
      intrinsic_value: round(liveValuation.adjusted_intrinsic_value, 2),
      buy_below: round(liveValuation.buy_below_price, 2),
      margin_of_safety: round(liveValuation.margin_of_safety_required, 2),
      discount_to_iv: round(liveValuation.discount_to_iv_pct, 1),
    } : null,
    live_signal: liveSignal,
    confidence_band: confidenceBand,
    economic_environment: economicEnvironment,
    vs_stored: {
      tier_changed: storedScreenResult?.tier !== liveScreen.tier,
      stored_tier: storedScreenResult?.tier || null,
      stored_pass_count: storedScreenResult?.pass_count || null,
      signal_changed: storedValuation ? (
        (storedValuation.buy_below_price && storedMarket?.price <= storedValuation.buy_below_price) !== (liveSignal.startsWith('BUY'))
      ) : null,
      stored_buy_below: storedValuation?.buy_below_price ? round(storedValuation.buy_below_price, 2) : null,
    },
  };

  // Full mode: also run attractor analysis
  if (mode === 'full') {
    try {
      const { runSingleAnalysis } = await import('../services/analysisRunner.js');
      const analysisResult = await runSingleAnalysis(env, ticker);
      result.attractor_refresh = {
        score: analysisResult.analysis?.attractor_stability_score,
        adjusted_score: analysisResult.analysis?.adjusted_attractor_score,
        network_regime: analysisResult.analysis?.network_regime,
        message: analysisResult.message,
      };
    } catch (err) {
      result.attractor_refresh = { error: err.message };
    }
  }

  return jsonResponse(result);
}

function round(n, decimals) {
  if (n == null) return null;
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
