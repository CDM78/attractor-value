import { getDynamicPECeiling } from '../services/screeningEngine.js';
import { getFinancialsForTicker } from '../db/queries.js';
import { SCREEN_DEFAULTS, VALUATION, MARGIN_OF_SAFETY, FAT_TAIL, ATTRACTOR } from '../../../shared/constants.js';

export async function reportRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return errorResponse('ticker parameter required', 400);

  // Gather all data
  const stock = await env.DB.prepare('SELECT * FROM stocks WHERE ticker = ?').bind(ticker).first();
  if (!stock) return errorResponse('Stock not found', 404);

  const marketData = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(ticker).first();
  const valuation = await env.DB.prepare('SELECT * FROM valuations WHERE ticker = ?').bind(ticker).first();
  const financials = await getFinancialsForTicker(env.DB, ticker);

  const screenResult = await env.DB.prepare(
    'SELECT * FROM screen_results WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1'
  ).bind(ticker).first();

  const analysis = await env.DB.prepare(
    'SELECT * FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
  ).bind(ticker).first();

  const cr = await env.DB.prepare(
    'SELECT * FROM concentration_risk WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
  ).bind(ticker).first();

  const insiderSignal = await env.DB.prepare(
    'SELECT * FROM insider_signals WHERE ticker = ?'
  ).bind(ticker).first();

  const bondRow = await env.DB.prepare(
    "SELECT price, fetched_at FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
  ).first();
  const aaaBondYield = bondRow?.price || null;
  const dynamicPECeiling = aaaBondYield != null ? getDynamicPECeiling(aaaBondYield) : 15;

  // Determine signal
  let signal = 'NO SIGNAL';
  let signalRationale = '';
  const isFullPass = screenResult?.passes_all_hard || screenResult?.tier === 'full_pass';
  const isNearMiss = screenResult?.tier === 'near_miss';
  const hasValuation = valuation?.buy_below_price != null && marketData?.price != null;
  const attractorScore = analysis?.attractor_stability_score;
  const isDissolvingAttractor = attractorScore != null && attractorScore < 2.0;
  const isTransitional = attractorScore != null && attractorScore >= 2.0 && attractorScore < 3.5;

  if (isDissolvingAttractor) {
    signal = 'DO NOT BUY';
    signalRationale = `Attractor score ${attractorScore.toFixed(1)} is below 2.0 (dissolving). The framework prohibits buying stocks with dissolving competitive positions.`;
  } else if (isFullPass && hasValuation) {
    if (marketData.price <= valuation.buy_below_price) {
      if (isTransitional) {
        signal = 'BUY (TRANSITIONAL)';
        signalRationale = `Current price ($${marketData.price.toFixed(2)}) is below the buy-below price ($${valuation.buy_below_price.toFixed(2)}), representing a ${valuation.discount_to_iv_pct?.toFixed(1)}% discount to adjusted intrinsic value. A ${(valuation.margin_of_safety_required * 100).toFixed(0)}% margin of safety has been applied due to transitional attractor score (${attractorScore?.toFixed(1)}). Monitor attractor score quarterly — if it drops below 2.0, the sell discipline requires immediate exit.`;
      } else {
        signal = 'BUY';
        signalRationale = `Current price ($${marketData.price.toFixed(2)}) is below the buy-below price ($${valuation.buy_below_price.toFixed(2)}), representing a ${valuation.discount_to_iv_pct?.toFixed(1)}% discount to adjusted intrinsic value with a ${(valuation.margin_of_safety_required * 100).toFixed(0)}% margin of safety.`;
      }
    } else if (valuation.discount_to_iv_pct > 0) {
      signal = 'WAIT';
      signalRationale = `Stock is undervalued (${valuation.discount_to_iv_pct?.toFixed(1)}% discount to IV) but has not reached the buy-below price ($${valuation.buy_below_price.toFixed(2)}).`;
    } else {
      signal = 'OVERVALUED';
      signalRationale = `Stock is trading above intrinsic value.`;
    }
  } else if (isNearMiss && hasValuation) {
    if (marketData.price <= valuation.buy_below_price) {
      if (isTransitional) {
        signal = 'BUY (NEAR MISS — TRANSITIONAL)';
      } else {
        signal = 'BUY (NEAR MISS)';
      }
      signalRationale = `Near miss (${screenResult.pass_count}/8 filters, failed ${formatFilterName(screenResult.failed_filter)}). Price ($${marketData.price.toFixed(2)}) is below buy-below ($${valuation.buy_below_price.toFixed(2)}) with ${(valuation.margin_of_safety_required * 100).toFixed(0)}% margin of safety.`;
    } else if (valuation.discount_to_iv_pct > 0) {
      signal = 'WAIT';
      signalRationale = `Near miss — undervalued but above buy-below price.`;
    } else {
      signal = 'OVERVALUED';
      signalRationale = `Near miss — trading above intrinsic value.`;
    }
  }

  // Build report
  const report = buildReport({
    stock, marketData, valuation, financials, screenResult,
    analysis, cr, insiderSignal,
    aaaBondYield, dynamicPECeiling, signal, signalRationale,
  });

  // Return as JSON with markdown content
  return jsonResponse({ ticker, signal, report });
}

