// Graham Intrinsic Value Calculator
// Formula: IV = EPS_norm × (8.5 + 2g) × (4.4 / Y)
// Then: adjusted_IV = IV × (1 - fat_tail_discount)
// Then: buy_below = adjusted_IV × (1 - margin_of_safety)

import { VALUATION, FAT_TAIL, MARGIN_OF_SAFETY, SMALL_CAP } from '../../../shared/constants.js';

export function calculateGrahamValuation(financials, marketData, aaaBondYieldPct, attractorData, screenInfo, economicEnvironment) {
  if (!financials || financials.length < 3 || !marketData?.price) {
    return null;
  }

  // Normalized EPS: 3-year average of most recent years
  const recent3 = financials.slice(0, 3);
  const normalizedEps = recent3.reduce((s, f) => s + (f.eps || 0), 0) / recent3.length;

  if (normalizedEps <= 0) return null;

  // Estimated growth rate: compounded annual from first 3 avg to last 3 avg
  // Time span = gap between midpoints of the two 3-year windows
  // 5-year fallback: compare 2-year averages with shorter span (years - 2)
  let growthRate = 0;
  if (financials.length >= 6) {
    const first3 = financials.slice(-3);
    const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    if (avgFirst > 0 && normalizedEps > 0) {
      const years = financials.length - 3; // midpoint-to-midpoint span
      growthRate = (Math.pow(normalizedEps / avgFirst, 1 / years) - 1) * 100;
    }
  } else if (financials.length === 5) {
    const first2 = financials.slice(-2);
    const last2 = financials.slice(0, 2);
    const avgFirst = first2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
    const avgLast = last2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
    if (avgFirst > 0 && avgLast > 0) {
      const years = financials.length - 2; // 3-year span for 5 years of data
      growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
    }
  }

  // Cap growth rate
  growthRate = Math.min(growthRate, VALUATION.growth_rate_cap);
  growthRate = Math.max(growthRate, 0);

  // AAA bond yield (use base if unavailable)
  const bondYield = aaaBondYieldPct > 0 ? aaaBondYieldPct : VALUATION.graham_base_bond_yield;

  // Graham formula: IV = EPS × (8.5 + 2g) × (4.4 / Y)
  const grahamIV = normalizedEps
    * (VALUATION.graham_base_pe + VALUATION.graham_growth_multiplier * growthRate)
    * (VALUATION.graham_base_bond_yield / bondYield);

  // Fat-tail discount: graduated by count of negative EPS years
  let fatTailDiscount;
  const hasDownturnData = financials.length >= 10;
  const negativeEpsYears = financials.filter(f => f.eps < 0).length;
  if (hasDownturnData) {
    if (negativeEpsYears <= 1) {
      fatTailDiscount = FAT_TAIL.resilient;       // 0% — proven resilience
    } else if (negativeEpsYears <= 3) {
      fatTailDiscount = FAT_TAIL.moderate_vol;    // 10% — moderate volatility
    } else {
      fatTailDiscount = FAT_TAIL.high_vol;        // 15% — genuinely volatile
    }
  } else {
    fatTailDiscount = FAT_TAIL.untested;           // 10% — insufficient history
  }

  const adjustedIV = grahamIV * (1 - fatTailDiscount);

  // Margin of safety: varies by attractor stability, network regime, and screen tier
  let marginOfSafety;
  const isNearMiss = screenInfo?.tier === 'near_miss';
  const missSeverity = screenInfo?.miss_severity;

  if (attractorData?.attractor_stability_score != null) {
    const score = attractorData.attractor_stability_score;
    const isHardNetwork = attractorData.network_regime === 'hard_network';

    if (score < 2.0) {
      // Dissolving attractor — do not buy (use very high margin to effectively block)
      marginOfSafety = 1.0;
    } else if (isNearMiss) {
      // Near-miss margin table
      if (missSeverity === 'clear') {
        marginOfSafety = MARGIN_OF_SAFETY.near_miss_clear;
      } else if (score >= 3.5) {
        marginOfSafety = isHardNetwork
          ? MARGIN_OF_SAFETY.near_miss_stable_hard_network
          : MARGIN_OF_SAFETY.near_miss_stable_classical;
      } else {
        marginOfSafety = MARGIN_OF_SAFETY.near_miss_transitional;
      }
    } else {
      // Full pass margin table
      if (score >= 3.5) {
        marginOfSafety = isHardNetwork
          ? MARGIN_OF_SAFETY.stable_hard_network_non_leader
          : MARGIN_OF_SAFETY.stable_classical;
      } else {
        marginOfSafety = MARGIN_OF_SAFETY.transitional_any;
      }
    }
  } else {
    // No attractor analysis — use default based on screen tier
    marginOfSafety = isNearMiss
      ? MARGIN_OF_SAFETY.near_miss_stable_classical
      : MARGIN_OF_SAFETY.stable_classical;
  }
  // Small cap adjustment: +5% MoS (stacks with economic environment)
  if (screenInfo?.is_small_cap) {
    marginOfSafety = Math.min(marginOfSafety + SMALL_CAP.mos_adjustment, 0.95);
  }
  // Economic environment stress adjustment: +5% MoS when STRESSED
  if (economicEnvironment === 'STRESSED') {
    marginOfSafety = Math.min(marginOfSafety + 0.05, 0.95);
  }

  const buyBelowPrice = adjustedIV * (1 - marginOfSafety);

  // Discount to IV: positive = undervalued, negative = overvalued
  const discountToIV = ((adjustedIV - marketData.price) / adjustedIV) * 100;

  return {
    ticker: marketData.ticker,
    normalized_eps: round(normalizedEps, 2),
    estimated_growth_rate: round(growthRate, 2),
    aaa_bond_yield: round(bondYield, 2),
    graham_intrinsic_value: round(grahamIV, 2),
    fat_tail_discount: round(fatTailDiscount, 2),
    adjusted_intrinsic_value: round(adjustedIV, 2),
    margin_of_safety_required: round(marginOfSafety, 2),
    buy_below_price: round(buyBelowPrice, 2),
    discount_to_iv_pct: round(discountToIV, 1),
    calculated_at: new Date().toISOString(),
  };
}

