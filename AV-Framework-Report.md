# Attractor Value Framework — Technical Report

## Overview

The Attractor Value Framework (AVF) is a systematic investment screening and portfolio management system that combines **Benjamin Graham's quantitative value investing** with **complex systems analysis**. The core thesis: companies whose competitive positions act as "stable attractors" — self-reinforcing equilibria that resist perturbation — are more reliably valued using traditional Graham-Dodd methods than companies in transition or dissolution.

The system operates in four layers, each progressively narrowing the investment universe:

| Layer | Name | Method | Input | Output |
|-------|------|--------|-------|--------|
| 1 | Quantitative Screen | 8 hard filters + 3 soft filters | Market data + financials | Pass / Near Miss / Fail |
| 2 | Graham Valuation | Modified Graham formula | EPS history + bond yields | Intrinsic value + buy-below price |
| 3 | Attractor Analysis | Claude AI qualitative scoring | 10-K filings + financials + news | Stability score + regime classification |
| 4 | Adjacent Possible | Claude AI opportunity scoring | Emerging market analysis | Position sizing + time horizon |

A stock must clear all four layers to receive a full buy recommendation.

---

## Layer 1: Quantitative Screening

### Purpose
Eliminate stocks that are quantitatively overvalued, overleveraged, or earnings-unstable using Graham-Dodd criteria adapted for modern markets.

### The 8 Hard Filters

Every stock is evaluated against 8 binary pass/fail filters. All 8 must pass for "Full Pass" status.

#### 1. Price-to-Earnings (Dynamic Ceiling)

The P/E threshold adjusts with interest rates rather than using Graham's fixed P/E <= 15.

**Formula:**
```
P/E_max = 1 / (AAA_bond_yield_decimal + equity_risk_premium)
```

**Parameters:**
- `AAA_bond_yield_decimal` = current Moody's AAA corporate bond yield / 100
- `equity_risk_premium` = 0.015 (1.5 percentage points)
- Fallback if bond yield unavailable: P/E <= 15

**Example:** At AAA yield = 5.3%, the ceiling = 1 / (0.053 + 0.015) = 14.7

**Pass condition:** Stock's trailing P/E <= dynamic P/E ceiling

#### 2. Price-to-Book (Sector-Relative)

Replaced Graham's fixed P/B <= 1.5 with a sector-relative screen to eliminate structural bias toward financial stocks.

**Method:**
1. Group all stocks in the universe by sector
2. For each sector, sort P/B ratios ascending
3. Compute the 33rd percentile value
4. Stock passes if its P/B <= its sector's 33rd percentile AND P/B <= 5.0 (absolute backstop)

**Pass condition:** `P/B <= sector_33rd_percentile AND P/B <= 5.0`

**Minimum sector size:** 3 stocks required; sectors with fewer stocks use the 5.0 backstop.

#### 3. Combined P/E x P/B

Graham's composite ceiling prevents both multiples from being elevated simultaneously.

**Pass condition:** `P/E x P/B <= 22.5`

**Example:** P/B of 2.5 with P/E of 8 = 20 (passes). P/B of 2.5 with P/E of 15 = 37.5 (fails).

#### 4. Debt-to-Equity

**Pass conditions (sector-dependent):**
- Industrial / Technology / Healthcare / Consumer: `D/E <= 1.0`
- Utilities / Real Estate / Energy: `D/E <= 2.0` (capital-intensive sectors)
- Financial Services / Insurance: **Auto-pass** (leverage is the business model)

#### 5. Current Ratio

**Pass condition:** `Current Assets / Current Liabilities >= 1.5`

- Financial Services / Insurance: **Auto-pass**

#### 6. Earnings Stability

**Pass condition:** Positive EPS in at least 8 of the last 10 fiscal years.

- Scaled for shorter histories: if only 7 years available, requires ~6 positive years.
- Requires minimum 5 years of history.

#### 7. Dividend Record

**Pass condition:** Dividends paid in each of the last 5 consecutive fiscal years.

#### 8. Earnings Growth

**Pass condition:** EPS compound annual growth rate >= 3% measured from the average of the first 3 years to the average of the last 3 years of available history.

**Formula:**
```
avg_recent = average EPS of most recent 3 years
avg_early  = average EPS of earliest 3 years
years      = total years of history - 1
growth     = ((avg_recent / avg_early)^(1/years) - 1) x 100

Pass if growth >= 3%
```

### Three-Tier Classification

| Tier | Criteria | Treatment |
|------|----------|-----------|
| **Full Pass** | 8/8 hard filters | Green. Proceeds to Layer 2 valuation + Layer 3 analysis. |
| **Near Miss** | 7/8 hard filters | Amber. Shows which filter failed, actual vs threshold value, and miss severity. Manual review recommended. |
| **Fail** | 6 or fewer | Grey. Not displayed by default. |

