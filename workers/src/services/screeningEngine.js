// Layer 1 screening logic - Graham-Dodd quantitative filters

import { SCREEN_DEFAULTS, NEAR_MISS } from '../../../shared/constants.js';

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

// Compute sector P/B percentile thresholds from all stocks in universe
// Returns: { 'Technology': 4.1, 'Financial Services': 1.2, ... }
export function computeSectorPBThresholds(allStocksWithPB) {
  const sectors = {};

  // Group by sector
  for (const s of allStocksWithPB) {
    const sector = s.sector || 'Unknown';
    if (!sectors[sector]) sectors[sector] = [];
    if (s.pb_ratio != null && s.pb_ratio > 0) {
      sectors[sector].push(s.pb_ratio);
    }
  }

  // Compute 33rd percentile for each sector
  const thresholds = {};
  for (const [sector, pbValues] of Object.entries(sectors)) {
    if (pbValues.length < 3) {
      // Too few stocks in sector — use absolute backstop
      thresholds[sector] = SCREEN_DEFAULTS.pb_absolute_backstop;
      continue;
    }
    pbValues.sort((a, b) => a - b);
    const idx = Math.floor(pbValues.length * (SCREEN_DEFAULTS.pb_sector_percentile / 100));
    thresholds[sector] = pbValues[idx];
  }

  return thresholds;
}

