# AV Framework — Post-Rebuild Quality Control & Debugging Audit

## Instructions for Claude Code

The AV Framework App has been fully restructured based on the comprehensive restructuring specification. Before this app is used to make real investment decisions, every calculation, data flow, and signal path must be verified. Errors in financial calculations directly translate to bad investment decisions.

Work through each section below in order. For each test, show your work — print the inputs, the intermediate values, and the final output. Compare against manually computed expected values. Flag any discrepancy, no matter how small. Fix all bugs before moving to the next section.

Do NOT skip any section. Do NOT assume something works because it "looks right." Verify with actual numbers.

---

## SECTION 1: Database Integrity

### 1A: Schema Verification
- Read every CREATE TABLE statement in the codebase
- Verify all foreign key relationships are valid
- Verify all CHECK constraints match the restructuring spec
- Verify all columns that should NOT be NULL have appropriate defaults or constraints
- Run: `SELECT COUNT(*) FROM candidates WHERE signal IS NOT NULL AND attractor_score IS NULL` — this should return 0 (no signal without an attractor score)
- Run: `SELECT COUNT(*) FROM candidates WHERE signal = 'BUY' AND buy_below_price IS NULL` — should return 0

### 1B: Data Migration
- If any data was migrated from the old schema, verify row counts match
- Check for orphaned records (candidates referencing deleted regimes, transactions referencing deleted candidates)
- Verify no duplicate ticker entries within the same discovery tier

---

## SECTION 2: Economic Environment Classification

### 2A: Test with known inputs
Manually set these FRED indicator values and verify the classification:

Test case 1 — NORMAL environment:
- Credit spread: 1.2
- Yield curve slope: 1.5
- High yield OAS: 3.5
- VIX: 15
- Unemployment: 3.5
Expected: NORMAL (0 stress signals)

Test case 2 — CAUTIOUS environment:
- Credit spread: 1.8
- Yield curve slope: -0.2
- High yield OAS: 4.5
- VIX: 22
- Unemployment: 4.5
Expected: CAUTIOUS (3 stress signals: yield curve inverted = 2, VIX not triggered, credit spread not triggered at 1.8, unemployment not triggered)
Verify the EXACT stress signal count and classification.

Test case 3 — STRESSED environment:
- Credit spread: 2.5
- Yield curve slope: -1.0
- High yield OAS: 7.0
- VIX: 35
- Unemployment: 6.5
Expected: STRESSED (9 stress signals)

### 2B: Crisis Detection
Test with known S&P 500 values:

Test case 1 — No crisis:
- S&P 500 current: 5000, 52-week high: 5200 (decline: -3.8%)
- VIX 5-day avg: 18
- Credit spread 30-day change: 0.3
Expected: crisis_active = false

Test case 2 — Moderate crisis:
- S&P 500 current: 4000, 52-week high: 5200 (decline: -23.1%)
- VIX 5-day avg: 28
- Credit spread 30-day change: 0.5
Expected: crisis_active = true, severity = moderate, stock_decline_threshold = -0.18

Test case 3 — Severe crisis:
- S&P 500 current: 3400, 52-week high: 5200 (decline: -34.6%)
- VIX 5-day avg: 45
- Credit spread 30-day change: 2.0
Expected: crisis_active = true, severity = severe, stock_decline_threshold = -0.15

---

## SECTION 3: Tier 2 — Crisis Screening Calculations

### 3A: Pre-screen filter verification
Create a mock stock and verify each filter:

```javascript
const mockStock = {
  price: 80,
  pre_crisis_price: 100,  // -20% decline
  sector_decline: -0.22,
  fundamentals: {
    earnings_stability: 8,
    debt_equity: 1.5,
    free_cash_flow_positive: true,
    pe_ratio: 18,
  },
};
```

With a moderate crisis (threshold = -0.18):
- Stock decline: -20% ≤ -18% threshold? YES
- Sector declined more than threshold × 0.8 (-17.6%)? Sector at -22%, YES
- Earnings stability ≥ 7? YES (8)
- D/E < 2.0? YES (1.5)
- FCF positive? YES
- P/E < 25? YES (18)
Expected: PASSES pre-screen

Now change one value at a time and verify each filter correctly rejects:
- Set earnings_stability = 6 → should FAIL
- Set debt_equity = 2.5 → should FAIL
- Set pe_ratio = 30 → should FAIL
- Set price = 85 (decline = -15%) with threshold -18% → should FAIL

### 3B: Crisis Impact Assessment Prompt
Verify the Claude API prompt for crisis impact assessment:
- Contains all three questions (revenue affected, pre-existing pressures, would recover)
- Expects JSON response with the specified fields
- Correctly filters: only "temporary_dislocation" proceeds

