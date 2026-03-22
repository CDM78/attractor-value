# AV Framework — Comprehensive Restructuring Specification

## Document Purpose

This document supersedes all previous update documents (Updates 1-8) and the original framework and scope specifications. It is the single authoritative reference for the AV Framework App going forward.

It restructures the app based on findings from the full calibration study (180 cases, 5 stress tests, allocation optimization) and the theoretical framework developed from complex systems science (West's scaling laws, Pross's DKS, Per Bak's criticality, Kauffman's adjacent possible, Bass diffusion models).

**Key architectural change:** Tier 1 (Graham-Dodd) is no longer a stock-finding strategy. It becomes the *valuation and risk management layer* that all candidates pass through. Stock discovery is handled by Tiers 2, 3, and 4, each finding different types of opportunities. Every candidate flows through a shared attractor analysis and tier-appropriate valuation before receiving a signal.

**Design principles for the UI:**
- BUY and SELL signals are unambiguous — green means buy, red means sell, no maybes
- Position sizing tells the user exactly how many dollars and shares to buy given their available capital
- The system makes the decisions; the user executes them
- All documentation explains the process in plain English with expandable technical details

---

## PART 1: RESTRUCTURED ARCHITECTURE

### The Pipeline (Replaces the Four Parallel Tiers)

```
STAGE 0: MARKET ENVIRONMENT
    FRED data → Economic environment (NORMAL / CAUTIOUS / STRESSED)
    → Crisis detection (activates Tier 2 when crisis flag is true)
    → Regime detection (activates Tier 4 when structural breaks detected)

STAGE 1: CANDIDATE DISCOVERY (Three Parallel Funnels)

    Tier 2 — Crisis Dislocation (active only during crises)
        Crisis flag ON → Screen universe for quality companies
        with price decline ≥ dynamic threshold
        → Crisis impact assessment (temporary vs accelerated decline)
        → ~5-20 candidates during active crisis; 0 otherwise

    Tier 3 — Emerging DKS (always active)
        Monthly quantitative pre-screen of full universe
        → Revenue CAGR, gross margin, market cap, years public
        → ~80-150 pre-screen passes → Claude DKS evaluation
        → ~10-25 candidates

    Tier 4 — Regime Transition (active when regimes detected)
        Daily news scan → regime candidate identification
        → FRED/commodity quantitative confirmation
        → Beneficiary screening (revenue exposure, scaling exponent)
        → CSI filter (reject consensus narratives)
        → ~3-10 candidates per active regime; 0 if no active regime

STAGE 2: ATTRACTOR ANALYSIS (Shared — All Candidates)
    Adversarial bull/bear Claude analysis (60/40 weighted)
    → 6 factors + concentration risk penalties
    → Attractor score ≥ 2.5 required to proceed
    → Dissolving attractors (<2.0) rejected outright

STAGE 3: VALUATION & SIGNAL (Shared — All Candidates That Pass Stage 2)
    Tier-appropriate valuation model:
        Tier 2 → Graham formula (established companies)
        Tier 3 → Growth-adjusted revenue/DCF model
        Tier 4 → Scenario-weighted valuation (regime bull/bear)
    → Margin of safety (attractor-informed + tier premium + environment adjustment)
    → Buy-below price computed
    → Compare current price to buy-below
    → SIGNAL: BUY / NOT YET / PASS

STAGE 4: POSITION SIZING (All BUY Signals)
    Available capital → tier allocation → position size
    → Exact dollar amount and share count
    → Portfolio rule compliance check
    → Final BUY order with specific instructions
```

### What Changed and Why

| Before | After | Reason |
|---|---|---|
| 4 parallel tiers each independently screening | 3 discovery funnels feeding shared analysis + valuation | Tier 1 screening produced negative alpha; its value is in valuation, not discovery |
| Graham-Dodd filters as stock-finding mechanism | Graham-Dodd as valuation discipline applied to candidates found by other methods | Calibration proved strict Graham screening misses the best opportunities |
| Separate attractor analysis per tier | One shared adversarial analysis for all candidates | Eliminates duplication; ensures consistent quality assessment |
| Multiple ambiguous signals (WAIT, REVIEW, MARGINAL) | Three clear signals: BUY, NOT YET, PASS | User should not make judgment calls on ambiguous signals |
| Position sizing left to user judgment | Exact dollar amounts and share counts computed by the system | Removes a decision point where inconsistency creeps in |

---

## PART 2: STAGE 0 — MARKET ENVIRONMENT MONITORING

### Economic Environment Classification

Runs daily. Uses FRED data already being collected.

```javascript
function classifyEnvironment(indicators) {
  let stressSignals = 0;

  if (indicators.credit_spread > 2.0) stressSignals += 2;
  else if (indicators.credit_spread > 1.5) stressSignals += 1;

  if (indicators.yield_curve_slope < 0) stressSignals += 2;
  else if (indicators.yield_curve_slope < 0.5) stressSignals += 1;

  if (indicators.high_yield_oas > 6.0) stressSignals += 2;
  else if (indicators.high_yield_oas > 5.0) stressSignals += 1;

  if (indicators.vix > 30) stressSignals += 2;
  else if (indicators.vix > 25) stressSignals += 1;

  if (indicators.unemployment_rate > 6.0) stressSignals += 1;

  if (stressSignals >= 5) return 'STRESSED';
  if (stressSignals >= 2) return 'CAUTIOUS';
  return 'NORMAL';
}
```

