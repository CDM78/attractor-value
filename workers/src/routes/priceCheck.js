import { fetchQuote } from '../services/yahooFinance.js';
import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

/**
 * Price Check Mode — lightweight re-screen that answers
 * "is my existing BUY signal still valid right now?"
 *
 * Pulls current price and P/B, compares against stored report data.
 * One Yahoo Finance API call per check.
 *
 * GET /api/price-check?ticker=CB
 */
export async function priceCheckRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) return errorResponse('ticker parameter required', 400);

  // Load stored valuation and screening data
  const valuation = await env.DB.prepare(
    'SELECT buy_below_price, adjusted_intrinsic_value, margin_of_safety_required, calculated_at FROM valuations WHERE ticker = ?'
  ).bind(ticker).first();

  if (!valuation || !valuation.buy_below_price) {
    return errorResponse(`No valuation data for ${ticker}. Generate a report first.`, 404);
  }

  const screenResult = await env.DB.prepare(
    'SELECT tier, pass_count, screen_date, sector_pb_threshold FROM screen_results WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1'
  ).bind(ticker).first();

  const storedMarket = await env.DB.prepare(
    'SELECT pb_ratio, pe_ratio, price, fetched_at FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();

  // Fetch live quote
  const quote = await fetchQuote(ticker);
  if (!quote || quote.price == null) {
    return errorResponse(`Could not fetch live quote for ${ticker}`, 502);
  }

  const currentPrice = quote.price;
  const buyBelow = valuation.buy_below_price;
  const pctFromBuyBelow = ((currentPrice - buyBelow) / buyBelow) * 100;

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

  // Check P/B drift if we have stored P/B data
  let pbWarning = null;
  if (storedMarket?.pb_ratio && screenResult?.sector_pb_threshold) {
    const storedPB = storedMarket.pb_ratio;
    const pbThreshold = Math.min(screenResult.sector_pb_threshold, SCREEN_DEFAULTS.pb_absolute_backstop);
    const pbPassed = storedPB <= pbThreshold;

    // Estimate current P/B: scale stored P/B by price change
    if (storedMarket.price && storedMarket.price > 0) {
      const estimatedPB = storedPB * (currentPrice / storedMarket.price);
      const estimatedPBPassed = estimatedPB <= pbThreshold;

      if (pbPassed && !estimatedPBPassed) {
        pbWarning = {
          message: 'P/B filter may now FAIL due to price increase',
          report_pb: round(storedPB, 2),
          estimated_current_pb: round(estimatedPB, 2),
          threshold: round(pbThreshold, 2),
          recommendation: 'Re-run full report to confirm signal',
        };
      } else if (!pbPassed && estimatedPBPassed) {
        pbWarning = {
          message: 'P/B filter may now PASS due to price decrease',
          report_pb: round(storedPB, 2),
          estimated_current_pb: round(estimatedPB, 2),
          threshold: round(pbThreshold, 2),
          recommendation: 'Re-run full report — screening result may have improved',
        };
      }
    }
  }

  // Check P/E × P/B drift
  let pexbWarning = null;
  if (storedMarket?.pe_ratio && storedMarket?.pb_ratio && storedMarket?.price > 0) {
    const storedPExPB = storedMarket.pe_ratio * storedMarket.pb_ratio;
    const estimatedPB = storedMarket.pb_ratio * (currentPrice / storedMarket.price);
    const estimatedPExPB = storedMarket.pe_ratio * estimatedPB;

    if (storedPExPB <= SCREEN_DEFAULTS.pe_x_pb_max && estimatedPExPB > SCREEN_DEFAULTS.pe_x_pb_max) {
      pexbWarning = {
        message: `P/E × P/B may now exceed ceiling of ${SCREEN_DEFAULTS.pe_x_pb_max}`,
        report_pexb: round(storedPExPB, 1),
        estimated_current_pexb: round(estimatedPExPB, 1),
        recommendation: 'Re-run full report to confirm',
      };
    }
  }

  const result = {
    ticker,
    report_date: valuation.calculated_at?.split('T')[0] || screenResult?.screen_date || null,
    report_buy_below: round(buyBelow, 2),
    report_intrinsic_value: round(valuation.adjusted_intrinsic_value, 2),
    report_mos: round(valuation.margin_of_safety_required, 2),
    screen_tier: screenResult?.tier || null,
    screen_pass_count: screenResult?.pass_count || null,
    current_price: round(currentPrice, 2),
    pct_from_buy_below: round(pctFromBuyBelow, 1),
    status,
    status_detail: statusDetail,
    pb_warning: pbWarning,
    pexb_warning: pexbWarning,
  };

  return jsonResponse(result);
}

function round(n, decimals) {
  if (n == null) return null;
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
