# Attractor Value Framework — Update 8: Calibration Results, Reversions, and New Features

## Context

This document amends all previously provided specification documents and supersedes specific recommendations made in conversation that were applied prematurely.

It serves three purposes:
1. **Revert two threshold changes** that were applied before calibration data was available
2. **Formally document features** developed during the calibration tool session that are not captured in Updates 1–7
3. **Establish calibration-validated parameter values** as the authoritative reference

### What Happened

A 30-case calibration study was conducted using historical data from 15 confirmed winners (Berkshire/Buffett public picks) and 15 confirmed value traps. The study tested parameter variations against known outcomes, scoring each configuration on a composite metric weighted 60% trap rejection / 40% winner capture.

Separately, an investigative analysis of the P/E×P/B and current ratio thresholds was conducted, and preliminary recommendations of P/E×P/B ≤ 30 and current ratio ≥ 1.2 were made and applied to the codebase. These recommendations were made without knowledge of the calibration results and conflict with the empirically validated values.

The calibration results — tested against 30 real-world outcomes — take precedence over the investigative analysis.

---

## Part A: Threshold Reversions

### Reversion 1: P/E × P/B Ceiling — Change from 30 back to 40

**Current (incorrect) value:** 30 (applied from investigative recommendation)

**Correct value:** 40 (calibration-validated)

**Evidence:** The calibration study found that moving from Graham's original 22.5 to 40 was the single biggest improvement to the composite score. At 22.5, the framework missed AAPL, KR, and VZ — all confirmed winners. At 40, it captured them without admitting any additional traps. The stocks admitted between 22.5 and 40 are not overpriced — they have elevated P/B primarily due to share buyback programs that reduce book value, not because the businesses are expensive.

At 30, several borderline-but-legitimate candidates (CTSH, and some near-misses in the 30–40 range) are excluded without any corresponding improvement in trap rejection.

**Action:** Change `pe_x_pb_ceiling` from 30 to 40 in the screening engine constants, the How It Works page, and the tooltip content.

### Reversion 2: Current Ratio — Change from 1.2 back to 1.0

**Current (incorrect) value:** 1.2 (applied from investigative recommendation)

**Correct value:** 1.0 (calibration-validated)

**Evidence:** The calibration study found that lowering from 1.5 to 1.0 captured Kroger (a stable, cash-generative grocer that returned strong forward returns) without admitting any new traps. At 1.2, Kroger-type companies with efficient working capital management are excluded. The concern that 1.0 represents "genuinely tight liquidity" is theoretically sound but empirically incorrect for companies that pass the other 7 filters — they tend to have deliberately lean working capital, not precarious balance sheets.

The impact of 1.0 vs. 1.2 is minimal (only CTRA moves from full pass to near miss), but the calibration data supports 1.0 and there is no empirical reason to use 1.2.

**Action:** Change `cr_threshold` from 1.2 to 1.0 in the screening engine constants, the How It Works page, and the tooltip content.

### Update All Documentation

After applying both reversions, update the following to reflect calibration-validated values:

| Location | P/E×P/B Value | CR Value |
|---|---|---|
| Screening engine constants | 40 | 1.0 |
| How It Works page, Section 2 (Layer 1) | 40 | 1.0 |
| Tooltip: `pe_x_pb` | ≤ 40 | — |
| Tooltip: `current_ratio` | — | ≥ 1.0 |
| Technical Report (if regenerated) | 40 | 1.0 |

---

## Part B: Calibration-Validated Parameter Set

The following parameter values are the authoritative reference for the screening engine, validated against 30 historical cases:

