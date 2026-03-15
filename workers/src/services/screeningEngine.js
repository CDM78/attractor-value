// Layer 1 screening logic - Graham-Dodd quantitative filters

import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

// Compute dynamic P/E ceiling from AAA bond yield (Update 2)
// Formula: P/E ≤ 1 / (AAA_yield_decimal + equity_risk_premium)
// At ~5% AAA yield this converges to Graham's original P/E ≤ 15
export function getDynamicPECeiling(aaaBondYieldPct) {
  if (aaaBondYieldPct == null || aaaBondYieldPct <= 0) {
    return SCREEN_DEFAULTS.pe_max_fallback;
  }
  const aaaDecimal = aaaBondYieldPct / 100;
  const minEarningsYield = aaaDecimal + SCREEN_DEFAULTS.equity_risk_premium;
  return 1 / minEarningsYield;
}

export function runLayer1Screen(stock, financials, marketData, options = {}) {
  const thresholds = { ...SCREEN_DEFAULTS, ...options };
  const results = {};

  // Dynamic P/E ceiling from AAA bond yield (Update 2)
  const dynamicPEMax = options.aaa_bond_yield != null
    ? getDynamicPECeiling(options.aaa_bond_yield)
    : thresholds.pe_max_fallback;

  // P/E filter — dynamic threshold based on current interest rates
  // Earnings yield (E/P) on trailing 3yr avg must exceed AAA yield + 1.5% equity premium
  const pe_trailing_3yr = marketData.pe_ratio;
  if (pe_trailing_3yr != null && pe_trailing_3yr > 0) {
    const earningsYield3yr = 1 / pe_trailing_3yr;
    const minEarningsYield = options.aaa_bond_yield != null
      ? (options.aaa_bond_yield / 100) + thresholds.equity_risk_premium
      : 1 / thresholds.pe_max_fallback;
    results.passes_pe = earningsYield3yr >= minEarningsYield ? 1 : 0;
  } else {
    results.passes_pe = 0;
  }

  // Store the dynamic ceiling for UI display
  results.dynamic_pe_ceiling = parseFloat(dynamicPEMax.toFixed(1));

  // P/B filter (unchanged — not rate-sensitive)
  results.passes_pb = marketData.pb_ratio != null && marketData.pb_ratio <= thresholds.pb_max ? 1 : 0;

  // Combined P/E × P/B (retained as backstop per Update 2)
  const pe_x_pb = (marketData.pe_ratio || 0) * (marketData.pb_ratio || 0);
  results.passes_pe_x_pb = pe_x_pb > 0 && pe_x_pb <= thresholds.pe_x_pb_max ? 1 : 0;

  // Sector-aware filter adjustments
  // Financial Services and Insurance: leverage is their business model,
  // current ratio is not meaningful. Use P/B as primary balance sheet check instead.
  const sectorLower = (stock.sector || '').toLowerCase();
  const isFinancial = sectorLower.includes('financial') || sectorLower.includes('insurance');
  const isUtilityOrRE = sectorLower.includes('utilit') || sectorLower.includes('real estate');

  // Debt/Equity
  const latestFinancials = financials[0];
  if (isFinancial) {
    // For financials, skip D/E (regulated capital requirements replace this filter)
    // Rely on P/B ≤ 1.5 as the balance sheet quality check
    results.passes_debt_equity = 1;
  } else if (latestFinancials && latestFinancials.shareholder_equity > 0) {
    const de = latestFinancials.total_debt / latestFinancials.shareholder_equity;
    const maxDE = isUtilityOrRE || sectorLower.includes('energy')
      ? thresholds.debt_equity_max_utility
      : thresholds.debt_equity_max_industrial;
    results.passes_debt_equity = de <= maxDE ? 1 : 0;
  } else {
    results.passes_debt_equity = 0;
  }

  // Current Ratio
  if (isFinancial) {
    // For financials, current ratio is not meaningful — skip this filter
    results.passes_current_ratio = 1;
  } else if (latestFinancials && latestFinancials.current_liabilities > 0) {
    const cr = latestFinancials.current_assets / latestFinancials.current_liabilities;
    results.passes_current_ratio = cr >= thresholds.current_ratio_min ? 1 : 0;
  } else {
    results.passes_current_ratio = 0;
  }

  // Earnings Stability (positive in 8 of 10 years)
  const positiveEarnings = financials.filter(f => f.eps > 0).length;
  results.passes_earnings_stability = positiveEarnings >= thresholds.earnings_stability_min_years ? 1 : 0;

  // Dividend Record (5 consecutive years)
  const recentYears = financials.slice(0, 5);
  results.passes_dividend_record = recentYears.length >= 5 && recentYears.every(f => f.dividend_paid) ? 1 : 0;

  // Earnings Growth (3% over 10 years, first 3 vs last 3 avg)
  if (financials.length >= 6) {
    const last3 = financials.slice(0, 3);
    const first3 = financials.slice(-3);
    const avgLast = last3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    if (avgFirst > 0) {
      const years = financials.length - 1;
      const growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
      results.passes_earnings_growth = growthRate >= thresholds.eps_growth_min_pct ? 1 : 0;
    } else {
      results.passes_earnings_growth = 0;
    }
  } else {
    results.passes_earnings_growth = 0;
  }

  // All hard filters pass?
  results.passes_all_hard = [
    results.passes_pe, results.passes_pb, results.passes_pe_x_pb,
    results.passes_debt_equity, results.passes_current_ratio,
    results.passes_earnings_stability, results.passes_dividend_record,
    results.passes_earnings_growth
  ].every(v => v === 1) ? 1 : 0;

  // Soft filters
  const fcfPositive = financials.filter(f => f.free_cash_flow > 0).length;
  results.passes_fcf = fcfPositive >= thresholds.fcf_positive_min_years ? 1 : 0;

  results.passes_insider_ownership = marketData.insider_ownership_pct >= thresholds.insider_ownership_min_pct ? 1 : 0;

  // Dilution check
  if (financials.length >= 5) {
    const recentShares = financials[0]?.shares_outstanding;
    const olderShares = financials[4]?.shares_outstanding;
    if (recentShares && olderShares && olderShares > 0) {
      const annualGrowth = (Math.pow(recentShares / olderShares, 1 / 4) - 1) * 100;
      results.passes_dilution = annualGrowth <= thresholds.dilution_max_annual_pct ? 1 : 0;
    } else {
      results.passes_dilution = null;
    }
  } else {
    results.passes_dilution = null;
  }

  return results;
}
