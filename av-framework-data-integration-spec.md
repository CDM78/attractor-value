# AV Framework Data Source Integration Spec — US Equities

**Project:** Attractor Value Framework  
**Location:** Existing project directory (wherever the AV Framework code lives)  
**Purpose:** Replace unreliable third-party financial data with authoritative government sources and expand screening universe into US small caps  
**Sessions:** Two independent sessions — data source integration first, small cap expansion second

---

## Background

The AV Framework currently pulls financial data from free-tier commercial APIs (Yahoo Finance, Alpha Vantage, Finnhub). A calibration study and live report audit identified a critical data reliability problem: P/B ratios, book value per share, and other balance sheet metrics vary across providers, differ in timing, and sometimes fail silently (displaying "?" in reports). The Chubb (CB) report showed P/B of 1.67 from our data source versus 1.75 from Yahoo Finance — a discrepancy large enough to flip a screening filter on a stock sitting right at the threshold.

The root cause is that commercial APIs repackage SEC filings with their own timing, rounding, and methodology choices, and we don't know which choices they made. The fix is to go to the source: SEC EDGAR for company fundamentals and FRED for economic data, both free government APIs with no authentication barriers.

Separately, the framework currently screens only large and mid-cap stocks. Expanding into small caps significantly increases the pool of potential value opportunities — small caps are less efficiently priced, more likely to be overlooked by institutional investors, and historically where Graham-Dodd screening has produced the strongest results. But small caps also carry higher data quality risk, wider bid-ask spreads, and thinner analyst coverage, which means the framework needs specific adaptations.

---

## Session A: SEC EDGAR as Primary Fundamental Data Source

### Overview

Replace Yahoo Finance and Alpha Vantage as the source for balance sheet, income statement, and per-share data. Keep commercial APIs only for real-time market price and market cap. Compute all ratios (P/B, P/E, D/E, current ratio) internally from EDGAR fundamentals + live price, rather than trusting any provider's pre-computed values.

### API Details

**Base URL:** `https://data.sec.gov/api/xbrl/`

**Three endpoints:**

1. **Company Facts** — all XBRL data for a single company  
   `https://data.sec.gov/api/xbrl/companyfacts/CIK{padded_cik}.json`  
   Returns every financial fact ever reported, organized by taxonomy and tag. This is the primary endpoint — one call gives you everything for a company.

2. **Company Concept** — single metric across all filings  
   `https://data.sec.gov/api/xbrl/companyconcept/CIK{padded_cik}/{taxonomy}/{tag}.json`  
   Useful for pulling one specific item (e.g., just EarningsPerShareDiluted) without downloading the full facts file. Good for the price-check re-screen mode.

3. **Frames** — single metric across ALL companies for a period  
   `https://data.sec.gov/api/xbrl/frames/{taxonomy}/{tag}/{unit}/{period}.json`  
   Returns one value per reporting entity for a calendar period. This is critical for the small cap expansion — it lets you screen thousands of companies on a single metric in one API call without fetching each company individually.

**Submissions endpoint** (company metadata):  
`https://data.sec.gov/submissions/CIK{padded_cik}.json`  
Returns company name, ticker, exchange, SIC code, state of incorporation, and complete filing history. Useful for building the screening universe and mapping tickers to CIKs.

**Authentication:** None. No API key required.

**Required headers on every request:**
```javascript
const headers = {
  'User-Agent': 'Bolin & Troy LLC charles@bolinandtroy.com',
  'Accept-Encoding': 'gzip, deflate'
};
```

**Rate limiting:** SEC requests no more than 10 requests per second. Implement a 200ms minimum delay between calls.