### Crisis Detection (Activates Tier 2)

```javascript
function detectCrisis(marketData) {
  const sp500DeclineFromHigh = (marketData.sp500_current - marketData.sp500_52w_high)
    / marketData.sp500_52w_high;
  const vixSustained = marketData.vix_5day_avg > 30;
  const spreadWidening = marketData.credit_spread_30d_change > 1.0;

  const severeSignals = [
    sp500DeclineFromHigh <= -0.15,
    vixSustained,
    spreadWidening,
  ].filter(Boolean).length;

  return {
    crisis_active: severeSignals >= 2 || sp500DeclineFromHigh <= -0.20,
    severity: sp500DeclineFromHigh <= -0.30 ? 'severe'
      : sp500DeclineFromHigh <= -0.20 ? 'moderate' : 'mild',
    sp500_decline: sp500DeclineFromHigh,
    stock_decline_threshold: sp500DeclineFromHigh <= -0.30 ? -0.15
      : sp500DeclineFromHigh <= -0.20 ? -0.18 : -0.20,
  };
}
```

### Regime Detection (Activates Tier 4)

**Daily automated news scan:**

```javascript
// Daily cron job
async function scanForRegimes(env) {
  // Pull last 24 hours of general financial news from Finnhub
  const news = await finnhub.getGeneralNews(env.FINNHUB_API_KEY);
  const headlines = news.map(n => n.headline).join('\n');

  // Ask Claude to identify potential regime transitions
  const analysis = await claude.analyze({
    model: 'claude-sonnet-4-20250514',
    system: REGIME_DETECTION_PROMPT,  // See prompt below
    user: `Headlines from the last 24 hours:\n${headlines}`,
  });

  // Parse response and add candidates to registry
  for (const candidate of analysis.regimes) {
    await db.addRegimeCandidate(candidate);
  }

  // Cross-reference pending candidates with FRED structural breaks
  await confirmRegimesFromQuantData(env);
}
```

**Regime detection prompt:**

```
You are monitoring for structural regime transitions — major policy changes,
geopolitical events, or technology breakthroughs that create lasting shifts
in economic sectors.

Review these headlines. For each potential regime transition identified:
1. Name and description
2. Catalyst type: policy | geopolitical | technology | commodity
3. Affected sectors (array)
4. Keywords for tracking this regime (array)
5. Adjacent possible score (1-5): are the components already in place?
6. Reversibility: low | medium | high
7. Estimated affected market size ($B)

Only flag STRUCTURAL shifts, not temporary news cycles. A Fed rate decision
is not a regime. The CHIPS Act is a regime. One bad earnings report is not
a regime. A war disrupting 10M barrels/day of oil is a regime.

If no regime transitions are identified, respond with empty array.
Respond in JSON only: { "regimes": [...] }
```

**Confirmation logic:** A regime candidate is confirmed when EITHER:
- FRED structural break detection independently detects the same shift, OR
- Claude flags the same candidate in 3+ consecutive weekly scans AND affected sector ETFs have moved 10%+ in the expected direction

---

## PART 3: STAGE 1 — CANDIDATE DISCOVERY

### Tier 2: Crisis Dislocation

**Active only when crisis flag is true.**

**Pre-screen (automated, full universe):**

```javascript
function tier2PreScreen(stock, crisisContext) {
  const declineFromPreCrisis = (stock.price - stock.pre_crisis_price)
    / stock.pre_crisis_price;

  return {
    passes: (
      declineFromPreCrisis <= crisisContext.stock_decline_threshold &&
      stock.sector_decline <= crisisContext.stock_decline_threshold * 0.8 &&
      // Stock declined with or more than its sector (not company-specific)
      stock.fundamentals.earnings_stability >= 7 &&
      stock.fundamentals.debt_equity < 2.0 &&
      stock.fundamentals.free_cash_flow_positive === true &&
      stock.fundamentals.pe_ratio < 25
    ),
  };
}
```

**Crisis impact assessment (Claude API for each pre-screen pass):**

```
CRISIS IMPACT ASSESSMENT for {company_name} ({ticker}):
Stock has declined {X}% during {crisis_description}.

1. Is the core revenue stream directly affected by this crisis?
2. Were there pre-existing competitive or structural pressures BEFORE
   the crisis that the crisis is now accelerating?
3. If the crisis resolved tomorrow, would revenue and margins return
   to pre-crisis levels within 12 months?

Respond in JSON:
{
  "revenue_directly_affected": true/false,
  "pre_existing_pressures": true/false,
  "would_recover_if_crisis_ends": true/false,
  "assessment": "temporary_dislocation" | "accelerated_decline" | "permanent_damage",
  "reasoning": "..."
}

Only "temporary_dislocation" proceeds to attractor analysis.
```

### Tier 3: Emerging DKS

**Always active. Monthly quantitative pre-screen + Claude DKS evaluation.**

**Quantitative pre-screen (automated, full universe):**

