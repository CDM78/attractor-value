// Reusable D1 query helpers

export async function upsertStock(db, stock) {
  return db.prepare(
    `INSERT OR REPLACE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    stock.ticker, stock.company_name, stock.sector, stock.industry,
    stock.market_cap, new Date().toISOString()
  ).run();
}

export async function upsertMarketData(db, data) {
  return db.prepare(
    `INSERT OR REPLACE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.ticker, data.price, data.pe_ratio, data.pb_ratio,
    data.earnings_yield, data.dividend_yield, data.insider_ownership_pct,
    new Date().toISOString()
  ).run();
}

export async function upsertFinancials(db, fin) {
  return db.prepare(
    `INSERT OR REPLACE INTO financials (ticker, fiscal_year, eps, book_value_per_share, total_debt, shareholder_equity, current_assets, current_liabilities, free_cash_flow, dividend_paid, shares_outstanding, revenue, net_income, roic, goodwill, operating_cash_flow, total_assets)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    fin.ticker, fin.fiscal_year, fin.eps, fin.book_value_per_share,
    fin.total_debt, fin.shareholder_equity, fin.current_assets,
    fin.current_liabilities, fin.free_cash_flow, fin.dividend_paid,
    fin.shares_outstanding, fin.revenue, fin.net_income, fin.roic,
    fin.goodwill ?? null, fin.operating_cash_flow ?? null, fin.total_assets ?? null
  ).run();
}

export async function getFinancialsForTicker(db, ticker, limit = 10) {
  const result = await db.prepare(
    'SELECT * FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT ?'
  ).bind(ticker, limit).all();
  return result.results || [];
}

export async function saveScreenResult(db, ticker, screenDate, results) {
  // Ensure ROE/pe_x_pb_ceiling columns exist (added by calibration backlog)
  try {
    await db.prepare("ALTER TABLE screen_results ADD COLUMN roe_5yr_avg REAL").run();
  } catch { /* column already exists */ }
  try {
    await db.prepare("ALTER TABLE screen_results ADD COLUMN pe_x_pb_ceiling_used REAL").run();
  } catch { /* column already exists */ }

  return db.prepare(
    `INSERT OR REPLACE INTO screen_results (ticker, screen_date, passes_pe, passes_pb, passes_pe_x_pb, passes_debt_equity, passes_current_ratio, passes_earnings_stability, passes_dividend_record, passes_earnings_growth, passes_all_hard, passes_fcf, passes_insider_ownership, passes_dilution, tier, pass_count, sector_pb_threshold, failed_filter, miss_severity, actual_value, threshold_value, de_auto_pass, cr_auto_pass, roe_5yr_avg, pe_x_pb_ceiling_used, is_small_cap, liquidity_flag, accruals_ratio, goodwill_ratio, revenue_quality_flag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ticker, screenDate, results.passes_pe, results.passes_pb, results.passes_pe_x_pb,
    results.passes_debt_equity, results.passes_current_ratio, results.passes_earnings_stability,
    results.passes_dividend_record, results.passes_earnings_growth, results.passes_all_hard,
    results.passes_fcf, results.passes_insider_ownership, results.passes_dilution,
    results.tier || 'fail', results.pass_count || 0, results.sector_pb_threshold || null,
    results.failed_filter || null, results.miss_severity || null,
    results.actual_value || null, results.threshold_value || null,
    results.de_auto_pass || 0, results.cr_auto_pass || 0,
    results.roe_5yr_avg ?? null, results.pe_x_pb_ceiling_used ?? null,
    results.is_small_cap ?? 0, results.liquidity_flag ?? null,
    results.accruals_ratio ?? null, results.goodwill_ratio ?? null,
    results.revenue_quality_flag ?? null
  ).run();
}

// Cache-aware helpers

// Check if market data is fresh (within TTL hours)
export async function isMarketDataFresh(db, ticker, ttlHours = 24) {
  const row = await db.prepare(
    `SELECT fetched_at FROM market_data WHERE ticker = ? AND fetched_at > datetime('now', '-${ttlHours} hours')`
  ).bind(ticker).first();
  return !!row;
}

// Check if financials exist for a ticker (30-day TTL)
export async function hasRecentFinancials(db, ticker) {
  const row = await db.prepare(
    `SELECT last_updated FROM stocks WHERE ticker = ? AND last_updated > datetime('now', '-30 days')`
  ).bind(ticker).first();
  return !!row;
}

// Get all tickers in the universe
export async function getAllTickers(db) {
  const result = await db.prepare('SELECT ticker FROM stocks ORDER BY ticker').all();
  return (result.results || []).map(r => r.ticker).filter(t => !t.startsWith('__'));
}

// Get tickers needing market data refresh
export async function getStaleMarketDataTickers(db, ttlHours = 24) {
  const result = await db.prepare(
    `SELECT s.ticker FROM stocks s
     LEFT JOIN market_data md ON s.ticker = md.ticker
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND (md.fetched_at IS NULL OR md.fetched_at < datetime('now', '-${ttlHours} hours'))
     ORDER BY s.ticker`
  ).all();
  return (result.results || []).map(r => r.ticker);
}

// Batch insert using D1 batch API for performance
export async function batchUpsertStocks(db, stocks) {
  const stmts = stocks.map(s =>
    db.prepare(
      `INSERT OR REPLACE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(s.ticker, s.company_name, s.sector, s.industry, s.market_cap, new Date().toISOString())
  );

  // D1 supports batching up to 100 statements
  const batches = [];
  for (let i = 0; i < stmts.length; i += 100) {
    batches.push(db.batch(stmts.slice(i, i + 100)));
  }
  return Promise.all(batches);
}

export async function upsertValuation(db, val) {
  return db.prepare(
    `INSERT OR REPLACE INTO valuations (ticker, normalized_eps, estimated_growth_rate, aaa_bond_yield, graham_intrinsic_value, fat_tail_discount, adjusted_intrinsic_value, margin_of_safety_required, buy_below_price, discount_to_iv_pct, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    val.ticker, val.normalized_eps, val.estimated_growth_rate, val.aaa_bond_yield,
    val.graham_intrinsic_value, val.fat_tail_discount, val.adjusted_intrinsic_value,
    val.margin_of_safety_required, val.buy_below_price, val.discount_to_iv_pct,
    val.calculated_at
  ).run();
}

export async function batchUpsertMarketData(db, items) {
  const stmts = items.map(d =>
    db.prepare(
      `INSERT OR REPLACE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(d.ticker, d.price, d.pe_ratio, d.pb_ratio, d.earnings_yield, d.dividend_yield, d.insider_ownership_pct, new Date().toISOString())
  );

  const batches = [];
  for (let i = 0; i < stmts.length; i += 100) {
    batches.push(db.batch(stmts.slice(i, i + 100)));
  }
  return Promise.all(batches);
}

// --- Small Cap / Session C helpers ---

export async function ensureSmallCapTables(db) {
  const alters = [
    // stocks table: cap tier classification
    "ALTER TABLE stocks ADD COLUMN cap_tier TEXT DEFAULT 'large'",
    // market_data table: volume data for liquidity filter
    "ALTER TABLE market_data ADD COLUMN avg_volume REAL",
    "ALTER TABLE market_data ADD COLUMN avg_dollar_volume REAL",
    // financials table: earnings quality inputs
    "ALTER TABLE financials ADD COLUMN goodwill REAL",
    "ALTER TABLE financials ADD COLUMN operating_cash_flow REAL",
    "ALTER TABLE financials ADD COLUMN total_assets REAL",
    // screen_results table: small cap flags and quality metrics
    "ALTER TABLE screen_results ADD COLUMN is_small_cap INTEGER DEFAULT 0",
    "ALTER TABLE screen_results ADD COLUMN liquidity_flag TEXT",
    "ALTER TABLE screen_results ADD COLUMN accruals_ratio REAL",
    "ALTER TABLE screen_results ADD COLUMN goodwill_ratio REAL",
    "ALTER TABLE screen_results ADD COLUMN revenue_quality_flag TEXT",
    // cik_map table: exchange and SIC for universe filtering
    "ALTER TABLE cik_map ADD COLUMN exchange TEXT",
    "ALTER TABLE cik_map ADD COLUMN sic TEXT",
  ];
  for (const sql of alters) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }

  // Staging table for universe build progress
  await db.prepare(`CREATE TABLE IF NOT EXISTS universe_candidates (
    cik TEXT PRIMARY KEY,
    ticker TEXT,
    company_name TEXT,
    exchange TEXT,
    sic TEXT,
    total_assets REAL,
    market_cap REAL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
}

// --- Multi-Tier Pipeline Tables (Comprehensive Restructuring) ---

export async function ensureMultiTierTables(db) {
  // Regime registry — tracks structural transitions (Tier 4 activation)
  await db.prepare(`CREATE TABLE IF NOT EXISTS regime_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    catalyst_type TEXT CHECK(catalyst_type IN
        ('commodity_break', 'policy', 'technology', 'geopolitical')),
    start_date TEXT NOT NULL,
    affected_sectors TEXT NOT NULL,
    regime_keywords TEXT NOT NULL,
    estimated_market_size_b REAL,
    adjacent_possible_score INTEGER,
    scurve_position TEXT,
    scurve_penetration_pct REAL,
    status TEXT DEFAULT 'pending'
      CHECK(status IN ('pending', 'active', 'matured', 'invalidated')),
    confirmed_by TEXT,
    ai_flag_count INTEGER DEFAULT 1,
    last_assessed TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  // Unified candidates table — all tiers feed into this
  await db.prepare(`CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    discovery_tier TEXT NOT NULL CHECK(discovery_tier IN ('tier2', 'tier3', 'tier4')),
    regime_id INTEGER,
    discovered_date TEXT NOT NULL,
    prescreen_pass INTEGER NOT NULL DEFAULT 0,
    prescreen_data TEXT,
    dks_score REAL,
    flywheel_description TEXT,
    moat_type TEXT,
    scaling_exponent REAL,
    crisis_assessment TEXT,
    price_decline_pct REAL,
    csi_score INTEGER,
    csi_interpretation TEXT,
    attractor_score REAL,
    bull_score REAL,
    bear_score REAL,
    attractor_analysis_date TEXT,
    intrinsic_value REAL,
    buy_below_price REAL,
    margin_of_safety REAL,
    valuation_method TEXT,
    valuation_date TEXT,
    signal TEXT CHECK(signal IN ('BUY', 'NOT_YET', 'PASS')),
    signal_confidence TEXT,
    signal_reason TEXT,
    recommended_shares INTEGER,
    recommended_dollars REAL,
    recommended_pct REAL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'purchased')),
    FOREIGN KEY (ticker) REFERENCES stocks(ticker),
    FOREIGN KEY (regime_id) REFERENCES regime_registry(id)
  )`).run();

  // Portfolio configuration — user settings
  await db.prepare(`CREATE TABLE IF NOT EXISTS portfolio_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  // Seed default config from calibration optimization
  const defaults = [
    ['total_capital', '10000'],
    ['tier2_allocation', '0.15'],
    ['tier3_allocation', '0.30'],
    ['tier4_allocation', '0.20'],
    ['flexible_allocation', '0.30'],
    ['cash_reserve', '0.05'],
    ['max_position_pct', '0.05'],
    ['tax_rate_short_term', '0.398'],
    ['tax_rate_long_term', '0.228'],
    ['tax_rate_state', '0.04'],
    ['default_analysis_model', 'claude-sonnet-4-20250514'],
    ['deep_analysis_model', 'claude-opus-4-20250514'],
    ['bulk_analysis_concurrency', '5'],
  ];
  for (const [key, value] of defaults) {
    await db.prepare(
      `INSERT OR IGNORE INTO portfolio_config (key, value) VALUES (?, ?)`
    ).bind(key, value).run();
  }

  // Add new columns to existing tables
  const alters = [
    "ALTER TABLE valuations ADD COLUMN valuation_method TEXT DEFAULT 'graham'",
    "ALTER TABLE valuations ADD COLUMN candidate_id INTEGER",
    "ALTER TABLE transactions ADD COLUMN candidate_id INTEGER",
    "ALTER TABLE transactions ADD COLUMN discovery_tier TEXT",
    "ALTER TABLE transactions ADD COLUMN tax_treatment TEXT",
    "ALTER TABLE transactions ADD COLUMN estimated_tax REAL",
    "ALTER TABLE transactions ADD COLUMN total_amount REAL",
    "ALTER TABLE attractor_analysis ADD COLUMN candidate_id INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_revenue_durability_score INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_competitive_reinforcement_score INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_industry_structure_score INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_demand_feedback_score INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_adaptation_capacity_score INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_capital_allocation_score INTEGER",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_raw_score REAL",
    "ALTER TABLE candidates ADD COLUMN analysis_model TEXT DEFAULT 'claude-sonnet-4-20250514'",
    "ALTER TABLE stocks ADD COLUMN pre_crisis_price REAL",
    "ALTER TABLE stocks ADD COLUMN pre_crisis_date TEXT",
    "ALTER TABLE stocks ADD COLUMN avg_volume_30d REAL",
    "ALTER TABLE stocks ADD COLUMN avg_volume_180d REAL",
    "ALTER TABLE stocks ADD COLUMN revenue_growth_3y REAL",
    "ALTER TABLE stocks ADD COLUMN gross_margin_pct REAL",
    "ALTER TABLE stocks ADD COLUMN shares_outstanding_m REAL",
    "ALTER TABLE attractor_analysis ADD COLUMN bull_case_text TEXT",
    "ALTER TABLE attractor_analysis ADD COLUMN bear_case_text TEXT",
  ];
  for (const sql of alters) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }

  // Index for fast candidate lookups
  try {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_candidates_ticker ON candidates(ticker, discovery_tier)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_candidates_signal ON candidates(signal)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_regime_status ON regime_registry(status)').run();
  } catch { /* indexes already exist */ }
}

// --- Multi-Tier Query Helpers ---

export async function upsertCandidate(db, candidate) {
  return db.prepare(
    `INSERT OR REPLACE INTO candidates (
      ticker, discovery_tier, regime_id, discovered_date, prescreen_pass, prescreen_data,
      dks_score, flywheel_description, moat_type, scaling_exponent,
      crisis_assessment, price_decline_pct, csi_score, csi_interpretation,
      attractor_score, bull_score, bear_score, attractor_analysis_date,
      intrinsic_value, buy_below_price, margin_of_safety, valuation_method, valuation_date,
      signal, signal_confidence, signal_reason,
      recommended_shares, recommended_dollars, recommended_pct, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    candidate.ticker, candidate.discovery_tier, candidate.regime_id || null,
    candidate.discovered_date || new Date().toISOString(),
    candidate.prescreen_pass ? 1 : 0, candidate.prescreen_data ? JSON.stringify(candidate.prescreen_data) : null,
    candidate.dks_score ?? null, candidate.flywheel_description ?? null,
    candidate.moat_type ?? null, candidate.scaling_exponent ?? null,
    candidate.crisis_assessment ?? null, candidate.price_decline_pct ?? null,
    candidate.csi_score ?? null, candidate.csi_interpretation ?? null,
    candidate.attractor_score ?? null, candidate.bull_score ?? null,
    candidate.bear_score ?? null, candidate.attractor_analysis_date ?? null,
    candidate.intrinsic_value ?? null, candidate.buy_below_price ?? null,
    candidate.margin_of_safety ?? null, candidate.valuation_method ?? null,
    candidate.valuation_date ?? null,
    candidate.signal ?? null, candidate.signal_confidence ?? null,
    candidate.signal_reason ?? null,
    candidate.recommended_shares ?? null, candidate.recommended_dollars ?? null,
    candidate.recommended_pct ?? null, candidate.status || 'active'
  ).run();
}

export async function getCandidatesByTier(db, tier, signalFilter) {
  let sql = 'SELECT * FROM candidates WHERE discovery_tier = ? AND status = ?';
  const params = [tier, 'active'];
  if (signalFilter) {
    sql += ' AND signal = ?';
    params.push(signalFilter);
  }
  sql += ' ORDER BY discovered_date DESC';
  const result = await db.prepare(sql).bind(...params).all();
  return result.results || [];
}

export async function getAllBuySignals(db) {
  const result = await db.prepare(
    `SELECT c.*, s.company_name, s.sector, s.industry, md.price as current_price
     FROM candidates c
     JOIN stocks s ON c.ticker = s.ticker
     LEFT JOIN market_data md ON c.ticker = md.ticker
     WHERE c.signal = 'BUY' AND c.status = 'active'
     ORDER BY c.discovery_tier, c.signal_confidence DESC`
  ).all();
  return result.results || [];
}

export async function upsertRegime(db, regime) {
  return db.prepare(
    `INSERT OR REPLACE INTO regime_registry (
      name, catalyst_type, start_date, affected_sectors, regime_keywords,
      estimated_market_size_b, adjacent_possible_score, scurve_position,
      scurve_penetration_pct, status, confirmed_by, ai_flag_count, last_assessed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    regime.name, regime.catalyst_type, regime.start_date,
    JSON.stringify(regime.affected_sectors), JSON.stringify(regime.regime_keywords),
    regime.estimated_market_size_b ?? null, regime.adjacent_possible_score ?? null,
    regime.scurve_position ?? null, regime.scurve_penetration_pct ?? null,
    regime.status || 'pending', regime.confirmed_by ?? null,
    regime.ai_flag_count || 1, new Date().toISOString()
  ).run();
}

export async function getActiveRegimes(db) {
  const result = await db.prepare(
    "SELECT * FROM regime_registry WHERE status = 'active' ORDER BY start_date DESC"
  ).all();
  return result.results || [];
}

export async function getPortfolioConfig(db) {
  const result = await db.prepare('SELECT key, value FROM portfolio_config').all();
  const config = {};
  for (const row of (result.results || [])) {
    config[row.key] = row.value;
  }
  return config;
}

export async function setPortfolioConfig(db, key, value) {
  return db.prepare(
    `INSERT OR REPLACE INTO portfolio_config (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  ).bind(key, String(value)).run();
}

// --- EDGAR / Data Confidence helpers ---

export async function ensureEdgarTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cik_map (
      ticker TEXT PRIMARY KEY,
      cik TEXT NOT NULL,
      company_name TEXT,
      updated_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS data_confidence (
      ticker TEXT,
      fiscal_year INTEGER,
      data_source TEXT NOT NULL,
      filing_date TEXT,
      fetch_date TEXT NOT NULL,
      is_stale INTEGER DEFAULT 0,
      notes TEXT,
      PRIMARY KEY (ticker, fiscal_year)
    )`),
  ]);

  // Add ratio_source column to market_data if it doesn't exist
  try {
    await db.prepare("ALTER TABLE market_data ADD COLUMN ratio_source TEXT DEFAULT 'finnhub'").run();
  } catch { /* column already exists */ }
}

export async function upsertDataConfidence(db, dc) {
  return db.prepare(
    `INSERT OR REPLACE INTO data_confidence (ticker, fiscal_year, data_source, filing_date, fetch_date, is_stale, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    dc.ticker, dc.fiscal_year, dc.data_source, dc.filing_date,
    dc.fetch_date, dc.is_stale || 0, dc.notes || null
  ).run();
}

export async function getDataConfidence(db, ticker) {
  const result = await db.prepare(
    'SELECT * FROM data_confidence WHERE ticker = ? ORDER BY fiscal_year DESC'
  ).bind(ticker).all();
  return result.results || [];
}

export async function updateMarketDataRatios(db, ticker, ratios, source) {
  return db.prepare(
    `UPDATE market_data SET pe_ratio = ?, pb_ratio = ?, earnings_yield = ?, ratio_source = ?, fetched_at = ?
     WHERE ticker = ?`
  ).bind(
    ratios.pe_ratio, ratios.pb_ratio, ratios.earnings_yield,
    source || 'edgar_computed', new Date().toISOString(), ticker
  ).run();
}
