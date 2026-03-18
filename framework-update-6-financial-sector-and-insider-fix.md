# Attractor Value Framework — Update 6: Financial Sector Data Normalization & Insider Transaction Pipeline Fix

## Context

This document amends the previously provided specification documents:
- **attractor-value-scope.md** (Claude Code project scope)
- **framework-update-3-finnhub-integration.md** (Update 3 — Finnhub integration)
- **AV-Framework-Report.md** (Technical Report)

It addresses two categories of issues discovered during live analysis of AXIS Capital Holdings (AXS):

1. **Financial sector data normalization** — The data pipeline produces incorrect values for insurance and financial companies: zero debt/equity, inflated dividend yields, and meaningless ROIC figures. These are not framework design problems but data ingestion bugs that produce false signals.

2. **Finnhub insider transaction pipeline failure** — Update 3 specified Finnhub as the source for insider transaction data, but the AXIS Capital report shows "No insider transaction data available" despite the integration supposedly being implemented. AXIS had ~$440 million in insider selling over 8 months — exactly the kind of signal the framework was designed to catch — and it was invisible.

Both issues must be fixed before the framework's automated signals can be trusted for financial sector stocks.

---

## Part A: Finnhub Insider Transaction Pipeline — Diagnosis & Fix

### Problem

The AXIS Capital analysis showed "No insider transaction data available" and "Insider Ownership: FAIL" with no supporting transaction data. The Finnhub insider transaction integration (Update 3) is either not implemented, not being called, or failing silently.

### Diagnostic Steps

Before writing new code, Claude Code should run these checks to identify where the pipeline breaks:

#### Step 1: Verify the Finnhub API key is configured

```bash
# Check if FINNHUB_API_KEY is set in wrangler.toml or .dev.vars
grep -r "FINNHUB" wrangler.toml .dev.vars 2>/dev/null
```

If the key is missing, it needs to be added to the Worker's environment variables:
```toml
# wrangler.toml
[vars]
FINNHUB_API_KEY = "your_key_here"
```

#### Step 2: Verify the Finnhub insider endpoint works

```bash
# Test the endpoint directly
curl "https://finnhub.io/api/v1/stock/insider-transactions?symbol=AXS&token=YOUR_KEY"
```

Expected: JSON array of insider transactions. If this returns empty or errors, the issue is with Finnhub's coverage of the ticker, not the app code.

#### Step 3: Check if the `finnhub.js` service module exists and is wired up

```bash
# Check if the service file exists
ls -la workers/src/services/finnhub.js

# Check if insider transaction functions are exported
grep -n "getInsiderTransactions\|getInsiderSentiment" workers/src/services/finnhub.js
```

If the file doesn't exist, Update 3 was never implemented. If it exists but the functions aren't there, it was partially implemented.

#### Step 4: Check if the cron job calls the insider refresh

```bash
# Search for insider-related calls in the cron handlers
grep -rn "insider\|insiderTransaction\|insider_transactions" workers/src/cron/
```

If there are no matches, the cron job was never wired to call the Finnhub insider functions.

#### Step 5: Check the database tables

```sql
-- Do the insider tables exist?
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%insider%';

-- If they exist, is there any data?
SELECT COUNT(*) FROM insider_transactions;
SELECT COUNT(*) FROM insider_signals;
```

### Required Implementation

Based on the diagnostic results, implement whichever of the following are missing:

#### A. Database tables (if missing)

```sql
CREATE TABLE IF NOT EXISTS insider_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    filing_date TEXT NOT NULL,
    insider_name TEXT NOT NULL,
    insider_title TEXT,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN
        ('buy', 'sell', 'option_exercise', 'gift', 'other')),
    shares REAL NOT NULL,
    price_per_share REAL,
    total_value REAL,
    is_10b5_1 INTEGER NOT NULL DEFAULT 0,
    source_url TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

CREATE INDEX IF NOT EXISTS idx_insider_tx_ticker ON insider_transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_insider_tx_date ON insider_transactions(filing_date);

CREATE TABLE IF NOT EXISTS insider_signals (
    ticker TEXT PRIMARY KEY,
    signal_date TEXT NOT NULL,
    trailing_90d_buys INTEGER DEFAULT 0,
    trailing_90d_buy_value REAL DEFAULT 0,
    trailing_90d_sells INTEGER DEFAULT 0,
    trailing_90d_sell_value REAL DEFAULT 0,
    unique_buyers_90d INTEGER DEFAULT 0,
    signal TEXT CHECK(signal IN ('strong_buy', 'neutral', 'caution')),
    signal_details TEXT,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);
```

