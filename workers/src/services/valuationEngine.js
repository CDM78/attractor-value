// Graham Intrinsic Value Calculator
// Formula: IV = EPS_norm × (8.5 + 2g) × (4.4 / Y)
// Then: adjusted_IV = IV × (1 - fat_tail_discount)
// Then: buy_below = adjusted_IV × (1 - margin_of_safety)

import { VALUATION, FAT_TAIL, MARGIN_OF_SAFETY } from '../../../shared/constants.js';

export function calculateGrahamValuation(financials, marketData, aaaBondYieldPct, attractorData) {
  if (!financials || financials.length < 3 || !marketData?.price) {
    return null;
  }

  // Normalized EPS: 3-year average of most recent years
  const recent3 = financials.slice(0, 3);
  const normalizedEps = recent3.reduce((s, f) => s + (f.eps || 0), 0) / recent3.length;

  if (normalizedEps <= 0) return null;

  // Estimated growth rate: compounded annual from first 3 avg to last 3 avg
  // Time span = gap between midpoints of the two 3-year windows
  let growthRate = 0;
  if (financials.length >= 6) {
    const first3 = financials.slice(-3);
    const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    if (avgFirst > 0 && normalizedEps > 0) {
      const years = financials.length - 3; // midpoint-to-midpoint span
      growthRate = (Math.pow(normalizedEps / avgFirst, 1 / years) - 1) * 100;
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

  // Fat-tail discount: check earnings history for downturn survival
  let fatTailDiscount;
  const hasDownturnData = financials.length >= 10;
  const hadNegativeEps = financials.some(f => f.eps < 0);
  if (hasDownturnData && !hadNegativeEps) {
    fatTailDiscount = FAT_TAIL.survived_downturn;
  } else if (hasDownturnData) {
    fatTailDiscount = FAT_TAIL.transitional;
  } else {
    fatTailDiscount = FAT_TAIL.untested;
  }

  const adjustedIV = grahamIV * (1 - fatTailDiscount);

  // Margin of safety: varies by attractor stability and network regime
  let marginOfSafety;
  if (attractorData?.attractor_stability_score != null) {
    if (attractorData.attractor_stability_score >= 3.5) {
      marginOfSafety = attractorData.network_regime === 'hard_network'
        ? MARGIN_OF_SAFETY.stable_hard_network_non_leader
        : MARGIN_OF_SAFETY.stable_classical;
    } else {
      marginOfSafety = MARGIN_OF_SAFETY.transitional_any;
    }
  } else {
    marginOfSafety = MARGIN_OF_SAFETY.stable_classical; // default when no analysis
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

function round(n, decimals) {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
