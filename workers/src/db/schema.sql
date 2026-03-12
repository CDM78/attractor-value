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
