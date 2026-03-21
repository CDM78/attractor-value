import { getDynamicPECeiling } from '../services/screeningEngine.js';
import { getFinancialsForTicker } from '../db/queries.js';
import { SCREEN_DEFAULTS, VALUATION, MARGIN_OF_SAFETY, FAT_TAIL, ATTRACTOR } from '../../../shared/constants.js';
import { isFinancialSector } from '../../../shared/sectorUtils.js';
import { getOrFetchEconomicSnapshot, formatEconomicEnvironmentSection } from '../services/fred.js';

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

  const secularDisruption = await env.DB.prepare(
    'SELECT * FROM secular_disruption WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
  ).bind(ticker).first();

  const insiderSignal = await env.DB.prepare(
    'SELECT * FROM insider_signals WHERE ticker = ?'
  ).bind(ticker).first();

  const bondRow = await env.DB.prepare(
    "SELECT price, fetched_at FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
  ).first();
  const aaaBondYield = bondRow?.price || null;
  const dynamicPECeiling = aaaBondYield != null ? getDynamicPECeiling(aaaBondYield) : 15;

  // Fetch economic snapshot for environment section
  let economicSnapshot = null;
  try {
    if (env.FRED_API_KEY) {
      economicSnapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
    }
  } catch (err) {
    console.error('Economic snapshot fetch failed:', err.message);
  }

  // Determine signal — use adjusted_attractor_score (includes secular disruption modifier) when available
  let signal = 'NO SIGNAL';
  let signalRationale = '';
  const isFullPass = screenResult?.passes_all_hard || screenResult?.tier === 'full_pass';
  const isNearMiss = screenResult?.tier === 'near_miss';
  const hasValuation = valuation?.buy_below_price != null && marketData?.price != null;
  const attractorScore = analysis?.adjusted_attractor_score ?? analysis?.attractor_stability_score;
  const isDissolvingAttractor = attractorScore != null && attractorScore < 2.0;
  const isTransitional = attractorScore != null && attractorScore >= 2.0 && attractorScore < 3.5;

  // Tech sector mandatory disruption gate (Update 7, Section 3.1)
  const isTechSector = ['Technology', 'Information Technology'].includes(stock.sector);
  const hasMandatoryDisruptionCheck = isTechSector && !secularDisruption;

  if (hasMandatoryDisruptionCheck && (isFullPass || isNearMiss)) {
    signal = 'ANALYSIS REQUIRED';
    signalRationale = `Technology sector stock requires mandatory secular disruption assessment before a signal can be generated. Run attractor analysis to complete the assessment.`;
  } else if (isDissolvingAttractor) {
    signal = 'DO NOT BUY';
    const sdNote = secularDisruption?.classification === 'advanced' || secularDisruption?.classification === 'active'
      ? ` Secular disruption modifier applied: ${secularDisruption.classification} disruption (-${Math.abs(secularDisruption.attractor_score_adjustment).toFixed(1)} score adjustment).`
      : '';
    signalRationale = `Adjusted attractor score ${attractorScore.toFixed(1)} is below 2.0 (dissolving). The framework prohibits buying stocks with dissolving competitive positions.${sdNote}`;
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

  // Confidence band: STRONG / STANDARD / MARGINAL based on price vs buy-below
  let confidenceBand = null;
  if (hasValuation && signal.startsWith('BUY')) {
    const price = marketData.price;
    const bb = valuation.buy_below_price;
    if (price <= bb * 0.90) confidenceBand = 'STRONG';
    else confidenceBand = 'STANDARD';
  } else if (hasValuation && !signal.startsWith('BUY')) {
    const price = marketData.price;
    const bb = valuation.buy_below_price;
    if (price <= bb * 1.05) confidenceBand = 'MARGINAL';
  }

  // Build data confidence assessment
  const dataConfidence = buildDataConfidence({
    stock, marketData, valuation, financials, insiderSignal,
    aaaBondYield, bondRow,
  });

  // Build report
  const report = buildReport({
    stock, marketData, valuation, financials, screenResult,
    analysis, cr, secularDisruption, insiderSignal,
    aaaBondYield, dynamicPECeiling, signal, signalRationale,
    dataConfidence, economicSnapshot, confidenceBand,
  });

  // Return as JSON with markdown content
  return jsonResponse({ ticker, signal, confidence_band: confidenceBand, report });
}

