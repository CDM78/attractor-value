// Service module for Finnhub API integration
// Free tier: 60 calls/minute, no daily cap
// Used for: insider transactions, insider sentiment, company news, company profile (fallback)

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Simple token bucket rate limiter
// Enforce max 50 calls/minute (leave 10 call buffer)
// Queue excess requests with a 1-second delay
const RATE_LIMIT = {
  maxPerMinute: 50,
  windowMs: 60000,
  calls: [],
};

async function rateLimitedFetch(url) {
  const now = Date.now();
  // Prune calls outside the window
  RATE_LIMIT.calls = RATE_LIMIT.calls.filter(t => now - t < RATE_LIMIT.windowMs);

  if (RATE_LIMIT.calls.length >= RATE_LIMIT.maxPerMinute) {
    // Wait until the oldest call falls out of the window
    const oldest = RATE_LIMIT.calls[0];
    const waitMs = RATE_LIMIT.windowMs - (now - oldest) + 100;
    await new Promise(r => setTimeout(r, waitMs));
    RATE_LIMIT.calls = RATE_LIMIT.calls.filter(t => Date.now() - t < RATE_LIMIT.windowMs);
  }

  RATE_LIMIT.calls.push(Date.now());

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('Finnhub rate limit exceeded');
    if (res.status === 403) throw new Error('Finnhub API key invalid or missing');
    throw new Error(`Finnhub API error: ${res.status}`);
  }

  return res.json();
}

// 0. Basic Financials / Metrics
// GET /stock/metric?symbol={ticker}&metric=all
// Returns current P/E, P/B, debt/equity, dividend yield, etc.
export async function getBasicMetrics(ticker, apiKey) {
  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${apiKey}`
  );

  const m = data.metric || {};
  return {
    ticker,
    pe_ratio: m.peNormalizedAnnual || m.peTTM || null,
    pb_ratio: m.pbAnnual || m.pbQuarterly || null,
    earnings_yield: m.peNormalizedAnnual ? (1 / m.peNormalizedAnnual) : null,
    dividend_yield: m.dividendYieldIndicatedAnnual || null,
    insider_ownership_pct: m.netPercentInsiderSharesOwned || null,
    // Extra metrics useful for quick screening
    debt_equity: m['totalDebt/totalEquityAnnual'] || null,
    current_ratio: m.currentRatioAnnual || null,
    roe: m.roeRfy || null,
    roic: m.roicTTM || null,
    revenue_growth_3y: m.revenueGrowth3Y || null,
    eps_growth_5y: m.epsGrowth5Y || null,
    // Tier 3 pre-screen fields
    market_cap_m: m.marketCapitalization || null,  // in millions
    gross_margin: m.grossMarginTTM || m.grossMarginAnnual || null,  // as percentage
    revenue_growth_quarterly: m.revenueGrowthQuarterlyYoy || null,
    shares_outstanding: m.sharesOutstanding || null,  // in millions
    fifty_two_week_high: m['52WeekHigh'] || null,
    fifty_two_week_low: m['52WeekLow'] || null,
  };
}

// 1. Insider Transactions
// GET /stock/insider-transactions?symbol={ticker}&from={date}&to={date}
// Returns raw transaction list
// Map to insider_transactions table schema
export async function getInsiderTransactions(ticker, fromDate, toDate, apiKey) {
  const params = new URLSearchParams({
    symbol: ticker,
    token: apiKey,
  });
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/stock/insider-transactions?${params}`
  );

  if (!data.data || !Array.isArray(data.data)) return [];

  return data.data.map(tx => ({
    ticker,
    filing_date: tx.transactionDate || tx.filingDate || null,
    insider_name: tx.name || 'Unknown',
    insider_title: null,  // Not reliably provided; supplement from getCompanyOfficers
    transaction_type: mapTransactionType(tx.transactionCode),
    shares: Math.abs(tx.share || 0),
    price_per_share: tx.transactionPrice || null,
    total_value: tx.transactionPrice && tx.share ? Math.abs(tx.transactionPrice * tx.share) : null,
    is_10b5_1: 0,  // Not provided by Finnhub; default to unknown
    source_url: null,
  }));
}

// Map Finnhub transaction codes to our schema
function mapTransactionType(code) {
  if (!code) return 'other';
  const upper = code.toUpperCase();
  // Finnhub codes: S = sell, P = purchase/buy, M = option exercise, etc.
  if (upper === 'P' || upper === 'A') return 'buy';
  if (upper === 'S' || upper === 'D') return 'sell';
  if (upper === 'M' || upper === 'C' || upper === 'F') return 'option_exercise';
  if (upper === 'G') return 'gift';
  return 'other';
}