#### B. Finnhub service functions (if missing or incomplete)

```javascript
// workers/src/services/finnhub.js

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

export async function getInsiderTransactions(ticker, apiKey, fromDate) {
  const url = `${FINNHUB_BASE}/stock/insider-transactions?symbol=${ticker}&from=${fromDate}&token=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Finnhub insider transactions failed for ${ticker}: ${response.status}`);
    return [];
  }

  const data = await response.json();

  if (!data || !data.data || !Array.isArray(data.data)) {
    console.warn(`Finnhub returned no insider data for ${ticker}`);
    return [];
  }

  // Map Finnhub response to our schema
  return data.data.map(tx => ({
    ticker: ticker,
    filing_date: tx.filingDate || tx.transactionDate,
    insider_name: tx.name || 'Unknown',
    insider_title: tx.position || null,  // NOTE: Finnhub does NOT always populate this
    transaction_type: mapTransactionType(tx.transactionCode),
    shares: Math.abs(tx.share || 0),
    price_per_share: tx.transactionPrice || null,
    total_value: Math.abs((tx.share || 0) * (tx.transactionPrice || 0)),
    is_10b5_1: 0,  // Finnhub doesn't flag this
  }));
}

function mapTransactionType(code) {
  // SEC Form 4 transaction codes
  // https://www.sec.gov/about/forms/form4data.pdf
  const buyTypes = ['P', 'A'];          // P = Open market purchase, A = Grant/award
  const sellTypes = ['S', 'D', 'F'];    // S = Sale, D = Disposition, F = Tax withholding
  const optionTypes = ['M', 'C', 'X'];  // M = Exercise, C = Conversion, X = Exercise

  if (!code) return 'other';
  if (buyTypes.includes(code)) return 'buy';
  if (sellTypes.includes(code)) return 'sell';
  if (optionTypes.includes(code)) return 'option_exercise';
  return 'other';
}

export async function getInsiderSentiment(ticker, apiKey, fromDate) {
  const url = `${FINNHUB_BASE}/stock/insider-sentiment?symbol=${ticker}&from=${fromDate}&token=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Finnhub insider sentiment failed for ${ticker}: ${response.status}`);
    return null;
  }

  const data = await response.json();
  return data;
}

export async function getCompanyOfficers(ticker, apiKey) {
  const url = `${FINNHUB_BASE}/stock/executive?symbol=${ticker}&token=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) return [];

  const data = await response.json();
  return data.executive || [];
}
```

#### C. Signal computation function

```javascript
// workers/src/services/insiderSignals.js

