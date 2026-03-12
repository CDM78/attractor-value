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
    `INSERT OR REPLACE INTO financials (ticker, fiscal_year, eps, book_value_per_share, total_debt, shareholder_equity, current_assets, current_liabilities, free_cash_flow, dividend_paid, shares_outstanding, revenue, net_income, roic)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    fin.ticker, fin.fiscal_year, fin.eps, fin.book_value_per_share,
    fin.total_debt, fin.shareholder_equity, fin.current_assets,
    fin.current_liabilities, fin.free_cash_flow, fin.dividend_paid,
    fin.shares_outstanding, fin.revenue, fin.net_income, fin.roic
  ).run();
}

export async function getFinancialsForTicker(db, ticker, limit = 10) {
  const result = await db.prepare(
    'SELECT * FROM financials WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT ?'
  ).bind(ticker, limit).all();
  return result.results || [];
}

export async function saveScreenResult(db, ticker, screenDate, results) {
  return db.prepare(
    `INSERT OR REPLACE INTO screen_results (ticker, screen_date, passes_pe, passes_pb, passes_pe_x_pb, passes_debt_equity, passes_current_ratio, passes_earnings_stability, passes_dividend_record, passes_earnings_growth, passes_all_hard, passes_fcf, passes_insider_ownership, passes_dilution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ticker, screenDate, results.passes_pe, results.passes_pb, results.passes_pe_x_pb,
    results.passes_debt_equity, results.passes_current_ratio, results.passes_earnings_stability,
    results.passes_dividend_record, results.passes_earnings_growth, results.passes_all_hard,
    results.passes_fcf, results.passes_insider_ownership, results.passes_dilution
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