// 2. Insider Sentiment (Aggregated)
// GET /stock/insider-sentiment?symbol={ticker}&from={date}&to={date}
// Returns monthly aggregated MSPR and total change in shares
// Use to populate insider_signals table
export async function getInsiderSentiment(ticker, fromDate, toDate, apiKey) {
  const params = new URLSearchParams({
    symbol: ticker,
    token: apiKey,
  });
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/stock/insider-sentiment?${params}`
  );

  if (!data.data || !Array.isArray(data.data)) return [];

  return data.data.map(m => ({
    year: m.year,
    month: m.month,
    mspr: m.mspr || 0,           // Monthly share purchase ratio
    change: m.change || 0,       // Net share change
  }));
}

// 3. Company Officers
// GET /stock/executive?symbol={ticker}
// Used to cross-reference insider names with C-suite titles
// Cache with 90-day TTL
export async function getCompanyOfficers(ticker, apiKey) {
  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/stock/executive?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`
  );

  if (!data.executive || !Array.isArray(data.executive)) return [];

  return data.executive.map(exec => ({
    name: exec.name || '',
    title: exec.position || '',
    age: exec.age || null,
  }));
}

// 4. Company News
// GET /company-news?symbol={ticker}&from={date}&to={date}
// Returns recent articles for Claude analysis supplementary context
export async function getCompanyNews(ticker, fromDate, toDate, apiKey) {
  const params = new URLSearchParams({
    symbol: ticker,
    token: apiKey,
  });
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/company-news?${params}`
  );

  if (!Array.isArray(data)) return [];

  return data.map(article => ({
    headline: article.headline || '',
    summary: article.summary || '',
    source: article.source || '',
    url: article.url || '',
    datetime: article.datetime ? new Date(article.datetime * 1000).toISOString() : null,
    category: article.category || '',
  }));
}

// 5. Company Profile (Fallback)
// GET /stock/profile2?symbol={ticker}
// Use only if Yahoo Finance data unavailable
export async function getCompanyProfile(ticker, apiKey) {
  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`
  );

  if (!data || !data.name) return null;

  return {
    ticker: data.ticker || ticker,
    company_name: data.name,
    sector: data.finnhubIndustry || null,
    industry: data.finnhubIndustry || null,
    market_cap: data.marketCapitalization ? data.marketCapitalization * 1e6 : null,
    exchange: data.exchange || null,
    logo: data.logo || null,
    weburl: data.weburl || null,
    shareOutstanding: data.shareOutstanding ? data.shareOutstanding * 1e6 : null,
  };
}

// 6. Financials As Reported (SEC filings)
// GET /stock/financials-reported?symbol={ticker}&freq=annual
// Returns 10-K annual data with XBRL tags — no daily cap
export async function getFinancialsReported(ticker, apiKey) {
  const data = await rateLimitedFetch(
    `${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(ticker)}&freq=annual&token=${apiKey}`
  );

  if (!data.data || !Array.isArray(data.data)) return [];
  return data.data;
}