**Bulk download:** The entire companyfacts database is available as a single ZIP:  
`https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip`  
Updated nightly at approximately 3:00 AM ET. Approximately 5-6GB uncompressed. For batch screening (especially small caps where you're evaluating hundreds of companies), download this nightly and query locally rather than hitting the API per-company. For on-demand single-stock checks, use the live API.

The submissions history is also available in bulk:  
`https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip`  
This contains company metadata (ticker, CIK, SIC, exchange) for every EDGAR filer. Essential for building the small cap screening universe.

### CIK Mapping

Each company has a Central Index Key (CIK), a 10-digit number padded with leading zeros. Build and maintain a mapping file `src/data/cik-map.json` from ticker to CIK.

The calibration tool already has mappings for 30 tickers. For the full screening universe (especially small caps), generate the mapping programmatically from the bulk submissions download rather than maintaining it by hand.

**CIK lookup for individual tickers:**  
`https://efts.sec.gov/LATEST/search-index?q={ticker}&forms=10-K`  
Or parse the submissions JSON which includes ticker symbols.

**Build a utility function:**
```javascript
async function getCIK(ticker) {
  // 1. Check local cik-map.json cache
  // 2. If not found, query EDGAR submissions
  // 3. Cache the result
  // 4. Return padded 10-digit CIK string
}
```

### XBRL Tags to Extract

These are standardized under the us-gaap taxonomy. All US domestic filers use these tags. Foreign filers (20-F) may use ifrs-full — check both namespaces, preferring us-gaap.

**Per-share data** (units: USD/shares):

| Framework Input | Primary XBRL Tag | Fallback Tags |
|----------------|-------------------|---------------|
| EPS (diluted) | `EarningsPerShareDiluted` | `EarningsPerShareBasic` |
| Dividends/Share | `CommonStockDividendsPerShareDeclared` | `CommonStockDividendsPerShareCashPaid` |

**Balance sheet data** (units: USD, instantaneous):

| Framework Input | Primary XBRL Tag | Fallback Tags |
|----------------|-------------------|---------------|
| Stockholders Equity | `StockholdersEquity` | `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` |
| Shares Outstanding | `CommonStockSharesOutstanding` | `EntityCommonStockSharesOutstanding` (dei taxonomy) |
| Total Assets | `Assets` | — |
| Current Assets | `AssetsCurrent` | — |
| Current Liabilities | `LiabilitiesCurrent` | — |
| Long-Term Debt | `LongTermDebt` | `LongTermDebtNoncurrent`, `LongTermDebtAndCapitalLeaseObligations` |
| Short-Term Debt | `ShortTermBorrowings` | `DebtCurrent` |
| Total Debt | Compute: LongTermDebt + ShortTermBorrowings | `LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities` |

**Income statement data** (units: USD, duration):

| Framework Input | Primary XBRL Tag | Fallback Tags |
|----------------|-------------------|---------------|
| Revenue | `Revenues` | `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet` |
| Net Income | `NetIncomeLoss` | — |

**Computed framework inputs:**

| Framework Input | Computation |
|----------------|-------------|
| BVPS | StockholdersEquity / CommonStockSharesOutstanding |
| P/B | Current market price (Yahoo/AV) / BVPS (EDGAR) |
| P/E | Current market price (Yahoo/AV) / TTM EPS (EDGAR) |
| Debt/Equity | Total Debt / StockholdersEquity |
| Current Ratio | AssetsCurrent / LiabilitiesCurrent |
| Earnings Yield | EPS / Price |

### Parsing Logic

The companyfacts response nests data under `facts > us-gaap > {tag} > units > {unit}`, where each entry has fields: `start`, `end`, `val`, `accn`, `fy`, `fp`, `form`, `filed`.

**Extraction rules:**
1. Filter by `form`: accept "10-K", "10-K/A", "20-F", "20-F/A" (annual reports and amendments)
2. Filter by `fp`: accept "FY" only (excludes quarterly data from 10-K filings)
3. Map to calendar year using the `end` date: `calendarYear = new Date(entry.end).getFullYear()` — do NOT use the `fy` field, which reflects the company's fiscal year label and doesn't align with calendar years for non-December FY companies
4. For flow items (revenue, net income, EPS), verify the duration is approximately annual (330-400 days) to exclude quarterly sub-periods that sometimes appear in annual filings
5. If multiple entries exist for the same calendar year (amendments, restatements), use the one with the latest `filed` date
6. For per-share data, apply stock split adjustments before comparing across years
7. Preferred tags cannot be overwritten by fallback tags — if the primary tag returns data, ignore fallbacks

**Stock split handling:**

EDGAR reports per-share data as-filed, not split-adjusted. Create and maintain `src/data/splits.json`:

```json
{
  "AAPL": [
    { "date": "2020-08-28", "ratio": 4 },
    { "date": "2014-06-09", "ratio": 7 }
  ],
  "GOOGL": [
    { "date": "2022-07-15", "ratio": 20 }
  ]
}
```

For any per-share EDGAR value with an `end` date before the split date, divide by the split ratio. For multiple splits, apply cumulatively.

For automated split detection (important for small caps where you won't manually maintain the table), compare CommonStockSharesOutstanding between consecutive annual filings. If shares outstanding jumps by more than 50% without a corresponding increase in StockholdersEquity, flag as a likely split and compute the ratio.

### Architecture

```
┌─────────────────────────────────────────┐
│           AV Framework Report           │
│              Generation                 │
├─────────────────────────────────────────┤
│         Data Aggregation Layer          │
│    (combines market + fundamental)      │
│    (computes P/B, P/E, D/E, CR)        │
├──────────────┬──────────────────────────┤
│  Market Data │   Fundamental Data       │
│              │                          │
│  Yahoo Fin / │   SEC EDGAR              │
│  Alpha Vntg  │   (PRIMARY)              │
│              │                          │
│  • Price     │   • EPS (10yr history)   │
│  • Market Cap│   • BVPS                 │
│  • Volume    │   • Debt / Equity        │
│              │   • Current Assets/Liab  │
│              │   • Revenue              │
│              │   • Dividends/Share      │
│              │   • Shares Outstanding   │
│              │                          │
│              │   Yahoo / Alpha Vantage  │
│              │   (FALLBACK ONLY)        │
├──────────────┴──────────────────────────┤
│         Data Confidence Layer           │
│  • Source name per input                │
│  • Filing date / retrieval timestamp    │
│  • Staleness flag (>100 days = STALE)   │
│  • EDGAR vs fallback flag               │
│  • Cross-source discrepancy detection   │
└─────────────────────────────────────────┘
```

**Key principle:** The framework computes its own ratios from raw inputs. P/B is never taken pre-computed from Yahoo or anywhere else. It is always: `current_price / (stockholders_equity / shares_outstanding)`, where price is live and the denominator comes from the most recent EDGAR filing.

### Implementation Steps

1. Create `src/data/edgar.js`:
   - `fetchCompanyFacts(cik)` — fetch and cache full companyfacts JSON
   - `extractAnnualEPS(facts, years)` — EPS by calendar year, split-adjusted
   - `extractBVPS(facts, year)` — book value per share for most recent filing as of given year
   - `extractDebtEquity(facts, year)` — D/E ratio from most recent filing
   - `extractCurrentRatio(facts, year)` — current ratio from most recent filing
   - `extractDividendHistory(facts, years)` — dividend per share by year
   - `extractRevenue(facts, years)` — revenue by calendar year
   - `extractSharesOutstanding(facts, year)` — for split detection and BVPS computation
   - `getFilingDate(facts, year)` — returns the date the annual report was filed (for data confidence)

2. Create `src/data/cik-map.json` — start with calibration tool's 30-ticker map, expand as stocks are screened

3. Create `src/data/splits.json` — known stock splits with dates and ratios

4. Create `src/data/aggregator.js` — combines EDGAR fundamentals with live price to compute all ratios. This is where P/B, P/E, D/E, and current ratio are calculated. Implements fallback logic: try EDGAR first, if it fails log a warning and try Yahoo/Alpha Vantage.

5. Modify report generation to use the aggregator instead of directly calling commercial APIs

6. Update the Data Confidence section in reports to show source (EDGAR 10-K filed {date}) and flag any values that fell back to commercial sources

7. Update the price-check re-screen mode to use EDGAR-cached BVPS with live price for current P/B computation

### Testing

Regenerate the CB (Chubb) report using EDGAR data. Verify:
- BVPS is populated for all years (no more "?" entries)
- P/B is computed from EDGAR BVPS + live price
- The P/B value is close to Yahoo's reported P/B (MRQ) — differences should be explainable by timing
- EPS history matches existing report values
- All 8 screening filters produce the same pass/fail results
- Data Confidence section shows EDGAR as the source with filing dates

Also test with AAPL to verify split adjustment logic works (4:1 in 2020, 7:1 in 2014).

### Commit

```
feat: integrate SEC EDGAR as primary fundamental data source with computed ratios
```

---

## Session B: FRED API Enhancement

### Overview

The framework already uses FRED for the Moody's AAA Corporate Bond Yield in the Graham formula. This session expands FRED usage to provide richer economic context for screening and the attractor analysis.

### API Details

**Base URL:** `https://api.stlouisfed.org/fred/`

**Authentication:** Free API key. Register at `https://fred.stlouisfed.org/docs/api/api_key.html`

**Key endpoint:**  
`GET https://api.stlouisfed.org/fred/series/observations?series_id={ID}&api_key={KEY}&file_type=json`

**Rate limiting:** 120 requests per minute. More than sufficient.

### Series to Add

| Series ID | Description | Update Frequency | Framework Use |
|-----------|-------------|------------------|---------------|
| `AAA` | Moody's AAA Corporate Bond Yield | Daily | Graham formula (already in use) |
| `BAA` | Moody's BAA Corporate Bond Yield | Daily | Credit spread = BAA - AAA |
| `DGS10` | 10-Year Treasury Yield | Daily | Alternative rate reference |
| `T10Y2Y` | 10Y minus 2Y Treasury Spread | Daily | Yield curve inversion (recession signal) |
| `CPIAUCSL` | Consumer Price Index (All Urban) | Monthly | Inflation-adjusted returns |
| `UNRATE` | Civilian Unemployment Rate | Monthly | Economic cycle context |
| `A191RL1Q225SBEA` | Real GDP Growth (quarterly, annualized) | Quarterly | Growth environment |
| `BAMLH0A0HYM2` | ICE BofA High Yield OAS | Daily | Credit stress indicator |
| `DCOILWTICO` | WTI Crude Oil Price | Daily | Energy sector context |
| `VIXCLS` | CBOE Volatility Index (VIX) | Daily | Market fear gauge |

### Implementation

Create `src/data/fred.js`:

```javascript
// Core fetch function
async function fetchSeries(seriesId, startDate, endDate) {
  // Returns array of { date, value } observations
}

// Convenience functions
async function getCurrentAAA() { ... }           // For Graham formula
async function getCreditSpread() { ... }         // BAA minus AAA
async function getYieldCurveSlope() { ... }      // T10Y2Y
async function getVIX() { ... }                  // Current VIX

// Derived indicators
function isYieldCurveInverted(t10y2y) {
  return t10y2y < 0;
}

function isCreditStressed(spread, historicalMedian) {
  return spread > historicalMedian * 1.5;
}

// Summary for reports
async function getEconomicSnapshot() {
  // Returns object with all current values and derived signals
  // {
  //   aaa_yield: 5.30,
  //   credit_spread: 1.15,
  //   yield_curve: 0.45,
  //   yield_curve_inverted: false,
  //   vix: 18.5,
  //   unemployment: 4.1,
  //   gdp_growth: 2.3,
  //   oil_price: 68.50,
  //   environment: "NORMAL"  // or "CAUTIOUS" or "STRESSED"
  // }
}
```

### Framework Integration Points

1. **Graham formula:** No change — already uses AAA yield. Route it through the FRED module for consistency.

2. **Margin of safety adjustment:** When the economic environment is "STRESSED" (yield curve inverted AND credit spreads above historical 90th percentile AND VIX > 30), automatically increase all margins of safety by 5 percentage points. This makes the framework more conservative heading into recessions — exactly when value traps are most dangerous.

3. **Report Economic Environment section:** Add to each report, between the Executive Summary and Current Market Data:

   ```
   ## Economic Environment
   | Indicator | Value | Signal |
   |-----------|-------|--------|
   | AAA Corporate Yield | 5.30% | — |
   | Credit Spread (BAA-AAA) | 1.15% | Normal |
   | Yield Curve (10Y-2Y) | +0.45% | Positive |
   | VIX | 18.5 | Normal |
   | Unemployment | 4.1% | Stable |
   | GDP Growth (Q/Q Ann.) | 2.3% | Moderate |
   | WTI Crude | $68.50 | — |
   | Environment | NORMAL | |
   ```

4. **Attractor analysis prompt enrichment:** Pass the economic snapshot to the Claude API call that generates the attractor stability assessment. The prompt should include: "Current economic environment: [snapshot]. Consider how macroeconomic conditions affect this company's attractor stability. A company that appears stable in expansion may be vulnerable in contraction."

### Testing

Run the economic snapshot function and verify all series return current data. Regenerate the CB report with the Economic Environment section and confirm it renders correctly. Test the stress detection logic against historical dates where the environment was clearly stressed (Q1 2020, Q4 2008) by querying FRED with those date ranges.

### Commit

```
feat: expand FRED integration with credit spreads, yield curve, and economic environment scoring
```

---

## Session C: Small Cap Expansion

### Overview

The framework currently screens large and mid-cap stocks — the Berkshire picks, S&P 500 constituents, and well-known names. This is a target-rich environment for quality analysis but a poor environment for finding cheap stocks. Large caps are heavily covered by analysts, efficiently priced, and rarely trade at deep discounts to intrinsic value.

Small caps (roughly $300M to $2B market cap) are where the Graham-Dodd method has historically produced the highest excess returns. These companies have thin or no analyst coverage, wider bid-ask spreads, and less institutional ownership — all of which create persistent mispricings that a systematic screening framework can exploit. The trade-off is higher risk: less liquidity, weaker competitive moats, greater vulnerability to single-customer or single-product concentration, and higher data quality variability.

This session adapts the framework to screen small caps effectively.

### Building the Small Cap Universe

**Step 1: Identify all US-listed companies in the target market cap range**

Use the EDGAR bulk submissions download to get the full list of EDGAR filers with their ticker, exchange, and SIC code. Cross-reference with live market cap data from Yahoo Finance or Alpha Vantage to filter to the $300M-$2B range.

Alternatively, use the EDGAR Frames API to pull a single financial metric (e.g., Assets or Revenue) across all filers in a calendar period, which gives you a rough size filter without needing market cap data:

```
GET https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2025Q3I.json
```

This returns one value per company — total assets as of Q3 2025. Filter to a reasonable range (say $500M to $10B in assets) to get a starting universe, then refine with market cap data.

**Step 2: Filter for screening eligibility**

Not all small caps are screenable. Exclude:
- Companies with fewer than 5 years of public filing history (insufficient data for earnings stability and growth filters)
- Companies that have not filed a 10-K in the last 15 months (delinquent filers — a red flag)
- Companies in the financial sector with assets below $1B (community banks and micro-insurers with insufficient diversification for the attractor framework)
- SPACs, blank check companies, and shell companies (SIC codes 6726, 6770)
- ADRs and foreign private issuers filing on 20-F (keep the universe US-domestic for now)
- Companies with negative revenue (pre-revenue biotech, early-stage companies — not value investments)

**Step 3: Store the universe**

Create a `screening-universe.json` file containing:
```json
{
  "generated": "2026-03-19",
  "market_cap_range": { "min": 300000000, "max": 2000000000 },
  "count": 1247,
  "companies": [
    {
      "ticker": "EXAMPLE",
      "cik": "0001234567",
      "name": "Example Corp",
      "sic": "3674",
      "sic_description": "Semiconductors and Related Devices",
      "exchange": "NASDAQ",
      "market_cap": 850000000,
      "last_10k_filed": "2025-11-15",
      "years_of_history": 8
    }
  ]
}
```

Regenerate this universe monthly. The market cap filter will naturally rotate companies in and out as prices move.

### Framework Adaptations for Small Caps

Small caps require several adjustments to the screening and scoring logic.

#### 1. Adjusted Sector P/B Thresholds

The current sector P/B thresholds were calibrated against large caps. Small caps tend to trade at lower P/B ratios because they lack brand premium and have less institutional demand. Adjust the sector P/B thresholds downward for small caps, or better, compute sector P/B percentiles directly from the EDGAR Frames API by pulling P/B (or equity and shares for computing it) for all companies in a given SIC code range and calculating the 33rd percentile empirically.

This is a major advantage of the Frames API — instead of using estimated sector percentiles, you can compute them from the actual population of filers.

#### 2. Liquidity Filter (New)

Add a new soft filter for trading liquidity:
- Pull average daily volume from Yahoo Finance or Alpha Vantage
- Flag stocks with average daily dollar volume below $500K as ILLIQUID
- Do not auto-reject — some of the best small cap value plays are illiquid. But display the warning prominently so the analyst (you) can make an informed decision about position sizing and exit difficulty

#### 3. Concentration Risk Enhancement

The attractor analysis already has concentration risk factors, but they're more critical for small caps. Enhance the attractor prompt to specifically probe:
- **Customer concentration:** Does the company derive more than 20% of revenue from a single customer? (Often disclosed in 10-K risk factors and notes to financial statements)
- **Geographic concentration:** Is the company dependent on a single facility or region?
- **Product concentration:** Does a single product line account for the majority of revenue?
- **Key person risk:** Is the company dependent on a founder or small management team?

For automated detection, some of these are available in XBRL. The tag `ConcentrationRiskPercentage1` (and variants) reports customer and supplier concentration when disclosed. The 10-K text itself is also available through EDGAR — a Claude API call could parse the risk factors section for concentration language.

#### 4. Insider Ownership (Elevated Importance)

The framework currently treats insider ownership as a soft filter that shows "N/A" when data is unavailable. For small caps, insider ownership is much more important — it aligns management incentives with shareholders and is one of the strongest predictors of small cap outperformance.

Finnhub already provides insider transaction data. For ownership percentage, check EDGAR for DEF 14A (proxy statement) filings which disclose beneficial ownership tables. Alternatively, use the Frames API to pull insider ownership data if it's tagged in XBRL.

Upgrade insider ownership from a soft filter to a scored factor in the attractor analysis for small caps:
- Insider ownership > 10%: positive signal (score +0.2 on attractor)
- Insider ownership 5-10%: neutral
- Insider ownership < 5% or unknown: mild negative for small caps (score -0.1)
- Recent insider buying: strong positive signal
- Recent insider selling: flag for review (but don't auto-penalize — executives sell for many reasons)

#### 5. Earnings Quality Checks

Small cap earnings are more susceptible to manipulation or one-time items. Add these quality checks to the screening pipeline:

- **Accruals ratio:** Compute (Net Income - Operating Cash Flow) / Total Assets. High accruals (>10%) suggest earnings are driven by accounting rather than cash. This requires pulling operating cash flow from EDGAR (tag: `NetCashProvidedByUsedInOperatingActivities`).
- **Revenue quality:** Compare revenue growth to operating cash flow growth. If revenue is growing much faster than cash flow, the growth may not be sustainable.
- **Goodwill ratio:** Compute Goodwill / Total Assets (tag: `Goodwill`). Small caps with goodwill above 40% of assets have significant writedown risk — the attractor analysis should flag this.

Display these as informational metrics in the report, not as hard filters. They inform the attractor analysis and the analyst's judgment.

#### 6. Margin of Safety Adjustment

Small caps are inherently riskier than large caps. Increase the margin of safety by 5 percentage points for all small cap stocks:
- Full pass (8/8): 30% (was 25% for large caps)
- Partial pass (6-7/8): 45% (was 40% for large caps)

This is separate from the economic environment adjustment in Session B — the two stack. In a stressed economic environment, a partial-pass small cap would require a 50% margin of safety (45% base + 5% stress), meaning it needs to trade at half its intrinsic value to generate a BUY signal. That's aggressive, but it's appropriate — small caps in recessions can lose 60-80% and some never recover.

#### 7. Batch Screening Pipeline

Screening 1,000+ small caps one-at-a-time through the EDGAR API would take too long and hit rate limits. Build a batch pipeline:

1. **Nightly:** Download the EDGAR companyfacts bulk ZIP. Extract and store locally.
2. **Weekly:** Run Layer 1 screening across the full small cap universe using local data. This is purely computational — no API calls needed once you have the bulk download.
3. **On demand:** For any stock that passes Layer 1, run Layer 2 valuation and generate a full report using live price data.

This means the weekly batch run produces a shortlist of "candidates" that pass the quantitative screen. You then review the shortlist, pick the interesting ones, and generate full reports (with attractor analysis) for those specific stocks. The batch run should output a simple CSV:

```
ticker, name, market_cap, pe, pb, pe_x_pb, pass_count, tier, buy_below_estimated
```

Where `buy_below_estimated` uses the most recent EPS and current AAA yield to compute a rough Graham IV — not a full report, just a quick signal for whether the stock is even in the right price range.

### Data Quality Considerations for Small Caps

Small cap EDGAR data has quirks that large cap data doesn't:

- **Non-standard XBRL tagging:** Smaller companies are more likely to use custom taxonomy extensions rather than standard us-gaap tags. The extraction logic needs robust fallback chains.
- **Restatements and amendments:** More common in small caps. Always use the latest-filed version of a given period's data.
- **Missing tags:** Some small caps don't report all standard line items. If a critical input (EPS, equity, current assets) is missing from EDGAR, the stock cannot be screened — mark it as INCOMPLETE and skip rather than guessing.
- **Fiscal year changes:** Small caps occasionally change their fiscal year end, creating oddly-lengthed reporting periods. Filter for periods of approximately 365 days (330-400) and flag anomalies.
- **Delayed filings:** Small caps are more likely to file late. Check the `filed` date against the period `end` date. If the gap is more than 90 days for a 10-K (the SEC deadline is 60 days for large accelerated filers, 75 days for accelerated, 90 days for non-accelerated), flag as LATE_FILER. Persistent late filing is a red flag.

### Implementation Steps

1. **Universe builder:** Create `src/screening/universe-builder.js`
   - Download bulk submissions ZIP
   - Parse all filers, filter by exchange (NYSE, NASDAQ, AMEX), SIC code exclusions, and filing recency
   - Cross-reference with market cap data (batch pull from Yahoo Finance API)
   - Output `screening-universe.json`

2. **Batch screener:** Create `src/screening/batch-screener.js`
   - Load companyfacts from bulk download (or local cache)
   - Run Layer 1 screening on each company in the universe
   - Output candidates CSV with estimated buy-below prices
   - Log any companies with INCOMPLETE data (missing critical XBRL tags)

3. **Framework adjustments:** Modify existing screening and scoring code:
   - Add `is_small_cap` flag based on market cap
   - Adjust margin of safety (+5% for small caps)
   - Add liquidity soft filter
   - Add accruals ratio, revenue quality, and goodwill ratio as informational metrics
   - Enhance attractor prompt with small-cap-specific concentration risk questions

4. **Insider activity integration:** Create `src/data/insider.js`
   - Pull insider transactions from Finnhub (already in the stack)
   - Pull beneficial ownership from EDGAR proxy filings where available
   - Score insider ownership for attractor analysis

5. **Sector P/B computation:** Create `src/screening/sector-percentiles.js`
   - Use EDGAR Frames API to pull equity and shares outstanding for all companies in a SIC code range
   - Compute actual 33rd percentile P/B by sector from the real population
   - Cache results and regenerate monthly
   - Use these computed thresholds instead of the current hardcoded estimates

### Testing

1. Run the universe builder and verify it produces a reasonable count (expect 800-1500 companies in the $300M-$2B range on major exchanges)
2. Run the batch screener on the full universe with default parameters. Expect 5-15% of companies to pass Layer 1 (50-150 candidates)
3. Pick 3-5 candidates and generate full reports. Verify:
   - EDGAR data is complete and correctly parsed
   - Small cap margin of safety adjustment is applied
   - Liquidity flag shows for thinly-traded stocks
   - Earnings quality metrics (accruals, goodwill) are displayed
   - Attractor analysis addresses concentration risk
4. Spot-check 2-3 reports against the actual 10-K filings on sec.gov to verify data accuracy

### Commit

```
feat: small cap screening expansion with batch pipeline, liquidity filters, and earnings quality checks
```

---

## Design Principles

1. **Government sources as primary, commercial APIs as fallback.** Every financial input should trace back to a regulatory filing. Commercial APIs repackage this data with unknown transformations.

2. **One call per company for fundamentals.** The EDGAR companyfacts endpoint returns everything in one request. Cache it and extract multiple inputs from it. For batch screening, use the bulk download — zero API calls for Layer 1 screening.

3. **Compute your own ratios.** Never take P/B, P/E, or D/E pre-computed from a third party. Always compute from: `live_price / edgar_fundamental`. This eliminates the data discrepancy problem entirely.

4. **Always show your source.** Every value in the report displays its source (EDGAR 10-K filed 2025-11-01, FRED AAA 2026-03-15, Yahoo Finance live). The Data Confidence layer is not optional.

5. **Degrade gracefully.** If EDGAR is down or a company isn't found, fall back to commercial APIs and flag prominently. Never silently use a lower-quality source.

6. **Cache fundamentals, never cache price.** Balance sheet data changes quarterly at most. Cache EDGAR responses for 90 days. Market price must always be live.

7. **Small caps need more skepticism, not less data.** The response to small cap data quality issues is more checks (accruals, goodwill, insider ownership, filing timeliness), not looser thresholds. The margin of safety increase is the appropriate tool for handling higher uncertainty.
