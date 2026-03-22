# Attractor Value Framework — Investment Strategy

*A systematic approach to finding quality businesses at reasonable prices, combining quantitative screening with AI-driven competitive analysis.*

---

## Philosophy

Markets occasionally misprice quality businesses. This happens during crises (temporary fear), for emerging growth companies (the market underestimates self-reinforcing competitive advantages), and during structural regime shifts (the market is slow to recognize new realities). The framework identifies these mispricings through three discovery pipelines, validates each opportunity through adversarial AI analysis, and applies discipline on both entry (buy only below fair value) and exit (take profits at +125% or sell if the competitive position dissolves).

**All uninvested capital sits in VOO** (Vanguard S&P 500 ETF). There is no idle cash. The pipeline allocations are budget caps, not reservations — they determine how much VOO to sell when signals fire. This hybrid approach beats buying and holding VOO alone in 97% of historical vintage simulations.

The framework does not try to predict where the market is going. It identifies what businesses are worth, waits for the market to offer them at a discount, and holds for 3 years or until the +125% take-profit fires.

---

## Architecture

### Four Stages

```
Stage 0: Market Environment Monitoring
  → Is there a crisis? Is there a regime shift?

Stage 1: Candidate Discovery (three pipelines)
  → Pipeline 1: Crisis Dislocation (quality companies in market panic)
  → Pipeline 2: Emerging Growth (DKS — self-reinforcing competitive advantages)
  → Pipeline 3: Regime Transition (structural shifts the market hasn't priced)

Stage 2: Attractor Analysis (shared AI evaluation)
  → Two-pass Claude analysis: bull case + adversarial bear case
  → Six-factor scoring of competitive stability

Stage 3: Valuation & Signal
  → Three models, one per pipeline
  → BUY / NOT_YET / PASS — no ambiguity

Stage 4: Position Sizing & Portfolio Construction
  → Tier-based allocation with flexible pool
  → Sell discipline with six mechanical triggers
```

### Data Sources

| Source | What It Provides | Refresh Frequency |
|--------|-----------------|-------------------|
| SEC EDGAR (primary) | Financial statements, EPS, revenue, balance sheet from 10-K XBRL | 20 tickers/day |
| Finnhub (fallback) | P/E, P/B, insider transactions, company profiles, news | Weekly |
| Yahoo Finance | Daily prices, volume, market cap | Daily 4:45 PM ET |
| FRED | AAA/BAA bond yields, VIX, yield curve, unemployment, GDP, oil, HY OAS | Daily |
| Claude Sonnet 4 | Attractor analysis, crisis impact assessment, DKS evaluation | 3 analyses/day |

---

## Stage 0: Market Environment Monitoring

### Economic Environment Classification

The system classifies the macro environment every day using a stress-point system:

| Indicator | Severe (+2 pts) | Elevated (+1 pt) |
|-----------|-----------------|-------------------|
| Credit spread (BAA-AAA) | > 2.0% | > 1.5% |
| Yield curve (10Y-2Y) | Inverted (< 0) | Flat (0-0.5%) |
| High yield OAS | > 6.0% | > 5.0% |
| VIX | > 30 | > 25 |
| Unemployment | — | > 6.0% |

**Classification:**
- **STRESSED** (≥ 5 points): Margins of safety increased by 5 percentage points across all tiers
- **CAUTIOUS** (≥ 2 points): Extra scrutiny on cyclicals and leveraged companies
- **NORMAL** (< 2 points): Standard thresholds apply

### Crisis Detection

A crisis activates Pipeline 1 (Crisis Dislocation) and triggers pre-crisis price snapshots for the entire universe.

**Activation:** Two or more severe signals, OR S&P 500 decline ≥ 20% from 52-week high:
- S&P 500 ≤ -15% from peak
- VIX sustained above 30
- Credit spread > 2× historical median

**Dynamic stock decline thresholds:** Stocks must have declined from their pre-crisis snapshot by:
- Severe crisis (S&P ≤ -30%): stock ≥ 15% decline
- Moderate crisis (S&P ≤ -20%): stock ≥ 18% decline
- Mild crisis: stock ≥ 20% decline

### Regime Detection

An AI news scan runs daily at 4:55 PM ET, using Claude to identify structural shifts (technology, geopolitical, policy, commodity) from recent headlines. Candidates are stored in a regime registry and confirmed after 3+ consecutive AI flags across separate scans.

---

## Stage 1: Candidate Discovery

### Pipeline 1 — Crisis Dislocation

**When it runs:** Only when a crisis is active.