---

## SECTION 4: Tier 3 — DKS Screening Calculations

### 4A: Quantitative pre-screen verification
Test with boundary values:

```javascript
const passingStock = {
  market_cap_m: 5000,
  revenue_cagr_3yr: 0.25,
  gross_margin: 0.55,
  years_public: 6,
  operating_cash_flow: 5000000,
};
// Expected: PASS

const tooSmall = { ...passingStock, market_cap_m: 400 };
// Expected: FAIL (< 500M)

const tooLarge = { ...passingStock, market_cap_m: 35000 };
// Expected: FAIL (> 30B)

const lowGrowth = { ...passingStock, revenue_cagr_3yr: 0.05, gross_margin: 0.30 };
// Expected: FAIL (growth < 8% AND margin < 35%)

const steadyCompounder = { ...passingStock, revenue_cagr_3yr: 0.10, gross_margin: 0.45 };
// Expected: PASS (growth ≥ 8%, margin ≥ 35%)

const highGrowthNoCashFlow = {
  ...passingStock,
  revenue_cagr_3yr: 0.30,
  operating_cash_flow: -2000000,
};
// Expected: PASS (growth ≥ 25% allows negative OCF)

const lowGrowthNoCashFlow = {
  ...passingStock,
  revenue_cagr_3yr: 0.12,
  operating_cash_flow: -2000000,
};
// Expected: FAIL (growth < 25% AND negative OCF)
```

Run each through the actual pre-screen function and verify results match expectations.

### 4B: Scaling Exponent Computation
This is a critical calculation. Test with known numbers:

Company A (superlinear):
- Year 1: Revenue $100M, Employees 500, Total Assets $200M
- Year 3: Revenue $250M, Employees 800, Total Assets $350M
- Revenue growth: ln(250/100) = 0.916
- Employee growth: ln(800/500) = 0.470
- Asset growth: ln(350/200) = 0.560
- Revenue/Employee exponent: 0.916 / 0.470 = 1.949
- Revenue/Asset exponent: 0.916 / 0.560 = 1.636
- Best exponent: 1.949
- Expected: PASS (> 1.0), interpretation: "strongly_superlinear"

Company B (sublinear):
- Year 1: Revenue $100M, Employees 500, Total Assets $200M
- Year 3: Revenue $130M, Employees 750, Total Assets $350M
- Revenue growth: ln(130/100) = 0.262
- Employee growth: ln(750/500) = 0.405
- Asset growth: ln(350/200) = 0.560
- Revenue/Employee exponent: 0.262 / 0.405 = 0.647
- Revenue/Asset exponent: 0.262 / 0.560 = 0.468
- Best exponent: 0.647
- Expected: FAIL (< 1.0), interpretation: "sublinear"

**Run both through the actual function. Print every intermediate value. Verify they match the manual calculations above to at least 2 decimal places.**

### 4C: Margin-Adjusted P/S Threshold (if implemented from earlier calibration fixes)
Test the threshold computation:
- Gross margin 30% → threshold should be ~4
- Gross margin 50% → threshold should be ~8
- Gross margin 70% → threshold should be ~12
- Gross margin 80% → threshold should be ~14

Verify the function never returns below 3 (the floor).

---

## SECTION 5: Tier 4 — Regime Detection and CSI

### 5A: S-Curve Position Estimation
Test with known adoption data:

Regime: Electric vehicles
- Year 1: 2% market penetration, growth rate 40%
- Year 2: 3% penetration, growth rate 50%
- Year 3: 5% penetration, growth rate 67%
- Year 4: 8% penetration, growth rate 60%
- Recent growth rate: average of last 2 = 63.5%
- Prior growth rate: average of first 2 = 45%
- Is accelerating: YES (63.5% > 45%)
- Penetration < 10% AND accelerating
- Expected position: "early"
- Expected investable: true

Regime: Smartphone adoption (mature)
- Market penetration: 85%
- Recent growth rate: 2%
- Prior growth rate: 5%
- Is accelerating: NO
- Penetration > 50%
- Expected position: "post_inflection"
- Expected investable: false

### 5B: Consensus Saturation Index
Test each component independently:

Mention velocity:
- 30-day mentions: 3, prior 60-day mentions: 4
- Velocity: 3 / (4/2) = 1.5
- Saturated? NO (< 3.0 and < 15 mentions)

- 30-day mentions: 20, prior 60-day mentions: 8
- Velocity: 20 / (8/2) = 5.0
- Saturated? YES (≥ 15 mentions AND velocity ≥ 3.0)