```javascript
function tier3PreScreen(stock) {
  return {
    passes: (
      stock.market_cap_m >= 500 &&
      stock.market_cap_m <= 30000 &&
      stock.revenue_cagr_3yr >= 0.08 &&  // Two-track: 8% for steady compounders
      stock.gross_margin >= 0.35 &&
      stock.years_public >= 2 &&
      stock.years_public <= 15 &&
      stock.operating_cash_flow > 0 || stock.revenue_cagr_3yr >= 0.25
      // High-growth companies can be cash flow negative if growing fast enough
    ),
  };
}
```

**DKS evaluation (Claude API for each pre-screen pass, cached 90 days):**

```
DKS EVALUATION for {company_name} ({ticker}):

Financial data: {5 years of revenue, gross margin, operating margin, FCF}
10-K MD&A excerpt: {Item 7 text, ~3000 tokens}
Recent news: {30 days of headlines from Finnhub}

EVALUATE:
1. FLYWHEEL IDENTIFICATION: What specific self-reinforcing mechanism does
   this company have? (e.g., "more merchants → more app developers →
   better platform → more merchants"). If you cannot identify a specific
   flywheel, the company fails this evaluation.

2. FLYWHEEL EVIDENCE: Is the flywheel actually spinning?
   - Revenue retention (if SaaS): >100% net dollar retention?
   - Gross margins: stable or expanding while revenue grows?
   - Customer acquisition cost: declining as % of revenue?
   - Per-customer revenue: increasing over time?
   Score the evidence 1-5.

3. FLYWHEEL VULNERABILITY: What could break it?
   - Can a larger competitor bundle equivalent functionality?
   - Is the data moat replicable?
   - Could an open standard emerge?
   - Is there a technology risk (like LLMs destroying Chegg)?
   Score the vulnerability 1-5 (5 = very defensible).

4. MOAT TYPE: network_effect | switching_cost | data_moat | platform | scale | brand

5. SUPERLINEAR SCALING: Compute from provided data:
   Revenue growth rate vs employee/asset growth rate.
   Exponent > 1.0 = superlinear (self-reinforcing).

Respond in JSON:
{
  "flywheel_identified": true/false,
  "flywheel_description": "...",
  "evidence_score": N,
  "vulnerability_score": N,
  "moat_type": "...",
  "scaling_exponent": N.N,
  "overall_dks_score": N.N,
  "proceed_to_attractor": true/false,
  "reasoning": "..."
}

Proceed only if flywheel_identified AND overall_dks_score >= 3.0.
```

**Thematic overlay:** In addition to the quantitative pre-screen, maintain a manually curated watchlist of companies in themes of interest. These go directly to the DKS evaluation regardless of whether they pass the quantitative pre-screen. Updated quarterly.

### Tier 4: Regime Transition

**Active when regime registry contains active regimes.**

**Beneficiary screening (automated, sector-filtered universe):**

```javascript
function tier4BeneficiaryScreen(stock, regime) {
  const exposure = computeRevenueExposure(stock, regime.affected_sectors);
  const scaling = computeScalingExponent(stock.financials);
  const balanceSheet = balanceSheetCheck(stock.fundamentals);

  return {
    passes: (
      exposure.exposure_pct >= 0.40 &&
      scaling.best_exponent > 1.0 &&
      balanceSheet.pass
    ),
    exposure_pct: exposure.exposure_pct,
    scaling_exponent: scaling.best_exponent,
  };
}
```

**Consensus Saturation Index (automated):**

```javascript
function computeCSI(ticker, regime, env) {
  const mentions = await analystMentionVelocity(ticker, regime.keywords, env);
  const volume = volumeAnomaly(ticker, priceHistory);
  const valuation = valuationPremium(currentMetrics, preRegimeMetrics);

  const csi = [
    mentions.saturated ? 1 : 0,
    volume.saturated ? 1 : 0,
    valuation.saturated ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return {
    csi_score: csi,
    pass: csi <= 1,  // Reject if 2+ saturation indicators
    interpretation: csi === 0 ? 'contrarian'
      : csi === 1 ? 'emerging' : 'consensus',
  };
}
```

**S-curve position check:** Estimate where on the adoption curve the regime is. Only proceed if early or approaching inflection.

---

## PART 4: STAGE 2 — SHARED ATTRACTOR ANALYSIS

All candidates from all tiers pass through the same adversarial attractor analysis.

**Bull case prompt + bear case prompt, weighted 60% bear / 40% bull.**

**Six factors scored 1-5:**
1. Revenue Durability
2. Competitive Reinforcement
3. Industry Structure
4. Demand Feedback
5. Adaptation Capacity
6. Capital Allocation

**Concentration risk penalties (stacking, floor 1.0):**
- Single customer ≥ 40% of revenue: -1.0
- Single customer ≥ 25% of revenue: -0.5
- Critical single-source supplier: -0.5
- ≥ 70% revenue from single foreign market: -0.3
- ≥ 50% revenue from single regulation/license: -0.5

**Tier-specific context in the prompt:**
- Tier 2: Include crisis context and crisis impact assessment
- Tier 3: Include DKS evaluation results and flywheel description
- Tier 4: Include regime context and beneficiary mechanism

**Threshold:** Adjusted attractor score ≥ 2.5 to proceed. Below 2.0 = hard reject. Between 2.0 and 2.5 = reject for new positions, monitor for existing.

---

