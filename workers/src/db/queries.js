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