**What it looks for:** Quality companies whose stock price has declined because of sector-wide fear, not company-specific deterioration. The opportunity exists because the market can't distinguish temporary panic from permanent damage.

**Quantitative pre-screen (5 filters):**

| Filter | Threshold | Rationale |
|--------|-----------|-----------|
| Price decline from pre-crisis | ≥ 15-20% (dynamic by severity) | Must actually be dislocated |
| Earnings stability | ≥ 70% of years with positive EPS | Proven earnings power |
| Debt/equity | < 2.0 (auto-pass for financials) | Can survive extended downturn |
| Free cash flow | Positive | Self-funding, not dependent on markets |
| P/E ratio | < 40 | Not egregiously expensive even after decline |

**Crisis impact assessment:** Claude evaluates each passing company: "Is this decline temporary (buying opportunity) or structural (value trap)?" Only companies classified as `temporary_dislocation` proceed.

**Valuation model:** Graham formula.

---

### Pipeline 2 — Emerging Growth (DKS)

**When it runs:** Monthly (first Saturday) for full universe scan. Candidates also discovered from the Layer 1 screener when growth companies pass quantitative filters.

**What it looks for:** Companies building self-reinforcing competitive advantages — DKS (Durable Keatable Systems). These are businesses where success breeds more success: network effects, switching costs, data moats, platform dynamics. The opportunity exists because the market underestimates how durable these advantages are, and prices growth companies on near-term earnings rather than long-term competitive position.

**Quantitative pre-screen (two tracks):**

**Track 1 — High Growth:**

| Filter | Threshold |
|--------|-----------|
| Revenue CAGR (3yr) | ≥ 20% |
| Gross margin | ≥ 35% |
| Years public | 2-15 |
| Operating cash flow | Positive (or high-growth exception) |

**Track 2 — Steady Compounder:**

| Filter | Threshold |
|--------|-----------|
| Revenue CAGR (3yr) | ≥ 8% |
| Gross margin | ≥ 35% |
| Durable moat type | network_effect, switching_cost, data_moat, platform, scale, brand |

**DKS evaluation:** Claude analyzes whether the company has a genuine self-reinforcing competitive loop. Scores the flywheel on evidence (1-5) and vulnerability (1-5). Only companies with flywheel identified AND overall DKS score ≥ 3.0 proceed to attractor analysis.

**Valuation model:** Growth-adjusted revenue model.

---

### Pipeline 3 — Regime Transition

**When it runs:** Daily at 5:05 PM ET, but only when active regimes exist in the registry.

**What it looks for:** Companies positioned to benefit from structural shifts — technology transitions (AI infrastructure), geopolitical realignment (defense rearmament), policy changes (energy transition), commodity breaks. The opportunity exists because markets are slow to price structural changes, and early movers in a regime shift compound their advantage.

**Quantitative pre-screen:**

| Filter | Threshold | Rationale |
|--------|-----------|-----------|
| Sector overlap | Company's sector/industry matches the regime's affected sectors | Relevance filter |
| Gross margin | > 0% | Viability filter — eliminates pre-revenue cash-burners |
| Debt/equity | < 3.0 | Can survive if regime thesis takes longer than expected |
| Current ratio | > 0.8 | Basic liquidity |

**Consensus Saturation Index (CSI):** Measures whether the market has already recognized and priced the regime shift. Three indicators:

| Indicator | Saturated if |
|-----------|-------------|
| Valuation premium vs pre-regime | Current P/E ≥ 2× historical implied P/E |
| Analyst attention | P/E > 30 |
| Price/Sales premium | P/S > 15 |

**CSI score 0-3.** Pass if CSI ≤ 1 (contrarian or emerging). Reject if CSI ≥ 2 (consensus — the market has already priced the regime shift).

**Valuation model:** Scenario-weighted model.

---

### Layer 1 — Quantitative Value Screen (Tier 1)

**Note:** Layer 1 is the original Graham-Dodd screen. It runs daily on the full universe and feeds candidates into Pipeline 1 for crisis-period entries. It also identifies near-miss candidates worthy of deeper analysis. Calibration showed Layer 1 alone produces negative alpha — its value is as a quantitative filter for other pipelines, not as a standalone discovery strategy.

**Six hard filters (all must pass for full_pass, 5/6 for near_miss):**