**Miss severity** for near-miss stocks:
- **Marginal**: actual value within 10% of the threshold (e.g., P/E 16.1 vs ceiling 14.7 = 9.5% off)
- **Clear**: more than 10% beyond threshold

### 3 Soft Filters (Informational, Not Blocking)

1. **Free Cash Flow**: Positive FCF in at least 7 of 10 years
2. **Insider Ownership**: >= 5% of shares held by insiders
3. **Share Dilution**: Shares outstanding growing <= 2% annually over 5 years

---

## Layer 2: Graham Valuation

### Purpose
Calculate intrinsic value for stocks that pass Layer 1, determine a buy-below price incorporating fat-tail risk and margin of safety.

### Graham Intrinsic Value Formula

```
IV = EPS_normalized x (8.5 + 2g) x (4.4 / Y)
```

**Where:**
- `EPS_normalized` = average EPS of the 3 most recent fiscal years
- `g` = estimated annual EPS growth rate (capped at 7%)
- `8.5` = Graham's base P/E for a zero-growth company
- `2` = Graham's growth multiplier
- `4.4` = Graham's base AAA bond yield (1962 benchmark)
- `Y` = current AAA corporate bond yield (%)

### Growth Rate Estimation

```
avg_recent = average EPS of most recent 3 years
avg_early  = average EPS of earliest 3 years
years      = total years of history - 3 (midpoint-to-midpoint span)
g          = ((avg_recent / avg_early)^(1/years) - 1) x 100
g          = min(g, 7%)  // capped
g          = max(g, 0%)  // floored at zero
```

### Fat-Tail Discount

Adjusts intrinsic value downward based on how the company has performed through economic stress:

| Condition | Discount | Rationale |
|-----------|----------|-----------|
| 10+ years of data, no negative EPS years | 0% | Survived at least one downturn |
| 10+ years of data, had negative EPS | 15% | Vulnerable to economic stress |
| Fewer than 10 years of data | 10% | Untested through a full cycle |

```
Adjusted IV = IV x (1 - fat_tail_discount)
```

### Margin of Safety

The required margin of safety varies based on the attractor stability score (from Layer 3) and network regime:

| Attractor Status | Network Regime | Margin of Safety |
|-----------------|----------------|-----------------|
| Stable (score >= 3.5) | Classical | 25% |
| Stable (score >= 3.5) | Soft Network | 25% |
| Stable (score >= 3.5) | Hard Network (non-leader) | 40% |
| Transitional (score < 3.5) | Any | 40% |
| Not yet analyzed | Default | 25% |

### Buy-Below Price

```
Buy Below = Adjusted IV x (1 - margin_of_safety)
```

### Discount to Intrinsic Value

```
Discount % = ((Adjusted IV - Current Price) / Adjusted IV) x 100
```

Positive = undervalued. Negative = overvalued.

### Complete Valuation Example

```
Stock: LKQ Corporation
Normalized EPS (3yr avg): $2.45
Growth rate: 5.2% (capped at 7%)
AAA bond yield: 5.3%

Graham IV = $2.45 x (8.5 + 2 x 5.2) x (4.4 / 5.3)
         = $2.45 x 18.9 x 0.8302
         = $38.44

Fat-tail: 10+ years, no negative EPS -> 0% discount
Adjusted IV = $38.44

Attractor: Stable (score 3.8), classical regime -> 25% margin
Buy Below = $38.44 x 0.75 = $28.83

Current price: $29.35
Discount to IV: (38.44 - 29.35) / 38.44 = 23.6% (undervalued, but above buy-below)
Signal: WAIT (undervalued but hasn't hit the buy-below threshold)
```

---

## Layer 3: Attractor Stability Analysis (AI)

### Purpose
Qualitatively assess whether a company's competitive position is a stable attractor — a self-reinforcing equilibrium that resists perturbation — or transitional/dissolving.

### Method
Claude Sonnet analyzes the company using three data sources:
1. **Financial data**: 5 years of EPS, revenue, FCF, debt/equity, ROIC, plus current market data and Graham valuation
2. **10-K MD&A text**: Item 7 (Management Discussion & Analysis) from the most recent SEC annual filing, fetched from EDGAR (~4,000 words)
3. **Recent news**: 30 days of company news headlines from Finnhub

### Six Scoring Factors (1-5 each)

