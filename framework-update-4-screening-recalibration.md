# Attractor Value Framework — Update 4: Layer 1 Screening Recalibration

## Context

This document amends the previously provided specification documents:
- **investment-framework.md** (The Attractor Value Framework — rule set)
- **attractor-value-scope.md** (Claude Code project scope)

It addresses a critical issue encountered in production: the strict P/B ≤ 1.5 filter eliminates 85% of the stock universe and structurally biases results toward the financial services sector. Only 10 of ~460 S&P 500 stocks pass all eight hard filters, and 8 of those 10 are banks or financial companies.

This is a known limitation of strict Graham screening applied to modern markets. Graham designed the P/B threshold for an era when most corporate value was in tangible assets that appeared on the balance sheet near market value. In today's economy, asset-light businesses (technology, healthcare, industrials with strong IP) carry enormous economic value in intangibles that don't appear on the balance sheet, making their P/B structurally high without being overvalued.

The fix preserves Graham's intent (buy cheaper than comparable companies) while removing the structural bias.

---

## Amendment 1: Replace Fixed P/B with Sector-Relative P/B Screen

### Old Rule (Framework Section II, Layer 1):

> **Price-to-Book (P/B):** P/B ≤ 1.5. *Combined filter:* P/E × P/B ≤ 22.5 (Graham's composite ceiling).

### New Rule:

> **Price-to-Book (P/B) — Sector-Relative:** The stock's P/B must fall in the **lower third (bottom 33rd percentile) of its sector**. This preserves Graham's intent — buy cheaper than peers — without structurally excluding asset-light sectors where P/B is inherently higher.
>
> **Absolute P/B backstop:** Regardless of sector percentile, reject any stock with P/B > 5.0. This prevents the sector-relative screen from admitting grossly overvalued stocks in sectors where even the bottom third trades at extreme multiples.
>
> **Combined filter (retained as hard backstop):** P/E × P/B ≤ 22.5. This composite remains a hard filter applied after the sector-relative P/B screen. It allows a higher P/B if the P/E is low enough to compensate (e.g., P/B 2.5 × P/E 8 = 20, passes) and rejects stocks where both multiples are elevated (e.g., P/B 2.5 × P/E 15 = 37.5, fails). The composite does the real work of preventing overpayment.

### Rationale:

| Approach | Problem |
|---|---|
| Fixed P/B ≤ 1.5 | Structurally excludes ~85% of non-financial companies in modern markets. Biases portfolio heavily toward banks. |
| No P/B filter at all | Removes an important valuation check. Admits stocks trading at absurd book value multiples. |
| Sector-relative P/B (bottom third) | Preserves Graham's logic ("buy the cheaper ones") while adapting to the reality that book value means different things in different industries. |

### Implementation Note — Sector Percentile Calculation:

The screening engine needs to compute P/B percentile rank within each sector before applying the filter. This requires knowing the P/B distribution for each sector in the screening universe.

```javascript
// Pseudocode for sector-relative P/B screening

// Step 1: Group all stocks by sector
const sectors = groupBy(allStocks, 'sector');

// Step 2: For each sector, compute P/B percentile thresholds
for (const [sector, stocks] of Object.entries(sectors)) {
  const pbValues = stocks
    .map(s => s.pb_ratio)
    .filter(pb => pb !== null && pb > 0)
    .sort((a, b) => a - b);

  const percentile33 = pbValues[Math.floor(pbValues.length * 0.33)];

  // Step 3: Mark stocks passing sector-relative P/B
  for (const stock of stocks) {
    stock.passes_pb = (
      stock.pb_ratio !== null &&
      stock.pb_ratio > 0 &&
      stock.pb_ratio <= percentile33 &&
      stock.pb_ratio <= 5.0  // absolute backstop
    );
    stock.sector_pb_threshold = percentile33;  // store for UI display
  }
}
```

---

## Amendment 2: Add Near-Miss Tier to Screening Results

### New Concept:

Stocks are classified into three tiers based on how many of the 8 hard filters they pass:

| Tier | Criteria | UI Treatment | Action |
|---|---|---|---|
| **Full Pass** | Passes all 8 hard filters | Green highlight. Automatically eligible for Layer 2 analysis. | Proceed to attractor analysis. |
| **Near Miss** | Passes 7 of 8 hard filters | Amber highlight. Displayed below full-pass stocks with the failed filter clearly identified. | Manual review recommended. If the failed filter is marginal (e.g., P/E of 16 against a threshold of 15.4, or earnings growth of 2.8% vs. 3.0%), the stock may still be worth analyzing. |
| **Fail** | Passes 6 or fewer hard filters | Not displayed by default. Available via "Show all" toggle for exploration. | Not recommended for further analysis under the framework. |

### Decision Logic for Near-Miss Stocks:

Not all near-misses are equal. A stock that misses on earnings stability (only 7 of 10 profitable years) is a more concerning miss than one that barely misses on earnings growth (2.8% vs. 3.0% threshold). The UI should display:

- Which filter was failed.
- The stock's actual value vs. the threshold (e.g., "P/E: 16.1 vs. max 15.4" or "Current ratio: 1.42 vs. min 1.50").
- A "miss severity" indicator:
  - **Marginal miss** (within 10% of the threshold): Displayed with a note that the miss is minor.
  - **Clear miss** (more than 10% beyond the threshold): Displayed with a note that the miss is meaningful.

### Implementation:

```javascript
// Classify screening results into tiers

function classifyResult(screenResult) {
  const hardFilters = [
    'passes_pe', 'passes_pb', 'passes_pe_x_pb',
    'passes_debt_equity', 'passes_current_ratio',
    'passes_earnings_stability', 'passes_dividend_record',
    'passes_earnings_growth'
  ];

  const passCount = hardFilters.filter(f => screenResult[f] === 1).length;
  const failedFilters = hardFilters.filter(f => screenResult[f] !== 1);

  if (passCount === 8) {
    return { tier: 'full_pass', failedFilters: [], passCount };
  } else if (passCount === 7) {
    return { tier: 'near_miss', failedFilters, passCount };
  } else {
    return { tier: 'fail', failedFilters, passCount };
  }
}
```

---

## Amendment 3: Database Schema Updates

### Modify `screen_results` table:

```sql
ALTER TABLE screen_results ADD COLUMN tier TEXT
  CHECK(tier IN ('full_pass', 'near_miss', 'fail'))
  DEFAULT 'fail';

ALTER TABLE screen_results ADD COLUMN pass_count INTEGER DEFAULT 0;

-- Store the sector P/B threshold used at screening time
ALTER TABLE screen_results ADD COLUMN sector_pb_threshold REAL;

-- Store miss severity for near-miss stocks
ALTER TABLE screen_results ADD COLUMN failed_filter TEXT;     -- which filter was missed
ALTER TABLE screen_results ADD COLUMN miss_severity TEXT       -- 'marginal' or 'clear'
  CHECK(miss_severity IN ('marginal', 'clear'));
ALTER TABLE screen_results ADD COLUMN actual_value REAL;      -- stock's actual value for failed filter
ALTER TABLE screen_results ADD COLUMN threshold_value REAL;   -- threshold it needed to meet
```

---

## Amendment 4: UI Changes

### Screener View:

**Filter funnel visualization:** Update to show three tiers instead of a binary pass/fail:
- Full Pass count (green)
- Near Miss count (amber)
- Fail count (grey, shown as "X filtered out")

**Results table:**
- Default view shows Full Pass stocks first (green), then Near Miss stocks (amber), separated by a visual divider.
- Each near-miss stock shows a badge on the failed filter column: "Missed: P/E 16.1 vs 15.4 (marginal)" in amber text.
- "Show all" toggle at the bottom to reveal stocks passing 6 or fewer filters (for exploration only).

**Filter controls:**
- Display the current dynamic P/E threshold (from Update 2) prominently.
- Display the sector P/B thresholds in a collapsible panel: "P/B thresholds by sector: Financials ≤ 1.2, Industrials ≤ 2.8, Technology ≤ 4.1, ..." so the user understands what the sector-relative screen is doing.
- Allow the user to toggle between sector-relative P/B mode and fixed P/B mode (for comparison purposes). Default to sector-relative.

### Stock Detail View:

When viewing a near-miss stock's detail page, display a prominent banner:
> "Near Miss — passes 7 of 8 filters. Failed: [filter name] ([actual value] vs. threshold [threshold value]). Consider running attractor analysis to determine if qualitative factors compensate."

Include a one-click "Run Attractor Analysis" button directly on this banner.

---

## Amendment 5: Attractor Analysis for Near-Miss Stocks

Near-miss stocks that receive attractor analysis should have the missed filter noted in the Claude API prompt so the analysis can account for it:

Add to the analysis prompt for near-miss stocks:

```
NOTE: This stock is a NEAR-MISS on quantitative screening. It passed 7 of 8
Graham-Dodd hard filters but failed on: {failed_filter_name}
(actual: {actual_value}, threshold: {threshold_value}).

In your analysis, consider whether the qualitative attractor factors
compensate for this quantitative shortfall. For example:
- If the missed filter is P/E or P/B, is there a strong reason the
  market is pricing this company at a slight premium (e.g., superior
  capital allocation, moat expansion)?
- If the missed filter is current ratio or debt/equity, does the
  company's industry or business model structurally require different
  leverage norms?
- If the missed filter is earnings stability or growth, is there a
  credible turnaround or cyclical recovery thesis?

Include in your JSON response:
"near_miss_assessment": {
    "compensating_factors": "...",
    "recommendation": "proceed" | "reject",
    "reasoning": "..."
}
```

### Decision Rule for Near-Miss Stocks After Attractor Analysis:

| Attractor Score | Near-Miss Assessment | Action |
|---|---|---|
| ≥ 3.5 | "proceed" | Add to candidates. Apply standard margin of safety for the attractor score and network regime. |
| ≥ 3.5 | "reject" | Reject. Qualitative analysis could not compensate for the quantitative miss. |
| 2.0–3.4 | "proceed" | Add to candidates but apply the higher 40% margin of safety AND require the miss to be marginal (within 10% of threshold). |
| 2.0–3.4 | "reject" | Reject. |
| < 2.0 | Any | Reject. |

---

## Amendment 6: Adjust Framework Section on Margin of Safety for Near-Miss Stocks

### Add to Framework Section III (Valuation Method), Required Margin of Safety table:

| Attractor Stability | Network Regime | Screen Tier | Minimum Discount to IV |
|---|---|---|---|
| Stable (≥ 3.5) | Classical / Soft network | Full Pass | 25% |
| Stable (≥ 3.5) | Classical / Soft network | Near Miss (marginal) | 30% |
| Stable (≥ 3.5) | Hard network / non-leader | Full Pass | 40% |
| Stable (≥ 3.5) | Hard network / non-leader | Near Miss (marginal) | 45% |
| Transitional (2.0–3.4) | Any | Full Pass | 40% |
| Transitional (2.0–3.4) | Any | Near Miss (marginal, Claude "proceed") | 45% |
| Dissolving (< 2.0) | Any | Any | Do not buy |

Near-miss stocks with a **clear miss** (more than 10% beyond the threshold) require the attractor analysis `near_miss_assessment.recommendation` to be "proceed" regardless of attractor score. If Claude recommends "reject," the stock is excluded even at a high attractor score.

---

## Phase Assignment

| Change | Phase | Rationale |
|---|---|---|
| Sector-relative P/B computation | Phase 1 | This modifies the core screening engine. Must be implemented immediately — the current fixed P/B makes the screener largely unusable for non-financial stocks. |
| Near-miss tier classification | Phase 1 | Simple logic addition to the screening engine. Low effort, high value. |
| Schema updates | Phase 1 | Run with other schema changes during this phase. |
| UI changes (tier display, sector thresholds, miss severity) | Phase 1 (if screener UI exists) or Phase 2 | Depends on current frontend state. Apply as soon as the screener view is functional. |
| Near-miss attractor prompt enhancement | Phase 3 | Integrates into existing attractor analysis work. |
| Margin of safety table update | Phase 2 | Apply when valuation calculator is built. |

---

## Summary of All Changes

| Document | Section | Change |
|---|---|---|
| Framework | Section II, Layer 1 | Replace fixed P/B ≤ 1.5 with sector-relative P/B (bottom 33rd percentile) + absolute backstop of 5.0 |
| Framework | Section II, Layer 1 | Retain P/E × P/B ≤ 22.5 composite as hard backstop |
| Framework | Section II | Add three-tier classification: Full Pass / Near Miss / Fail |
| Framework | Section III | Expand margin of safety table to include near-miss tier adjustments |
| Scope | Screening engine | Add sector percentile computation for P/B; add tier classification logic |
| Scope | Database schema | Add tier, pass_count, failed_filter, miss_severity, actual_value, threshold_value columns to screen_results |
| Scope | Claude API prompt | Add near_miss_assessment block for 7/8 stocks |
| Scope | UI — Screener | Three-tier display; sector P/B thresholds panel; miss severity badges |
| Scope | UI — Stock detail | Near-miss banner with one-click attractor analysis |