## PART 5: STAGE 3 — VALUATION & SIGNAL

### Tier 2 Valuation: Modified Graham Formula

For established companies bought during a crisis. These have stable earnings histories and the Graham formula is appropriate.

```
IV = Normalized_EPS × (8.5 + 2g) × (4.4 / Y)

With ROE modifier on P/E×P/B ceiling:
  ROE 20-30% → ceiling × 1.25
  ROE 30%+ → ceiling × 1.50

Fat-tail discount: 0-15% based on earnings volatility history
Margin of safety: attractor-informed + crisis premium
  Base: 25% (stable attractor) or 35% (transitional)
  Crisis premium: +5% during STRESSED environment
  Small cap premium: +5% if market cap < $2B

Buy-below = Adjusted_IV × (1 - total_margin)
```

### Tier 3 Valuation: Growth-Adjusted Revenue Model

Graham's formula doesn't work for high-growth companies. Use a revenue-based model that accounts for growth trajectory and margin potential.

```javascript
function tier3Valuation(stock) {
  const revenueTTM = stock.financials.revenue_ttm;
  const revenueGrowth = stock.growth_metrics.revenue_cagr_3yr;
  const grossMargin = stock.growth_metrics.gross_margin;
  const targetOperatingMargin = estimateTargetMargin(stock);

  // Project revenue 3 years forward at decelerating growth rate
  const year1Growth = revenueGrowth * 0.85;  // Assume some deceleration
  const year2Growth = revenueGrowth * 0.70;
  const year3Growth = revenueGrowth * 0.55;

  const revenue3yr = revenueTTM
    * (1 + year1Growth) * (1 + year2Growth) * (1 + year3Growth);

  // Apply target operating margin to get estimated earnings
  const estimatedEarnings3yr = revenue3yr * targetOperatingMargin;
  const estimatedEPS3yr = estimatedEarnings3yr / stock.shares_outstanding;

  // Apply a terminal P/E based on expected growth at year 3
  // (Lower than current because growth will have decelerated)
  const terminalPE = Math.min(25, 10 + year3Growth * 100);
  const terminalValue = estimatedEPS3yr * terminalPE;

  // Discount back to present at 12% required return
  const discountRate = 0.12;
  const intrinsicValue = terminalValue / Math.pow(1 + discountRate, 3);

  // Margin of safety
  const baseMargin = stock.attractor_score >= 3.5 ? 0.25 : 0.35;
  const tierPremium = 0.05;  // Tier 3 carries more uncertainty than Tier 2
  const envPremium = getEnvironmentPremium();
  const smallCapPremium = stock.market_cap_m < 2000 ? 0.05 : 0;
  const totalMargin = baseMargin + tierPremium + envPremium + smallCapPremium;

  return {
    intrinsic_value: intrinsicValue,
    buy_below: intrinsicValue * (1 - totalMargin),
    margin_of_safety: totalMargin,
    method: 'growth_adjusted_revenue',
  };
}
```

### Tier 4 Valuation: Scenario-Weighted Model

The thesis depends on an external structural shift. Value under two scenarios.

```javascript
function tier4Valuation(stock, regime) {
  // Bull case: regime fully materializes
  const bullRevenue = stock.financials.revenue_ttm * (1 + regime.revenue_impact_bull);
  const bullEarnings = bullRevenue * stock.financials.operating_margin * 1.15;
  // Margin expansion from regime tailwind
  const bullPE = 18;  // Established company benefiting from structural shift
  const bullValue = (bullEarnings / stock.shares_outstanding) * bullPE;

  // Bear case: regime fizzles or reverses
  const bearRevenue = stock.financials.revenue_ttm * 1.05;  // Modest organic growth
  const bearEarnings = bearRevenue * stock.financials.operating_margin;
  const bearPE = 14;
  const bearValue = (bearEarnings / stock.shares_outstanding) * bearPE;

  // Weight by adjacent possible score
  const bullWeight = regime.adjacent_possible_score >= 4 ? 0.65
    : regime.adjacent_possible_score >= 3 ? 0.55 : 0.45;
  const bearWeight = 1 - bullWeight;

  const weightedIV = bullValue * bullWeight + bearValue * bearWeight;

  // Margin of safety — higher than other tiers due to regime uncertainty
  const baseMargin = stock.attractor_score >= 3.5 ? 0.30 : 0.40;
  const envPremium = getEnvironmentPremium();
  const totalMargin = baseMargin + envPremium;

  return {
    intrinsic_value: weightedIV,
    bull_value: bullValue,
    bear_value: bearValue,
    scenario_weights: { bull: bullWeight, bear: bearWeight },
    buy_below: weightedIV * (1 - totalMargin),
    margin_of_safety: totalMargin,
    method: 'scenario_weighted',
  };
}
```

### Signal Logic — Three Signals Only

