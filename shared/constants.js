// Graham-Dodd Quantitative Filter Thresholds
export const SCREEN_DEFAULTS = {
  // P/E: dynamic ceiling based on AAA bond yield (Update 2)
  // Formula: P/E ≤ 1 / (AAA_yield + equity_risk_premium)
  // At ~5% AAA yield this converges to Graham's original P/E ≤ 15
  equity_risk_premium: 0.015,  // 1.5 percentage points above AAA yield
  pe_max_fallback: 15,         // fallback if bond yield unavailable
  pb_max: 1.5,                    // legacy fallback; sector-relative P/B is primary (Update 4)
  pb_sector_percentile: 33,       // bottom 33rd percentile of sector (Update 4)
  pb_absolute_backstop: 5.0,      // absolute P/B ceiling regardless of sector (Update 4)
  pe_x_pb_max: 22.5,
  debt_equity_max_industrial: 1.0,
  debt_equity_max_utility: 2.0,
  current_ratio_min: 1.5,
  earnings_stability_min_years: 8,
  earnings_stability_window: 10,
  dividend_years_required: 5,
  eps_growth_min_pct: 3,
  eps_growth_window: 10,
  // Soft filters
  fcf_positive_min_years: 7,
  fcf_window: 10,
  insider_ownership_min_pct: 5,
  dilution_max_annual_pct: 2,
};

// Graham Valuation Formula
export const VALUATION = {
  graham_base_pe: 8.5,
  graham_growth_multiplier: 2,
  graham_base_bond_yield: 4.4,
  growth_rate_cap: 7,
};

// Attractor Stability
export const ATTRACTOR = {
  stable_threshold: 3.5,
  transitional_min: 2.0,
  dissolving_max: 2.0,
};

// Margin of Safety Requirements (full matrix including near-miss tiers)
export const MARGIN_OF_SAFETY = {
  // Full pass
  stable_classical: 0.25,
  stable_soft_network: 0.25,
  stable_hard_network_non_leader: 0.40,
  transitional_any: 0.40,
  // Near miss (marginal)
  near_miss_stable_classical: 0.30,
  near_miss_stable_hard_network: 0.45,
  near_miss_transitional: 0.45,
  // Near miss (clear) — requires Claude "proceed"
  near_miss_clear: 0.45,
};

// Fat-Tail Discounts (graduated by count of negative EPS years)
export const FAT_TAIL = {
  resilient: 0.0,       // 10+ years, 0-1 negative EPS years
  moderate_vol: 0.10,   // 10+ years, 2-3 negative EPS years
  high_vol: 0.15,       // 10+ years, 4+ negative EPS years
  untested: 0.10,       // fewer than 10 years of data
};

// Portfolio Construction Rules
export const PORTFOLIO = {
  core_min_pct: 70,
  core_max_pct: 85,
  asymmetric_min_pct: 15,
  asymmetric_max_pct: 30,
  core_positions_min: 12,
  core_positions_max: 20,
  asymmetric_positions_min: 3,
  asymmetric_positions_max: 6,
  max_single_position_core_pct: 8,
  max_single_position_asymmetric_pct: 5,
  trim_threshold_pct: 12,
  trim_target_pct: 8,
  max_sector_pct: 25,
  max_hard_network_pct: 15,
  min_sector_diversity: 3,
  // AP-adjusted constraints for asymmetric positions
  ap_caution_max_position_pct: 3,
  ap_horizon_warning_days: 30,
};

// Near-Miss Tier Thresholds (Update 4)
export const NEAR_MISS = {
  marginal_miss_pct: 10,   // within 10% of threshold = marginal
  full_pass_count: 8,
  near_miss_count: 7,
};

// Network Regimes
export const NETWORK_REGIMES = ['classical', 'soft_network', 'hard_network', 'platform'];

// Adjacent Possible (Layer 4 — Asymmetric Opportunity candidates only)
export const ADJACENT_POSSIBLE = {
  proceed_threshold: 3.5,
  caution_min: 2.0,
  reject_max: 2.0,
  // Position sizing by AP score
  standard_max_position_pct: 0.05,
  caution_max_position_pct: 0.03,
  // Time horizons
  standard_horizon_months: { min: 18, max: 24 },
  caution_horizon_months: { min: 12, max: 18 },
};

// Concentration Risk Modifiers (Update 2)
export const CONCENTRATION_RISK = {
  customer_25pct: 0.5,          // any single customer ≥ 25% revenue
  customer_40pct: 1.0,          // any single customer ≥ 40% revenue (severe)
  supplier_single_source: 0.5,  // critical single-source supplier
  geographic_70pct: 0.3,        // ≥ 70% revenue from single foreign country
  regulatory_50pct: 0.5,        // ≥ 50% revenue tied to single reg/license/contract
  adjusted_score_floor: 1.0,    // minimum adjusted attractor score
};

// Insider Transaction Signal Thresholds (Update 2)
export const INSIDER_SIGNALS = {
  strong_buy_min_buyers: 3,           // 3+ distinct insiders buying
  strong_buy_min_value: 100000,       // ≥ $100K aggregate purchases
  strong_buy_window_days: 90,
  caution_sell_buy_ratio: 5,          // net selling exceeds net buying by 5x
  caution_requires_csuite: true,      // selling must be by CEO/CFO/COO
};

// Secular Disruption Modifier (Update 7)
export const SECULAR_DISRUPTION = {
  // Classification thresholds (number of indicators present)
  none_max: 1,        // 0-1 indicators = no disruption
  early_max: 2,       // 2 indicators = early-stage
  active_max: 3,      // 3 indicators = active disruption
  // 4-5 = advanced disruption

  // Attractor score adjustments
  early_score_adjustment: -0.5,
  active_score_adjustment: -1.0,
  advanced_score_adjustment: -1.5,

  // MoS adjustments (percentage points added to base MoS)
  early_mos_adjustment: 0,
  active_mos_adjustment: 10,
  advanced_mos_adjustment: 15,

  // Floor for adjusted score
  adjusted_score_floor: 1.0,
};

// Sectors requiring mandatory secular disruption assessment (Update 7)
export const MANDATORY_DISRUPTION_SECTORS = ['Technology', 'Information Technology'];

// Sell Discipline Rules
export const SELL_RULES = [
  'price_exceeds_iv',
  'attractor_dissolution',
  'thesis_violation',
  'better_opportunity',
  'concentration_creep',
  'adjacent_possible_invalidation',
];