Volume anomaly:
- Recent 30-day avg volume: 500,000
- Baseline 180-day avg volume: 200,000
- Ratio: 2.5
- Saturated? YES (≥ 2.5)

- Recent: 250,000, Baseline: 200,000
- Ratio: 1.25
- Saturated? NO (< 2.5)

Valuation premium:
- Current P/E: 30, Pre-regime P/E: 14
- Premium: 30/14 = 2.14
- Saturated? YES (≥ 2.0)

Composite CSI:
- If mentions saturated (1) + volume saturated (1) + valuation not (0) = CSI 2
- Expected: FAIL (CSI > 1), interpretation: "mainstream"

- If mentions not (0) + volume not (0) + valuation not (0) = CSI 0
- Expected: PASS, interpretation: "contrarian"

**Run each through the actual functions.**

---

## SECTION 6: Attractor Analysis

### 6A: Score Computation
Verify the adversarial weighting:

Bull case scores: [4, 3, 4, 3, 4, 3] → average = 3.5
Bear case scores: [2, 2, 3, 2, 2, 3] → average = 2.33

Weighted composite (60% bear, 40% bull):
= (0.40 × 3.5) + (0.60 × 2.33)
= 1.40 + 1.40
= 2.80

Verify this matches the actual computation.

### 6B: Concentration Risk Penalties
Test stacking:

Company with:
- Single customer at 30% of revenue: -0.5
- Critical single-source supplier: -0.5
- 60% revenue from single foreign market: no penalty (< 70%)

Raw score: 3.5
Adjusted: 3.5 - 0.5 - 0.5 = 2.5
Floor: 1.0 (not needed here)

Verify penalties stack correctly and never push below 1.0.

### 6C: Signal Threshold
- Attractor score 1.8 → PASS (hard reject, reason: "Attractor dissolving")
- Attractor score 2.3 → PASS (reason: "Attractor too weak")
- Attractor score 2.5, price > IV → PASS (reason: "Overvalued")
- Attractor score 3.0, price = buy_below → BUY
- Attractor score 3.5, price < buy_below × 0.90 → BUY (STRONG)
- Attractor score 3.0, price between buy_below and IV → NOT YET

Run each case through the signal function and verify.

---

## SECTION 7: Valuation Models — THE MOST CRITICAL SECTION

### 7A: Tier 2 — Modified Graham Formula

Test case: Kroger (KR)
- Normalized EPS (3yr avg): $3.50
- 7yr earnings growth rate: 8%
- AAA corporate bond yield: 4.5%
- ROE: 25%

Step 1: Basic Graham formula
IV = EPS × (8.5 + 2g) × (4.4 / Y)
IV = 3.50 × (8.5 + 2×8) × (4.4 / 4.5)
IV = 3.50 × 24.5 × 0.978
IV = $83.80

Step 2: ROE modifier on P/E×P/B ceiling
ROE 25% (between 20-30%) → ceiling × 1.25
This affects whether the stock passes the composite screen, not the IV directly.
Verify the ROE modifier is applied correctly.

Step 3: Fat-tail discount
Check the company's earnings history. If 1 negative EPS year in last 10: 10% discount.
IV after fat-tail: $83.80 × 0.90 = $75.42

Step 4: Margin of safety
Assume attractor score 3.2 (stable), NORMAL environment, market cap > $2B.
Base margin: 25%
Crisis premium: 0% (NORMAL)
Small cap premium: 0%
Total margin: 25%

Buy-below = $75.42 × (1 - 0.25) = $56.57

**Run this exact case through the Tier 2 valuation function. Print every intermediate value. Verify each step matches the manual calculation.**

### 7B: Tier 3 — Growth-Adjusted Revenue Model

Test case: Hypothetical SaaS Company
- Revenue TTM: $500M
- Revenue CAGR 3yr: 35%
- Gross margin: 72%
- Target operating margin estimate: 25% (from estimateTargetMargin)
- Shares outstanding: 200M
- Attractor score: 3.8

Step 1: Projected revenue (decelerating growth)
Year 1 growth: 35% × 0.85 = 29.75%
Year 2 growth: 35% × 0.70 = 24.50%
Year 3 growth: 35% × 0.55 = 19.25%

Revenue year 1: $500M × 1.2975 = $648.75M
Revenue year 2: $648.75M × 1.2450 = $807.69M
Revenue year 3: $807.69M × 1.1925 = $963.17M

Step 2: Estimated earnings at year 3
Earnings = $963.17M × 0.25 = $240.79M
EPS = $240.79M / 200M = $1.204