| Parameter | Original (Graham) | Calibration-Validated | Change Rationale |
|---|---|---|---|
| P/E ceiling | Fixed 15 | Dynamic: 1 / (AAA yield + 0.015) | Interest rate regime awareness (Update 2) |
| P/B threshold | Fixed 1.5 | Sector-relative 33rd percentile, backstop 5.0 | Eliminate financial sector bias (Update 4) |
| P/E × P/B ceiling | 22.5 | 40 (with ROE modifier — see Part C) | Captures buyback-heavy quality companies |
| D/E threshold | 1.0 | 1.0 industrial / 2.0 capital-intensive / exempt financials | Unchanged from original framework |
| Current ratio | 1.5 | 1.0 (exempt financials) | Captures efficient working capital companies |
| Earnings stability | 8 of 10 years | 8 of 10 years | Unchanged |
| Dividend record | 5 consecutive years | 5 consecutive years | Unchanged |
| Earnings growth | 3% CAGR | 3% CAGR | Unchanged |
| Growth cap (Graham formula) | 7% | 7% | Unchanged |
| Margin of safety (stable) | 25% | 25% | Unchanged |
| Margin of safety (transitional) | 35% | 40% | Improved trap rejection AND precision simultaneously |

---

## Part C: ROE Modifier for P/E × P/B Ceiling (New Feature)

### Problem

Companies with very high returns on equity — the best capital allocators — often have elevated P/B ratios because aggressive share buybacks reduce book value. Apple at the time of Buffett's 2016 purchase had P/E×P/B well above 22.5, not because it was expensive, but because buybacks had compressed equity. American Express (AXP) returned +42%/+115% over 3/5 years but had P/E×P/B of 56 — failing even the relaxed 40 ceiling.

A flat P/E×P/B ceiling penalizes the best businesses for doing exactly what good capital allocators should do.

### Solution

Adjust the P/E×P/B ceiling upward for companies with demonstrably high ROE:

| ROE Range | Ceiling Modifier | Effective Ceiling |
|---|---|---|
| < 20% | ×1.00 (no adjustment) | 40 |
| 20% – 30% | ×1.25 | 50 |
| > 30% | ×1.50 | 60 |

### Calibration Validation

Tested against the 30-case dataset:
- AXP now passes (ROE 30%+ → ceiling 60 > P/E×P/B of 56). AXP returned +42%/+115%.
- No new traps admitted. None of the 15 value traps had ROE > 30% at entry.
- The 20–30% tier admits quality industrials and financials without loosening standards for mediocre businesses.

### Implementation

```javascript
function getAdjustedPexPBCeiling(roe, baseCeiling = 40) {
  if (roe >= 0.30) return baseCeiling * 1.50;
  if (roe >= 0.20) return baseCeiling * 1.25;
  return baseCeiling;
}

// In the screening engine:
const roeTTM = financials.net_income / financials.shareholder_equity;
const adjustedCeiling = getAdjustedPexPBCeiling(roeTTM);
const passes_pe_x_pb = (pe * pb) <= adjustedCeiling;
```

### Documentation Updates

**How It Works page, Section 2, filter 3 — update to:**

> Graham's composite ceiling prevents both multiples from being elevated simultaneously. The base ceiling is 40. For companies with exceptionally high returns on equity (ROE ≥ 20%), the ceiling is adjusted upward — because a high P/B driven by share buybacks in a high-ROE business isn't overvaluation, it's the mathematical consequence of excellent capital allocation.

**Tooltip `pe_x_pb` — update to:**

> Graham's composite ceiling. Base ≤ 40. Adjusted upward for high-ROE companies: ROE 20–30% → ceiling 50; ROE 30%+ → ceiling 60. Prevents both multiples from being elevated simultaneously while rewarding exceptional capital allocators.

---

## Part D: Adversarial Attractor Scoring (New Feature)

### Problem

The original attractor analysis (Layer 3) relies on a single Claude API call that produces a single set of scores. This creates anchoring risk — the model forms an initial impression and subsequent scoring is consistent with that impression rather than independently assessed. There is no stress test of the analysis.

### Solution — Bull/Bear Dual Analysis

Replace the single attractor analysis with two separate analyses:

