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
    description: 'Graham\'s combined ceiling. Prevents both multiples from being elevated at the same time.',
    formula: 'Must be \u2264 22.5',
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
    formula: 'Must be \u2265 1.5',
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
}