Step 3: Terminal P/E
Min(25, 10 + 19.25% × 100) = Min(25, 29.25) = 25
Terminal value per share = $1.204 × 25 = $30.10

Step 4: Discount to present (12% rate)
IV = $30.10 / (1.12)^3 = $30.10 / 1.4049 = $21.43

Step 5: Margin of safety
Attractor 3.8 → base margin 25%
Tier 3 premium: 5%
NORMAL environment: 0%
Market cap > $2B: 0%
Total: 30%

Buy-below = $21.43 × (1 - 0.30) = $15.00

**Run this exact case through the Tier 3 valuation function. Print every intermediate value. Every number must match within $0.05.**

### 7C: Tier 4 — Scenario-Weighted Valuation

Test case: Hypothetical Defense Contractor
- Revenue TTM: $2B
- Operating margin: 12%
- Shares outstanding: 100M
- Regime: European defense rearmament
- Revenue impact (bull case): +40%
- Adjacent possible score: 4
- Attractor score: 3.3

Step 1: Bull case
Revenue: $2B × 1.40 = $2.8B
Earnings: $2.8B × 0.12 × 1.15 = $386.4M (margin expansion)
EPS: $386.4M / 100M = $3.864
Value: $3.864 × 18 = $69.55

Step 2: Bear case
Revenue: $2B × 1.05 = $2.1B
Earnings: $2.1B × 0.12 = $252M
EPS: $252M / 100M = $2.52
Value: $2.52 × 14 = $35.28

Step 3: Scenario weighting
Adjacent possible 4 → bull weight 0.65, bear weight 0.35
Weighted IV = (0.65 × $69.55) + (0.35 × $35.28) = $45.21 + $12.35 = $57.56

Step 4: Margin of safety
Attractor 3.3 (between 3.0-3.5) → base margin 30% (Tier 4 uses higher base)
NORMAL environment: 0%
Total: 30%

Buy-below = $57.56 × (1 - 0.30) = $40.29

**Run this exact case. Every intermediate value must match.**

---

## SECTION 8: Position Sizing

### 8A: Basic Position Sizing

Test case:
- Total portfolio: $40,000
- Cash balance: $12,000
- Tier 3 allocation: 30% = $12,000
- Current Tier 3 invested: $8,000
- Tier 3 remaining: $4,000
- Max position: 5% = $2,000
- Signal confidence: STANDARD (multiplier: 0.75)
- Stock price: $48.00

Target dollars: min($2,000 × 0.75, $4,000, $12,000 × 0.90) = min($1,500, $4,000, $10,800) = $1,500
Shares: floor($1,500 / $48.00) = 31
Actual dollars: 31 × $48.00 = $1,488.00
% of portfolio: $1,488 / $40,000 = 3.72%

**Verify the actual function produces shares = 31, total = $1,488.00, pct = 3.72%.**

### 8B: Edge Cases

Test when tier budget is exhausted:
- Tier 3 remaining: $200
- Max position: $2,000
- Should cap at $200

Test when cash is nearly depleted:
- Cash: $500
- Should cap at $500 × 0.90 = $450

Test STRONG confidence:
- Same as 8A but STRONG → multiplier 1.0 → target $2,000 → 41 shares × $48 = $1,968

### 8C: Flexible Allocation
Verify that when a tier's dedicated allocation is full, the flexible pool (30%) is used.

Test:
- Tier 3 allocation: $12,000 (fully invested)
- Flexible pool: $12,000 (30% of $40,000)
- Flexible currently used: $4,000
- Flexible remaining: $8,000
- New Tier 3 BUY signal should pull from flexible, not fail

---

## SECTION 9: Sell Triggers

### 9A: Price Exceeds IV
- Current price: $50, IV: $45
- Expected: SELL signal with reason "Price ($50) exceeds intrinsic value ($45)"

### 9B: Attractor Dissolution
- Attractor score drops from 3.0 to 1.8
- Expected: SELL signal immediately, overrides tax hold

### 9C: Concentration Creep
- Position value: $3,500 in $40,000 portfolio = 8.75%
- Threshold: 8%
- Expected: TRIM signal
- Trim to 5%: sell $3,500 - $2,000 = $1,500 worth
- At price $50/share: sell 30 shares

### 9D: Tax-Aware Timing
Position held 340 days, current price $60, cost basis $40:
- Gain: $20/share
- Days to long-term: 26
- Short-term tax: $20 × 0.398 = $7.96/share
- Long-term tax: $20 × 0.228 = $4.56/share
- Savings: $3.40/share
- Breakeven decline: $3.40 / $60 = 5.67%
- Expected: WAIT recommended (stock would need to decline 5.67% in 26 days for selling now to be better)