1. **Bull Case Analysis:** Prompt instructs Claude to make the strongest possible case for the company's competitive durability. Score the six factors assuming the most favorable reasonable interpretation of the evidence.

2. **Bear Case Analysis:** Prompt instructs Claude to make the strongest possible case that the company's competitive position is deteriorating or vulnerable. Score the six factors assuming the most critical reasonable interpretation of the evidence.

3. **Composite Score:** Weighted average of bull and bear scores.

### Weighting

**Default: 60% bear / 40% bull.**

Rationale: In value investing, the asymmetric risk favors caution. Missing a good stock costs you opportunity; buying a dissolving business costs you capital. The bear case should carry more weight.

This weighting may be adjusted to 70/30 or 75/25 based on further calibration — the bear case is systematically biased downward by construction (it's instructed to be critical), so the weights need to compensate.

### Prompt Templates

**Bull case prompt — append to existing analysis prompt:**

```
ANALYSIS MODE: BULL CASE

You are making the strongest reasonable case for this company's competitive
durability. For each of the six attractor factors, identify the most favorable
evidence and score accordingly. You are not fabricating — you are interpreting
ambiguous evidence in the most favorable light and weighting positive signals
more heavily.

This is one half of a dual analysis. A separate bear case will also be
generated. Be genuinely optimistic but grounded in evidence.
```

**Bear case prompt — append to existing analysis prompt:**

```
ANALYSIS MODE: BEAR CASE

You are making the strongest reasonable case that this company's competitive
position is vulnerable, transitioning, or dissolving. For each of the six
attractor factors, identify risks, threats, competitive pressures, and
structural weaknesses. Score accordingly.

Specifically look for:
- Revenue sources that could be disrupted by technology, regulation, or
  competitor innovation
- Competitive advantages that are static rather than compounding
- Industry dynamics shifting toward commoditization or winner-take-all
  (unfavorable for this company)
- Management capital allocation mistakes or strategic missteps
- Customer, supplier, or geographic concentration risks
- Signs of "transformation theater" — announced pivots without execution

This is one half of a dual analysis. A separate bull case will also be
generated. Be genuinely critical but grounded in evidence.
```

### Composite Computation

```javascript
function computeAdversarialAttractorScore(bullScores, bearScores, weight = 0.60) {
  // weight = bear case weight (default 60%)
  const bullWeight = 1 - weight;

  const factors = [
    'revenue_durability', 'competitive_reinforcement', 'industry_structure',
    'demand_feedback', 'adaptation_capacity', 'capital_allocation'
  ];

  const compositeScores = {};
  for (const factor of factors) {
    compositeScores[factor] = (
      bullScores[factor] * bullWeight +
      bearScores[factor] * weight
    );
  }

  const compositeAverage = Object.values(compositeScores)
    .reduce((sum, s) => sum + s, 0) / factors.length;

  return {
    bull_average: Object.values(bullScores).reduce((s, v) => s + v, 0) / factors.length,
    bear_average: Object.values(bearScores).reduce((s, v) => s + v, 0) / factors.length,
    composite_scores: compositeScores,
    composite_average: compositeAverage,
    weight_used: { bull: bullWeight, bear: weight },
  };
}
```

### Database Schema Update

```sql
ALTER TABLE attractor_analysis ADD COLUMN bull_score REAL;
ALTER TABLE attractor_analysis ADD COLUMN bear_score REAL;
ALTER TABLE attractor_analysis ADD COLUMN bear_weight REAL DEFAULT 0.60;
ALTER TABLE attractor_analysis ADD COLUMN analysis_mode TEXT DEFAULT 'single';
  -- 'single' = legacy, 'adversarial' = bull/bear dual
```

The existing `attractor_stability_score` column stores the composite (weighted) score. The `bull_score` and `bear_score` columns store the individual averages for display and review.

### UI Updates

In the attractor analysis detail view, display:
- The composite radar chart (existing, now showing weighted composite scores)
- A **bull/bear comparison** showing both sets of scores side by side, with the weighting indicated
- The bear case reasoning text (particularly important — this is where red flags surface)
- If the bull and bear scores diverge by more than 1.5 points on any factor, highlight that factor as "contested" with a note explaining the disagreement

### Cost Impact

This doubles the Claude API calls per attractor analysis (two calls instead of one). Per-analysis cost rises from ~$0.025 to ~$0.05. With the caching policy from Update 5 (3–8 fresh analyses per day), monthly cost increases from ~$5–10 to ~$10–20. Still very manageable.

### Calibration Validation

The adversarial scoring was tested against the 4 hardest false positives from the calibration study:
- **INTC:** 1.0/5.0 Dissolving. Bear case scored 1.8 ("Transformation Theater"). Identified AMD, TSMC, Apple M-series, hyperscaler custom silicon as threats. 4/5 secular disruption indicators. **Strongly caught.**
- **AT&T:** 1.0/5.0 Dissolving. Advanced disruption. Caught DirecTV debt burden and cord-cutting. 80% red flag coverage. **Caught.**
- **KHC:** 1.0/5.0 Dissolving. Caught brand erosion and writedown pattern. Identified cost-cutting exhaustion. **Caught.**
- **WBA, M, WFC:** Not yet tested — pending addition to stock universe. Complete these as part of the trap harness.

These are stocks that passed 7–8 quantitative filters and looked perfect on the numbers. No ratio threshold can catch them. The adversarial attractor analysis is the correct mechanism.

---

## Part E: Confidence Bands (New Feature)

### Purpose

Not all BUY signals are equal. A stock trading at 50% below buy-below price is a much stronger opportunity than one trading at 2% below. Confidence bands communicate this.

### Implementation

| Band | Condition | Display |
|---|---|---|
| **STRONG** | Current price ≤ 90% of buy-below price | Green badge: "STRONG" |
| **STANDARD** | Current price ≤ buy-below price (but > 90% of it) | Default BUY display |
| **MARGINAL** | Current price > buy-below but ≤ 105% of buy-below | Amber badge: "MARGINAL" |

Stocks in the MARGINAL band are not technically at or below buy-below, but they're close enough that a small price decline could trigger a BUY. Display them with a "Watch closely" note.

### Implementation

```javascript
function getConfidenceBand(currentPrice, buyBelowPrice) {
  if (currentPrice <= buyBelowPrice * 0.90) return 'STRONG';
  if (currentPrice <= buyBelowPrice) return 'STANDARD';
  if (currentPrice <= buyBelowPrice * 1.05) return 'MARGINAL';
  return null;  // not in any buy band
}
```

### UI

The confidence band badge appears next to the BUY signal:
- **BUY — STRONG** (deep green)
- **BUY** (standard green)
- **MARGINAL** (amber, with note: "Within 5% of buy-below price. Watch for entry point.")

### Tooltip

```javascript
confidence_band: {
  label: 'Confidence Band',
  description: 'How far below the buy-below price the stock is trading. STRONG = deep discount (≤90% of buy-below). STANDARD = at or below buy-below. MARGINAL = within 5% above buy-below — close to a buy signal.',
  anchor: 'layer-2-valuation',
},
```

---

## Part F: Economic Environment Scoring (New Feature)

### Purpose

Market-wide stress conditions should automatically tighten the margin of safety. During credit crises, recessions, or periods of elevated volatility, even stable companies face increased risk. The framework should respond to the environment, not just the individual stock.

### Data Sources (from FRED — already integrated)

| Indicator | FRED Series | What It Measures |
|---|---|---|
| AAA Bond Yield | AAA | Already used for P/E ceiling and Graham formula |
| BAA Bond Yield | BAA | Credit spread = BAA - AAA (widens during stress) |
| 10-Year Treasury | GS10 | Risk-free rate benchmark |
| Yield Curve Slope | GS10 - GS2 (computed) | Negative = inverted = recession signal |
| High Yield OAS | BAMLH0A0HYM2 | Option-adjusted spread on junk bonds (spikes during stress) |
| VIX | VIXCLS | Implied volatility (fear gauge) |
| Unemployment Rate | UNRATE | Labor market health |
| CPI Year-over-Year | CPIAUCSL (computed) | Inflation pressure |

### Environment Classification

```javascript
function classifyEnvironment(indicators) {
  let stressSignals = 0;

  // Credit spread (BAA - AAA) > 1.5% is elevated
  if (indicators.baa_yield - indicators.aaa_yield > 2.0) stressSignals += 2;
  else if (indicators.baa_yield - indicators.aaa_yield > 1.5) stressSignals += 1;

  // Yield curve inverted
  if (indicators.gs10 - indicators.gs2 < 0) stressSignals += 2;
  else if (indicators.gs10 - indicators.gs2 < 0.5) stressSignals += 1;

  // High yield OAS > 5% is stressed
  if (indicators.high_yield_oas > 6.0) stressSignals += 2;
  else if (indicators.high_yield_oas > 5.0) stressSignals += 1;

  // VIX > 25 is elevated
  if (indicators.vix > 30) stressSignals += 2;
  else if (indicators.vix > 25) stressSignals += 1;

  // Unemployment rising
  if (indicators.unemployment_rate > 6.0) stressSignals += 1;

  // Classify
  if (stressSignals >= 5) return 'STRESSED';
  if (stressSignals >= 2) return 'CAUTIOUS';
  return 'NORMAL';
}
```

### Margin of Safety Adjustment

| Environment | Adjustment | Effect |
|---|---|---|
| NORMAL | +0% | Standard margins apply |
| CAUTIOUS | +3% | All margins increased by 3 percentage points |
| STRESSED | +5% | All margins increased by 5 percentage points |

These adjustments stack with all other margin calculations (attractor score, network regime, screen tier, small cap adjustment).

**Example:** A Full Pass stock with stable attractor (25% base) during a STRESSED environment: 25% + 5% = 30% margin of safety.

### Small Cap Adjustment

All stocks with market cap < $2B receive an additional +5% margin of safety, stacking with the economic environment adjustment.

**Example:** A small cap, Full Pass, stable attractor, STRESSED environment: 25% + 5% (small cap) + 5% (stressed) = 35% margin of safety.

### UI

Display the current economic environment classification in the app header or dashboard:
- **NORMAL** (green) — standard conditions
- **CAUTIOUS** (amber) — elevated stress indicators, margins widened by 3%
- **STRESSED** (red) — significant market stress, margins widened by 5%

Include a tooltip explaining which indicators are contributing and their current values.

### Database

```sql
CREATE TABLE IF NOT EXISTS economic_environment (
    date TEXT PRIMARY KEY,
    aaa_yield REAL,
    baa_yield REAL,
    credit_spread REAL,
    gs10 REAL,
    gs2 REAL,
    yield_curve_slope REAL,
    high_yield_oas REAL,
    vix REAL,
    unemployment_rate REAL,
    cpi_yoy REAL,
    stress_signals INTEGER,
    classification TEXT CHECK(classification IN ('NORMAL', 'CAUTIOUS', 'STRESSED')),
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Refresh daily as part of the FRED data fetch.

---

## Part G: EDGAR as Primary Fundamental Data Source (Architectural Decision)

### Decision

Replace all commercial API sources (Yahoo Finance, Alpha Vantage) for balance sheet and income statement data with SEC EDGAR XBRL. Commercial APIs remain only for real-time price data and news.

### Rationale

The calibration study and live analysis of AXIS Capital (Update 6) and Chubb both revealed that pre-computed ratios from commercial APIs are unreliable:
- P/B discrepancies between sources (Chubb: 1.67 vs. 1.75)
- Zero debt readings for insurance companies (AXIS)
- Inflated dividend yields from preferred/common confusion (AXIS)
- Missing BVPS data ("?" entries in financial history tables)

### Core Principle

**P/B is never taken pre-computed from any provider.** It is always computed as: `current_price / (stockholders_equity / shares_outstanding)`, where the denominator comes from the most recent EDGAR filing and the numerator comes from a live price feed.

The same principle applies to P/E, D/E, current ratio, and all other ratios used in screening.

### EDGAR Endpoints

| Endpoint | URL Pattern | Use |
|---|---|---|
| Company Facts | `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` | Everything for one company in one call |
| Company Concept | `data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json` | Single metric across all filings (for re-screen mode) |
| Frames | `data.sec.gov/api/xbrl/frames/us-gaap/{concept}/{unit}/CY{year}.json` | Single metric across ALL companies for a period (batch screening) |

Bulk download available nightly for batch screening without API calls.

**Rate limit:** 10 requests/second with User-Agent header identifying the requester.

**Authentication:** None required. Free. No API key.

### Implementation Priority

This is a significant architectural change. Implement in phases:

1. **Phase 1:** Add EDGAR as verification source alongside existing APIs. Compare EDGAR values against current data for discrepancy detection.
2. **Phase 2:** Switch ratio computation to use EDGAR denominators + live price numerators. Keep commercial APIs as fallback.
3. **Phase 3:** Remove commercial API dependency for fundamentals entirely. Commercial APIs used only for real-time price.

### Data Source Allocation (Post-EDGAR Migration)

| Data Type | Source |
|---|---|
| Balance sheet, income statement, cash flow | SEC EDGAR (XBRL) |
| Real-time and end-of-day prices | Yahoo Finance |
| Insider transactions | Finnhub |
| Company news | Finnhub |
| Bond yields, economic indicators | FRED |
| 10-K filing text (MD&A for attractor analysis) | SEC EDGAR (full-text) |

---

## Phase Assignment

| Change | Priority | Timing |
|---|---|---|
| Revert P/E×P/B to 40 | **Critical** | Immediate |
| Revert current ratio to 1.0 | **Critical** | Immediate |
| Update How It Works + tooltips for reverted values | High | Same session as reversions |
| ROE modifier implementation | High | Next screening engine session |
| Adversarial attractor scoring | High | Next attractor analysis session |
| Confidence bands | Medium | Next UI session |
| Economic environment scoring | Medium | Next FRED integration session |
| EDGAR Phase 1 (verification) | Medium | Dedicated session |
| EDGAR Phase 2 (ratio computation) | Lower | After Phase 1 validated |
| EDGAR Phase 3 (full migration) | Lower | After Phase 2 stable |
| Complete trap harness (WBA, M, WFC) | Medium | After adversarial scoring implemented |

---

## Summary of All Changes

| Document | Section | Change |
|---|---|---|
| Scope | Screening engine constants | Revert P/E×P/B to 40, CR to 1.0 |
| Scope | Screening engine | Add ROE modifier for P/E×P/B ceiling |
| Scope | Attractor analysis | Replace single analysis with adversarial bull/bear dual analysis |
| Scope | Database schema | Add bull_score, bear_score, bear_weight, analysis_mode to attractor_analysis; add economic_environment table |
| Scope | Valuation display | Add confidence bands (STRONG / STANDARD / MARGINAL) |
| Scope | Margin of safety | Add economic environment adjustment (+3% CAUTIOUS, +5% STRESSED) and small cap adjustment (+5%) |
| Scope | Data architecture | EDGAR as primary fundamental data source (phased migration) |
| Scope | FRED integration | Expand to credit spreads, yield curve, VIX, unemployment, CPI |
| Update 7 | How It Works page | Update P/E×P/B and CR values, add ROE modifier explanation, add confidence bands section, add economic environment section |
| Update 7 | Tooltip content | Update pe_x_pb, current_ratio tooltips; add roe_modifier, confidence_band, economic_environment tooltips |