export function computeInsiderSignal(transactions, officers) {
  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  // Filter to last 90 days
  const recent = transactions.filter(tx =>
    new Date(tx.filing_date) >= ninetyDaysAgo
  );

  // Separate buys and sells (exclude option exercises, gifts, etc.)
  const buys = recent.filter(tx => tx.transaction_type === 'buy');
  const sells = recent.filter(tx => tx.transaction_type === 'sell');

  const totalBuyValue = buys.reduce((sum, tx) => sum + (tx.total_value || 0), 0);
  const totalSellValue = sells.reduce((sum, tx) => sum + (tx.total_value || 0), 0);
  const uniqueBuyers = new Set(buys.map(tx => tx.insider_name)).size;

  // Cross-reference sellers against known C-suite officers
  const cSuiteTitles = ['CEO', 'CFO', 'COO', 'Chief Executive',
    'Chief Financial', 'Chief Operating', 'President'];
  const officerNames = new Set(
    officers
      .filter(o => cSuiteTitles.some(t =>
        (o.position || '').toUpperCase().includes(t.toUpperCase())
      ))
      .map(o => o.name)
  );

  const cSuiteSells = sells.filter(tx =>
    officerNames.has(tx.insider_name) ||
    cSuiteTitles.some(t =>
      (tx.insider_title || '').toUpperCase().includes(t.toUpperCase())
    )
  );

  // Determine signal
  let signal = 'neutral';
  let details = '';

  if (uniqueBuyers >= 3 && totalBuyValue >= 100000) {
    signal = 'strong_buy';
    details = `${uniqueBuyers} insiders bought $${(totalBuyValue / 1000).toFixed(0)}K in 90 days`;
  } else if (totalSellValue > 0 && totalBuyValue > 0 &&
             totalSellValue / totalBuyValue >= 5 && cSuiteSells.length > 0) {
    signal = 'caution';
    details = `C-suite selling $${(totalSellValue / 1000000).toFixed(1)}M vs $${(totalBuyValue / 1000).toFixed(0)}K buying`;
  } else if (totalSellValue > 0 && totalBuyValue === 0 &&
             totalSellValue >= 1000000 && cSuiteSells.length > 0) {
    // Edge case: zero buying, significant C-suite selling
    signal = 'caution';
    details = `Zero insider buying; C-suite selling $${(totalSellValue / 1000000).toFixed(1)}M`;
  }

  // Special case for AXIS-style massive director sales
  // Flag any single insider selling > $10M in 90 days
  const largeSellers = sells.filter(tx => tx.total_value >= 10000000);
  if (largeSellers.length > 0 && signal === 'neutral') {
    signal = 'caution';
    const biggest = largeSellers.sort((a, b) => b.total_value - a.total_value)[0];
    details = `Large insider sale: ${biggest.insider_name} sold $${(biggest.total_value / 1000000).toFixed(1)}M`;
  }

  return {
    trailing_90d_buys: buys.length,
    trailing_90d_buy_value: totalBuyValue,
    trailing_90d_sells: sells.length,
    trailing_90d_sell_value: totalSellValue,
    unique_buyers_90d: uniqueBuyers,
    signal,
    signal_details: details,
  };
}
```

#### D. Cron integration

The insider refresh must be wired into the cron handler. In maintenance mode (per Update 5), it runs as part of the weekly Saturday refresh AND the daily post-market job for watchlist/portfolio stocks:

```javascript
// In the daily post-market sequence (5:20 PM ET, after screening)
async function dailyInsiderCheck(db, env) {
  // Refresh insider data for watchlist and portfolio stocks only
  const tickers = await db.prepare(`
    SELECT ticker FROM watchlist
    UNION
    SELECT DISTINCT ticker FROM holdings
  `).all();

  for (const { ticker } of tickers.results) {
    const fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    const transactions = await getInsiderTransactions(
      ticker, env.FINNHUB_API_KEY, fromDate
    );

    // Store transactions
    for (const tx of transactions) {
      await db.prepare(`
        INSERT OR IGNORE INTO insider_transactions
        (ticker, filing_date, insider_name, insider_title,
         transaction_type, shares, price_per_share, total_value, is_10b5_1)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tx.ticker, tx.filing_date, tx.insider_name, tx.insider_title,
        tx.transaction_type, tx.shares, tx.price_per_share,
        tx.total_value, tx.is_10b5_1
      ).run();
    }

    // Compute and store signal
    const officers = await getCompanyOfficers(ticker, env.FINNHUB_API_KEY);
    const allRecent = await db.prepare(`
      SELECT * FROM insider_transactions
      WHERE ticker = ? AND filing_date >= date('now', '-180 days')
    `).bind(ticker).all();

    const signal = computeInsiderSignal(allRecent.results, officers);

    await db.prepare(`
      INSERT OR REPLACE INTO insider_signals
      (ticker, signal_date, trailing_90d_buys, trailing_90d_buy_value,
       trailing_90d_sells, trailing_90d_sell_value, unique_buyers_90d,
       signal, signal_details)
      VALUES (?, date('now'), ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ticker, signal.trailing_90d_buys, signal.trailing_90d_buy_value,
      signal.trailing_90d_sells, signal.trailing_90d_sell_value,
      signal.unique_buyers_90d, signal.signal, signal.signal_details
    ).run();
  }
}
```

Add this to the maintenance mode schedule in Update 5's cron handler:

```javascript
// Add after dailyAttractorCheck
if (isMarketDay && etHour === 17 && minute === 20) {
  await dailyInsiderCheck(db, env);
}
```

#### E. Wire insider signals into the stock detail and analysis views

The attractor analysis view and stock detail view must display insider data when available. Currently they show "No insider transaction data available" — this text should only appear when the `insider_signals` table has no row for the ticker, and it should be accompanied by an explanation: "Insider data refreshes daily for watchlist/portfolio stocks. Add this stock to your watchlist to begin tracking insider activity."

For stocks WITH insider data, display:
- The signal icon (green up-arrow / grey dash / amber down-arrow)
- Signal details text
- Expandable transaction list (date, name, title, type, shares, value)
- Total 90-day buy vs. sell volume as a simple bar comparison

---

## Part B: Financial Sector Data Normalization

### Problem

The data pipeline produces incorrect values for insurance and financial companies across three metrics:

| Metric | Expected (AXS) | Reported | Root Cause |
|---|---|---|---|
| Debt/Equity | ~0.24 | 0.00 | Insurance debt classified under different XBRL tags than industrial debt |
| Dividend Yield | ~1.74% | 6.82% | Pipeline picking up preferred share dividend instead of common-only |
| ROIC | ~18% (ROE basis) | 480%–1776% | ROIC formula meaningless for insurers; invested capital denominator is tiny |

These aren't edge cases — the screening universe includes dozens of financial and insurance companies. Any of them could be producing false passes or false fails.

### Sector Detection

The fix starts with reliable sector identification. The `stocks` table should already have a `sector` field. Verify that insurance companies are correctly classified. Finnhub's company profile endpoint returns an `finnhubIndustry` field. The relevant classifications are:

```javascript
const FINANCIAL_SECTORS = ['Financial Services', 'Financials'];
const INSURANCE_INDUSTRIES = [
  'Insurance - Property & Casualty',
  'Insurance - Diversified',
  'Insurance - Life',
  'Insurance - Reinsurance',
  'Insurance - Specialty',
  'Insurance Brokers',
];
const BANK_INDUSTRIES = [
  'Banks - Regional',
  'Banks - Diversified',
  'Banks - Global',
];

function isFinancialSector(stock) {
  return FINANCIAL_SECTORS.includes(stock.sector);
}

function isInsurance(stock) {
  return INSURANCE_INDUSTRIES.includes(stock.industry);
}

function isBank(stock) {
  return BANK_INDUSTRIES.includes(stock.industry);
}
```

### Fix B1: Debt/Equity for Financial Companies

#### Problem Detail

Industrial companies report debt under XBRL tags like `LongTermDebt`, `LongTermDebtNoncurrent`, or `TotalDebt`. Insurance companies often report debt under tags like `DebtInstrumentCarryingAmount`, `LongTermDebtFairValue`, or within the broader `Liabilities` structure. The pipeline's XBRL parser looks for the industrial tags, finds nothing, and defaults to zero.

#### Fix

For financial sector companies, the D/E filter is already set to auto-pass (Update 4, report line 74). This is correct for screening purposes — leverage is the business model for banks and insurers, and a standard D/E test is meaningless.

However, the **displayed** D/E value should still be accurate for the stock detail view. Two approaches:

**Approach 1 (Recommended — simpler):** For financial sector stocks, don't display D/E at all in the detail view. Instead, display the sector-appropriate leverage metric:

| Sub-Industry | Metric to Display | Source |
|---|---|---|
| Insurance | Debt-to-Total-Capital ratio | From 10-K: total debt / (total debt + total equity) |
| Banks | Tier 1 Capital Ratio | From regulatory filings (Finnhub may not have this — use 10-K) |
| Other Financials | Debt-to-Total-Capital ratio | Same as insurance |

**Approach 2 (More accurate but harder):** Expand the XBRL tag list to include insurance-specific debt tags. This requires mapping the various XBRL taxonomies used by insurance companies, which varies by company.

**Implementation (Approach 1):**

```javascript
// In the stock detail view / valuation card
function getDisplayLeverage(stock, financials) {
  if (isFinancialSector(stock)) {
    // Don't show D/E — show debt-to-total-capital instead
    const totalDebt = financials.total_debt || 0;
    const totalEquity = financials.shareholder_equity || 0;
    const totalCapital = totalDebt + totalEquity;

    if (totalCapital > 0) {
      return {
        label: 'Debt / Total Capital',
        value: (totalDebt / totalCapital * 100).toFixed(1) + '%',
        note: 'Standard D/E is not meaningful for financial companies'
      };
    }
    return {
      label: 'Debt / Total Capital',
      value: 'N/A — financial data may use non-standard debt classification',
      note: 'Verify leverage from 10-K filing directly'
    };
  }

  // Industrial companies — standard D/E
  return {
    label: 'Debt / Equity',
    value: financials.debt_to_equity?.toFixed(2) || 'N/A',
    note: null
  };
}
```

**In the screening engine:** No change needed — financial companies already auto-pass the D/E filter. But add a flag in the screen results indicating this was an auto-pass, not a computed pass:

```sql
ALTER TABLE screen_results ADD COLUMN de_auto_pass INTEGER DEFAULT 0;
```

Set `de_auto_pass = 1` for all financial sector stocks so the UI can display "Auto-pass (financial sector)" instead of a green checkmark that implies a computed D/E of 0.00 is correct.

### Fix B2: Dividend Yield — Common vs. Preferred

#### Problem Detail

Insurance companies and banks frequently issue preferred shares with higher dividends than common shares. The data pipeline is either picking up the preferred dividend, aggregating common + preferred dividends, or dividing total dividends paid (including preferred) by only the common share count.

For AXIS Capital: the common dividend is $1.76/share annually (~1.74% yield at ~$101). The preferred shares (Series E) pay a 5.5% coupon. If the pipeline is pulling total dividend payments and dividing by common shares only, it would produce an inflated yield.

#### Fix

The dividend yield displayed and used in screening must be **common-share-only**.

**Check the data source:** Inspect what Finnhub's fundamental data returns for the dividend field. The relevant endpoint is the company profile (`/stock/profile2`) which includes a `dividend` field, or the XBRL fundamentals which may break out common vs. preferred.

```javascript
// Verify what Finnhub returns
const profile = await fetch(
  `https://finnhub.io/api/v1/stock/profile2?symbol=AXS&token=${apiKey}`
);
// Check: does the dividend field reflect common-only or total?
```

**If Finnhub returns total dividends (common + preferred):**

The fix requires subtracting preferred dividends. This data is available from XBRL fundamentals under tags like `PreferredStockDividendsIncomeStatementImpact` or `DividendsPreferredStock`.

```javascript
function getCommonDividendYield(stock, financials, marketData) {
  if (isFinancialSector(stock) && financials.preferred_dividends_total) {
    const totalDividends = financials.total_dividends_paid;
    const commonDividends = totalDividends - financials.preferred_dividends_total;
    const commonShares = financials.shares_outstanding;
    const commonDivPerShare = commonDividends / commonShares;
    return commonDivPerShare / marketData.price;
  }
  // Standard calculation for non-financial companies
  return marketData.dividend_yield;
}
```

**If Finnhub returns common-only dividends correctly:**

Then the bug is elsewhere — possibly in how Yahoo Finance's bulk data endpoint reports dividends for companies with preferred shares. Check the Yahoo Finance data for AXS specifically and compare against the Finnhub figure.

**Regardless of root cause:** Add a validation check in the data ingestion layer:

```javascript
// Sanity check: dividend yield > 5% for a non-REIT, non-utility is suspicious
function validateDividendYield(ticker, sector, industry, dividendYield) {
  const highYieldNormal = ['REIT', 'Utilities', 'Real Estate'];
  if (dividendYield > 0.05 && !highYieldNormal.some(s =>
    sector?.includes(s) || industry?.includes(s)
  )) {
    console.warn(
      `SUSPICIOUS: ${ticker} dividend yield ${(dividendYield * 100).toFixed(2)}% ` +
      `in sector ${sector}. Possible preferred/common confusion.`
    );
    return { value: dividendYield, flagged: true };
  }
  return { value: dividendYield, flagged: false };
}
```

Display flagged dividend yields in the UI with a warning icon and tooltip: "This yield appears unusually high for the sector. It may include preferred dividends. Verify from the company's IR page."

### Fix B3: ROIC Replacement for Financial Companies

#### Problem Detail

ROIC = Net Operating Profit After Tax / Invested Capital. For industrial companies, invested capital = total equity + total debt - cash. For insurance companies, this denominator is meaningless because:

- Their "invested capital" is primarily policyholder reserves (float), which is a liability, not equity or debt in the traditional sense.
- The resulting tiny denominator produces absurd ROIC figures (480%+).

Insurance companies are properly evaluated using Return on Equity (ROE) or, more specifically, Operating Return on Average Common Equity (Operating ROACE).

#### Fix

For financial sector companies, replace ROIC with ROE in all displays and analyses.

```javascript
function getProfitabilityMetric(stock, financials) {
  if (isFinancialSector(stock)) {
    const roe = financials.net_income / financials.shareholder_equity;
    return {
      label: 'Return on Equity (ROE)',
      value: (roe * 100).toFixed(1) + '%',
      note: 'ROE used instead of ROIC for financial companies'
    };
  }

  // Standard ROIC for industrials
  const investedCapital = financials.shareholder_equity +
    financials.total_debt - (financials.cash || 0);
  const roic = financials.net_income / investedCapital;
  return {
    label: 'ROIC',
    value: (roic * 100).toFixed(1) + '%',
    note: null
  };
}
```

**In the Claude attractor analysis prompt:** When sending financial data to Claude for a financial sector company, send ROE instead of ROIC and note the sector context:

```
NOTE: This company is classified as [Insurance / Banking / Financial Services].
Financial metrics have been adjusted for sector norms:
- ROE is provided instead of ROIC (ROIC is not meaningful for financial companies)
- Leverage is shown as Debt/Total Capital, not Debt/Equity
- Standard D/E and current ratio filters were auto-passed (financial sector exemption)

Evaluate capital allocation discipline using ROE trends and book value per
share growth rather than ROIC vs. cost of capital.
```

**Add a ROIC validation check** (similar to the dividend yield check):

```javascript
function validateROIC(ticker, sector, roic) {
  if (roic > 1.0) {  // > 100% is almost certainly wrong
    console.warn(
      `SUSPICIOUS: ${ticker} ROIC ${(roic * 100).toFixed(0)}% — ` +
      `likely meaningless for ${sector} sector`
    );
    return { value: roic, flagged: true, useROE: isFinancialSector({ sector }) };
  }
  return { value: roic, flagged: false, useROE: false };
}
```

### Fix B4: Add Auto-Pass Indicators to Screening Display

#### Problem

When a financial company auto-passes the D/E and current ratio filters, the screening table shows green checkmarks identical to companies that actually computed a passing value. This gives the false impression that the data is correct (e.g., D/E = 0.00 showing as a green pass).

#### Fix

Add a distinct visual indicator for auto-passes:

```sql
-- Add auto-pass tracking columns
ALTER TABLE screen_results ADD COLUMN cr_auto_pass INTEGER DEFAULT 0;
-- de_auto_pass already added in Fix B1
```

In the screening results UI:
- Computed pass: green checkmark
- Auto-pass (sector exemption): blue "E" badge with tooltip "Exempt — financial sector"
- Fail: red X
- Near miss: amber warning

This makes it immediately clear which passes are based on computed data and which are sector exemptions.

---

## Part C: Financial Sector Attractor Analysis Adjustments

### Problem

The Claude API attractor analysis prompt sends ROIC, D/E, and other metrics that are meaningless for financial companies. This could cause Claude to produce inaccurate attractor scores.

### Fix

Create a sector-aware prompt template. When the stock is in the financial sector, modify the financial context block:

```javascript
function buildFinancialContext(stock, financials, marketData) {
  if (isFinancialSector(stock)) {
    return `
FINANCIAL CONTEXT (Insurance/Financial Company — adjusted metrics):
Sector: ${stock.sector} | Industry: ${stock.industry}
Price: $${marketData.price} | P/E: ${marketData.pe_ratio} | P/B: ${marketData.pb_ratio}
Book Value Per Share: $${financials.book_value_per_share}
ROE (5-year): ${formatROESeries(financials)}
Combined Ratio (if insurance): ${financials.combined_ratio || 'N/A'}
Debt/Total Capital: ${formatDebtToCapital(financials)}
Premium Growth (if insurance): ${financials.premium_growth || 'N/A'}
Dividend Yield (common only): ${marketData.common_dividend_yield || 'N/A'}

NOTE: This is a financial sector company. Standard industrial metrics (ROIC,
D/E, current ratio) are not applicable. Evaluate using:
- ROE and book value per share growth (not ROIC)
- Combined ratio trends (for insurance)
- Debt-to-total-capital (not D/E)
- Premium/loan growth and pricing discipline
- Reserve adequacy and loss development patterns
`;
  }

  // Standard industrial context
  return `
FINANCIAL CONTEXT:
Price: $${marketData.price} | P/E: ${marketData.pe_ratio} | P/B: ${marketData.pb_ratio}
ROIC (5-year): ${formatROICSeries(financials)}
D/E: ${financials.debt_to_equity}
Current Ratio: ${financials.current_ratio}
FCF (5-year): ${formatFCFSeries(financials)}
Dividend Yield: ${marketData.dividend_yield}
`;
}
```

---

## Database Additions Summary

```sql
-- Auto-pass tracking for screening display
ALTER TABLE screen_results ADD COLUMN de_auto_pass INTEGER DEFAULT 0;
ALTER TABLE screen_results ADD COLUMN cr_auto_pass INTEGER DEFAULT 0;

-- Insider transaction tables (if not already created per Update 3)
CREATE TABLE IF NOT EXISTS insider_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    filing_date TEXT NOT NULL,
    insider_name TEXT NOT NULL,
    insider_title TEXT,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN
        ('buy', 'sell', 'option_exercise', 'gift', 'other')),
    shares REAL NOT NULL,
    price_per_share REAL,
    total_value REAL,
    is_10b5_1 INTEGER NOT NULL DEFAULT 0,
    source_url TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

CREATE TABLE IF NOT EXISTS insider_signals (
    ticker TEXT PRIMARY KEY,
    signal_date TEXT NOT NULL,
    trailing_90d_buys INTEGER DEFAULT 0,
    trailing_90d_buy_value REAL DEFAULT 0,
    trailing_90d_sells INTEGER DEFAULT 0,
    trailing_90d_sell_value REAL DEFAULT 0,
    unique_buyers_90d INTEGER DEFAULT 0,
    signal TEXT CHECK(signal IN ('strong_buy', 'neutral', 'caution')),
    signal_details TEXT,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker)
);