export function runLayer1Screen(stock, financials, marketData, options = {}) {
  const thresholds = { ...SCREEN_DEFAULTS, ...options };
  const results = {};

  // Dynamic P/E ceiling from AAA bond yield (Update 2)
  const dynamicPEMax = options.aaa_bond_yield != null
    ? getDynamicPECeiling(options.aaa_bond_yield)
    : thresholds.pe_max_fallback;

  // P/E filter — dynamic threshold based on current interest rates
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

  // P/B filter — sector-relative (Update 4)
  // Use bottom 33rd percentile of sector, with absolute backstop of 5.0
  const sectorName = stock.sector || 'Unknown';
  const sectorPBThresholds = options.sector_pb_thresholds || {};
  const sectorPBMax = sectorPBThresholds[sectorName] || thresholds.pb_max; // fallback to 1.5
  const pbBackstop = thresholds.pb_absolute_backstop || 5.0;

  // P/B boundary: uses <= (not <), so a stock exactly at the threshold passes.
  // e.g., P/B 1.67 vs threshold 1.67 → PASS
  if (marketData.pb_ratio != null && marketData.pb_ratio > 0) {
    results.passes_pb = (marketData.pb_ratio <= sectorPBMax && marketData.pb_ratio <= pbBackstop) ? 1 : 0;
  } else {
    results.passes_pb = 0;
  }
  results.sector_pb_threshold = sectorPBMax;

  // Combined P/E × P/B (retained as backstop per Update 2)
  const pe_x_pb = (marketData.pe_ratio || 0) * (marketData.pb_ratio || 0);
  results.passes_pe_x_pb = pe_x_pb > 0 && pe_x_pb <= thresholds.pe_x_pb_max ? 1 : 0;

  // Sector-aware filter adjustments
  const sectorLower = sectorName.toLowerCase();
  const isFinancial = sectorLower.includes('financial') || sectorLower.includes('insurance');
  const isUtilityOrRE = sectorLower.includes('utilit') || sectorLower.includes('real estate');

  // Debt/Equity
  const latestFinancials = financials[0];
  if (isFinancial) {
    results.passes_debt_equity = 1;
    results.de_auto_pass = 1;
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
    results.passes_current_ratio = 1;
    results.cr_auto_pass = 1;
  } else if (latestFinancials && latestFinancials.current_liabilities > 0) {
    const cr = latestFinancials.current_assets / latestFinancials.current_liabilities;
    results.passes_current_ratio = cr >= thresholds.current_ratio_min ? 1 : 0;
  } else {
    results.passes_current_ratio = 0;
  }

  // Earnings Stability (positive in 8 of 10 years, scaled for shorter histories)
  const positiveEarnings = financials.filter(f => f.eps > 0).length;
  const stabilityWindow = Math.min(financials.length, thresholds.earnings_stability_window);
  const stabilityRequired = Math.min(thresholds.earnings_stability_min_years, stabilityWindow);
  results.passes_earnings_stability = stabilityWindow >= 5 && positiveEarnings >= stabilityRequired ? 1 : 0;

  // Dividend Record (5 consecutive years)
  const recentYears = financials.slice(0, 5);
  results.passes_dividend_record = recentYears.length >= 5 && recentYears.every(f => f.dividend_paid) ? 1 : 0;

  // Earnings Growth (3% over 10 years, first 3 vs last 3 avg, midpoint-to-midpoint span)
  // 5-year fallback: compare 2-year averages with shorter span (years - 2)
  if (financials.length >= 6) {
    const last3 = financials.slice(0, 3);
    const first3 = financials.slice(-3);
    const avgLast = last3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
    if (avgFirst > 0) {
      const years = financials.length - 3; // midpoint-to-midpoint span
      const growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
      results.passes_earnings_growth = growthRate >= thresholds.eps_growth_min_pct ? 1 : 0;
    } else {
      results.passes_earnings_growth = 0;
    }
  } else if (financials.length === 5) {
    // Fallback: 2-year averages with years - 2 span
    const last2 = financials.slice(0, 2);
    const first2 = financials.slice(-2);
    const avgLast = last2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
    const avgFirst = first2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
    if (avgFirst > 0) {
      const years = financials.length - 2; // 3-year span for 5 years of data
      const growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
      results.passes_earnings_growth = growthRate >= thresholds.eps_growth_min_pct ? 1 : 0;
    } else {
      results.passes_earnings_growth = 0;
    }
  } else {
    results.passes_earnings_growth = 0;
  }

  // Count passes and classify tier (Update 4)
  const hardFilters = [
    'passes_pe', 'passes_pb', 'passes_pe_x_pb',
    'passes_debt_equity', 'passes_current_ratio',
    'passes_earnings_stability', 'passes_dividend_record',
    'passes_earnings_growth'
  ];
  const passCount = hardFilters.filter(f => results[f] === 1).length;
  results.pass_count = passCount;
  results.passes_all_hard = passCount === 8 ? 1 : 0;

  // Tier classification
  if (passCount === 8) {
    results.tier = 'full_pass';
  } else if (passCount === 7) {
    results.tier = 'near_miss';
    // Identify failed filter and compute miss severity
    const failedFilter = hardFilters.find(f => results[f] !== 1);
    results.failed_filter = failedFilter ? failedFilter.replace('passes_', '') : null;

    // Compute actual vs threshold for the failed filter
    const missInfo = getMissInfo(results.failed_filter, stock, financials, marketData, {
      dynamicPEMax, sectorPBMax, pbBackstop, thresholds,
    });
    results.actual_value = missInfo.actual;
    results.threshold_value = missInfo.threshold;

    // Marginal = within 10% of threshold
    if (missInfo.actual != null && missInfo.threshold != null && missInfo.threshold !== 0) {
      const pctOff = Math.abs(missInfo.actual - missInfo.threshold) / Math.abs(missInfo.threshold) * 100;
      results.miss_severity = pctOff <= NEAR_MISS.marginal_miss_pct ? 'marginal' : 'clear';
    } else {
      results.miss_severity = 'clear';
    }
  } else {
    results.tier = 'fail';
  }

  // EPS data quality check (Bug 1.1 — Update 7): flag identical EPS for 3+ years
  if (financials.length >= 3) {
    const epsValues = financials.slice(0, Math.min(financials.length, 5)).map(f => f.eps?.toFixed(2));
    let consecutiveIdentical = 1;
    for (let i = 1; i < epsValues.length; i++) {
      if (epsValues[i] === epsValues[i - 1] && epsValues[i] != null) {
        consecutiveIdentical++;
        if (consecutiveIdentical >= 3) {
          results.eps_data_warning = `Identical EPS ($${epsValues[i]}) for ${consecutiveIdentical}+ consecutive years — possible data quality issue`;
          console.warn(`EPS DATA WARNING: ${stock.ticker} has identical EPS for ${consecutiveIdentical}+ years — likely data artifact`);
          break;
        }
      } else {
        consecutiveIdentical = 1;
      }
    }
  }

  // Soft filters
  const fcfPositive = financials.filter(f => f.free_cash_flow > 0).length;
  results.passes_fcf = fcfPositive >= thresholds.fcf_positive_min_years ? 1 : 0;

  // Fix 4: null insider_ownership_pct means data unavailable, not a failure
  results.passes_insider_ownership = marketData.insider_ownership_pct != null
    ? (marketData.insider_ownership_pct >= thresholds.insider_ownership_min_pct ? 1 : 0)
    : null;

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

// Compute actual value and threshold for a failed filter
function getMissInfo(filterName, stock, financials, marketData, ctx) {
  const latestFinancials = financials[0];
  const sectorLower = (stock.sector || '').toLowerCase();
  const isUtilityOrRE = sectorLower.includes('utilit') || sectorLower.includes('real estate');

  switch (filterName) {
    case 'pe': {
      return { actual: marketData.pe_ratio, threshold: ctx.dynamicPEMax };
    }
    case 'pb': {
      const threshold = Math.min(ctx.sectorPBMax, ctx.pbBackstop);
      return { actual: marketData.pb_ratio, threshold };
    }
    case 'pe_x_pb': {
      const actual = (marketData.pe_ratio || 0) * (marketData.pb_ratio || 0);
      return { actual, threshold: ctx.thresholds.pe_x_pb_max };
    }
    case 'debt_equity': {
      if (latestFinancials && latestFinancials.shareholder_equity > 0) {
        const de = latestFinancials.total_debt / latestFinancials.shareholder_equity;
        const maxDE = isUtilityOrRE || sectorLower.includes('energy')
          ? ctx.thresholds.debt_equity_max_utility
          : ctx.thresholds.debt_equity_max_industrial;
        return { actual: de, threshold: maxDE };
      }
      return { actual: null, threshold: null };
    }
    case 'current_ratio': {
      if (latestFinancials && latestFinancials.current_liabilities > 0) {
        const cr = latestFinancials.current_assets / latestFinancials.current_liabilities;
        return { actual: cr, threshold: ctx.thresholds.current_ratio_min };
      }
      return { actual: null, threshold: null };
    }
    case 'earnings_stability': {
      const positiveEarnings = financials.filter(f => f.eps > 0).length;
      const window = Math.min(financials.length, ctx.thresholds.earnings_stability_window);
      const required = Math.min(ctx.thresholds.earnings_stability_min_years, window);
      return { actual: positiveEarnings, threshold: required };
    }
    case 'dividend_record': {
      const recentYears = financials.slice(0, 5);
      const consecutive = recentYears.filter(f => f.dividend_paid).length;
      return { actual: consecutive, threshold: 5 };
    }
    case 'earnings_growth': {
      if (financials.length >= 6) {
        const last3 = financials.slice(0, 3);
        const first3 = financials.slice(-3);
        const avgLast = last3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
        const avgFirst = first3.reduce((s, f) => s + (f.eps || 0), 0) / 3;
        if (avgFirst > 0) {
          const years = financials.length - 3;
          const growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
          return { actual: growthRate, threshold: ctx.thresholds.eps_growth_min_pct };
        }
      } else if (financials.length === 5) {
        const last2 = financials.slice(0, 2);
        const first2 = financials.slice(-2);
        const avgLast = last2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
        const avgFirst = first2.reduce((s, f) => s + (f.eps || 0), 0) / 2;
        if (avgFirst > 0) {
          const years = financials.length - 2;
          const growthRate = (Math.pow(avgLast / avgFirst, 1 / years) - 1) * 100;
          return { actual: growthRate, threshold: ctx.thresholds.eps_growth_min_pct };
        }
      }
      return { actual: null, threshold: ctx.thresholds.eps_growth_min_pct };
    }
    default:
      return { actual: null, threshold: null };
  }
}