function buildReport(d) {
  const {
    stock, marketData, valuation, financials, screenResult,
    analysis, cr, insiderSignal,
    aaaBondYield, dynamicPECeiling, signal, signalRationale,
  } = d;

  const now = new Date().toISOString().split('T')[0];
  const lines = [];

  // Header
  lines.push(`# Investment Research Report: ${stock.company_name} (${stock.ticker})`);
  lines.push(`**Generated:** ${now}  `);
  lines.push(`**Framework:** Attractor Value Framework  `);
  lines.push(`**Signal:** ${signal}`);
  lines.push('');

  // Executive Summary
  lines.push('---');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`**${stock.company_name}** (${stock.ticker}) operates in the ${stock.sector || 'Unknown'} sector (${stock.industry || stock.sector || 'Unknown'}).`);
  lines.push('');
  if (signalRationale) lines.push(signalRationale);
  lines.push('');

  if (analysis) {
    const classification = analysis.attractor_stability_score >= 3.5 ? 'Stable Attractor'
      : analysis.attractor_stability_score >= 2.0 ? 'Transitional' : 'Dissolving';
    lines.push(`The company has been assessed as a **${classification}** with an attractor stability score of **${analysis.attractor_stability_score?.toFixed(1)}/5.0** under a **${formatRegime(analysis.network_regime)}** competitive regime.`);
    lines.push('');
  }

  // Market Data
  lines.push('---');
  lines.push('## Current Market Data');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Price | $${marketData?.price?.toFixed(2) || 'N/A'} |`);
  lines.push(`| P/E Ratio | ${marketData?.pe_ratio?.toFixed(1) || 'N/A'} |`);
  lines.push(`| P/B Ratio | ${marketData?.pb_ratio?.toFixed(1) || 'N/A'} |`);
  lines.push(`| P/E x P/B | ${marketData?.pe_ratio && marketData?.pb_ratio ? (marketData.pe_ratio * marketData.pb_ratio).toFixed(1) : 'N/A'} |`);
  lines.push(`| Earnings Yield | ${marketData?.earnings_yield ? (marketData.earnings_yield * 100).toFixed(1) + '%' : (marketData?.pe_ratio ? (100 / marketData.pe_ratio).toFixed(1) + '%' : 'N/A')} |`);
  lines.push(`| Dividend Yield | ${marketData?.dividend_yield ? marketData.dividend_yield.toFixed(2) + '%' : 'N/A'} |`);
  lines.push(`| Market Cap | ${stock.market_cap ? '$' + (stock.market_cap / 1e9).toFixed(1) + 'B' : 'N/A'} |`);
  lines.push(`| Sector | ${stock.sector || 'N/A'} |`);
  lines.push(`| Industry | ${stock.industry || 'N/A'} |`);
  lines.push('');

  // Layer 1: Screening
  lines.push('---');
  lines.push('## Layer 1: Quantitative Screening');
  lines.push('');
  if (screenResult) {
    lines.push(`**Tier:** ${screenResult.tier === 'full_pass' ? 'Full Pass (8/8)' : screenResult.tier === 'near_miss' ? `Near Miss (${screenResult.pass_count}/8)` : `Fail (${screenResult.pass_count}/8)`}  `);
    lines.push(`**Screen Date:** ${screenResult.screen_date}`);
    lines.push('');
    lines.push('| Filter | Result | Details |');
    lines.push('|--------|--------|---------|');
    lines.push(`| P/E (dynamic) | ${screenResult.passes_pe ? 'PASS' : 'FAIL'} | P/E ${marketData?.pe_ratio?.toFixed(1) || '?'} vs ceiling ${dynamicPECeiling.toFixed(1)} (AAA yield ${aaaBondYield?.toFixed(2) || '?'}% + 1.5% premium) |`);
    lines.push(`| P/B (sector-relative) | ${screenResult.passes_pb ? 'PASS' : 'FAIL'} | P/B ${marketData?.pb_ratio?.toFixed(1) || '?'} vs sector threshold ${screenResult.sector_pb_threshold?.toFixed(2) || '?'} (${stock.sector || 'Unknown'} 33rd pctile, backstop 5.0) |`);
    lines.push(`| P/E x P/B | ${screenResult.passes_pe_x_pb ? 'PASS' : 'FAIL'} | ${marketData?.pe_ratio && marketData?.pb_ratio ? (marketData.pe_ratio * marketData.pb_ratio).toFixed(1) : '?'} vs max 22.5 |`);
    lines.push(`| Debt/Equity | ${screenResult.passes_debt_equity ? 'PASS' : 'FAIL'} | ${getDebtEquity(financials)} |`);
    lines.push(`| Current Ratio | ${screenResult.passes_current_ratio ? 'PASS' : 'FAIL'} | ${getCurrentRatio(financials)} |`);
    lines.push(`| Earnings Stability | ${screenResult.passes_earnings_stability ? 'PASS' : 'FAIL'} | ${getEarningsStability(financials)} |`);
    lines.push(`| Dividend Record | ${screenResult.passes_dividend_record ? 'PASS' : 'FAIL'} | ${getDividendRecord(financials)} |`);
    lines.push(`| Earnings Growth | ${screenResult.passes_earnings_growth ? 'PASS' : 'FAIL'} | ${getEarningsGrowth(financials)} |`);
    lines.push('');

    if (screenResult.tier === 'near_miss' && screenResult.failed_filter) {
      lines.push(`**Near-Miss Detail:** Failed on ${formatFilterName(screenResult.failed_filter)} — actual: ${screenResult.actual_value?.toFixed(2) || '?'} vs threshold: ${screenResult.threshold_value?.toFixed(2) || '?'} (${screenResult.miss_severity || 'unknown'} miss)`);
      lines.push('');
    }

    // Soft filters
    lines.push('**Soft Filters (informational):**');
    lines.push(`- Free Cash Flow: ${screenResult.passes_fcf ? 'PASS' : 'FAIL'} (positive in 7+ of 10 years)`);
    lines.push(`- Insider Ownership: ${screenResult.passes_insider_ownership ? 'PASS' : 'FAIL'} (>= 5%: ${marketData?.insider_ownership_pct?.toFixed(1) || '?'}%)`);
    lines.push(`- Share Dilution: ${screenResult.passes_dilution == null ? 'N/A' : screenResult.passes_dilution ? 'PASS' : 'FAIL'} (<= 2% annual)`);
    lines.push('');
  } else {
    lines.push('No screening data available for this stock.');
    lines.push('');
  }

  // Layer 2: Valuation
  lines.push('---');
  lines.push('## Layer 2: Graham Valuation');
  lines.push('');
  if (valuation) {
    lines.push('### Formula');
    lines.push('```');
    lines.push('Intrinsic Value = EPS_normalized x (8.5 + 2g) x (4.4 / Y)');
    lines.push('```');
    lines.push('');
    lines.push('### Inputs');
    lines.push(`| Parameter | Value | Source |`);
    lines.push(`|-----------|-------|--------|`);
    lines.push(`| Normalized EPS (3yr avg) | $${valuation.normalized_eps?.toFixed(2)} | Average of ${financials.length >= 3 ? financials.slice(0, 3).map(f => f.fiscal_year).join(', ') : '?'} |`);
    lines.push(`| Estimated Growth Rate (g) | ${valuation.estimated_growth_rate?.toFixed(2)}% | CAGR first-3 to last-3 year EPS, capped at 7% |`);
    lines.push(`| AAA Bond Yield (Y) | ${valuation.aaa_bond_yield?.toFixed(2)}% | Moody's AAA Corporate via FRED |`);
    lines.push(`| Graham Base P/E | 8.5 | Zero-growth company baseline |`);
    lines.push(`| Growth Multiplier | 2x | Graham's original multiplier |`);
    lines.push(`| Base Bond Yield | 4.4% | 1962 AAA benchmark |`);
    lines.push('');
    lines.push('### Calculation');
    lines.push('```');
    lines.push(`IV = $${valuation.normalized_eps?.toFixed(2)} x (8.5 + 2 x ${valuation.estimated_growth_rate?.toFixed(2)}) x (4.4 / ${valuation.aaa_bond_yield?.toFixed(2)})`);
    lines.push(`   = $${valuation.normalized_eps?.toFixed(2)} x ${(8.5 + 2 * valuation.estimated_growth_rate).toFixed(2)} x ${(4.4 / valuation.aaa_bond_yield).toFixed(4)}`);
    lines.push(`   = $${valuation.graham_intrinsic_value?.toFixed(2)}`);
    lines.push('```');
    lines.push('');
    lines.push('### Adjustments');
    lines.push(`| Adjustment | Value | Rationale |`);
    lines.push(`|------------|-------|-----------|`);
    lines.push(`| Fat-Tail Discount | ${(valuation.fat_tail_discount * 100).toFixed(0)}% | ${valuation.fat_tail_discount === 0 ? 'Resilient (10+ years, 0-1 negative EPS years)' : valuation.fat_tail_discount >= 0.15 ? 'High volatility (4+ negative EPS years)' : valuation.fat_tail_discount >= 0.10 ? 'Moderate volatility or untested' : 'Unknown'} |`);
    lines.push(`| Adjusted IV | $${valuation.adjusted_intrinsic_value?.toFixed(2)} | IV x (1 - ${(valuation.fat_tail_discount * 100).toFixed(0)}%) |`);
    lines.push(`| Margin of Safety | ${(valuation.margin_of_safety_required * 100).toFixed(0)}% | ${getMarginRationale(valuation, analysis)} |`);
    lines.push(`| **Buy-Below Price** | **$${valuation.buy_below_price?.toFixed(2)}** | Adjusted IV x (1 - ${(valuation.margin_of_safety_required * 100).toFixed(0)}%) |`);
    lines.push('');
    lines.push('### Valuation Summary');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Graham Intrinsic Value | $${valuation.graham_intrinsic_value?.toFixed(2)} |`);
    lines.push(`| Adjusted Intrinsic Value | $${valuation.adjusted_intrinsic_value?.toFixed(2)} |`);
    lines.push(`| Buy-Below Price | $${valuation.buy_below_price?.toFixed(2)} |`);
    lines.push(`| Current Price | $${marketData?.price?.toFixed(2) || 'N/A'} |`);
    lines.push(`| Discount to IV | ${valuation.discount_to_iv_pct?.toFixed(1)}% |`);
    lines.push(`| Price vs Buy-Below | ${marketData?.price <= valuation.buy_below_price ? 'BELOW (actionable)' : 'ABOVE (wait)'} |`);
    lines.push('');
  } else {
    lines.push('No valuation data available. Requires at least 3 years of EPS history.');
    lines.push('');
  }

  // Layer 3: Attractor Analysis
  lines.push('---');
  lines.push('## Layer 3: Attractor Stability Analysis');
  lines.push('');
  if (analysis) {
    const classification = analysis.attractor_stability_score >= 3.5 ? 'Stable Attractor'
      : analysis.attractor_stability_score >= 2.0 ? 'Transitional' : 'Dissolving';
    lines.push(`**Classification:** ${classification}  `);
    lines.push(`**Composite Score:** ${analysis.attractor_stability_score?.toFixed(1)}/5.0  `);
    lines.push(`**Network Regime:** ${formatRegime(analysis.network_regime)}  `);
    lines.push(`**Analysis Date:** ${analysis.analysis_date}`);
    lines.push('');

    lines.push('### Factor Scores');
    lines.push('| Factor | Score | Rating |');
    lines.push('|--------|-------|--------|');
    lines.push(`| Revenue Durability | ${analysis.revenue_durability_score}/5 | ${ratingWord(analysis.revenue_durability_score)} |`);
    lines.push(`| Competitive Reinforcement | ${analysis.competitive_reinforcement_score}/5 | ${ratingWord(analysis.competitive_reinforcement_score)} |`);
    lines.push(`| Industry Structure | ${analysis.industry_structure_score}/5 | ${ratingWord(analysis.industry_structure_score)} |`);
    lines.push(`| Demand Feedback | ${analysis.demand_feedback_score}/5 | ${ratingWord(analysis.demand_feedback_score)} |`);
    lines.push(`| Adaptation Capacity | ${analysis.adaptation_capacity_score}/5 | ${ratingWord(analysis.adaptation_capacity_score)} |`);
    lines.push(`| Capital Allocation | ${analysis.capital_allocation_score}/5 | ${ratingWord(analysis.capital_allocation_score)} |`);
    lines.push('');

    lines.push('### AI Analysis');
    lines.push('');
    lines.push(analysis.analysis_text || 'No analysis text available.');
    lines.push('');

    // Red flags
    let redFlags = analysis.red_flags;
    if (typeof redFlags === 'string') {
      try { redFlags = JSON.parse(redFlags); } catch { redFlags = [redFlags]; }
    }
    if (Array.isArray(redFlags) && redFlags.length > 0) {
      lines.push('### Red Flags');
      for (const flag of redFlags) {
        lines.push(`- ${flag}`);
      }
      lines.push('');
    } else {
      lines.push('### Red Flags');
      lines.push('No red flags identified.');
      lines.push('');
    }

    // Concentration risk
    if (cr) {
      lines.push('### Concentration Risk');
      lines.push(`| Risk Type | Assessment | Penalty |`);
      lines.push(`|-----------|------------|---------|`);
      lines.push(`| Customer | ${cr.largest_customer_pct ? cr.largest_customer_pct + '% (' + (cr.largest_customer_name || 'undisclosed') + ')' : 'Low / diversified'} | ${cr.largest_customer_pct >= 40 ? '-1.0' : cr.largest_customer_pct >= 25 ? '-0.5' : '0'} |`);
      lines.push(`| Supplier | ${cr.single_source_supplier ? (cr.supplier_details || 'Single source identified') : 'Diversified'} | ${cr.single_source_supplier ? '-0.5' : '0'} |`);
      lines.push(`| Geographic | ${cr.largest_geo_market_pct ? cr.largest_geo_market_pct + '% (' + (cr.largest_geo_market_name || 'undisclosed') + ')' : 'Diversified'} | ${cr.largest_geo_market_pct >= 70 ? '-0.3' : '0'} |`);
      lines.push(`| Regulatory | ${cr.regulatory_dependency_pct ? cr.regulatory_dependency_pct + '% — ' + (cr.regulatory_details || '') : 'Low'} | ${cr.regulatory_dependency_pct >= 50 ? '-0.5' : '0'} |`);
      lines.push(`| **Total Penalty** | | **-${cr.concentration_penalty?.toFixed(1) || '0'}** |`);
      lines.push('');
    }
  } else {
    lines.push('No attractor analysis has been performed. Run analysis from the stock detail page.');
    lines.push('');
  }

  // Insider Signals
  lines.push('---');
  lines.push('## Insider Activity');
  lines.push('');
  if (insiderSignal) {
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Signal | ${insiderSignal.signal || 'neutral'} |`);
    lines.push(`| 90-Day Buys | ${insiderSignal.trailing_90d_buys || 0} transactions ($${((insiderSignal.trailing_90d_buy_value || 0) / 1000).toFixed(0)}K) |`);
    lines.push(`| 90-Day Sells | ${insiderSignal.trailing_90d_sells || 0} transactions ($${((insiderSignal.trailing_90d_sell_value || 0) / 1000).toFixed(0)}K) |`);
    lines.push(`| Unique Buyers (90d) | ${insiderSignal.unique_buyers_90d || 0} |`);
    lines.push(`| Signal Date | ${insiderSignal.signal_date} |`);
    if (insiderSignal.signal_details) lines.push(`\n${insiderSignal.signal_details}`);
    lines.push('');
  } else {
    lines.push('No insider transaction data available.');
    lines.push('');
  }

  // Financial History
  lines.push('---');
  lines.push('## Financial History');
  lines.push('');
  if (financials.length > 0) {
    lines.push('| Year | EPS | Revenue | FCF | D/E | BVPS | ROIC | Div |');
    lines.push('|------|-----|---------|-----|-----|------|------|-----|');
    for (const f of financials) {
      lines.push(`| ${f.fiscal_year} | $${f.eps?.toFixed(2) || '?'} | ${f.revenue ? '$' + (f.revenue / 1e9).toFixed(1) + 'B' : '?'} | ${f.free_cash_flow ? '$' + (f.free_cash_flow / 1e6).toFixed(0) + 'M' : '?'} | ${f.shareholder_equity > 0 ? (f.total_debt / f.shareholder_equity).toFixed(2) : '?'} | $${f.book_value_per_share?.toFixed(2) || '?'} | ${f.roic ? (f.roic * 100).toFixed(1) + '%' : '?'} | ${f.dividend_paid ? 'Yes' : 'No'} |`);
    }
    lines.push('');
  } else {
    lines.push('No financial history available.');
    lines.push('');
  }

  // Conclusion
  lines.push('---');
  lines.push('## Conclusion');
  lines.push('');
  lines.push(`**Signal: ${signal}**`);
  lines.push('');
  if (signal === 'BUY') {
    lines.push(`${stock.company_name} passes all 8 quantitative hard filters, has a Graham intrinsic value of $${valuation?.adjusted_intrinsic_value?.toFixed(2)} (after ${(valuation?.fat_tail_discount * 100).toFixed(0)}% fat-tail discount), and is currently trading at $${marketData?.price?.toFixed(2)} — a ${valuation?.discount_to_iv_pct?.toFixed(1)}% discount to adjusted intrinsic value. With a ${(valuation?.margin_of_safety_required * 100).toFixed(0)}% margin of safety applied, the buy-below price is $${valuation?.buy_below_price?.toFixed(2)}, and the current price is below this threshold.`);
    if (analysis) {
      lines.push('');
      lines.push(`The attractor stability analysis scores the company at ${analysis.attractor_stability_score?.toFixed(1)}/5.0 (${analysis.attractor_stability_score >= 3.5 ? 'Stable' : 'Transitional'}), operating under a ${formatRegime(analysis.network_regime)} competitive regime.`);
    }
  } else if (signal === 'WAIT') {
    lines.push(`The stock is undervalued but has not reached the required buy-below price. Monitor for price decline to $${valuation?.buy_below_price?.toFixed(2)} or below.`);
  } else if (signal === 'REVIEW') {
    lines.push(`Near miss — passes ${screenResult?.pass_count}/8 filters. Manual review of the failed filter (${formatFilterName(screenResult?.failed_filter)}) is recommended before proceeding.`);
  }
  lines.push('');
  lines.push('---');
  lines.push('*This report was generated by the Attractor Value Framework. It is not financial advice. All investment decisions should be made with independent research and professional consultation.*');

  return lines.join('\n');
}