| # | Filter | Threshold | Notes |
|---|--------|-----------|-------|
| 1 | P/E | ≤ 1/(AAA yield + 1.5%) | Dynamic — ~15 at 5% AAA yield |
| 2 | P/E × P/B | ≤ 40 (ROE 20-30%: × 1.25; ROE 30%+: × 1.50) | Composite valuation with ROE modifier |
| 3 | Debt/Equity | ≤ 1.0 industrial, ≤ 2.0 utility (auto-pass financials) | Solvency |
| 4 | Current Ratio | ≥ 1.0 (auto-pass financials) | Liquidity |
| 5 | Earnings Stability | ≥ 8 of 10 years positive EPS | Consistency |
| 6 | Earnings Growth | ≥ 3% CAGR over 10 years | Not in permanent decline |

**Removed filters:** P/B standalone (buyback-distorted — AAPL, DVA, HPQ all have broken book values; the P/E×P/B composite provides sufficient discipline) and Dividend Record (excluded best capital allocators like BRK and early AAPL; what-if testing showed 0% CV gap, 64% of bootstraps improved, 0% degraded).

---

## Stage 2: Attractor Analysis

Every candidate that passes its pipeline's pre-screen receives a two-pass AI analysis to evaluate competitive stability.

### Two-Pass Structure

**Bull case (40% weight):** Claude Sonnet evaluates the company's competitive position optimistically, scoring six factors 1-5.

**Bear case (60% weight):** A second adversarial pass challenges every strength the bull case identified. The intentional pessimistic weighting means a company must have genuinely strong competitive dynamics to score well.

### Six Attractor Factors (each scored 1-5)

1. **Revenue Durability** — How predictable and recurring is the revenue stream?
2. **Competitive Reinforcement** — Does success make future competition harder?
3. **Industry Structure** — Is the competitive landscape favorable (oligopoly, high barriers)?
4. **Demand Feedback** — Do more customers create value for existing customers?
5. **Adaptation Capacity** — Can the company evolve without losing its advantage?
6. **Capital Allocation** — Does management reinvest wisely and avoid empire-building?

### Composite Score

```
Weighted Score = (Bull Score × 0.40) + (Bear Score × 0.60)
```

Adjusted for:
- **Concentration risk penalties:** Customer ≥ 40% revenue (-1.0), ≥ 25% (-0.5), single-source supplier (-0.5), geographic ≥ 70% (-0.3), regulatory ≥ 50% (-0.5)
- **Secular disruption adjustments:** Early (-0.5), active (-1.0), advanced (-1.5)
- **Small cap insider ownership:** > 10% (+0.2), < 5% (-0.1)
- **Score floor:** 1.0

### Signal Thresholds

| Attractor Score | Action |
|-----------------|--------|
| < 2.0 | Hard reject — "dissolving" attractor. Triggers emergency SELL for existing positions. |
| 2.0 - 3.0 | Reject for new positions (raised from 2.5 to 3.0: same beat rate, +5pp alpha) |
| ≥ 3.0 | Proceed to valuation |
| ≥ 3.5 | "Stable" attractor — receives tighter margin of safety (lower discount required) |

---

## Stage 3: Valuation & Signal

### Three Valuation Models

#### Pipeline 1 — Graham Formula (Crisis Dislocation)

For established companies with proven earnings power:

```
Intrinsic Value = Normalized EPS × (8.5 + 2g) × (4.4 / Y)

Where:
  Normalized EPS = 3-year average of most recent EPS
  g = earnings growth rate (capped at 7%)
  Y = current AAA corporate bond yield
```

**Fat-tail discount** (reduces IV for earnings volatility):

| EPS History | Discount |
|-------------|----------|
| 10+ years, 0-1 negative years | 0% (resilient) |
| 10+ years, 2-3 negative years | 10% (moderate volatility) |
| 10+ years, 4+ negative years | 15% (high volatility) |
| < 10 years of data | 10% (untested) |

**Margin of safety** (determines buy-below price):

| Classification | Attractor Score | MoS |
|----------------|-----------------|-----|
| Full pass, stable classical | ≥ 3.5 | 25% |
| Full pass, hard network non-leader | ≥ 3.5 | 40% |
| Full pass, transitional | < 3.5 | 40% |
| Near-miss, stable | ≥ 3.5 | 40% |
| Near-miss, hard network | ≥ 3.5 | 45% |
| Near-miss, transitional or clear | < 3.5 | 45% |
| Small cap | any | +5% |
| Stressed environment | any | +5% |

```
Buy Below = Adjusted IV × (1 - Margin of Safety)
```

#### Pipeline 2 — Growth-Adjusted Revenue Model (Emerging DKS)

For growth companies where Graham's formula is inappropriate:

