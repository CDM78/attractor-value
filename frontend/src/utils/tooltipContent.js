export const TOOLTIP_CONTENT = {

  // Layer 1 metrics
  pe_ratio: {
    label: 'Price-to-Earnings (P/E)',
    description: 'How much you\'re paying per dollar of earnings. Lower = cheaper. The threshold adjusts with interest rates.',
    formula: 'Max P/E = 1 / (AAA yield + 0.015)',
    anchor: 'layer-1',
  },
  pb_ratio: {
    label: 'Price-to-Book (P/B)',
    description: 'Price relative to net asset value. Compared to the stock\'s own sector \u2014 must be in the cheapest third.',
    formula: 'Pass if P/B \u2264 sector 33rd percentile AND \u2264 5.0',
    anchor: 'layer-1',
  },
  pe_x_pb: {
    label: 'P/E \u00D7 P/B Composite',
    description: 'Graham\'s composite ceiling. Base \u2264 40. Adjusted upward for high-ROE companies: ROE 20\u201330% \u2192 ceiling 50; ROE 30%+ \u2192 ceiling 60. Rewards exceptional capital allocators.',
    formula: 'Base \u2264 40 | ROE 20-30%: \u2264 50 | ROE 30%+: \u2264 60',
    anchor: 'layer-1',
  },
  debt_equity: {
    label: 'Debt-to-Equity',
    description: 'Total debt \u00F7 shareholder equity. Measures leverage. Threshold varies by sector. Financial companies are exempt.',
    formula: 'Industrial \u2264 1.0 | Utilities/Energy \u2264 2.0 | Financials: exempt',
    anchor: 'layer-1',
  },
  current_ratio: {
    label: 'Current Ratio',
    description: 'Current assets \u00F7 current liabilities. Can the company pay its short-term bills? Financial companies exempt.',
    formula: 'Must be \u2265 1.0',
    anchor: 'layer-1',
  },
  earnings_stability: {
    label: 'Earnings Stability',
    description: 'Positive earnings in at least 8 of the last 10 years. One or two bad years is OK \u2014 chronic losses are not.',
    anchor: 'layer-1',
  },
  dividend_record: {
    label: 'Dividend Record',
    description: 'Dividends paid every year for the last 5 years. A sign of financial discipline and real cash generation.',
    anchor: 'layer-1',
  },
  earnings_growth: {
    label: 'Earnings Growth',
    description: 'At least 3% annual earnings growth over the available history. Value investing doesn\'t mean buying stagnant businesses.',
    formula: 'CAGR of 3-year average EPS (early vs recent) \u2265 3%',
    anchor: 'layer-1',
  },

  // Tiers and signals
  full_pass: {
    label: 'Full Pass',
    description: 'Stock passes all 8 hard filters. Proceeds to valuation and attractor analysis.',
    anchor: 'layer-1',
  },
  near_miss: {
    label: 'Near Miss',
    description: 'Passes 7 of 8 filters. The failed filter and miss severity are shown. May still receive a BUY signal after attractor analysis.',
    anchor: 'layer-1',
  },
  miss_severity: {
    label: 'Miss Severity',
    description: 'How far the stock missed the failed filter. Marginal = within 10% of threshold. Clear = more than 10%.',
    anchor: 'layer-1',
  },
  auto_pass: {
    label: 'Auto-Pass (Sector Exempt)',
    description: 'This filter is exempt for financial sector companies. Banks and insurers use different leverage and liquidity metrics.',
    anchor: 'layer-1',
  },

  // Layer 2
  intrinsic_value: {
    label: 'Intrinsic Value',
    description: 'Estimated fair value of the stock based on normalized earnings, growth, and interest rates. The price the business is "worth."',
    formula: 'IV = EPS \u00D7 (8.5 + 2g) \u00D7 (4.4 / AAA yield)',
    anchor: 'layer-2',
  },
  adjusted_iv: {
    label: 'Adjusted Intrinsic Value',
    description: 'Intrinsic value after the fat-tail discount. Accounts for the risk of extreme market events.',
    formula: 'Adjusted IV = IV \u00D7 (1 - fat-tail discount)',
    anchor: 'layer-2',
  },
  fat_tail_discount: {
    label: 'Fat-Tail Discount',
    description: 'A 0\u201315% reduction to intrinsic value based on the company\'s earnings volatility history. Companies that weathered downturns without losses get no discount.',
    anchor: 'layer-2',
  },
  margin_of_safety: {
    label: 'Margin of Safety',
    description: 'The required discount below intrinsic value before buying. Ranges from 25% to 45% depending on attractor score, network regime, and screening tier.',
    anchor: 'layer-2',
  },
  buy_below_price: {
    label: 'Buy-Below Price',
    description: 'The maximum price at which the stock qualifies as a BUY. If the current price is at or below this, the margin of safety condition is met.',
    formula: 'Buy Below = Adjusted IV \u00D7 (1 - margin of safety)',
    anchor: 'layer-2',
  },
  discount_to_iv: {
    label: 'Discount to Intrinsic Value',
    description: 'How far below estimated fair value the stock is trading. Positive = undervalued. Negative = overvalued.',
    formula: '((Adjusted IV - Price) / Adjusted IV) \u00D7 100',
    anchor: 'layer-2',
  },
  normalized_eps: {
    label: 'Normalized EPS',
    description: 'Average earnings per share over the last 3 years. Smooths out one-off spikes or dips to give a more reliable picture.',
    anchor: 'layer-2',
  },
  growth_rate: {
    label: 'Estimated Growth Rate',
    description: 'The annualized earnings growth rate used in the Graham formula. Based on historical EPS trend, capped at 7% to prevent overoptimism.',
    anchor: 'layer-2',
  },

  // Layer 3
  attractor_score: {
    label: 'Attractor Score',
    description: 'Average of 6 qualitative factors (1\u20135) assessing competitive durability, minus concentration penalties. \u2265 3.5 = Stable, 2.0\u20133.4 = Transitional, < 2.0 = Dissolving.',
    anchor: 'layer-3',
  },
  revenue_durability: {
    label: 'Revenue Durability',
    description: 'How recurring, diversified, and switching-cost-protected is the revenue? Subscription models score high. One-time commodity sales score low.',
    anchor: 'layer-3',
  },
  competitive_reinforcement: {
    label: 'Competitive Reinforcement',
    description: 'Do the company\'s advantages compound over time? Brands that build, data moats that deepen, and scale that lowers costs all score high.',
    anchor: 'layer-3',
  },
  industry_structure: {
    label: 'Industry Structure',
    description: 'Is the industry consolidated with rational competitors and high barriers? Or fragmented with price wars and low barriers?',
    anchor: 'layer-3',
  },
  demand_feedback: {
    label: 'Demand Feedback',
    description: 'Does customer behavior create positive feedback loops? Ecosystem lock-in, habit formation, and platform dynamics score high.',
    anchor: 'layer-3',
  },
  adaptation_capacity: {
    label: 'Adaptation Capacity',
    description: 'Can the company adapt to disruption without destroying its core? Track record of navigating change scores high. Rigid single-product companies score low.',
    anchor: 'layer-3',
  },
  capital_allocation: {
    label: 'Capital Allocation',
    description: 'Does management deploy capital well? Smart acquisitions, buybacks at reasonable prices, and reinvestment that generates returns above cost of capital.',
    anchor: 'layer-3',
  },
  concentration_risk: {
    label: 'Concentration Risk',
    description: 'Penalty applied when a company depends too heavily on one customer, supplier, market, or regulation. Can reduce attractor score by up to 2.8 points.',
    anchor: 'layer-3',
  },
  network_regime: {
    label: 'Network Regime',
    description: 'The type of competitive dynamics: Classical (traditional moats), Soft Network (mild network effects), Hard Network (winner-take-all), or Platform (multi-sided marketplace).',
    anchor: 'layer-3',
  },

  // Layer 4
  adjacent_possible_score: {
    label: 'Adjacent Possible Score',
    description: 'Measures whether a company\'s growth opportunity is one combinatorial step from existing reality (high score) or requires multiple unproven leaps (low score).',
    anchor: 'layer-4',
  },

  // Insider signals
  insider_signal: {
    label: 'Insider Signal',
    description: 'Based on SEC Form 4 filings. Strong Buy = multiple insiders buying. Caution = heavy C-suite selling. Neutral = no clear pattern. Confirming indicator, not a filter.',
    anchor: 'insider-signals',
  },
  insider_strong_buy: {
    label: 'Insider Strong Buy Signal',
    description: '3+ distinct insiders made open-market purchases within 90 days, totaling \u2265 $100K. People with inside knowledge are putting their own money in.',
    anchor: 'insider-signals',
  },
  insider_caution: {
    label: 'Insider Caution Signal',
    description: 'Net insider selling exceeds buying by 5\u00D7+ and includes C-suite executives, OR a single insider sold > $10M in 90 days. Investigate before buying.',
    anchor: 'insider-signals',
  },

  // Portfolio
  core_holding: {
    label: 'Core Holding',
    description: 'A position in the 70\u201385% core tier. Deep-value stocks passing all framework layers. Max 8% per position, 12\u201320 positions total.',
    anchor: 'portfolio-rules',
  },
  asymmetric_position: {
    label: 'Asymmetric Position',
    description: 'A position in the 15\u201330% speculative tier. Companies near a phase transition. Max 5% per position, 3\u20136 positions, with defined time horizons.',
    anchor: 'portfolio-rules',
  },

  // Signals
  signal_buy: {
    label: 'BUY Signal',
    description: 'Full Pass + price at or below buy-below + stable attractor confirmed. All conditions met for purchase.',
    anchor: 'signals-summary',
  },
  signal_buy_transitional: {
    label: 'BUY (TRANSITIONAL)',
    description: 'Full Pass + price at or below buy-below + transitional attractor (2.0\u20133.4). Higher margin of safety (40%) applied. Monitor quarterly.',
    anchor: 'signals-summary',
  },
  signal_buy_near_miss: {
    label: 'BUY (NEAR MISS)',
    description: '7/8 filters passed + price below buy-below + attractor confirmed + AI recommends proceeding. Higher margin applied.',
    anchor: 'signals-summary',
  },
  signal_wait: {
    label: 'WAIT Signal',
    description: 'Stock is undervalued (price < intrinsic value) but hasn\'t reached the buy-below price. Not enough margin of safety yet.',
    anchor: 'signals-summary',
  },
  signal_over: {
    label: 'OVER Signal',
    description: 'Stock price exceeds adjusted intrinsic value. Overvalued. Don\'t buy. If held, consider selling.',
    anchor: 'signals-summary',
  },

  // Financial sector specific
  roe: {
    label: 'Return on Equity (ROE)',
    description: 'Net income \u00F7 shareholder equity. The primary profitability metric for banks and insurance companies. Replaces ROIC for financial sector stocks.',
    anchor: 'layer-3',
  },
  roic: {
    label: 'Return on Invested Capital (ROIC)',
    description: 'Net operating profit \u00F7 invested capital. Measures how efficiently a company turns investment into profit. Not used for financial companies.',
    anchor: 'layer-2',
  },
  debt_to_total_capital: {
    label: 'Debt / Total Capital',
    description: 'Total debt \u00F7 (total debt + total equity). Used instead of D/E for financial companies, where standard D/E is not meaningful.',
    anchor: 'layer-1',
  },

  // ========================================
  // Multi-Tier Pipeline (Restructuring)
  // ========================================

  // Discovery tiers
  tier2_crisis: {
    label: 'Tier 2: Crisis Dislocation',
    description: 'Quality companies temporarily discounted by market-wide fear. Only activates during actual crises (S&P 500 down 20%+). Screens for intact business models with temporary price drops.',
    anchor: 'how-opportunities-found',
  },
  tier3_dks: {
    label: 'Tier 3: Emerging DKS',
    description: 'Companies building self-reinforcing competitive positions (flywheels). Monthly scan for high-growth (20%+ revenue CAGR) or steady compounders (8%+ CAGR with strong moats).',
    anchor: 'how-opportunities-found',
  },
  tier4_regime: {
    label: 'Tier 4: Regime Transition',
    description: 'Companies positioned to benefit from structural economic shifts (new legislation, geopolitical events, technology breakthroughs). Filters out consensus plays.',
    anchor: 'how-opportunities-found',
  },

  // DKS / Flywheel
  dks_score: {
    label: 'DKS Score',
    description: 'Dynamic Kinetic Stability score (1-5). Measures how self-reinforcing a company\'s competitive position is. Score \u2265 3.0 needed to proceed to attractor analysis.',
    anchor: 'how-companies-evaluated',
  },
  flywheel: {
    label: 'Flywheel / DKS Mechanism',
    description: 'A self-reinforcing cycle where each part of the business strengthens the others. Example: more users \u2192 more data \u2192 better product \u2192 more users. Companies without an identifiable flywheel are rejected.',
    anchor: 'how-companies-evaluated',
  },
  scaling_exponent: {
    label: 'Scaling Exponent',
    description: 'Revenue growth rate \u00F7 asset/employee growth rate. Above 1.0 = superlinear (revenue grows faster than inputs, indicating self-reinforcing dynamics). Below 1.0 = sublinear (diminishing returns).',
    anchor: 'how-companies-evaluated',
  },
  moat_type: {
    label: 'Moat Type',
    description: 'The primary competitive defense mechanism: network_effect (users attract more users), switching_cost (hard to leave), data_moat (proprietary data), platform (multi-sided marketplace), scale (cost advantages), or brand (pricing power).',
    anchor: 'how-companies-evaluated',
  },

  // Consensus / CSI
  csi: {
    label: 'Consensus Saturation Index',
    description: 'Measures how widely known an investment thesis is. Score 0-3 based on analyst mentions, volume anomalies, and valuation premium. Score \u2264 1 = not saturated (proceed). Score 2-3 = consensus play (reject \u2014 if everyone knows, it\'s priced in).',
    anchor: 'how-opportunities-found',
  },

  // Regime
  regime_transition: {
    label: 'Regime Transition',
    description: 'A structural shift in economic, geopolitical, or technological landscape that creates lasting changes in industry dynamics. Examples: CHIPS Act (semiconductor reshoring), European rearmament, AI infrastructure buildout.',
    anchor: 'how-opportunities-found',
  },
  regime_status: {
    label: 'Regime Status',
    description: 'Pending: identified but not confirmed. Active: confirmed by quantitative data or repeated AI detection. Matured: shift is fully priced in. Invalidated: thesis didn\'t materialize.',
    anchor: 'how-opportunities-found',
  },
  scurve_position: {
    label: 'S-Curve Position',
    description: 'Where on the adoption curve a regime transition sits. Early = low adoption, high upside. Inflection = rapid adoption phase. Late = widespread adoption, diminishing returns. Best entry is early or approaching inflection.',
    anchor: 'how-opportunities-found',
  },
  adjacent_possible: {
    label: 'Adjacent Possible Score',
    description: 'How many components of a regime shift are already in place (1-5). Score 4-5 = most pieces exist, transition is imminent. Score 1-2 = too many missing pieces, thesis is speculative.',
    anchor: 'how-opportunities-found',
  },

  // Crisis
  crisis_active: {
    label: 'Crisis Active',
    description: 'Market conditions meeting crisis threshold: S&P 500 down 20%+ from 52-week high, OR 2+ severe indicators (VIX >30, credit spreads widening, S&P down 15%+). Activates Tier 2 screening.',
    anchor: 'market-environment',
  },
  crisis_severity: {
    label: 'Crisis Severity',
    description: 'Mild: S&P 500 down 15-20%. Moderate: down 20-30%. Severe: down 30%+. Severity determines the minimum stock decline needed for Tier 2 entry (less decline needed in severe crises because quality companies drop less).',
    anchor: 'market-environment',
  },

  // Signals
  signal_buy: {
    label: 'BUY Signal',
    description: 'Price is below the buy-below threshold with adequate margin of safety, and the attractor score is \u2265 2.5. The system has computed exact share count and dollar amount. Execute this trade.',
    anchor: 'what-signals-mean',
  },
  signal_not_yet: {
    label: 'NOT YET Signal',
    description: 'Company passes all quality checks but the current price hasn\'t dropped enough. On the watchlist with a specific target price. The system will alert you if price reaches the buy-below level.',
    anchor: 'what-signals-mean',
  },
  signal_pass: {
    label: 'PASS Signal',
    description: 'Either the company failed quality checks (attractor too weak, fundamentals inadequate) or it\'s overvalued. Not an opportunity right now.',
    anchor: 'what-signals-mean',
  },
  signal_confidence_strong: {
    label: 'STRONG Confidence',
    description: 'Price is at or below 90% of the buy-below price. Exceptional discount. Full position size recommended.',
    anchor: 'what-signals-mean',
  },
  signal_confidence_standard: {
    label: 'STANDARD Confidence',
    description: 'Price is below buy-below but within 10% of it. Good but not exceptional. Position size reduced to 75% of maximum.',
    anchor: 'what-signals-mean',
  },

  // Sell triggers
  sell_overvalued: {
    label: 'SELL: Overvalued',
    description: 'Current price exceeds intrinsic value. The market has priced in more than the fundamentals justify. Sell entire position.',
    anchor: 'sell-discipline',
  },
  sell_dissolving: {
    label: 'SELL: Dissolving',
    description: 'Attractor score dropped below 2.0. The competitive position is actively eroding. Sell immediately \u2014 this overrides tax-delay recommendations.',
    anchor: 'sell-discipline',
  },
  sell_thesis_broken: {
    label: 'SELL: Thesis Broken',
    description: 'A fundamental change has invalidated the original investment thesis. Multiple red flags identified. Sell entire position.',
    anchor: 'sell-discipline',
  },
  trim_overweight: {
    label: 'TRIM: Overweight',
    description: 'Position has grown to exceed 8% of portfolio through appreciation. Trim to 5% target. This is risk management, not a negative signal about the company.',
    anchor: 'sell-discipline',
  },
  sell_growth_stalled: {
    label: 'SELL: Growth Stalled (Tier 3)',
    description: 'Revenue growth dropped below 10% for consecutive periods. The growth flywheel that justified the investment is no longer spinning. Tier 3 only.',
    anchor: 'sell-discipline',
  },
  trim_regime_maturing: {
    label: 'TRIM: Regime Maturing (Tier 4)',
    description: 'The structural shift that drove the investment is now widely priced in (regime status: matured) and the stock has appreciated 50%+. Take half the profit. Tier 4 only.',
    anchor: 'sell-discipline',
  },

  // Position sizing / allocation
  flexible_allocation: {
    label: 'Flexible Allocation (30%)',
    description: '30% of capital not pre-assigned to any tier. When a BUY signal fires and its tier\'s dedicated budget is full, the flexible pool is used. Prevents missing good opportunities due to artificial tier caps.',
    anchor: 'position-sizing',
  },
  cash_reserve: {
    label: 'Cash Reserve (5%)',
    description: '5% always held in cash. Ensures you can act on a new BUY signal without selling an existing position. Earns money market rate.',
    anchor: 'position-sizing',
  },
  position_size_limit: {
    label: 'Position Size Limit',
    description: 'No single position exceeds 5% of total portfolio. Prevents concentration risk. STRONG confidence gets full 5%, STANDARD gets 3.75% (75% multiplier).',
    anchor: 'position-sizing',
  },

  // Environment
  environment_normal: {
    label: 'NORMAL Environment',
    description: 'No stress signals. Credit spreads, yield curve, VIX, and employment all within normal ranges. Standard margins of safety apply.',
    anchor: 'market-environment',
  },
  environment_cautious: {
    label: 'CAUTIOUS Environment',
    description: 'One or more stress indicators present (elevated credit spreads, flat yield curve, VIX >25). Exercise additional scrutiny on cyclical and leveraged companies.',
    anchor: 'market-environment',
  },
  environment_stressed: {
    label: 'STRESSED Environment',
    description: 'Multiple severe stress signals (inverted yield curve, credit spreads at extremes, VIX >30). Margins of safety automatically increased by 5 percentage points. Value traps are most dangerous here.',
    anchor: 'market-environment',
  },

  // Tax
  tax_aware_timing: {
    label: 'Tax-Aware Sell Timing',
    description: 'When a SELL trigger fires on a profitable position held 300-365 days, the system calculates whether waiting for long-term capital gains rate (~23% vs ~40%) saves more in tax than the risk of holding. Exception: attractor dissolution always sells immediately.',
    anchor: 'sell-discipline',
  },

  // Valuation methods
  valuation_graham: {
    label: 'Graham Formula (Tier 2)',
    description: 'IV = Normalized EPS \u00D7 (8.5 + 2g) \u00D7 (4.4/Y). Used for established companies bought during crises. Adjusted for ROE, fat-tail risk, and attractor stability.',
    formula: 'IV = EPS \u00D7 (8.5 + 2g) \u00D7 (4.4/Y)',
    anchor: 'how-valued',
  },
  valuation_growth: {
    label: 'Growth-Adjusted Revenue (Tier 3)',
    description: 'Projects revenue 3 years forward at decelerating growth rates, applies target operating margin, uses terminal P/E, and discounts back at 12% required return. For emerging growth companies where Graham doesn\'t apply.',
    anchor: 'how-valued',
  },
  valuation_scenario: {
    label: 'Scenario-Weighted (Tier 4)',
    description: 'Values the stock under bull case (regime materializes) and bear case (regime fizzles). Weights by adjacent possible score. Higher margin of safety due to regime uncertainty.',
    anchor: 'how-valued',
  },
}