```javascript
function computeSignal(candidate) {
  const price = candidate.current_price;
  const buyBelow = candidate.valuation.buy_below;
  const iv = candidate.valuation.intrinsic_value;

  if (candidate.attractor_score < 2.0) {
    return { signal: 'PASS', reason: 'Attractor dissolving', color: 'red' };
  }

  if (candidate.attractor_score < 2.5) {
    return { signal: 'PASS', reason: 'Attractor too weak', color: 'red' };
  }

  if (price <= buyBelow) {
    return {
      signal: 'BUY',
      reason: `${((1 - price/iv) * 100).toFixed(0)}% below intrinsic value`,
      color: 'green',
      confidence: price <= buyBelow * 0.90 ? 'STRONG' : 'STANDARD',
    };
  }

  if (price <= iv) {
    return {
      signal: 'NOT YET',
      reason: `Undervalued but needs ${((1 - price/buyBelow) * -100).toFixed(0)}% more decline`,
      color: 'amber',
      target_price: buyBelow,
    };
  }

  return { signal: 'PASS', reason: 'Overvalued', color: 'grey' };
}
```

**Signal definitions for the user:**

| Signal | Color | Meaning | User Action |
|---|---|---|---|
| **BUY** | Green | The system has identified this as a purchase opportunity. Price is below the buy-below threshold with adequate margin of safety. | Buy the specified position. See position sizing below. |
| **NOT YET** | Amber | The company passes all quality checks but the price hasn't dropped enough. It's on the watchlist with a target price. | Wait. The system will alert you if the price drops to the buy-below level. |
| **PASS** | Grey/Red | Either the company failed quality checks or it's overvalued. | Do nothing. This stock is not an opportunity right now. |

**No other signals exist.** No REVIEW, no MARGINAL, no WAIT, no ANALYSIS REQUIRED. The system makes the decision. You execute BUY signals and ignore everything else.

---

## PART 6: STAGE 4 — POSITION SIZING

### The System Tells You Exactly What to Buy

When a BUY signal fires, the system computes the exact position:

```javascript
function computePosition(signal, portfolio) {
  const availableCapital = portfolio.total_value;
  const cashAvailable = portfolio.cash_balance;

  // Tier allocation
  const tierAllocation = TIER_ALLOCATIONS[signal.tier];
  const tierBudget = availableCapital * tierAllocation;
  const currentTierInvested = portfolio.getTierInvested(signal.tier);
  const tierRemaining = tierBudget - currentTierInvested;

  // Position size limits
  const maxPositionPct = signal.tier === 'tier2' ? 0.05
    : signal.tier === 'tier3' ? 0.05
    : signal.tier === 'tier4' ? 0.05
    : 0.08;  // Should not occur in new architecture

  const maxPositionDollars = availableCapital * maxPositionPct;

  // Confidence adjustment
  const confidenceMultiplier = signal.confidence === 'STRONG' ? 1.0 : 0.75;

  // Compute final position
  const targetDollars = Math.min(
    maxPositionDollars * confidenceMultiplier,
    tierRemaining,
    cashAvailable * 0.90  // Never invest last 10% of cash
  );

  const shares = Math.floor(targetDollars / signal.current_price);
  const actualDollars = shares * signal.current_price;

  return {
    action: 'BUY',
    ticker: signal.ticker,
    shares: shares,
    price: signal.current_price,
    total_cost: actualDollars,
    pct_of_portfolio: actualDollars / availableCapital,
    tier: signal.tier,
    tier_remaining_after: tierRemaining - actualDollars,
    cash_remaining_after: cashAvailable - actualDollars,
  };
}
```

### User Configuration: Starting Capital

The user sets their total available investment capital once. The system handles everything else.

```
Settings:
  Total investment capital: $________
  [Update]

The system will allocate this capital across tiers and size all positions
automatically. You don't need to decide how much to put in each stock.
```

### Default Allocation (from calibration optimization)

```javascript
const TIER_ALLOCATIONS = {
  tier2: 0.15,  // Crisis dislocation — 15%
  tier3: 0.30,  // Emerging DKS — 30%
  tier4: 0.20,  // Regime transition — 20%
  cash_reserve: 0.05,  // Always held — 5%
  // Remaining 30% is available for any tier based on opportunity
  flexible: 0.30,
};
```

**The flexible allocation:** 30% of capital is not pre-assigned to a tier. When a BUY signal fires in any tier and that tier's dedicated allocation is full, the flexible pool is used. This prevents the situation where Tier 3 has 5 great candidates but can only buy 3 because its allocation is capped.

**Cash reserve:** 5% is always held in cash (earning money market rate). This ensures you can always act on a new BUY signal without selling an existing position.

---

## PART 7: SELL DISCIPLINE

### Six Sell Triggers — Unambiguous

Each trigger produces a SELL signal with the same clarity as BUY signals.

| # | Trigger | Condition | Action Displayed |
|---|---|---|---|
| 1 | **Price exceeds IV** | Current price > adjusted intrinsic value | **SELL: Overvalued** — "Price ($X) exceeds intrinsic value ($Y). Sell entire position." |
| 2 | **Attractor dissolution** | Attractor score drops below 2.0 on reassessment | **SELL: Dissolving** — "Competitive position is eroding. Sell entire position immediately." |
| 3 | **Thesis violation** | Fundamental change invalidates the investment thesis | **SELL: Thesis broken** — "Original investment thesis no longer holds. Sell entire position." |
| 4 | **Concentration creep** | Position exceeds 8% of portfolio at market value | **TRIM: Overweight** — "Position is X% of portfolio. Sell N shares ($X) to reduce to 5%." |
| 5 | **Tier 3 growth failure** | Revenue growth below 10% for 2 consecutive quarters OR gross margin below 30% | **SELL: Growth stalled** — "Revenue growth has decelerated below threshold. Sell entire position." |
| 6 | **Tier 4 regime expiry** | Regime status changed to 'matured' or 'invalidated' AND stock has appreciated > 50% from entry | **TRIM: Regime maturing** — "Structural shift is maturing. Sell half the position, hold remainder." |