```
Step 1: Project revenue 3 years forward at decelerating growth
  Year 1 growth = Revenue CAGR × 0.90
  Year 2 growth = Revenue CAGR × 0.80
  Year 3 growth = Revenue CAGR × 0.70

Step 2: Estimate target operating margin at scale
  If gross margin > 50%: target = midpoint(current net margin, 50% of gross margin)
  Otherwise: target = current net margin + 5%, floor 10%

Step 3: Compute terminal value
  Estimated EPS at year 3 = (Projected Revenue × Target Margin) / Shares
  Terminal P/E = min(35, 12 + Year 3 growth rate × 100)
  Terminal Value = EPS × Terminal P/E

Step 4: Discount back 3 years at 12% required return
  Intrinsic Value = Terminal Value / (1.12)³
```

**Graduated margin of safety by attractor quality:**

| Attractor Score | MoS | Rationale |
|-----------------|-----|-----------|
| ≥ 3.5 (strong moat) | 15% | High confidence in competitive durability |
| 3.0 - 3.4 (moderate moat) | 20% | Solid but not dominant |
| < 3.0 (weak/unknown moat) | 30% | Wide discount as quality filter |
| Small cap | +5% | Size risk premium |
| Stressed environment | +5% | Macro risk premium |

#### Pipeline 3 — Scenario-Weighted Model (Regime Transition)

For regime beneficiaries where the outcome depends on an external structural shift:

```
Bull case (regime materializes):
  Revenue = Current × 1.40 (40% uplift)
  Earnings = Revenue × Operating Margin × 1.15 (margin expansion)
  Bull Value = (Earnings / Shares) × 18 P/E

Bear case (regime fizzles):
  Revenue = Current × 1.05 (modest organic growth)
  Earnings = Revenue × Operating Margin
  Bear Value = (Earnings / Shares) × 14 P/E

Weighting by Adjacent Possible score:
  AP ≥ 4 (high conviction): 65% bull / 35% bear
  AP ≥ 3 (moderate conviction): 55% bull / 45% bear
  AP < 3 (low conviction): 45% bull / 55% bear

Intrinsic Value = Bull Value × Bull Weight + Bear Value × Bear Weight
```

**Margin of safety:** 30% (strong attractor) to 40% (weak attractor) + 5% stressed environment.

### Signal Logic

```
If attractor score < 2.0 → PASS (dissolving)
If attractor score < 3.0 → PASS (below quality threshold)
If price ≤ buy below → BUY
  If price ≤ 90% of buy below → BUY (STRONG confidence)
  Else → BUY (STANDARD confidence)
If price ≤ intrinsic value → NOT_YET (undervalued but not cheap enough)
Else → PASS (overvalued)
```

**Three signals only.** BUY, NOT_YET, or PASS. No ambiguity, no "maybe." The system makes the decision; the user executes.

---

## Stage 4: Portfolio Construction

### Capital Allocation

| Bucket | Allocation | Purpose |
|--------|-----------|---------|
| Crisis Pipeline | 25% | Quality at crisis discounts (individual stocks) |
| Growth Pipeline | 20% | Sector ETFs weighted by candidate density |
| Regime Pipeline | 15% | Structural shift beneficiaries (individual stocks) |
| Flexible pool | 35% | Overflow from any pipeline with strong signals |
| Cash reserve | 0% | No idle cash — everything in VOO when not deployed |

### Position Sizing

- Maximum single position: 7% of total capital (calibration sweep: 86% → 97% beat rate at 7%)
- STRONG confidence: full position size (7%)
- STANDARD confidence: 75% of maximum (5.25%)
- Sector ETF positions can exceed 7% (inherently diversified — a basket of 50-200 stocks)
- When a pipeline's allocation is exhausted, the flexible pool provides additional capacity

### Sell Discipline — Two Triggers

The sell engine was simplified from six triggers to two after calibration testing showed the others were either harmful or negligible (Test 5).

| # | Trigger | Action | Urgency |
|---|---------|--------|---------|
| 1 | **Take profit at +125%** | SELL all | Standard |
| 2 | **Attractor dissolving** (score < 2.0) | SELL all | Immediate (overrides tax delay) |

**Default hold: 3 years.** The hold period sweep confirmed 3yr is optimal — 1yr exits too early, 5yr collapses from mean reversion.

**Tax awareness:** For the +125% take-profit trigger, if a position is held 300-365 days, the system calculates whether waiting for long-term capital gains (23% vs 40%) is worth the risk. The attractor dissolution trigger always overrides tax delay.

