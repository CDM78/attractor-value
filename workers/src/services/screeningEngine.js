// Layer 1 screening logic - Graham-Dodd quantitative filters

import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

export function runLayer1Screen(stock, financials, marketData, options = {}) {
  const thresholds = { ...SCREEN_DEFAULTS, ...options };
  const results = {};

  // P/E filter (3-year average earnings)
  results.passes_pe = marketData.pe_ratio != null && marketData.pe_ratio <= thresholds.pe_max ? 1 : 0;

  // P/B filter
  results.passes_pb = marketData.pb_ratio != null && marketData.pb_ratio <= thresholds.pb_max ? 1 : 0;

  // Combined P/E × P/B
  const pe_x_pb = (marketData.pe_ratio || 0) * (marketData.pb_ratio || 0);
  results.passes_pe_x_pb = pe_x_pb > 0 && pe_x_pb <= thresholds.pe_x_pb_max ? 1 : 0;

  // Debt/Equity
  const latestFinancials = financials[0];
  if (latestFinancials && latestFinancials.shareholder_equity > 0) {
    const de = latestFinancials.total_debt / latestFinancials.shareholder_equity;
    const maxDE = stock.sector === 'Utilities' || stock.sector === 'Real Estate'
      ? thresholds.debt_equity_max_utility
      : thresholds.debt_equity_max_industrial;
    results.passes_debt_equity = de <= maxDE ? 1 : 0;
  } else {
    results.passes_debt_equity = 0;
  }

  // Current Ratio
  if (latestFinancials && latestFinancials.current_liabilities > 0) {
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
