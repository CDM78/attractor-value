// Alpha Vantage API - for fundamental data
// Free tier: 25 requests/day
// Strategy: fetch fundamentals gradually, cache in D1 with 30-day TTL

const BASE_URL = 'https://www.alphavantage.co/query';

function checkForErrors(data) {
  if (data['Error Message']) throw new Error(`AV Error: ${data['Error Message']}`);
  if (data['Note']) throw new Error(`AV rate limit: ${data['Note']}`);
  if (data['Information']) throw new Error(`AV info: ${data['Information']}`);
}

// Fetch income statement (annual)
export async function fetchIncomeStatement(ticker, apiKey) {
  const url = `${BASE_URL}?function=INCOME_STATEMENT&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`);
  const data = await res.json();

  checkForErrors(data);
  return data.annualReports || [];
}

// Fetch balance sheet (annual)
export async function fetchBalanceSheet(ticker, apiKey) {
  const url = `${BASE_URL}?function=BALANCE_SHEET&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`);
  const data = await res.json();

  checkForErrors(data);
  return data.annualReports || [];
}

// Fetch cash flow statement (annual)
export async function fetchCashFlow(ticker, apiKey) {
  const url = `${BASE_URL}?function=CASH_FLOW&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`);
  const data = await res.json();

  checkForErrors(data);
  return data.annualReports || [];
}

// Fetch company overview (P/E, P/B, sector, industry, etc.)
export async function fetchOverview(ticker, apiKey) {
  const url = `${BASE_URL}?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`);
  const data = await res.json();

  checkForErrors(data);
  return data;
}

// Parse Alpha Vantage data into our unified format
export function parseOverviewToMarketData(ticker, overview) {
  const parseNum = (v) => {
    const n = parseFloat(v);
    return isNaN(n) || v === 'None' || v === '-' ? null : n;
  };

  return {
    ticker,
    pe_ratio: parseNum(overview.TrailingPE),
    pb_ratio: parseNum(overview.PriceToBookRatio),
    earnings_yield: parseNum(overview.TrailingPE) ? (1 / parseFloat(overview.TrailingPE)) * 100 : null,
    dividend_yield: parseNum(overview.DividendYield) ? parseFloat(overview.DividendYield) * 100 : null,
    insider_ownership_pct: parseNum(overview.PercentInsiders),
    sector: overview.Sector || null,
    industry: overview.Industry || null,
    market_cap: parseNum(overview.MarketCapitalization),
  };
}

// Parse financial statements into our financials table format
export function parseFinancialStatements(ticker, incomeStmts, balanceSheets, cashFlows) {
  const years = {};
  const parseNum = (v) => {
    const n = parseFloat(v);
    return isNaN(n) || v === 'None' || v === '-' ? null : n;
  };

  for (const stmt of incomeStmts) {
    const year = parseInt(stmt.fiscalDateEnding?.substring(0, 4));
    if (!year) continue;
    if (!years[year]) years[year] = { ticker, fiscal_year: year };

    years[year].revenue = parseNum(stmt.totalRevenue);
    years[year].net_income = parseNum(stmt.netIncome);

    const shares = parseNum(stmt.commonStockSharesOutstanding) || parseNum(stmt.dilutedEPSFromContinuingOperations && stmt.netIncome ? null : null);
    const eps = parseNum(stmt.reportedEPS);
    if (eps != null) {
      years[year].eps = eps;
    } else if (years[year].net_income) {
      // Will calculate after we have shares from balance sheet
    }
  }

  for (const stmt of balanceSheets) {
    const year = parseInt(stmt.fiscalDateEnding?.substring(0, 4));
    if (!year) continue;
    if (!years[year]) years[year] = { ticker, fiscal_year: year };

    years[year].total_debt = (parseNum(stmt.longTermDebt) || 0) + (parseNum(stmt.shortTermDebt) || 0) + (parseNum(stmt.currentLongTermDebt) || 0);
    years[year].shareholder_equity = parseNum(stmt.totalShareholderEquity);
    years[year].current_assets = parseNum(stmt.totalCurrentAssets);
    years[year].current_liabilities = parseNum(stmt.totalCurrentLiabilities);

    const shares = parseNum(stmt.commonStockSharesOutstanding);
    if (shares) {
      years[year].shares_outstanding = shares;
      if (years[year].shareholder_equity) {
        years[year].book_value_per_share = years[year].shareholder_equity / shares;
      }
      if (years[year].net_income && !years[year].eps) {
        years[year].eps = years[year].net_income / shares;
      }
    }
  }

  for (const stmt of cashFlows) {
    const year = parseInt(stmt.fiscalDateEnding?.substring(0, 4));
    if (!year) continue;
    if (!years[year]) years[year] = { ticker, fiscal_year: year };

    const opCashflow = parseNum(stmt.operatingCashflow) || 0;
    const capex = parseNum(stmt.capitalExpenditures) || 0;
    years[year].free_cash_flow = opCashflow - Math.abs(capex);

    const dividendsPaid = parseNum(stmt.dividendPayout) || parseNum(stmt.dividendPayoutCommonStock) || 0;
    years[year].dividend_paid = dividendsPaid > 0 ? 1 : 0;

    // ROIC approximation
    const nopat = years[year].net_income;
    const investedCapital = (years[year].shareholder_equity || 0) + (years[year].total_debt || 0);
    if (nopat && investedCapital > 0) {
      years[year].roic = (nopat / investedCapital) * 100;
    }
  }

  return Object.values(years).map(y => ({
    ticker: y.ticker,
    fiscal_year: y.fiscal_year,
    eps: y.eps || null,
    book_value_per_share: y.book_value_per_share || null,
    total_debt: y.total_debt || null,
    shareholder_equity: y.shareholder_equity || null,
    current_assets: y.current_assets || null,
    current_liabilities: y.current_liabilities || null,
    free_cash_flow: y.free_cash_flow || null,
    dividend_paid: y.dividend_paid || 0,
    shares_outstanding: y.shares_outstanding || null,
    revenue: y.revenue || null,
    net_income: y.net_income || null,
    roic: y.roic || null,
  })).sort((a, b) => b.fiscal_year - a.fiscal_year);
}

// Fetch all fundamental data for a ticker (uses 4 API calls, sequential to avoid rate limits)
export async function fetchAllFundamentals(ticker, apiKey) {
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  const overview = await fetchOverview(ticker, apiKey);
  await delay(1200);
  const income = await fetchIncomeStatement(ticker, apiKey);
  await delay(1200);
  const balance = await fetchBalanceSheet(ticker, apiKey);
  await delay(1200);
  const cashflow = await fetchCashFlow(ticker, apiKey);

  const marketData = parseOverviewToMarketData(ticker, overview);
  const financials = parseFinancialStatements(ticker, income, balance, cashflow);

  return {
    overview,
    marketData,
    financials,
    stock: {
      ticker,
      company_name: overview.Name || ticker,
      sector: overview.Sector || null,
      industry: overview.Industry || null,
      market_cap: marketData.market_cap,
    },
  };
}