Position held 340 days, attractor score drops to 1.5:
- Expected: SELL NOW regardless of tax (attractor dissolution overrides)

---

## SECTION 10: Signal Flow Integration Test

### 10A: Full Pipeline — Tier 3 Happy Path

Create a mock company that should pass every stage:

```javascript
const mockTier3Company = {
  ticker: 'TEST',
  market_cap_m: 5000,
  revenue_cagr_3yr: 0.30,
  gross_margin: 0.65,
  years_public: 5,
  operating_cash_flow: 50000000,
  revenue_ttm: 400000000,
  shares_outstanding: 150000000,
  current_price: 12.00,
  // ... full financial data for DKS eval and valuation
};
```

Run through entire pipeline:
1. Tier 3 pre-screen → should PASS
2. DKS evaluation → mock the Claude response with high scores
3. Attractor analysis → mock with score 3.5
4. Tier 3 valuation → compute IV and buy-below
5. Signal → should be BUY if price < buy-below
6. Position sizing → should produce exact shares/dollars

Verify every database record is created correctly at each stage.

### 10B: Full Pipeline — Tier 2 Rejection Path

Create a mock company that should be rejected at the crisis impact stage:

```javascript
const mockSecularDecline = {
  ticker: 'FAIL',
  price: 25,
  pre_crisis_price: 35,  // -28.6% decline
  // But has pre-existing pressures
};
```

Mock the Claude crisis assessment response as "accelerated_decline".
Verify:
1. Pre-screen PASSES (decline is sufficient)
2. Crisis assessment REJECTS (not temporary dislocation)
3. No attractor analysis is run (saves API cost)
4. Candidate record shows signal = PASS with reason referencing accelerated decline

### 10C: Signal Change on Opus Re-Analysis

1. Create a candidate with Sonnet BUY signal (attractor 3.0)
2. Trigger deep analysis endpoint
3. Mock Opus response with attractor 2.3 (lower than Sonnet saw)
4. Verify: signal changes from BUY to PASS, analysis_model updated to Opus, signal_reason updated

---

## SECTION 11: Dashboard Data Integrity

### 11A: Signal Panel
- Query the database for all BUY signals
- Verify each has: ticker, price, buy_below, IV, recommended_shares, recommended_dollars, confidence
- Verify no BUY signal has NULL in any of these fields

### 11B: Holdings Table
- Verify gain/loss calculations: (current_value - cost_basis) / cost_basis
- Verify % of portfolio: position_value / total_portfolio_value
- Verify TRIM alerts fire at exactly 8% threshold

### 11C: Allocation Display
- Sum all position values by tier
- Compare against tier allocation targets
- Verify flexible pool computation: total - (tier2 + tier3 + tier4 + cash)

---

## SECTION 12: Cron Job Verification

### 12A: Daily Price Refresh
- Trigger the daily cron manually
- Verify stock prices update
- Verify signals recalculate after price change (a stock that crossed below buy-below should now show BUY)

### 12B: Monthly Tier 3 Pre-Screen
- Trigger the monthly cron manually
- Verify new candidates are added to the candidates table
- Verify previously screened candidates are not duplicated

### 12C: Regime Detection
- Trigger the daily regime scan with mock news data
- Verify regime candidates are created with status "pending"
- Verify confirmation logic works (mock a FRED structural break matching the pending regime)

---

## FINAL STEP: Generate QC Report

After completing all sections, produce a summary:

```
AV FRAMEWORK QC REPORT
=======================
Date: [date]
Sections tested: 12

Section 1  (Database):        [PASS/FAIL] — [notes]
Section 2  (Environment):     [PASS/FAIL] — [notes]
Section 3  (Tier 2):          [PASS/FAIL] — [notes]
Section 4  (Tier 3):          [PASS/FAIL] — [notes]
Section 5  (Tier 4):          [PASS/FAIL] — [notes]
Section 6  (Attractor):       [PASS/FAIL] — [notes]
Section 7  (Valuation):       [PASS/FAIL] — [notes]
Section 8  (Position Sizing): [PASS/FAIL] — [notes]
Section 9  (Sell Triggers):   [PASS/FAIL] — [notes]
Section 10 (Integration):     [PASS/FAIL] — [notes]
Section 11 (Dashboard):       [PASS/FAIL] — [notes]
Section 12 (Cron):            [PASS/FAIL] — [notes]

Bugs found and fixed: [N]
Bugs remaining: [N]

OVERALL: [READY FOR PRODUCTION / NEEDS FIXES]
```

If any section fails, fix the bugs and re-run that section until it passes before moving on. The app is not ready for use until all 12 sections show PASS.