// Helper functions
function getDebtEquity(financials) {
  if (!financials.length) return 'No data';
  const f = financials[0];
  if (!f.shareholder_equity || f.shareholder_equity <= 0) return 'N/A (no equity)';
  const de = f.total_debt / f.shareholder_equity;
  return `${de.toFixed(2)} (${f.fiscal_year})`;
}

function getCurrentRatio(financials) {
  if (!financials.length) return 'No data';
  const f = financials[0];
  if (!f.current_liabilities || f.current_liabilities <= 0) return 'N/A';
  const cr = f.current_assets / f.current_liabilities;
  return `${cr.toFixed(2)} (${f.fiscal_year})`;
}

function getEarningsStability(financials) {
  const positive = financials.filter(f => f.eps > 0).length;
  return `${positive} positive of ${financials.length} years`;
}

function getDividendRecord(financials) {
  const recent5 = financials.slice(0, 5);
  const consecutive = recent5.filter(f => f.dividend_paid).length;
  return `${consecutive}/5 recent years paid`;
}

function getEarningsGrowth(financials) {
  if (financials.length < 6) return `Insufficient data (${financials.length} years)`;
  const last3 = financials.slice(0, 3);
  const first3 = financials.slice(-3);
  const avgLast = last3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
  const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
  if (avgFirst <= 0) return 'N/A (negative base EPS)';
  const years = financials.length - 3; // midpoint-to-midpoint span
  const growth = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
  return `${growth.toFixed(1)}% CAGR over ${years} years`;
}

function getMarginRationale(valuation, analysis) {
  if (!analysis) return 'Default 25% (no attractor analysis)';
  if (analysis.attractor_stability_score >= 3.5) {
    if (analysis.network_regime === 'hard_network') return 'Stable + hard network = 40%';
    return 'Stable attractor = 25%';
  }
  return 'Transitional = 40%';
}

function formatFilterName(name) {
  const names = {
    pe: 'P/E', pb: 'P/B', pe_x_pb: 'P/E x P/B', debt_equity: 'Debt/Equity',
    current_ratio: 'Current Ratio', earnings_stability: 'Earnings Stability',
    dividend_record: 'Dividend Record', earnings_growth: 'Earnings Growth',
  };
  return names[name] || name || 'Unknown';
}

function formatRegime(regime) {
  const map = { classical: 'Classical', soft_network: 'Soft Network', hard_network: 'Hard Network', platform: 'Platform' };
  return map[regime] || regime || 'Unknown';
}

function ratingWord(score) {
  if (score >= 5) return 'Excellent';
  if (score >= 4) return 'Strong';
  if (score >= 3) return 'Adequate';
  if (score >= 2) return 'Weak';
  return 'Poor';
}