/**
 * Tier 3 Valuation: Growth-Adjusted Revenue Model
 * For emerging growth companies where Graham formula is inappropriate.
 * Projects revenue forward at decelerating growth, applies target margins, discounts back.
 */
export function calculateTier3Valuation(candidate, financials, marketData, attractorScore, economicEnvironment) {
  if (!financials || financials.length < 2 || !marketData?.price) return null;

  const recent = financials[0];
  const revenueTTM = recent?.revenue;
  // shares_outstanding: direct value or computed from net_income / eps
  let sharesOutstanding = recent?.shares_outstanding;
  if ((!sharesOutstanding || sharesOutstanding <= 0) && recent?.eps > 0 && recent?.net_income > 0) {
    sharesOutstanding = Math.round(recent.net_income / recent.eps);
  }
  if (!revenueTTM || revenueTTM <= 0 || !sharesOutstanding || sharesOutstanding <= 0) return null;

  // Revenue CAGR from prescreen data
  const prescreenData = typeof candidate.prescreen_data === 'string'
    ? JSON.parse(candidate.prescreen_data) : (candidate.prescreen_data || {});
  const revenueGrowth = prescreenData.revenue_cagr_3yr || 0.15;

  // Project revenue 3 years forward at decelerating growth
  const y1Growth = revenueGrowth * 0.85;
  const y2Growth = revenueGrowth * 0.70;
  const y3Growth = revenueGrowth * 0.55;
  const revenue3yr = revenueTTM * (1 + y1Growth) * (1 + y2Growth) * (1 + y3Growth);

  // Target operating margin: estimate from gross margin and current trajectory
  // High gross margin companies (SaaS, software) converge to higher operating margins at scale
  const netMargin = recent.net_income && revenueTTM > 0 ? recent.net_income / revenueTTM : 0.10;
  const grossMarginPct = prescreenData.gross_margin_estimate || null;
  let targetOperatingMargin;
  if (grossMarginPct && grossMarginPct > 0.50) {
    // High gross margin: target = midpoint between current net margin and 50% of gross margin
    // e.g., 80% gross → 40% target ceiling, company at 18% net → target ~29%
    const matureCeiling = Math.min(grossMarginPct * 0.50, 0.45);
    targetOperatingMargin = Math.max((netMargin + matureCeiling) / 2, netMargin + 0.05);
  } else {
    targetOperatingMargin = Math.max(netMargin + 0.05, 0.10);
  }

  // Estimated EPS at year 3
  const estimatedEarnings3yr = revenue3yr * targetOperatingMargin;
  const estimatedEPS3yr = estimatedEarnings3yr / sharesOutstanding;

  // Terminal P/E based on expected growth at year 3
  const terminalPE = Math.min(25, 10 + y3Growth * 100);
  const terminalValue = estimatedEPS3yr * terminalPE;

  // Discount back at 12% required return
  const discountRate = 0.12;
  const intrinsicValue = terminalValue / Math.pow(1 + discountRate, 3);

  if (intrinsicValue <= 0) return null;

  // Margin of safety — attractor-informed + tier premium
  const baseMargin = (attractorScore ?? 3.0) >= 3.5 ? 0.25 : 0.35;
  const tierPremium = 0.05; // Growth carries more uncertainty
  const envPremium = economicEnvironment === 'STRESSED' ? 0.05 : 0;
  const smallCapPremium = (marketData.market_cap || 999999) < 2000 ? 0.05 : 0;
  const totalMargin = Math.min(baseMargin + tierPremium + envPremium + smallCapPremium, 0.60);

  const buyBelow = intrinsicValue * (1 - totalMargin);
  const discountToIV = ((intrinsicValue - marketData.price) / intrinsicValue) * 100;

  return {
    ticker: marketData.ticker || candidate.ticker,
    intrinsic_value: round(intrinsicValue, 2),
    buy_below_price: round(buyBelow, 2),
    margin_of_safety: round(totalMargin, 2),
    discount_to_iv_pct: round(discountToIV, 1),
    valuation_method: 'growth_adjusted_revenue',
    revenue_ttm: round(revenueTTM, 0),
    projected_revenue_3yr: round(revenue3yr, 0),
    target_operating_margin: round(targetOperatingMargin, 3),
    terminal_pe: round(terminalPE, 1),
    deceleration: { y1: round(y1Growth, 3), y2: round(y2Growth, 3), y3: round(y3Growth, 3) },
    calculated_at: new Date().toISOString(),
  };
}

