// SEC EDGAR XBRL Data Service — Primary fundamental data source
// Fetches Company Facts JSON and extracts annual financial data
// from XBRL tags filed in 10-K and 20-F reports.
//
// Replaces Finnhub as the primary source for EPS, BVPS, debt,
// equity, revenue, and all balance sheet items. Finnhub remains
// as fallback for companies not found in EDGAR.

// Known stock splits — loaded from external data file for maintainability.
import SPLIT_ADJUSTMENTS from '../data/splits.js';

const EDGAR_HEADERS = {
  'User-Agent': 'Bolin & Troy LLC charles@bolinandtroy.com',
  'Accept-Encoding': 'gzip, deflate',
};

// XBRL tag fallback lists — ordered by preference.
// Matches the tags used in finnhub.js parseFinancialsReported() for consistency.
const TAGS = {
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  shares: ['CommonStockSharesOutstanding'],
  sharesDE: ['EntityCommonStockSharesOutstanding'], // dei namespace
  longDebt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  shortDebt: ['ShortTermBorrowings', 'DebtCurrent', 'LongTermDebtCurrent'],
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'],
  netIncome: ['NetIncomeLoss'],
  opCashflow: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  dividendsPerShare: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'],
  dividendsPaid: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock', 'DividendsPaid'],
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch Company Facts JSON from EDGAR.
 * Returns null on 404 (company not found).
 */
export async function fetchCompanyFacts(cik) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const res = await fetch(url, { headers: EDGAR_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EDGAR HTTP ${res.status} for CIK ${cik}`);
  return res.json();
}

/**
 * Extract annual values for XBRL tags from Company Facts JSON.
 *
 * Groups entries by fiscal year (fy), picks the entry with the latest
 * end date per fy (= the annual entry at FY end), then maps to calendar
 * year from that end date. For flow items with start dates, filters for
 * annual period length (300-400 days) to exclude quarterly sub-periods
 * that EDGAR tags with fp="FY" in 10-K filings.
 *
 * Tags are processed in preference order — once a preferred tag provides
 * data for a year, fallback tags cannot overwrite it.
 *
 * @returns {{ [calendarYear: number]: { val: number, filed: string, end: string } }}
 */
export function extractAnnualValues(facts, tagNames, unitType, forms) {
  if (!facts?.facts) return {};

  const namespaces = ['us-gaap', 'ifrs-full', 'dei'];
  const formFilter = forms || ['10-K', '10-K/A', '20-F', '20-F/A'];
  const results = {};

  for (const ns of namespaces) {
    if (!facts.facts[ns]) continue;

    for (const tag of (Array.isArray(tagNames) ? tagNames : [tagNames])) {
      const tagData = facts.facts[ns][tag];
      if (!tagData?.units) continue;

      const units = tagData.units[unitType];
      if (!units) continue;

      // Group entries by fiscal year
      const byFy = {};
      for (const entry of units) {
        if (!formFilter.includes(entry.form)) continue;
        if (entry.fp !== 'FY') continue;
        if (!entry.end || !entry.fy) continue;

        // For flow items: strict period length filter
        if (entry.start) {
          const daySpan = (new Date(entry.end) - new Date(entry.start)) / 86400000;
          if (daySpan < 300 || daySpan > 400) continue;
        }

        const fy = entry.fy;
        if (!byFy[fy]) byFy[fy] = [];
        byFy[fy].push(entry);
      }

      // For each fiscal year, pick the entry with the latest end date,
      // then the latest filed date for dedup
      const tagResults = {};
      for (const [, entries] of Object.entries(byFy)) {
        entries.sort((a, b) => {
          const endCmp = b.end.localeCompare(a.end);
          return endCmp !== 0 ? endCmp : b.filed.localeCompare(a.filed);
        });

        const best = entries[0];
        const calendarYear = new Date(best.end).getFullYear();

        if (!tagResults[calendarYear] || best.filed > tagResults[calendarYear].filed) {
          tagResults[calendarYear] = { val: best.val, filed: best.filed, end: best.end };
        }
      }

      // Merge: only fill years not already populated by a higher-priority tag
      for (const [year, data] of Object.entries(tagResults)) {
        if (!results[year]) {
          results[year] = data;
        }
      }
    }
  }

  return results;
}

/**
 * Adjust per-share values for stock splits.
 * EDGAR reports as-filed; pre-split values must be divided by the ratio.
 */
export function adjustForSplits(ticker, value, endDate) {
  const splits = SPLIT_ADJUSTMENTS[ticker];
  if (!splits || value == null) return value;

  let adjusted = value;
  for (const split of splits) {
    if (endDate < split.date) {
      adjusted = adjusted / split.ratio;
    }
  }
  return adjusted;
}

/**
 * Parse EDGAR Company Facts into financials table rows.
 * Returns { financials: Array, confidence: Array } where each financials
 * entry matches the financials table schema and each confidence entry
 * contains source metadata.
 */
export function parseEdgarToFinancials(ticker, facts) {
  const epsRaw = extractAnnualValues(facts, TAGS.eps, 'USD/shares');
  const equityRaw = extractAnnualValues(facts, TAGS.equity, 'USD');
  const sharesRaw = extractAnnualValues(facts, [...TAGS.shares, ...TAGS.sharesDE], 'shares');
  const longDebtRaw = extractAnnualValues(facts, TAGS.longDebt, 'USD');
  const shortDebtRaw = extractAnnualValues(facts, TAGS.shortDebt, 'USD');
  const currentAssetsRaw = extractAnnualValues(facts, TAGS.currentAssets, 'USD');
  const currentLiabRaw = extractAnnualValues(facts, TAGS.currentLiabilities, 'USD');
  const revenueRaw = extractAnnualValues(facts, TAGS.revenue, 'USD');
  const netIncomeRaw = extractAnnualValues(facts, TAGS.netIncome, 'USD');
  const opCashflowRaw = extractAnnualValues(facts, TAGS.opCashflow, 'USD');
  const capexRaw = extractAnnualValues(facts, TAGS.capex, 'USD');
  const divPerShareRaw = extractAnnualValues(facts, TAGS.dividendsPerShare, 'USD/shares');
  const divPaidRaw = extractAnnualValues(facts, TAGS.dividendsPaid, 'USD');

  // Collect all years that have at least EPS or equity data
  const allYears = new Set([
    ...Object.keys(epsRaw),
    ...Object.keys(equityRaw),
  ]);

  const financials = [];
  const confidence = [];

  for (const yearStr of [...allYears].sort((a, b) => Number(b) - Number(a))) {
    const year = Number(yearStr);

    const epsEntry = epsRaw[year];
    const eps = epsEntry
      ? adjustForSplits(ticker, epsEntry.val, epsEntry.end)
      : null;

    const equity = equityRaw[year]?.val || null;
    const shares = sharesRaw[year]?.val || null;
    const longDebt = longDebtRaw[year]?.val || 0;
    const shortDebt = shortDebtRaw[year]?.val || 0;
    const totalDebt = longDebt + shortDebt;
    const currentAssets = currentAssetsRaw[year]?.val || null;
    const currentLiab = currentLiabRaw[year]?.val || null;
    const revenue = revenueRaw[year]?.val || null;
    const netIncome = netIncomeRaw[year]?.val || null;
    const opCashflow = opCashflowRaw[year]?.val || null;
    const capex = capexRaw[year]?.val || 0;
    const fcf = opCashflow != null ? opCashflow - Math.abs(capex) : null;

    const bvps = (equity && shares && shares > 0)
      ? adjustForSplits(ticker, equity / shares, equityRaw[year]?.end || `${year}-12-31`)
      : null;

    const roic = (netIncome != null && equity != null && (equity + totalDebt) > 0)
      ? (netIncome / (equity + totalDebt)) * 100
      : null;

    // Dividend detection: check both per-share declarations and aggregate payments
    const hasDivPerShare = divPerShareRaw[year]?.val > 0;
    const hasDivPaid = divPaidRaw[year]?.val > 0;
    const dividendPaid = (hasDivPerShare || hasDivPaid) ? 1 : 0;

    financials.push({
      ticker,
      fiscal_year: year,
      eps: eps != null ? round(eps, 4) : null,
      book_value_per_share: bvps != null ? round(bvps, 2) : null,
      total_debt: totalDebt > 0 ? round(totalDebt, 0) : null,
      shareholder_equity: equity != null ? round(equity, 0) : null,
      current_assets: currentAssets != null ? round(currentAssets, 0) : null,
      current_liabilities: currentLiab != null ? round(currentLiab, 0) : null,
      free_cash_flow: fcf != null ? round(fcf, 0) : null,
      dividend_paid: dividendPaid,
      shares_outstanding: shares != null ? round(shares, 0) : null,
      revenue: revenue != null ? round(revenue, 0) : null,
      net_income: netIncome != null ? round(netIncome, 0) : null,
      roic: roic != null ? round(roic, 2) : null,
    });

    // Track best filing date for this year (from EPS or equity entry)
    const filingDate = epsEntry?.filed || equityRaw[year]?.filed || null;
    confidence.push({
      ticker,
      fiscal_year: year,
      data_source: 'edgar',
      filing_date: filingDate,
      fetch_date: new Date().toISOString(),
      is_stale: filingDate ? (Date.now() - new Date(filingDate).getTime() > 15 * 30 * 86400000 ? 1 : 0) : 0,
      notes: null,
    });
  }

  return { financials, confidence };
}

/**
 * Compute P/E, P/B, earnings yield, D/E, and CR from live price + EDGAR fundamentals.
 * Returns partial market_data fields to merge into the existing row.
 */
export function computeDerivedRatios(price, latestFinancials) {
  if (!price || !latestFinancials) return null;

  const eps = latestFinancials.eps;
  const bvps = latestFinancials.book_value_per_share;
  const totalDebt = latestFinancials.total_debt;
  const equity = latestFinancials.shareholder_equity;
  const currentAssets = latestFinancials.current_assets;
  const currentLiab = latestFinancials.current_liabilities;

  const peRatio = (eps && eps > 0) ? round(price / eps, 2) : null;
  const pbRatio = (bvps && bvps > 0) ? round(price / bvps, 2) : null;
  const earningsYield = peRatio ? round(1 / peRatio, 4) : null;

  return {
    pe_ratio: peRatio,
    pb_ratio: pbRatio,
    earnings_yield: earningsYield,
  };
}

/**
 * Refresh the CIK map from SEC's bulk ticker-to-CIK file.
 * Returns the number of entries processed.
 */
export async function refreshCikMap(db) {
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: EDGAR_HEADERS,
  });
  if (!res.ok) throw new Error(`CIK map fetch failed: HTTP ${res.status}`);

  const data = await res.json();
  // data is { "0": { cik_str, ticker, title }, "1": { ... }, ... }
  const entries = Object.values(data);

  // Batch upsert into cik_map table
  const now = new Date().toISOString();
  const stmts = entries.map(e =>
    db.prepare(
      `INSERT OR REPLACE INTO cik_map (ticker, cik, company_name, updated_at)
       VALUES (?, ?, ?, ?)`
    ).bind(
      e.ticker.toUpperCase(),
      String(e.cik_str).padStart(10, '0'),
      e.title,
      now
    )
  );

  // D1 batch limit is 100 statements
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  console.log(`CIK map refreshed: ${entries.length} entries`);
  return entries.length;
}

/**
 * Look up CIK for a ticker from the cik_map table.
 */
export async function getCik(db, ticker) {
  const row = await db.prepare(
    'SELECT cik FROM cik_map WHERE ticker = ?'
  ).bind(ticker.toUpperCase()).first();
  return row?.cik || null;
}

function round(n, decimals) {
  if (n == null) return null;
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export { EDGAR_HEADERS, SPLIT_ADJUSTMENTS, TAGS, delay };