CREATE INDEX IF NOT EXISTS idx_insider_tx_ticker ON insider_transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_insider_tx_date ON insider_transactions(filing_date);
```

---

## Phase Assignment

| Fix | Priority | Phase |
|---|---|---|
| Insider pipeline diagnosis (Part A, Steps 1–5) | **Critical** | Immediate — run diagnostics before writing new code |
| Insider pipeline implementation (Part A, sections A–E) | **Critical** | Immediate — this was supposed to be done already |
| D/E display fix for financials (B1) | High | Immediate |
| Dividend yield common/preferred fix (B2) | High | Immediate |
| ROIC → ROE replacement for financials (B3) | High | Immediate |
| Auto-pass indicators (B4) | Medium | Next UI pass |
| Financial sector attractor prompt (Part C) | Medium | Next attractor analysis session |

---

## Summary of All Changes

| Document | Section | Change |
|---|---|---|
| Scope | `finnhub.js` service | Implement or fix insider transaction functions with complete mapping logic |
| Scope | Cron handler | Wire insider refresh into daily maintenance schedule |
| Scope | Database schema | Add insider tables if missing; add auto-pass columns to screen_results |
| Scope | Signal computation | Implement insider signal algorithm with large-seller edge case handling |
| Scope | Screening engine | Add sector detection utilities; auto-pass flagging for D/E and current ratio |
| Scope | Data ingestion | Add validation checks for suspicious dividend yields and ROIC values |
| Scope | Stock detail UI | Display sector-appropriate metrics (ROE vs ROIC, Debt/Capital vs D/E) |
| Scope | Stock detail UI | Display insider signal icon + expandable transaction list |
| Scope | Claude API prompt | Sector-aware financial context with appropriate metrics for financial companies |
| Report | Data sources | Add note that financial sector stocks use adjusted metrics |
