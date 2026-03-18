-- Core stock data, refreshed daily
CREATE TABLE stocks (
    ticker TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    sector TEXT,
    industry TEXT,
    market_cap REAL,
    last_updated TEXT NOT NULL  -- ISO 8601
);

-- Annual financial data, one row per ticker per year
CREATE TABLE financials (
    ticker TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    eps REAL,
    book_value_per_share REAL,
    total_debt REAL,
    shareholder_equity REAL,
    current_assets REAL,
    current_liabilities REAL,
    free_cash_flow REAL,
    dividend_paid INTEGER NOT NULL DEFAULT 0,  -- boolean
    shares_outstanding REAL,
    revenue REAL,
    net_income REAL,
    roic REAL,
    PRIMARY KEY (ticker, fiscal_year),
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Current market data, refreshed daily
CREATE TABLE market_data (
    ticker TEXT PRIMARY KEY,
    price REAL NOT NULL,
    pe_ratio REAL,
    pb_ratio REAL,
    earnings_yield REAL,
    dividend_yield REAL,
    insider_ownership_pct REAL,
    fetched_at TEXT NOT NULL,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Graham formula + adjustments
CREATE TABLE valuations (
    ticker TEXT PRIMARY KEY,
    normalized_eps REAL,          -- 3-year average
    estimated_growth_rate REAL,   -- g in Graham formula
    aaa_bond_yield REAL,          -- at time of calculation
    graham_intrinsic_value REAL,  -- base formula result
    fat_tail_discount REAL,       -- 0.0, 0.10, or 0.15
    adjusted_intrinsic_value REAL,-- after fat-tail discount
    margin_of_safety_required REAL, -- 0.25 or 0.40
    buy_below_price REAL,         -- adjusted IV × (1 - margin)
    discount_to_iv_pct REAL,      -- current discount (or premium)
    calculated_at TEXT NOT NULL,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Attractor stability analysis (Claude-generated)
CREATE TABLE attractor_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    analysis_date TEXT NOT NULL,
    -- Individual factor scores (1-5)
    revenue_durability_score INTEGER,
    competitive_reinforcement_score INTEGER,
    industry_structure_score INTEGER,
    demand_feedback_score INTEGER,
    adaptation_capacity_score INTEGER,
    -- Composite
    attractor_stability_score REAL,  -- average of above
    -- Network regime
    network_regime TEXT CHECK(network_regime IN
        ('classical', 'soft_network', 'hard_network', 'platform')),
    -- Claude's reasoning (stored for review)
    analysis_text TEXT,
    -- Red flags identified
    red_flags TEXT,  -- JSON array of strings
    -- Capital allocation discipline (Update 2 — 6th factor)
    capital_allocation_score INTEGER,
    -- Data sources used
    sources_used TEXT,  -- JSON array
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Layer 1 screening results
CREATE TABLE screen_results (
    ticker TEXT NOT NULL,
    screen_date TEXT NOT NULL,
    passes_pe INTEGER NOT NULL DEFAULT 0,
    passes_pb INTEGER NOT NULL DEFAULT 0,
    passes_pe_x_pb INTEGER NOT NULL DEFAULT 0,
    passes_debt_equity INTEGER NOT NULL DEFAULT 0,
    passes_current_ratio INTEGER NOT NULL DEFAULT 0,
    passes_earnings_stability INTEGER NOT NULL DEFAULT 0,
    passes_dividend_record INTEGER NOT NULL DEFAULT 0,
    passes_earnings_growth INTEGER NOT NULL DEFAULT 0,
    passes_all_hard INTEGER NOT NULL DEFAULT 0,
    -- Soft filters
    passes_fcf INTEGER,
    passes_insider_ownership INTEGER,
    passes_dilution INTEGER,
    -- Tier classification (Update 4)
    tier TEXT CHECK(tier IN ('full_pass', 'near_miss', 'fail')) DEFAULT 'fail',
    pass_count INTEGER DEFAULT 0,
    sector_pb_threshold REAL,
    failed_filter TEXT,
    miss_severity TEXT CHECK(miss_severity IN ('marginal', 'clear')),
    actual_value REAL,
    threshold_value REAL,
    PRIMARY KEY (ticker, screen_date),
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Watchlist
CREATE TABLE watchlist (
    ticker TEXT PRIMARY KEY,
    added_date TEXT NOT NULL,
    notes TEXT,
    target_buy_price REAL,
    alert_enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Portfolio holdings
CREATE TABLE holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN ('core', 'asymmetric')),
    shares REAL NOT NULL,
    cost_basis_per_share REAL NOT NULL,
    purchase_date TEXT NOT NULL,
    purchase_thesis TEXT,  -- why you bought it
    attractor_score_at_purchase REAL,
    time_horizon_months INTEGER,  -- for asymmetric positions
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Transaction log (buys and sells)
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'trim')),
    shares REAL NOT NULL,
    price_per_share REAL NOT NULL,
    transaction_date TEXT NOT NULL,
    reason TEXT,  -- maps to sell discipline rules
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Portfolio snapshots for performance tracking
CREATE TABLE portfolio_snapshots (
    snapshot_date TEXT PRIMARY KEY,
    total_value REAL NOT NULL,
    total_cost_basis REAL NOT NULL,
    cash_balance REAL NOT NULL,
    core_pct REAL,
    asymmetric_pct REAL,
    sector_concentrations TEXT  -- JSON object
);

-- Adjacent possible assessment (asymmetric candidates only)
CREATE TABLE adjacent_possible_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    analysis_date TEXT NOT NULL,
    -- Individual factor scores (1-5)
    component_maturity_score INTEGER,
    behavioral_adjacency_score INTEGER,
    analogous_precedent_score INTEGER,
    combinatorial_clarity_score INTEGER,
    infrastructure_readiness_score INTEGER,
    -- Composite
    adjacent_possible_score REAL,  -- average of above
    -- Key components identified
    existing_components TEXT,  -- JSON array of strings describing what already exists
    missing_components TEXT,  -- JSON array of strings describing what must be created/proven
    -- Analogous transitions cited
    precedents TEXT,  -- JSON array of strings
    -- Recommended time horizon
    recommended_horizon_months INTEGER,
    -- Max position size constraint
    max_position_pct REAL,  -- 0.05 or 0.03 based on score
    -- Claude's reasoning
    analysis_text TEXT,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Concentration risk assessment (extracted by Claude API from 10-K filings)
CREATE TABLE concentration_risk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    analysis_date TEXT NOT NULL,
    -- Customer concentration
    largest_customer_pct REAL,       -- % of revenue, null if not disclosed
    largest_customer_name TEXT,      -- if disclosed
    customers_above_10pct INTEGER,   -- count of customers disclosed as >10%
    -- Supplier concentration
    single_source_supplier INTEGER NOT NULL DEFAULT 0,  -- boolean
    supplier_details TEXT,           -- description
    -- Geographic concentration
    largest_geo_market_pct REAL,     -- % of revenue
    largest_geo_market_name TEXT,
    -- Regulatory concentration
    regulatory_dependency_pct REAL,  -- % of revenue tied to single reg/contract
    regulatory_details TEXT,
    -- Computed modifier
    concentration_penalty REAL NOT NULL DEFAULT 0.0,  -- total score reduction
    -- Source
    analysis_text TEXT,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Insider transactions from SEC EDGAR Form 4 filings
CREATE TABLE insider_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    filing_date TEXT NOT NULL,
    insider_name TEXT NOT NULL,
    insider_title TEXT,              -- CEO, CFO, Director, VP, etc.
    transaction_type TEXT NOT NULL CHECK(transaction_type IN
        ('buy', 'sell', 'option_exercise', 'gift', 'other')),
    shares REAL NOT NULL,
    price_per_share REAL,
    total_value REAL,
    is_10b5_1 INTEGER NOT NULL DEFAULT 0,  -- boolean: pre-planned sale
    source_url TEXT,                 -- link to Form 4 on EDGAR
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Computed insider signals (aggregated from insider_transactions)
CREATE TABLE insider_signals (
    ticker TEXT PRIMARY KEY,
    signal_date TEXT NOT NULL,       -- date signal was computed
    trailing_90d_buys INTEGER,       -- count of open-market purchases
    trailing_90d_buy_value REAL,     -- aggregate dollar value
    trailing_90d_sells INTEGER,      -- count of discretionary C-suite sells
    trailing_90d_sell_value REAL,
    unique_buyers_90d INTEGER,       -- count of distinct insiders buying
    signal TEXT CHECK(signal IN ('strong_buy', 'neutral', 'caution')),
    signal_details TEXT,             -- human-readable summary
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

-- Rebalancing alerts
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type TEXT NOT NULL,
    ticker TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    dismissed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);