// Parse Finnhub financials-reported into our financials table format
// XBRL tag names vary by company, so we try multiple common variants
export function parseFinancialsReported(ticker, reports) {
  const findValue = (report, ...tags) => {
    if (!report.report) return null;
    // Search all sections: ic (income), bs (balance sheet), cf (cash flow)
    for (const section of ['ic', 'bs', 'cf']) {
      const items = report.report[section] || [];
      for (const tag of tags) {
        const tagLower = tag.toLowerCase();
        const match = items.find(i => {
          // Match with or without namespace prefix (us-gaap_, ifrs_, company-specific)
          const concept = (i.concept || '').toLowerCase();
          const bare = concept.includes('_') ? concept.split('_').slice(1).join('_') : concept;
          return bare === tagLower || concept === tagLower;
        });
        if (match?.value != null) return match.value;
      }
    }
    return null;
  };

  return reports.map(report => {
    const year = parseInt(report.year);
    if (!year) return null;

    const revenue = findValue(report,
      'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense',
      'TotalRevenuesAndOtherIncome', 'InterestAndDividendIncomeOperating');
    const netIncome = findValue(report,
      'NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic');
    const eps = findValue(report,
      'EarningsPerShareBasic', 'EarningsPerShareDiluted',
      'BasicEarningsLossPerShare');
    const totalDebt = findValue(report,
      'LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations');
    const shortTermDebt = findValue(report,
      'ShortTermBorrowings', 'CommercialPaper', 'LongTermDebtCurrent');
    const equity = findValue(report,
      'StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
      'TotalStockholdersEquity');
    const currentAssets = findValue(report,
      'AssetsCurrent', 'TotalCurrentAssets');
    const currentLiabilities = findValue(report,
      'LiabilitiesCurrent', 'TotalCurrentLiabilities');
    const shares = findValue(report,
      'CommonStockSharesOutstanding',
      'WeightedAverageNumberOfSharesOutstandingBasic',
      'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
      'WeightedAverageNumberOfDilutedSharesOutstanding');
    const opCashflow = findValue(report,
      'NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByOperatingActivities',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect');
    const capex = findValue(report,
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'CapitalExpendituresIncurredButNotYetPaid',
      'PurchaseOfPropertyPlantAndEquipment',
      'PaymentsToAcquireProductiveAssets');
    const dividends = findValue(report,
      'PaymentsOfDividends', 'PaymentsOfDividendsCommonStock',
      'Dividends', 'DividendsPaid',
      'PaymentsOfOrdinaryDividends');

    const totalDebtVal = (totalDebt || 0) + (shortTermDebt || 0);
    const fcf = opCashflow != null ? opCashflow - Math.abs(capex || 0) : null;
    const bvps = equity && shares ? equity / shares : null;
    const epsCalc = eps || (netIncome && shares ? netIncome / shares : null);
    const investedCapital = (equity || 0) + totalDebtVal;
    const roic = netIncome && investedCapital > 0 ? (netIncome / investedCapital) * 100 : null;

    return {
      ticker,
      fiscal_year: year,
      eps: epsCalc,
      book_value_per_share: bvps,
      total_debt: totalDebtVal || null,
      shareholder_equity: equity,
      current_assets: currentAssets,
      current_liabilities: currentLiabilities,
      free_cash_flow: fcf,
      dividend_paid: dividends && dividends > 0 ? 1 : 0,
      shares_outstanding: shares,
      revenue,
      net_income: netIncome,
      roic,
    };
  }).filter(Boolean).sort((a, b) => b.fiscal_year - a.fiscal_year);
}

// Helper: compute insider signal from sentiment data
// Positive MSPR corroborates strong_buy, negative corroborates caution
export function computeInsiderSignalFromSentiment(sentimentData) {
  if (!sentimentData || sentimentData.length === 0) {
    return { signal: 'neutral', details: 'No insider sentiment data available' };
  }

  // Use the most recent 3 months
  const recent = sentimentData.slice(-3);
  const avgMspr = recent.reduce((s, m) => s + m.mspr, 0) / recent.length;
  const totalChange = recent.reduce((s, m) => s + m.change, 0);

  if (avgMspr > 0.1 && totalChange > 0) {
    return {
      signal: 'strong_buy',
      details: `Positive insider sentiment: avg MSPR ${avgMspr.toFixed(2)}, net +${totalChange} shares over ${recent.length} months`,
    };
  }

  if (avgMspr < -0.1 && totalChange < 0) {
    return {
      signal: 'caution',
      details: `Negative insider sentiment: avg MSPR ${avgMspr.toFixed(2)}, net ${totalChange} shares over ${recent.length} months. Note: may include pre-planned 10b5-1 sales.`,
    };
  }

  return {
    signal: 'neutral',
    details: `Mixed insider activity: avg MSPR ${avgMspr.toFixed(2)}, net ${totalChange > 0 ? '+' : ''}${totalChange} shares over ${recent.length} months`,
  };
}

// Helper: format recent news headlines for Claude prompt context (~500 tokens)
export function formatNewsForPrompt(newsArticles, maxItems = 10) {
  if (!newsArticles || newsArticles.length === 0) return '';

  const truncated = newsArticles.slice(0, maxItems);
  const lines = truncated.map(a => {
    const date = a.datetime ? a.datetime.split('T')[0] : 'Unknown date';
    return `- [${date}] ${a.headline}`;
  });

  return `RECENT NEWS (last 30 days, from Finnhub):\n${lines.join('\n')}\n\nConsider whether any of these developments affect your assessment of\nattractor stability, competitive reinforcement, or adaptation capacity.\nNote any potential phase transition signals in the news.`;
}