| Factor | What It Measures | Score 5 | Score 1 |
|--------|-----------------|---------|---------|
| **Revenue Durability** | How recurring, diversified, and switching-cost-protected is revenue? | Subscription/contract-based, diversified customers, high switching costs | One-time sales, customer concentration, easy substitution |
| **Competitive Reinforcement** | Do advantages compound over time? | Brand, scale, patents, network effects that strengthen with use | Commodity product, no moat, advantages eroding |
| **Industry Structure** | Is the industry consolidated with rational competition? | Oligopoly, high barriers, pricing discipline | Fragmented, price wars, low barriers |
| **Demand Feedback** | Does customer behavior create positive feedback loops? | Habit formation, ecosystem lock-in, platform dynamics | Discretionary, easily deferred, no switching costs |
| **Adaptation Capacity** | Can the company adapt without destroying its core? | Successfully navigated disruption, R&D culture, optionality | Rigid, single-product, disruption-vulnerable |
| **Capital Allocation** | Track record of disciplined capital deployment? | Returns > cost of capital, smart M&A, buybacks at discount | Value-destroying M&A, overbuilding, poor capital returns |

### Composite Attractor Score

```
Raw Score = average of 6 factor scores

Concentration Penalties:
  - Customer >= 40% of revenue: -1.0
  - Customer >= 25% of revenue: -0.5
  - Critical single-source supplier: -0.5
  - Geographic >= 70% from single foreign market: -0.3
  - Regulatory >= 50% tied to single regulation: -0.5

Adjusted Score = max(1.0, Raw Score - total penalties)
```

### Attractor Classification

| Score | Classification | Implication |
|-------|---------------|-------------|
| >= 3.5 | **Stable** | Self-reinforcing position. Standard margin of safety. |
| 2.0 - 3.4 | **Transitional** | Position changing. Higher margin of safety required (40%). |
| < 2.0 | **Dissolving** | Competitive position eroding. Sell signal if held. |

### Network Regime Classification

The AI also classifies the company's competitive dynamics:

| Regime | Description | Implication |
|--------|-------------|-------------|
| **Classical** | Traditional moats (brand, scale, cost advantages) | Standard 25% margin of safety |
| **Soft Network** | Mild network effects, moderate switching costs | Standard 25% margin of safety |
| **Hard Network** | Strong network effects, winner-take-most dynamics | 40% margin of safety (unless clear market leader) |
| **Platform** | Multi-sided platform connecting producers/consumers | Valuation must account for platform-specific dynamics |

### Concentration Risk Extraction

The AI identifies four types of concentration risk from filing data:

| Risk Type | Threshold | Score Penalty |
|-----------|-----------|--------------|
| Single customer >= 40% of revenue | Severe | -1.0 |
| Single customer >= 25% of revenue | Moderate | -0.5 |
| Critical single-source supplier | Binary | -0.5 |
| >= 70% revenue from one foreign market | Geographic | -0.3 |
| >= 50% revenue from one regulation/license | Regulatory | -0.5 |

The adjusted score is floored at 1.0 regardless of penalty accumulation.

---

## Layer 4: Adjacent Possible Analysis (Asymmetric Positions)

### Purpose
Evaluate speculative/asymmetric investment opportunities — companies where a near-term "phase transition" (new product category, market expansion, business model shift) could unlock outsized returns.

### Status
The database schema and constants are defined but the Claude analysis prompt is **not yet implemented**. The five scoring factors are:

| Factor | What It Measures |
|--------|-----------------|
| **Component Maturity** | Are the building blocks for the transition already mature? |
| **Behavioral Adjacency** | Is the new market/product a natural extension of existing behavior? |
| **Analogous Precedent** | Have similar transitions succeeded in other industries? |
| **Combinatorial Clarity** | Is the path from current state to new state clear and achievable? |
| **Infrastructure Readiness** | Is the enabling infrastructure (tech, regulatory, distribution) in place? |

### Position Constraints (Defined)

| AP Score | Max Position Size | Time Horizon |
|----------|------------------|--------------|
| >= 3.5 (Proceed) | 5% of portfolio | 18-24 months |
| 2.0-3.5 (Caution) | 3% of portfolio | 12-18 months |
| < 2.0 (Reject) | Do not invest | N/A |

---

## Portfolio Construction Rules

### Allocation Tiers

| Tier | Allocation | Positions | Max Single Position |
|------|-----------|-----------|-------------------|
| **Core** | 70-85% of portfolio | 12-20 positions | 8% |
| **Asymmetric** | 15-30% of portfolio | 3-6 positions | 5% |

### Risk Limits

- **Sector concentration**: No sector > 25% of portfolio
- **Hard network exposure**: No more than 15% in hard_network regime stocks
- **Minimum diversification**: At least 3 sectors represented
- **Position trimming**: Auto-alert when any position exceeds 12%; trim target is 8%

---

## Insider Transaction Signals

The framework monitors SEC Form 4 insider trading filings for confirmation/caution signals:

| Signal | Criteria |
|--------|----------|
| **Strong Buy** | 3+ distinct insiders buying within 90 days AND aggregate purchases >= $100,000 |
| **Caution** | Net selling exceeds net buying by 5x AND selling includes C-suite (CEO/CFO/COO) |
| **Neutral** | Neither condition met |