/**
 * Tier 4 Valuation: Scenario-Weighted Model
 * For regime transition beneficiaries where the thesis depends on an external structural shift.
 */
export function calculateTier4Valuation(candidate, financials, marketData, regime, attractorScore, economicEnvironment) {
  if (!financials || financials.length < 2 || !marketData?.price) return null;

  const recent = financials[0];
  const revenueTTM = recent?.revenue;
  let sharesOutstanding = recent?.shares_outstanding;
  if ((!sharesOutstanding || sharesOutstanding <= 0) && recent?.eps > 0 && recent?.net_income > 0) {
    sharesOutstanding = Math.round(recent.net_income / recent.eps);
  }
  if (!revenueTTM || revenueTTM <= 0 || !sharesOutstanding || sharesOutstanding <= 0) return null;

  const operatingMargin = recent.net_income && revenueTTM > 0
    ? recent.net_income / revenueTTM : 0.10;

  // Bull case: regime fully materializes
  const revenueImpactBull = 0.40; // 40% revenue uplift from regime
  const bullRevenue = revenueTTM * (1 + revenueImpactBull);
  const bullEarnings = bullRevenue * operatingMargin * 1.15; // margin expansion
  const bullPE = 18;
  const bullValue = (bullEarnings / sharesOutstanding) * bullPE;

  // Bear case: regime fizzles
  const bearRevenue = revenueTTM * 1.05; // modest organic growth
  const bearEarnings = bearRevenue * operatingMargin;
  const bearPE = 14;
  const bearValue = (bearEarnings / sharesOutstanding) * bearPE;

  // Weight by adjacent possible score
  const adjPossible = regime?.adjacent_possible_score || 3;
  const bullWeight = adjPossible >= 4 ? 0.65 : adjPossible >= 3 ? 0.55 : 0.45;
  const bearWeight = 1 - bullWeight;
  const weightedIV = bullValue * bullWeight + bearValue * bearWeight;

  if (weightedIV <= 0) return null;

  // Margin of safety — higher for regime uncertainty
  const baseMargin = (attractorScore ?? 3.0) >= 3.5 ? 0.30 : 0.40;
  const envPremium = economicEnvironment === 'STRESSED' ? 0.05 : 0;
  const totalMargin = Math.min(baseMargin + envPremium, 0.60);

  const buyBelow = weightedIV * (1 - totalMargin);
  const discountToIV = ((weightedIV - marketData.price) / weightedIV) * 100;

  return {
    ticker: marketData.ticker || candidate.ticker,
    intrinsic_value: round(weightedIV, 2),
    bull_value: round(bullValue, 2),
    bear_value: round(bearValue, 2),
    scenario_weights: { bull: bullWeight, bear: bearWeight },
    buy_below_price: round(buyBelow, 2),
    margin_of_safety: round(totalMargin, 2),
    discount_to_iv_pct: round(discountToIV, 1),
    valuation_method: 'scenario_weighted',
    adjacent_possible_score: adjPossible,
    calculated_at: new Date().toISOString(),
  };
}

function round(n, decimals) {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
