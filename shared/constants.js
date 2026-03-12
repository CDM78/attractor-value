// Graham-Dodd Quantitative Filter Thresholds
export const SCREEN_DEFAULTS = {
  pe_max: 15,
  pb_max: 1.5,
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

// Margin of Safety Requirements
export const MARGIN_OF_SAFETY = {
  stable_classical: 0.25,
  stable_soft_network: 0.25,
  stable_hard_network_non_leader: 0.40,
  transitional_any: 0.40,
};

// Fat-Tail Discounts
export const FAT_TAIL = {
  survived_downturn: 0.0,
  untested: 0.10,
  transitional: 0.15,
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

// Sell Discipline Rules
export const SELL_RULES = [
  'price_exceeds_iv',
  'attractor_dissolution',
  'thesis_violation',
  'better_opportunity',
  'concentration_creep',
  'adjacent_possible_invalidation',
];