**Removed triggers:** Growth failure (actively hurt returns: -$1,512), concentration trim (never fired), thesis violation (overlaps with dissolution), regime expiry (captured by take-profit instead).

---

## Daily Operations

### Cron Schedule (Market Days)

| Time (ET) | Action |
|-----------|--------|
| 4:45 PM | Yahoo prices for watchlist + passing stocks + rotating universe slice |
| 4:50 PM | Crisis detection → if active, Tier 2 pre-screen (up to 200 stocks) |
| 4:55 PM | Regime detection via AI news scan |
| 5:00 PM | EDGAR fundamentals refresh (20 tickers) + Layer 1 screening |
| 5:05 PM | Tier 4 beneficiary screen for all active regimes |
| 5:10 PM | Signal refresh for all active candidates (BUY/NOT_YET/PASS) |
| 5:15 PM | Sell trigger check for all open positions |

### Weekly

| Day | Action |
|-----|--------|
| Saturday | Finnhub fallback refresh (sectors, metrics, fundamentals) |
| 1st Saturday monthly | Full Tier 3 universe pre-screen |

### Analysis Budget

- 3 attractor analyses per day (Claude Sonnet, ~$0.02-0.03 each)
- Priority: no analysis on record > watchlist/portfolio stale > low scores > any qualifying stock

---

## Calibration Results

The framework was backtested against 292 historical cases spanning 2016-2025, across four market regimes (bull, bear, sideways, crisis). Key findings:

### Per-Pipeline Performance

| Pipeline | BUY Signals | Winner Capture | Trap Rejection | Precision | Avg 3yr Alpha |
|----------|------------|----------------|----------------|-----------|---------------|
| Crisis Dislocation | 42 | 66% | 55% | 81% | +37% |
| Emerging Growth | 32-37 | 42-53% | 72% | 69-73% | +191% |
| Regime Transition | 25 | 79% | 87% | 92% | +320% |

### Portfolio Simulation (Best Risk-Adjusted)

The pure-value configuration (75% Pipeline 1 / 25% Pipeline 2) produced the highest Sharpe ratio (0.29) with after-tax annualized return of 10.4% and maximum drawdown of -15.8%.

### Key Calibration Findings

1. **Layer 1 alone produces negative alpha.** Graham-Dodd screening in the 2016-2025 era underperforms the S&P 500. Its value is as a filter for other pipelines, not standalone.

2. **Narrative strength predicts regime trap risk.** Consensus narratives (strength 4-5) produced only 14% winners vs 100% for contrarian narratives (1-2). The CSI filter automates this.

3. **The growth model's conservatism is intentional.** The deceleration multipliers (0.90/0.80/0.70) and 12% discount rate mean only genuinely undervalued growth companies receive BUY signals. This was calibrated to achieve 68% precision on non-bear cases.

4. **Bear markets are Pipeline 1's domain, not Pipeline 2's.** The emerging growth model (Pipeline 2) tested at 30-38% precision during the 2022 selloff — quality compounders underperformed the S&P's 86% recovery. Pipeline 1's crisis screening is specifically designed for bear-market entries.

5. **Cross-validation confirms generalization.** Five-fold CV showed all pipelines generalize well (composite gaps: Pipeline 1 = 2.5%, Pipeline 2 = 0.8%, Pipeline 3 = 0.5%).

---

## Current System State

As of March 2026:

- **Universe:** 18,435 US stocks, 5,065 with EDGAR financial data
- **Active candidates:** 59 with attractor scores ≥ 2.5
- **BUY signals:** 6 (PAYC, BRBR, INCY, IDCC, META, PCTY)
- **NOT_YET signals:** 11 (closest: URI at 0.0% from triggering, POWL at 1.9%)
- **Data pipeline:** Operational — daily prices, weekly Finnhub, continuous EDGAR backfill
- **Analysis pipeline:** 3 Claude analyses/day, attractor trap validation confirmed on 6/6 known traps

---

## What the Framework Does NOT Do

- **It does not predict market direction.** It has no view on whether the market will go up or down.
- **It does not trade on momentum or technicals.** No moving averages, no RSI, no chart patterns.
- **It does not chase performance.** If a stock doubled but is now overvalued, the signal is PASS.
- **It does not use leverage.** All positions are equity-only, funded from the allocated capital pool.
- **It does not try to time the market.** It deploys capital when opportunities appear and holds cash when they don't.
- **It does not override the system.** If the attractor score says dissolving, you sell. If the price is above buy-below, you don't buy. No exceptions.