### Tax-Aware Sell Timing

When a SELL trigger fires on a profitable position held 10-12 months:

```
TAX NOTE: This position has been held [X] months. Waiting [Y] more days
converts this from short-term tax (~40%) to long-term (~23%).
Tax savings: ~$[Z]. Stock would need to decline [W]% for selling now
to be the better choice.

RECOMMENDATION: [WAIT / SELL NOW]
```

The system recommends WAIT if the tax savings exceed the estimated risk. Exception: attractor dissolution (trigger #2) always overrides — sell immediately regardless of tax.

### Long-Term Threshold Hold

```javascript
function shouldDelayForTax(position, currentPrice) {
  const holdingDays = daysSince(position.purchase_date);
  if (holdingDays > 365 || holdingDays < 300) return null;  // Not applicable
  if (currentPrice <= position.cost_basis) return null;  // No gain = no tax

  const gain = currentPrice - position.cost_basis;
  const daysToLongTerm = 366 - holdingDays;
  const shortTermTax = gain * 0.398;  // ~40%
  const longTermTax = gain * 0.228;   // ~23%
  const savings = shortTermTax - longTermTax;
  const breakEvenDecline = savings / currentPrice;

  return {
    delay_recommended: true,
    days_to_wait: daysToLongTerm,
    tax_savings: savings,
    breakeven_decline_pct: breakEvenDecline,
  };
}
```

---

## PART 8: PORTFOLIO DASHBOARD

### Main Dashboard View

The dashboard is the app's home screen. It shows:

**Portfolio Summary Bar (always visible at top):**
```
Total Value: $XX,XXX  |  Today: +$XXX (+X.X%)  |  Cash: $X,XXX (X%)
Environment: [NORMAL/CAUTIOUS/STRESSED]  |  Active Crises: [0/1]  |  Active Regimes: [N]
```

**Allocation Donut Chart:**
Visual showing current allocation across tiers + cash vs. target allocation. Highlights any tier that's over or under its target.

```
[Tier 2: 12% / 15% target]  [Tier 3: 28% / 30% target]
[Tier 4: 18% / 20% target]  [Cash: 7% / 5% target]
[Flexible: 35% / 30% target]
```

**Active Signals Panel (most important element):**

```
┌─────────────────────────────────────────────────────────────────────┐
│  🟢 BUY SIGNALS (2)                                                │
│                                                                      │
│  CRWD — CrowdStrike    Tier 3 (Emerging DKS)    STRONG             │
│  Price: $245    Buy Below: $280    IV: $375                          │
│  Action: Buy 8 shares ($1,960)    Portfolio: 4.9%                   │
│  [EXECUTE BUY →]                                                     │
│                                                                      │
│  CCJ — Cameco           Tier 4 (Nuclear regime)  STANDARD           │
│  Price: $48     Buy Below: $52     IV: $72                           │
│  Action: Buy 20 shares ($960)     Portfolio: 2.4%                   │
│  [EXECUTE BUY →]                                                     │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  🔴 SELL SIGNALS (1)                                                │
│                                                                      │
│  WBA — Walgreens        SELL: Dissolving                             │
│  Attractor score dropped to 1.5. Competitive position eroding.      │
│  Action: Sell all 25 shares (~$625)                                  │
│  [EXECUTE SELL →]                                                    │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  🟡 NOT YET (5)                                                     │
│  AXON $310 → needs $280 (-9.7%)  |  MSCI $520 → needs $470 (-9.6%)│
│  VEEV $215 → needs $195 (-9.3%)  |  ...                            │
│  [View Watchlist →]                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Key design requirements for the signals panel:**
- BUY signals show the EXACT number of shares and dollar amount to buy
- SELL signals show the EXACT number of shares to sell
- One-click "EXECUTE" buttons (these don't actually trade — they mark the signal as acted upon and log the transaction)
- NOT YET shows how far the price needs to fall as a percentage
- No ambiguous signals — everything is BUY, SELL, or NOT YET

### Holdings Table

```
┌────────┬────────┬───────┬──────────┬──────────┬────────┬──────────┬────────────┐
│ Ticker │  Tier  │ Shares│ Cost     │ Current  │ Gain   │ % of     │ Signal     │
│        │        │       │ Basis    │ Value    │        │ Portfolio │            │
├────────┼────────┼───────┼──────────┼──────────┼────────┼──────────┼────────────┤
│ SHOP   │ T3 DKS │  15   │ $1,200   │ $1,875   │ +56.3% │ 4.7%     │ HOLD       │
│ BWXT   │ T4 Reg │  40   │ $2,000   │ $3,200   │ +60.0% │ 8.0%     │ TRIM ⚠️    │
│ MSFT   │ T2 Cri │  10   │ $1,350   │ $4,200   │ +211%  │ 10.5%    │ TRIM ⚠️    │
│ WBA    │ T2 Cri │  25   │ $1,375   │   $625   │ -54.5% │ 1.6%     │ 🔴 SELL    │
└────────┴────────┴───────┴──────────┴──────────┴────────┴──────────┴────────────┘
```

**Color coding:**
- Green: positive gain
- Red: negative gain or SELL signal
- Amber warning: TRIM needed (position > 8%)
- Each row is clickable for full detail view

### Alerts Panel (Persistent, Dismissable)

```
⚠️ BWXT exceeds 8% of portfolio (8.0%). Trim to 5%. [REVIEW →]
⚠️ Cash reserve below 5% target (3.2%). Consider trimming to raise cash.
ℹ️ Tier 3 quarterly review due. 3 positions need attractor re-analysis.
ℹ️ Regime "AI Infrastructure" S-curve approaching inflection. Review Tier 4 positions.
```

---

## PART 9: UPDATED HOW IT WORKS PAGE

The How It Works page should be completely rewritten to reflect the new architecture. Structure:

### Section 1: What This App Does
Explain the pipeline: discover candidates through three methods, evaluate their competitive durability, value them appropriately, and produce clear buy/sell signals with exact position sizes.

### Section 2: How Opportunities Are Found
Three subsections — one for each discovery funnel:
- **Crisis Dislocation:** Quality companies temporarily discounted by market-wide fear
- **Emerging Growth:** Companies building self-reinforcing competitive positions
- **Regime Transition:** Companies benefiting from structural economic shifts
Each with plain English + expandable technical details.

### Section 3: How Companies Are Evaluated
The shared attractor analysis — bull case, bear case, weighted composite. Six factors. Concentration risk. Written for a reader who doesn't know what "DKS" means.

### Section 4: How Stocks Are Valued
Three valuation approaches, one per tier. Explain in plain English why different types of companies need different valuation methods. Graham formula for established companies. Growth model for emerging companies. Scenario model for regime plays.

### Section 5: What the Signals Mean
BUY, NOT YET, PASS — and the six sell triggers. Emphasize: the system makes the decisions, you execute them.

### Section 6: How Position Sizes Are Determined
How the system divides your capital across tiers and computes exact share counts. The allocation targets, the flexible pool, the cash reserve.

### Section 7: Market Environment Monitoring
How the system detects crises and regime transitions. The economic environment indicator. What NORMAL, CAUTIOUS, and STRESSED mean for your portfolio.

### Section 8: Sell Discipline
The six triggers, tax-aware timing, and why each exists.

### Section 9: Glossary
Updated to include all new terms (CSI, scaling exponent, S-curve position, regime registry, DKS flywheel, etc.)

### Section 10: The Research Behind This Approach
Brief overview of the complex systems framework, the calibration study, and the professional investors who use similar approaches (Mauboussin, Sleep, Anderson, Miller). This section builds trust that the methodology has intellectual and empirical foundations.

---

## PART 10: CONTEXTUAL TOOLTIPS

Update the tooltip content map from Update 7 to reflect the new architecture. Add tooltips for:

- All three discovery funnels (Tier 2, 3, 4)
- Crisis flag and crisis severity
- Regime registry and active regimes
- DKS flywheel and DKS score
- Scaling exponent
- Consensus Saturation Index
- S-curve position
- Scenario-weighted valuation
- Flexible allocation pool
- All six sell triggers
- Economic environment indicator
- Tax-aware sell timing

Every metric, signal, badge, and label in the UI should have a tooltip. The tooltip should be 1-3 sentences and link to the relevant section of How It Works.

---

## PART 11: DATABASE SCHEMA CHANGES

### New Tables

```sql
-- Replace regime_registry if it exists with expanded version
CREATE TABLE IF NOT EXISTS regime_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    catalyst_type TEXT CHECK(catalyst_type IN
        ('commodity_break', 'policy', 'technology', 'geopolitical')),
    start_date TEXT NOT NULL,
    affected_sectors TEXT NOT NULL,      -- JSON array
    regime_keywords TEXT NOT NULL,        -- JSON array
    estimated_market_size_b REAL,
    adjacent_possible_score INTEGER,
    scurve_position TEXT,
    scurve_penetration_pct REAL,
    status TEXT DEFAULT 'pending'
      CHECK(status IN ('pending', 'active', 'matured', 'invalidated')),
    confirmed_by TEXT,                   -- 'quantitative' | 'repeated_ai' | 'both'
    ai_flag_count INTEGER DEFAULT 1,     -- For repeated-flag confirmation
    last_assessed TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unified candidates table (replaces separate per-tier tables)
CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    discovery_tier TEXT NOT NULL CHECK(discovery_tier IN ('tier2', 'tier3', 'tier4')),
    regime_id INTEGER,                   -- NULL for tier2/tier3
    discovered_date TEXT NOT NULL,
    -- Pre-screen data
    prescreen_pass INTEGER NOT NULL DEFAULT 0,
    prescreen_data TEXT,                 -- JSON with tier-specific pre-screen metrics
    -- DKS evaluation (Tier 3)
    dks_score REAL,
    flywheel_description TEXT,
    moat_type TEXT,
    scaling_exponent REAL,
    -- Crisis assessment (Tier 2)
    crisis_assessment TEXT,              -- 'temporary_dislocation' etc.
    price_decline_pct REAL,
    -- CSI (Tier 4)
    csi_score INTEGER,
    csi_interpretation TEXT,
    -- Shared attractor analysis
    attractor_score REAL,
    bull_score REAL,
    bear_score REAL,
    attractor_analysis_date TEXT,
    -- Valuation
    intrinsic_value REAL,
    buy_below_price REAL,
    margin_of_safety REAL,
    valuation_method TEXT,
    valuation_date TEXT,
    -- Signal
    signal TEXT CHECK(signal IN ('BUY', 'NOT_YET', 'PASS')),
    signal_confidence TEXT,              -- 'STRONG' | 'STANDARD'
    signal_reason TEXT,
    -- Position sizing (populated when signal = BUY)
    recommended_shares INTEGER,
    recommended_dollars REAL,
    recommended_pct REAL,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker),
    FOREIGN KEY (regime_id) REFERENCES regime_registry(id)
);