function buildReport(d) {
  const {
    stock, marketData, valuation, financials, screenResult,
    analysis, cr, secularDisruption, insiderSignal,
    aaaBondYield, dynamicPECeiling, signal, signalRationale,
    dataConfidence, economicSnapshot, confidenceBand,
  } = d;

  const now = new Date().toISOString().split('T')[0];
  const isFinSector = isFinancialSector(stock);
  const lines = [];

  // Header
  lines.push(`# Investment Research Report: ${stock.company_name} (${stock.ticker})`);
  lines.push(`**Generated:** ${now}  `);
  lines.push(`**Framework:** Attractor Value Framework  `);
  lines.push(`**Signal:** ${signal}${confidenceBand ? ` (${confidenceBand})` : ''}`);
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

  // Data confidence warning banner
  if (dataConfidence?.hasIssues) {
    lines.push('> ⚠️ **DATA CONFIDENCE WARNING:** One or more screening inputs have quality issues. See Data Confidence section before acting on this signal.');
    lines.push('');
  }

  // Data Confidence
  if (dataConfidence) {
    lines.push('---');
    lines.push('## Data Confidence');
    lines.push('');
    lines.push('| Input | Value | Source | Retrieved | Status |');
    lines.push('|-------|-------|--------|-----------|--------|');
    for (const item of dataConfidence.items) {
      const val = item.value ?? 'N/A';
      const statusIcon = item.status === 'OK' ? 'OK' : item.status === 'STALE' ? '⚠️ STALE' : item.status === 'MISSING' ? '❌ MISSING' : item.status;
      lines.push(`| ${item.input} | ${val} | ${item.source} | ${item.retrieved || 'N/A'} | ${statusIcon} |`);
    }
    lines.push('');
  }

  // Economic Environment
  if (economicSnapshot) {
    lines.push(formatEconomicEnvironmentSection(economicSnapshot));
  }

  // Market Data
  lines.push('---');
  lines.push('## Current Market Data');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Price | $${marketData?.price?.toFixed(2) || 'N/A'} |`);
  lines.push(`| P/E (TTM) | ${marketData?.pe_ratio?.toFixed(1) || 'N/A'} |`);
  // Normalized P/E using 3-year avg EPS (Bug 1.3)
  const normalizedPE = valuation?.normalized_eps > 0 && marketData?.price
    ? (marketData.price / valuation.normalized_eps).toFixed(1)
    : null;
  if (normalizedPE && marketData?.pe_ratio) {
    const peDivergence = Math.abs(parseFloat(normalizedPE) - marketData.pe_ratio) / marketData.pe_ratio * 100;
    lines.push(`| P/E (3yr normalized) | ${normalizedPE}${peDivergence > 20 ? ' *' : ''} |`);
  }
  lines.push(`| P/B Ratio | ${marketData?.pb_ratio?.toFixed(2) || 'N/A'} |`);
  // P/E x P/B computed from displayed P/E and P/B for consistency (Fix 1)
  const mktDispPE = marketData?.pe_ratio?.toFixed(1);
  const mktDispPB = marketData?.pb_ratio?.toFixed(2);
  lines.push(`| P/E x P/B | ${mktDispPE && mktDispPB ? (parseFloat(mktDispPE) * parseFloat(mktDispPB)).toFixed(2) : 'N/A'} |`);
  lines.push(`| Earnings Yield | ${marketData?.earnings_yield ? (marketData.earnings_yield * 100).toFixed(1) + '%' : (marketData?.pe_ratio ? (100 / marketData.pe_ratio).toFixed(1) + '%' : 'N/A')} |`);
  const divYield = marketData?.dividend_yield;
  const divYieldStr = divYield ? divYield.toFixed(2) + '%' : 'N/A';
  const divYieldFlag = divYield > 5.0 && isFinSector ? ' ⚠️ *May include preferred dividends*' : '';
  lines.push(`| Dividend Yield | ${divYieldStr}${divYieldFlag} |`);
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

    // Compute threshold proximity for each hard filter
    // proximity = |actual - threshold| / |threshold|; marginal if < 0.10
    const proximities = computeProximities(marketData, financials, screenResult, dynamicPECeiling, isFinSector);

    lines.push('| Filter | Result | Details | Proximity |');
    lines.push('|--------|--------|---------|-----------|');
    lines.push(`| P/E (dynamic) | ${screenResult.passes_pe ? 'PASS' : 'FAIL'} | P/E ${marketData?.pe_ratio?.toFixed(1) || '?'} vs ceiling ${dynamicPECeiling.toFixed(1)} (AAA yield ${aaaBondYield?.toFixed(2) || '?'}% + 1.5% premium) | ${proximities.pe} |`);
    lines.push(`| P/B (sector-relative) | ${screenResult.passes_pb ? 'PASS' : 'FAIL'} | P/B ${marketData?.pb_ratio?.toFixed(1) || '?'} vs sector threshold ${screenResult.sector_pb_threshold?.toFixed(2) || '?'} (${stock.sector || 'Unknown'} 33rd pctile, backstop 5.0) | ${proximities.pb} |`);
    // Compute displayed P/E×P/B from the same rounded values shown in the table
    const dispPE = marketData?.pe_ratio?.toFixed(1);
    const dispPB = marketData?.pb_ratio?.toFixed(2);
    const dispPExPB = dispPE && dispPB ? (parseFloat(dispPE) * parseFloat(dispPB)).toFixed(2) : '?';
    const pexbCeiling = screenResult.pe_x_pb_ceiling_used || SCREEN_DEFAULTS.pe_x_pb_max;
    const roeNote = screenResult.roe_5yr_avg != null && screenResult.roe_5yr_avg >= 20
      ? ` (ROE ${screenResult.roe_5yr_avg.toFixed(0)}% modifier)`
      : '';
    lines.push(`| P/E x P/B | ${screenResult.passes_pe_x_pb ? 'PASS' : 'FAIL'} | ${dispPExPB} vs max ${pexbCeiling}${roeNote} | ${proximities.pe_x_pb} |`);
    lines.push(`| Debt/Equity | ${screenResult.passes_debt_equity ? 'PASS' : 'FAIL'} | ${screenResult.de_auto_pass ? 'Auto-pass (financial sector)' : getDebtEquity(financials)} | ${proximities.debt_equity} |`);
    lines.push(`| Current Ratio | ${screenResult.passes_current_ratio ? 'PASS' : 'FAIL'} | ${screenResult.cr_auto_pass ? 'Auto-pass (financial sector)' : getCurrentRatio(financials)} | ${proximities.current_ratio} |`);
    lines.push(`| Earnings Stability | ${screenResult.passes_earnings_stability ? 'PASS' : 'FAIL'} | ${getEarningsStability(financials)} | |`);
    lines.push(`| Dividend Record | ${screenResult.passes_dividend_record ? 'PASS' : 'FAIL'} | ${getDividendRecord(financials)} | |`);
    lines.push(`| Earnings Growth | ${screenResult.passes_earnings_growth ? 'PASS' : 'FAIL'} | ${getEarningsGrowth(financials)} | ${proximities.earnings_growth} |`);
    lines.push('');

    // Composite proximity warning
    const marginalCount = Object.values(proximities).filter(v => v.includes('MARGINAL')).length;
    if (marginalCount > 0) {
      lines.push(`> **Note:** ${marginalCount} of 8 filters ${marginalCount === 1 ? 'is' : 'are'} within 10% of ${marginalCount === 1 ? 'its' : 'their'} threshold. Small data movements could change the screening tier. Consider re-screening with live data before acting.`);
      lines.push('');
    }

    if (screenResult.tier === 'near_miss' && screenResult.failed_filter) {
      lines.push(`**Near-Miss Detail:** Failed on ${formatFilterName(screenResult.failed_filter)} — actual: ${screenResult.actual_value?.toFixed(2) || '?'} vs threshold: ${screenResult.threshold_value?.toFixed(2) || '?'} (${screenResult.miss_severity || 'unknown'} miss)`);
      lines.push('');
    }

    // Soft filters
    lines.push('**Soft Filters (informational):**');
    lines.push(`- Free Cash Flow: ${screenResult.passes_fcf ? 'PASS' : 'FAIL'} (positive in 7+ of 10 years)`);
    // Fix 4: Distinguish FAIL (data exists, below threshold) vs N/A (data unavailable)
    const insiderPct = marketData?.insider_ownership_pct;
    const insiderOwnershipLabel = insiderPct != null
      ? (screenResult.passes_insider_ownership ? 'PASS' : 'FAIL') + ` (>= 5%: ${insiderPct.toFixed(1)}%)`
      : 'N/A (data unavailable)';
    lines.push(`- Insider Ownership: ${insiderOwnershipLabel}`);
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
    // Fix 1: Display inputs at sufficient precision so the displayed math reproduces
    // the displayed result. We show the "show your work" block using the rounded display
    // values and compute the displayed IV from those same rounded values, ensuring
    // internal consistency of the calculation block.
    const dispEps = valuation.normalized_eps?.toFixed(2);
    const dispGrowth = valuation.estimated_growth_rate?.toFixed(2);
    const dispYield = valuation.aaa_bond_yield?.toFixed(2);
    // Compute displayed intermediate and final values from the display-precision inputs
    const dispGrowthFactor = (8.5 + 2 * parseFloat(dispGrowth)).toFixed(2);
    const dispYieldFactor = (4.4 / parseFloat(dispYield)).toFixed(4);
    const dispIV = (parseFloat(dispEps) * parseFloat(dispGrowthFactor) * parseFloat(dispYieldFactor)).toFixed(2);

    lines.push('### Inputs');
    lines.push(`| Parameter | Value | Source |`);
    lines.push(`|-----------|-------|--------|`);
    lines.push(`| Normalized EPS (3yr avg) | $${dispEps} | Average of ${financials.length >= 3 ? financials.slice(0, 3).map(f => f.fiscal_year).join(', ') : '?'} |`);
    lines.push(`| Estimated Growth Rate (g) | ${dispGrowth}% | CAGR first-3 to last-3 year EPS, capped at 7% |`);
    lines.push(`| AAA Bond Yield (Y) | ${dispYield}% | Moody's AAA Corporate via FRED |`);
    lines.push(`| Graham Base P/E | 8.5 | Zero-growth company baseline |`);
    lines.push(`| Growth Multiplier | 2x | Graham's original multiplier |`);
    lines.push(`| Base Bond Yield | 4.4% | 1962 AAA benchmark |`);
    lines.push('');
    lines.push('### Calculation');
    lines.push('```');
    lines.push(`IV = $${dispEps} x (8.5 + 2 x ${dispGrowth}) x (4.4 / ${dispYield})`);
    lines.push(`   = $${dispEps} x ${dispGrowthFactor} x ${dispYieldFactor}`);
    lines.push(`   = $${dispIV}`);
    lines.push('```');
    lines.push('');
    lines.push('### Adjustments');
    lines.push(`| Adjustment | Value | Rationale |`);
    lines.push(`|------------|-------|-----------|`);
    lines.push(`| Fat-Tail Discount | ${(valuation.fat_tail_discount * 100).toFixed(0)}% | ${valuation.fat_tail_discount === 0 ? 'Resilient (10+ years, 0-1 negative EPS years)' : valuation.fat_tail_discount >= 0.15 ? 'High volatility (4+ negative EPS years)' : valuation.fat_tail_discount >= 0.10 ? 'Moderate volatility or untested' : 'Unknown'} |`);
    lines.push(`| Adjusted IV | $${valuation.adjusted_intrinsic_value?.toFixed(2)} | IV x (1 - ${(valuation.fat_tail_discount * 100).toFixed(0)}%) |`);
    lines.push(`| Margin of Safety | ${(valuation.margin_of_safety_required * 100).toFixed(0)}% | ${getMarginRationale(valuation, analysis, secularDisruption)} |`);
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
    const effectiveScore = analysis.adjusted_attractor_score ?? analysis.attractor_stability_score;
    const classification = effectiveScore >= 3.5 ? 'Stable Attractor'
      : effectiveScore >= 2.0 ? 'Transitional' : 'Dissolving';
    lines.push(`**Classification:** ${classification}  `);
    lines.push(`**Base Score:** ${analysis.attractor_stability_score?.toFixed(1)}/5.0  `);
    if (analysis.adjusted_attractor_score != null && analysis.adjusted_attractor_score !== analysis.attractor_stability_score) {
      lines.push(`**Adjusted Score:** ${analysis.adjusted_attractor_score?.toFixed(1)}/5.0 (after secular disruption modifier)  `);
    }
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
    // Secular Disruption (Update 7)
    if (secularDisruption) {
      lines.push('### Secular Disruption Assessment');
      lines.push('');
      const sdClass = secularDisruption.classification;
      const sdBadge = sdClass === 'advanced' ? 'ADVANCED (red)' : sdClass === 'active' ? 'ACTIVE (orange)' : sdClass === 'early' ? 'EARLY (yellow)' : 'NONE (green)';
      lines.push(`**Classification:** ${sdBadge} (${secularDisruption.total_indicators}/5 indicators)  `);
      if (secularDisruption.attractor_score_adjustment !== 0) {
        lines.push(`**Score Adjustment:** ${secularDisruption.attractor_score_adjustment > 0 ? '+' : ''}${secularDisruption.attractor_score_adjustment.toFixed(1)}  `);
        lines.push(`**Attractor Score:** ${analysis.attractor_stability_score?.toFixed(1)} → ${analysis.adjusted_attractor_score?.toFixed(1)} (after secular disruption)  `);
      }
      if (secularDisruption.mos_adjustment_pct > 0) {
        lines.push(`**MoS Adjustment:** +${secularDisruption.mos_adjustment_pct}% additional margin of safety required  `);
      }
      lines.push('');
      lines.push('| Indicator | Present | Explanation |');
      lines.push('|-----------|---------|-------------|');
      lines.push(`| Demand Substitution | ${secularDisruption.demand_substitution ? 'Yes' : 'No'} | ${secularDisruption.demand_substitution_note || '—'} |`);
      lines.push(`| Labor Model Disruption | ${secularDisruption.labor_model_disruption ? 'Yes' : 'No'} | ${secularDisruption.labor_model_disruption_note || '—'} |`);
      lines.push(`| Pricing Power Erosion | ${secularDisruption.pricing_power_erosion ? 'Yes' : 'No'} | ${secularDisruption.pricing_power_erosion_note || '—'} |`);
      lines.push(`| Capital Migration | ${secularDisruption.capital_migration ? 'Yes' : 'No'} | ${secularDisruption.capital_migration_note || '—'} |`);
      lines.push(`| Incumbent Response Paradox | ${secularDisruption.incumbent_response_paradox ? 'Yes' : 'No'} | ${secularDisruption.incumbent_response_paradox_note || '—'} |`);
      lines.push('');

      // Beneficiary scan
      let beneficiarySectors = secularDisruption.beneficiary_sectors;
      if (typeof beneficiarySectors === 'string') {
        try { beneficiarySectors = JSON.parse(beneficiarySectors); } catch { beneficiarySectors = []; }
      }
      if (Array.isArray(beneficiarySectors) && beneficiarySectors.length > 0 && (sdClass === 'active' || sdClass === 'advanced')) {
        lines.push('### Disruption Beneficiaries');
        lines.push('');
        lines.push(`**Beneficiary Sectors:** ${beneficiarySectors.join(', ')}  `);
        if (secularDisruption.beneficiary_rationale) {
          lines.push(`**Rationale:** ${secularDisruption.beneficiary_rationale}`);
        }
        lines.push('');
      }
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
    if (isFinSector) {
      lines.push('> *Financial sector company — showing ROE instead of ROIC, Debt/Capital instead of D/E*');
      lines.push('');
      lines.push('| Year | EPS | Revenue | BVPS | ROE | Debt/Capital | Div |');
      lines.push('|------|-----|---------|------|-----|-------------|-----|');
      for (const f of financials) {
        const roe = f.net_income && f.shareholder_equity > 0
          ? ((f.net_income / f.shareholder_equity) * 100).toFixed(1) + '%'
          : '?';
        const totalCapital = (f.total_debt || 0) + (f.shareholder_equity || 0);
        const debtToCapital = totalCapital > 0
          ? ((f.total_debt || 0) / totalCapital * 100).toFixed(1) + '%'
          : '?';
        lines.push(`| ${f.fiscal_year} | $${f.eps?.toFixed(2) || '?'} | ${f.revenue ? '$' + (f.revenue / 1e9).toFixed(1) + 'B' : '?'} | ${f.book_value_per_share != null ? '$' + f.book_value_per_share.toFixed(2) : 'N/A'} | ${roe} | ${debtToCapital} | ${f.dividend_paid ? 'Yes' : 'No'} |`);
      }
    } else {
      lines.push('| Year | EPS | Revenue | FCF | D/E | BVPS | ROIC | Div |');
      lines.push('|------|-----|---------|-----|-----|------|------|-----|');
      for (const f of financials) {
        lines.push(`| ${f.fiscal_year} | $${f.eps?.toFixed(2) || '?'} | ${f.revenue ? '$' + (f.revenue / 1e9).toFixed(1) + 'B' : '?'} | ${f.free_cash_flow ? '$' + (f.free_cash_flow / 1e6).toFixed(0) + 'M' : '?'} | ${f.shareholder_equity > 0 ? (f.total_debt / f.shareholder_equity).toFixed(2) : '?'} | ${f.book_value_per_share != null ? '$' + f.book_value_per_share.toFixed(2) : 'N/A'} | ${f.roic ? f.roic.toFixed(1) + '%' : '?'} | ${f.dividend_paid ? 'Yes' : 'No'} |`);
      }
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
  if (financials.length >= 6) {
    const last3 = financials.slice(0, 3);
    const first3 = financials.slice(-3);
    const avgLast = last3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    if (avgFirst <= 0) return 'N/A (negative base EPS)';
    const years = financials.length - 3;
    const growth = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
    return `${growth.toFixed(1)}% CAGR over ${years} years`;
  } else if (financials.length === 5) {
    const last2 = financials.slice(0, 2);
    const first2 = financials.slice(-2);
    const avgLast = last2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
    const avgFirst = first2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
    if (avgFirst <= 0) return 'N/A (negative base EPS)';
    const years = financials.length - 2;
    const growth = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
    return `${growth.toFixed(1)}% CAGR over ${years} years (5yr fallback)`;
  }
  return `Insufficient data (${financials.length} years)`;
}

function getMarginRationale(valuation, analysis, secularDisruption) {
  if (!analysis) return 'Default 25% (no attractor analysis)';
  const effectiveScore = analysis.adjusted_attractor_score ?? analysis.attractor_stability_score;
  let rationale;
  if (effectiveScore >= 3.5) {
    rationale = analysis.network_regime === 'hard_network' ? 'Stable + hard network = 40%' : 'Stable attractor = 25%';
  } else if (effectiveScore >= 2.0) {
    rationale = 'Transitional = 40%';
  } else {
    rationale = 'Dissolving = DO NOT BUY';
  }
  if (secularDisruption?.mos_adjustment_pct > 0) {
    rationale += ` + ${secularDisruption.mos_adjustment_pct}% secular disruption`;
  }
  return rationale;
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

// Threshold proximity calculations for Layer 1 filters
// Returns an object with a display string per filter: '' if comfortable, '⚠️ MARGINAL (X%)' if within 10%
function computeProximities(marketData, financials, screenResult, dynamicPECeiling, isFinSector) {
  function marginalLabel(actual, threshold) {
    if (actual == null || threshold == null || threshold === 0) return '';
    const pct = Math.abs(actual - threshold) / Math.abs(threshold) * 100;
    if (pct < 10) return `⚠️ MARGINAL (${pct.toFixed(1)}%)`;
    return '';
  }

  const result = {};

  // P/E: actual vs dynamic ceiling
  result.pe = marginalLabel(marketData?.pe_ratio, dynamicPECeiling);

  // P/B: actual vs sector threshold
  const sectorPBThreshold = screenResult?.sector_pb_threshold;
  result.pb = marginalLabel(marketData?.pb_ratio, sectorPBThreshold);

  // P/E x P/B: actual product vs 22.5
  const pexb = (marketData?.pe_ratio || 0) * (marketData?.pb_ratio || 0);
  result.pe_x_pb = pexb > 0 ? marginalLabel(pexb, SCREEN_DEFAULTS.pe_x_pb_max) : '';

  // D/E: skip for financial sector auto-pass
  if (isFinSector || screenResult?.de_auto_pass) {
    result.debt_equity = '';
  } else {
    const latestFin = financials?.[0];
    if (latestFin?.shareholder_equity > 0) {
      const de = latestFin.total_debt / latestFin.shareholder_equity;
      result.debt_equity = marginalLabel(de, SCREEN_DEFAULTS.debt_equity_max_industrial);
    } else {
      result.debt_equity = '';
    }
  }

  // Current Ratio: skip for financial sector auto-pass
  if (isFinSector || screenResult?.cr_auto_pass) {
    result.current_ratio = '';
  } else {
    const latestFin = financials?.[0];
    if (latestFin?.current_liabilities > 0) {
      const cr = latestFin.current_assets / latestFin.current_liabilities;
      result.current_ratio = marginalLabel(cr, SCREEN_DEFAULTS.current_ratio_min);
    } else {
      result.current_ratio = '';
    }
  }

  // Earnings Growth: actual CAGR vs min threshold
  if (financials?.length >= 6) {
    const last3 = financials.slice(0, 3);
    const first3 = financials.slice(-3);
    const avgLast = last3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    if (avgFirst > 0) {
      const years = financials.length - 3;
      const growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
      result.earnings_growth = marginalLabel(growthRate, SCREEN_DEFAULTS.eps_growth_min_pct);
    } else {
      result.earnings_growth = '';
    }
  } else {
    result.earnings_growth = '';
  }

  return result;
}

// Data Confidence assessment — evaluates quality of each critical input
// 5 trading days ≈ 7 calendar days
const STALE_THRESHOLD_DAYS = 7;

function buildDataConfidence({ stock, marketData, valuation, financials, insiderSignal, aaaBondYield, bondRow }) {
  const now = Date.now();
  const items = [];

  function daysSince(isoStr) {
    if (!isoStr) return null;
    return (now - new Date(isoStr).getTime()) / (1000 * 60 * 60 * 24);
  }

  function status(value, fetchedAt) {
    if (value == null) return 'MISSING';
    const days = daysSince(fetchedAt);
    if (days == null) return 'OK';
    if (days > STALE_THRESHOLD_DAYS) return 'STALE';
    return 'OK';
  }

  const mdFetched = marketData?.fetched_at;
  const mdFetchedShort = mdFetched ? mdFetched.split('T')[0] : null;

  // Price
  items.push({
    input: 'Price',
    value: marketData?.price != null ? `$${marketData.price.toFixed(2)}` : null,
    source: 'Yahoo Finance',
    retrieved: mdFetchedShort,
    status: status(marketData?.price, mdFetched),
  });

  // P/E
  items.push({
    input: 'P/E Ratio',
    value: marketData?.pe_ratio != null ? marketData.pe_ratio.toFixed(1) : null,
    source: 'Finnhub',
    retrieved: mdFetchedShort,
    status: status(marketData?.pe_ratio, mdFetched),
  });

  // P/B
  items.push({
    input: 'P/B Ratio',
    value: marketData?.pb_ratio != null ? marketData.pb_ratio.toFixed(2) : null,
    source: 'Finnhub',
    retrieved: mdFetchedShort,
    status: status(marketData?.pb_ratio, mdFetched),
  });

  // EPS (from financials — most recent year)
  const latestFin = financials?.[0];
  const finRetrieved = stock?.last_updated?.split('T')[0] || null;
  items.push({
    input: 'EPS (latest)',
    value: latestFin?.eps != null ? `$${latestFin.eps.toFixed(2)} (${latestFin.fiscal_year})` : null,
    source: 'Finnhub (10-K XBRL)',
    retrieved: finRetrieved,
    status: status(latestFin?.eps, stock?.last_updated),
  });

  // Normalized EPS (from valuation)
  items.push({
    input: 'Normalized EPS (3yr)',
    value: valuation?.normalized_eps != null ? `$${valuation.normalized_eps.toFixed(2)}` : null,
    source: 'Calculated',
    retrieved: valuation?.calculated_at?.split('T')[0] || null,
    status: status(valuation?.normalized_eps, valuation?.calculated_at),
  });

  // BVPS
  items.push({
    input: 'BVPS',
    value: latestFin?.book_value_per_share != null ? `$${latestFin.book_value_per_share.toFixed(2)} (${latestFin.fiscal_year})` : null,
    source: 'Finnhub (10-K XBRL)',
    retrieved: finRetrieved,
    status: status(latestFin?.book_value_per_share, stock?.last_updated),
  });

  // Dividend History
  const divYears = financials?.filter(f => f.dividend_paid).length || 0;
  items.push({
    input: 'Dividend History',
    value: financials?.length > 0 ? `${divYears}/${financials.length} years paid` : null,
    source: 'Finnhub (10-K XBRL)',
    retrieved: finRetrieved,
    status: status(financials?.length > 0 ? divYears : null, stock?.last_updated),
  });

  // Earnings History
  const earningsYears = financials?.filter(f => f.eps != null).length || 0;
  items.push({
    input: 'Earnings History',
    value: financials?.length > 0 ? `${earningsYears} years of data` : null,
    source: 'Finnhub (10-K XBRL)',
    retrieved: finRetrieved,
    status: status(financials?.length > 0 ? earningsYears : null, stock?.last_updated),
  });

  // Insider Ownership
  items.push({
    input: 'Insider Ownership',
    value: marketData?.insider_ownership_pct != null ? `${marketData.insider_ownership_pct.toFixed(1)}%` : null,
    source: 'Finnhub',
    retrieved: mdFetchedShort,
    status: marketData?.insider_ownership_pct != null ? status(marketData.insider_ownership_pct, mdFetched) : 'MISSING',
  });

  // AAA Bond Yield
  items.push({
    input: 'AAA Bond Yield',
    value: aaaBondYield != null ? `${aaaBondYield.toFixed(2)}%` : null,
    source: 'FRED',
    retrieved: bondRow?.fetched_at?.split('T')[0] || null,
    status: status(aaaBondYield, bondRow?.fetched_at),
  });

  // Check for hard filter inputs with issues
  const hardFilterInputs = ['P/E Ratio', 'P/B Ratio', 'EPS (latest)', 'BVPS'];
  const hasIssues = items.some(i => hardFilterInputs.includes(i.input) && i.status !== 'OK');

  return { items, hasIssues };
}