Pre-planned sales (10b5-1 plans) are excluded from caution signals.

---

## Sell Discipline

The framework defines 6 mandatory sell triggers:

| Rule | Trigger | Action |
|------|---------|--------|
| **Price Exceeds IV** | Current price > adjusted intrinsic value | Sell/trim position |
| **Attractor Dissolution** | Attractor score drops below 2.0 | Full sell |
| **Thesis Violation** | Original investment thesis is invalidated | Full sell |
| **Better Opportunity** | Higher-conviction opportunity needs capital | Trim/swap |
| **Concentration Creep** | Position exceeds 12% of portfolio | Trim to 8% |
| **AP Invalidation** | Adjacent Possible thesis is disproven | Sell asymmetric position |

---

## Automated Alerts (9 Rules)

The system generates alerts for portfolio holders:

1. Position exceeds trim threshold (12%) or tier max (8% core / 5% asymmetric)
2. Price exceeds adjusted intrinsic value
3. Attractor score drops below 2.0 (dissolution)
4. Attractor score transitions from stable to transitional
5. Asymmetric position within 30 days of time horizon end
6. Asymmetric position past its time horizon
7. Any sector exceeds 25% of portfolio
8. Fewer than 3 sectors represented
9. Insider caution signal on held positions / strong buy on watchlist

---

## What Constitutes a Full Buy Recommendation

For a stock to reach a "BUY" signal in the framework, **all of the following must be true**:

### 1. Layer 1 — Quantitative Screen: Full Pass (8/8)
- P/E below dynamic ceiling (currently ~14.7 at 5.3% AAA yield)
- P/B in bottom third of its sector (and below 5.0 absolute backstop)
- P/E x P/B <= 22.5
- Debt/Equity within sector-appropriate limits
- Current ratio >= 1.5 (or financial sector exemption)
- Positive earnings in 8+ of 10 years
- Dividends paid for 5+ consecutive years
- EPS growth >= 3% CAGR

### 2. Layer 2 — Valuation: Price Below Buy-Below Threshold
- Graham intrinsic value calculated from normalized EPS, growth, and bond yields
- Fat-tail discount applied (0-15%)
- Margin of safety applied (25-40% depending on attractor analysis)
- **Current market price must be at or below the resulting buy-below price**

### 3. Layer 3 — Attractor Analysis: Stable (Score >= 3.5)
- Claude AI assessment of 6 qualitative factors averaging >= 3.5 after concentration penalties
- Network regime classified
- No disqualifying red flags (attractor dissolution risk)
- Concentration risk penalties have not pushed score below 3.5

### 4. Confirmation Signals (Positive but Not Blocking)
- Insider buying signal (3+ insiders, $100K+ in 90 days) strengthens conviction
- Positive FCF in 7+ of 10 years
- Insider ownership >= 5%
- Low share dilution (<= 2%/year)

### Signal Summary

| Condition | Signal Displayed |
|-----------|-----------------|
| Full Pass + Price <= Buy Below | **BUY** (green) |
| Full Pass + Price > Buy Below but < IV | **WAIT** (amber) — undervalued but not enough margin |
| Full Pass + Price > IV | **OVER** (red) — overvalued |
| Near Miss (7/8) + Price <= Buy Below | **REVIEW** (amber) — manual judgment needed |
| Fail (<= 6/8) | No signal |

### The Complete Path: Universe to Purchase

```
~700 stocks (S&P 500 + S&P 400 MidCap)
    |
    v  Layer 1: 8 hard filters
~5-15 Full Pass + ~10-20 Near Miss
    |
    v  Layer 2: Graham valuation
Intrinsic value + buy-below price calculated
    |
    v  Price check: is current price <= buy-below?
~2-5 stocks showing BUY signal
    |
    v  Layer 3: Claude attractor analysis
Stable attractor confirmed (score >= 3.5)
    |
    v  Portfolio rules check
Position size, sector limits, regime limits
    |
    v  BUY
```

---

## Data Sources

| Source | Data | Rate Limit | Cost |
|--------|------|-----------|------|
| Yahoo Finance | Real-time prices | Unlimited | Free |
| Finnhub | P/E, P/B, fundamentals (10-K XBRL), insider transactions, company profiles, news | 60 calls/min | Free tier |
| FRED | AAA corporate bond yield | Unlimited | Free |
| SEC EDGAR | 10-K annual filings (MD&A text) | 10 req/sec | Free |
| Claude Sonnet API | Attractor stability analysis | Per-token | ~$0.02-0.03 per analysis |

---

*Report generated 2026-03-18. Reflects the framework as implemented including Update 4 (Screening Recalibration). Adjacent Possible (Layer 4) analysis logic is defined but not yet implemented.*