-- Transaction log (enhanced)
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    candidate_id INTEGER,
    action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'trim')),
    shares REAL NOT NULL,
    price_per_share REAL NOT NULL,
    total_amount REAL NOT NULL,
    transaction_date TEXT NOT NULL,
    discovery_tier TEXT,
    reason TEXT,                          -- Maps to sell trigger or buy signal
    tax_treatment TEXT,                  -- 'long_term' | 'short_term' | 'loss'
    estimated_tax REAL,
    FOREIGN KEY (ticker) REFERENCES stocks(ticker),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

-- Portfolio configuration
CREATE TABLE IF NOT EXISTS portfolio_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default configuration
INSERT OR IGNORE INTO portfolio_config (key, value) VALUES
  ('total_capital', '10000'),
  ('tier2_allocation', '0.15'),
  ('tier3_allocation', '0.30'),
  ('tier4_allocation', '0.20'),
  ('flexible_allocation', '0.30'),
  ('cash_reserve', '0.05'),
  ('max_position_pct', '0.05'),
  ('tax_rate_short_term', '0.398'),
  ('tax_rate_long_term', '0.228'),
  ('tax_rate_state', '0.04');
```

---

## PART 12: CRON SCHEDULE (MAINTENANCE MODE)

```
Daily (after market close, 4:30-5:30 PM ET):
  4:30 — Price refresh for full universe
  4:45 — Economic environment update (FRED)
  4:50 — Crisis detection check
  4:55 — Regime detection (AI news scan)
  5:00 — Tier 2 pre-screen (if crisis active)
  5:05 — Tier 4 beneficiary screen (if active regimes)
  5:10 — Signal update for all existing candidates
  5:15 — Portfolio alerts check
  5:20 — Insider transaction refresh (watchlist + portfolio)

Weekly (Saturday):
  6:00 AM — Full fundamental refresh (EDGAR)
  8:00 AM — Regime re-assessment (all active regimes)

Monthly (first Saturday):
  6:00 AM — Tier 3 quantitative pre-screen (full universe)
  7:00 AM — DKS evaluation for new Tier 3 pre-screen passes
  9:00 AM — Attractor analysis refresh for all held positions

Quarterly:
  Full attractor re-analysis for all candidates and positions
  S-curve position update for all active regimes
  Tier 3 thematic watchlist review (manual input encouraged)
```

---

## PART 13: IMPLEMENTATION PRIORITY

| Phase | What | Sessions |
|---|---|---|
| 1 | Database schema migration + new tables | 1 |
| 2 | Stage 0: Economic environment + crisis detection + regime detection | 1-2 |
| 3 | Stage 1: Tier 3 quantitative pre-screen + DKS evaluation prompt | 2 |
| 4 | Stage 1: Tier 2 crisis screening + crisis impact prompt | 1 |
| 5 | Stage 1: Tier 4 beneficiary screening + CSI computation | 1-2 |
| 6 | Stage 2: Shared attractor analysis (refactor existing) | 1 |
| 7 | Stage 3: Three valuation models + signal logic | 2 |
| 8 | Stage 4: Position sizing engine | 1 |
| 9 | Dashboard UI: Signals panel + holdings table + alerts | 2-3 |
| 10 | Sell discipline + tax-aware timing | 1 |
| 11 | How It Works page rewrite | 1-2 |
| 12 | Tooltip updates | 1 |
| 13 | Cron schedule migration to new pipeline | 1 |
| 14 | Testing + polish | 2-3 |

**Total: approximately 18-24 Claude Code sessions**

Start with Phases 1-3 (database + environment monitoring + Tier 3) because Tier 3 is the highest-conviction strategy and should be producing real signals first.

---

## PART 14: SUCCESS CRITERIA

The restructured app is working correctly when:

1. The dashboard shows BUY signals with exact share counts and dollar amounts
2. The dashboard shows SELL signals with exact instructions
3. NOT YET candidates show specific target prices
4. The system produces signals without any human judgment calls
5. Position sizes are computed automatically from the configured capital
6. The economic environment indicator updates daily
7. Crisis detection activates Tier 2 screening when conditions warrant
8. Regime detection identifies and confirms structural shifts automatically
9. All signals are traceable — clicking any signal shows the full analysis chain (discovery → attractor → valuation → signal)
10. The How It Works page accurately describes the current process
