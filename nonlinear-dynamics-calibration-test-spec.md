# Non-Linear Dynamics Calibration Tests — Specification for Claude Code

## Overview

These five tests examine whether non-linear mathematical signatures in company financial data can predict investment outcomes. Each test is grounded in established complex systems science — power law scaling (Geoffrey West), critical transitions (Per Bak, Scheffer), Bass diffusion S-curves, and Zipf rank dynamics — applied to EDGAR financial data in ways that, to our knowledge, have not been tested in the investment literature.

All tests use the existing 292-case calibration dataset and EDGAR companyfacts data. Some tests additionally require sector-wide data from the 5,065-stock universe.

## Shared Data Requirements

For each calibration case, the tests need quarterly time series of financial metrics from EDGAR. Much of this was already pulled for the Benford tests. Ensure the following are available per company per quarter:

- **Revenue** (us-gaap:Revenues or us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax)
- **Total assets** (us-gaap:Assets)
- **Total employees** (dei:EntityNumberOfEmployees — spotty coverage, use where available)
- **Operating income** (us-gaap:OperatingIncomeLoss)
- **Net income** (us-gaap:NetIncomeLoss)
- **Operating cash flow** (us-gaap:NetCashProvidedByUsedInOperatingActivities)
- **Gross profit** (us-gaap:GrossProfit)
- **Cost of revenue** (us-gaap:CostOfRevenue)

Collect as many quarters as available per company, ideally 12-20 quarters before the case's entry date. Store as time series arrays indexed by fiscal quarter.

Also pre-compute for convenience:
- Revenue growth rate per quarter: (Rev_t - Rev_{t-4}) / Rev_{t-4} (year-over-year to remove seasonality)
- Operating margin per quarter: OperatingIncome / Revenue
- Free cash flow margin: OperatingCashFlow / Revenue

---

## Test 1: Metabolic Scaling Crossover

### Theory

Geoffrey West showed that biological organisms scale sublinearly (metabolic rate ∝ mass^0.75) while cities scale superlinearly (innovation ∝ population^1.15). Companies exist on this spectrum. Traditional businesses scale sublinearly — doubling revenue requires more than doubling assets and employees. Network-effect and DKS businesses scale superlinearly — each additional unit of input produces more than proportional output because the competitive flywheel amplifies returns.

The DKS tipping point may be identifiable as the moment a company's scaling exponent crosses 1.0 — the transition from "growing is getting harder" to "growing is getting easier."

### Method

For each calibration case with at least 8 quarters of data:

**1A: Static scaling exponent**

Compute β from the power law relationship: Revenue = k × Assets^β

```javascript
// For each company, collect quarterly (log_revenue, log_assets) pairs
// Fit linear regression: log10(revenue) = log10(k) + β × log10(assets)
// β < 1.0 = sublinear (organism-like, diminishing returns)
// β = 1.0 = linear
// β > 1.0 = superlinear (city-like, increasing returns)

function computeScalingExponent(quarterlyData) {
  const points = quarterlyData
    .filter(q => q.revenue > 0 && q.assets > 0)
    .map(q => ({
      x: Math.log10(q.assets),
      y: Math.log10(q.revenue)
    }));

  if (points.length < 8) return null;

  // Simple linear regression on log-log data
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

  const beta = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const logK = (sumY - beta * sumX) / n;
  const r2 = /* compute R² for fit quality */;

  return { beta, logK, r2, n: points.length };
}
```

Also compute β using employees as the denominator where employee data is available:
Revenue = k × Employees^β_emp

**1B: Scaling exponent trajectory**

Split the quarterly data into two halves (early and late). Compute β for each half. The trajectory tells you if the company is becoming more or less efficient at converting inputs to revenue:

- β_late > β_early AND β_late > 1.0 → Crossing into superlinear (DKS flywheel forming)
- β_late > β_early AND β_late < 1.0 → Improving but still sublinear (getting more efficient)
- β_late < β_early → Scaling degrading (flywheel weakening or not present)

### Report

```
Test 1A — Static Scaling Exponent at Entry:
                    | Winners | Traps | Underperform
  Mean β (assets)   | X.XX    | X.XX  | X.XX
  Median β          | X.XX    | X.XX  | X.XX
  % with β > 1.0   | X%      | X%    | X%
  % with β < 0.8   | X%      | X%    | X%

  Mann-Whitney (winners vs traps): p = X.XXXX, effect size r = X.XX

  Cases with employee data: X / 292
  Mean β (employees) | X.XX   | X.XX  | X.XX

Test 1B — Scaling Exponent Trajectory:
                           | Winners | Traps
  Mean β change (late-early)| X.XX   | X.XX
  % crossing above 1.0     | X%     | X%
  % degrading (β declining) | X%     | X%

  Cross-tabulation:
                    | Winner | Trap
  β > 1.0 at entry | X      | X
  β < 1.0 at entry | X      | X
  β improving       | X      | X
  β degrading       | X      | X
```

**PASS criteria:** Winners show statistically higher β than traps (p < 0.05), OR winners are disproportionately likely to have β > 1.0 or β improving.

---

## Test 2: Benford Maturity Gradient

### Theory

Benford convergence (decreasing KLD over time) should be a phase-specific signal. Mature companies already span enough orders of magnitude that their Benford conformity is at baseline — it can't meaningfully improve. Young companies in the scaling phase are actively spreading their financial data across new orders of magnitude as they enter new markets and product lines. Benford convergence should be most informative for companies in the transition from pre-scale to scaling.

The original Test 4 from the Benford spec found traps improving Benford conformity more than winners. This may be because the calibration dataset mixes mature winners (where Benford can't improve) with immature traps (where Benford naturally improves as the company grows, even if it's ultimately a trap).

### Method

**2A: Segment Test 4 by company maturity**

Use revenue at entry date as a proxy for maturity. Segment all cases into four bands:

| Band | Revenue Range | Expected Benford Behavior |
|------|--------------|--------------------------|
| Pre-scale | < $100M | Narrow range, may not have enough data. Benford less applicable. |
| Early scaling | $100M - $1B | Maximum signal zone. Flywheel forming/failing shows in Benford convergence. |
| Late scaling | $1B - $10B | Moderate signal. Approaching natural Benford equilibrium. |
| Mature | > $10B | Minimal signal. Already at Benford baseline. |

For each band, re-run the Benford Test 4 analysis (rolling 8-quarter KLD slope):

```
Report:
  Revenue Band  | Cases | Winner % improving | Trap % improving | Gap  | p-value
  < $100M       | X     | X%                 | X%               | Xpp  | X.XXXX
  $100M - $1B   | X     | X%                 | X%               | Xpp  | X.XXXX
  $1B - $10B    | X     | X%                 | X%               | Xpp  | X.XXXX
  > $10B        | X     | X%                 | X%               | Xpp  | X.XXXX
```

**Prediction:** The winner/trap gap reverses in the $100M-$1B band — winners show MORE improvement than traps (genuine flywheel formation), while the $10B+ band shows no difference (Benford is already saturated).

**2B: Orders of magnitude spanned as a feature**

For each company, count how many orders of magnitude its financial line items span at entry date (e.g., smallest non-zero value to largest). A company with values from $10K to $10B spans 6 orders. A company from $1M to $50M spans less than 2.

```
Report:
  Orders of magnitude spanned:
                    | Winners | Traps | Underperform
  Mean orders       | X.X     | X.X   | X.X
  Median orders     | X.X     | X.X   | X.X
  Correlation with KLD: rho = X.XX, p = X.XXXX
  (more orders = lower KLD expected — this is the maturity confound)
```

**PASS criteria:** The winner/trap KLD slope difference is statistically significant within the $100M-$1B band specifically, AND the direction shows winners improving more (reversing the overall Test 4 result).

---

## Test 3: Critical Slowing Down

### Theory

In dynamical systems theory, a universal early warning signal of approaching tipping points is "critical slowing down" — the system takes longer to recover from perturbations as it approaches a phase transition. Mathematically, this manifests as increasing autocorrelation and increasing variance in the system's state variables.

Applied to companies: a business approaching a DKS tipping point (positive or negative) should show increasing autocorrelation in its financial metrics. Revenue growth that used to bounce randomly quarter-to-quarter starts trending persistently. Margins that fluctuated around a mean begin drifting. The system is losing its ability to self-correct, which means it's about to lock into a new attractor — either a DKS flywheel (winner) or a death spiral (trap).

Critical slowing down is directionally agnostic — it says "a transition is imminent" but not which direction. Combined with other signals (Benford health, scaling exponent direction), it becomes directional.

### Method

For each calibration case with at least 12 quarters of data before entry:

**3A: Autocorrelation trend**

Compute lag-1 autocorrelation of each metric in rolling 8-quarter windows:

```javascript
function rollingAutocorrelation(series, windowSize = 8) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const window = series.slice(i - windowSize, i);
    const n = window.length;
    const mean = window.reduce((s, v) => s + v, 0) / n;

    let num = 0, den = 0;
    for (let j = 0; j < n - 1; j++) {
      num += (window[j] - mean) * (window[j + 1] - mean);
    }
    for (let j = 0; j < n; j++) {
      den += (window[j] - mean) ** 2;
    }

    results.push({
      quarter: i,
      autocorrelation: den > 0 ? num / den : 0
    });
  }
  return results;
}
```

Apply to: quarterly revenue YoY growth rate, operating margin, free cash flow margin.

Compute the slope of autocorrelation over the final 8 quarters before entry (positive slope = critical slowing down = transition approaching).

**3B: Variance trend**

The second classic early warning signal is increasing variance. Compute rolling variance of the same metrics and track whether it's increasing over time.

```javascript
function rollingVariance(series, windowSize = 8) {
  const results = [];
  for (let i = windowSize; i <= series.length; i++) {
    const window = series.slice(i - windowSize, i);
    const mean = window.reduce((s, v) => s + v, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / (window.length - 1);
    results.push({ quarter: i, variance });
  }
  return results;
}
```

**3C: Combined CSD index**

Create a simple composite: CSD_index = (autocorrelation_slope + variance_slope) / 2, where both are normalized to [0, 1] range. Higher CSD_index = more evidence of approaching transition.

### Report

```
Test 3A — Autocorrelation Trend:
  Metric: Revenue YoY Growth
                                   | Winners | Traps | Underperform
  Mean autocorr slope (+ = slowing)| X.XXXX  | X.XXXX| X.XXXX
  % with positive slope            | X%      | X%    | X%
  Mann-Whitney: p = X.XXXX

  Metric: Operating Margin
  (same format)

  Metric: FCF Margin
  (same format)

Test 3B — Variance Trend:
  (same format as 3A but for variance slopes)

Test 3C — Combined CSD Index:
                    | Winners | Traps | Underperform
  Mean CSD index    | X.XX    | X.XX  | X.XX
  Cases with CSD > 0.5 (strong signal):
    Winners: X (X%)
    Traps: X (X%)

  For cases with CSD > 0.5, what was the outcome?
    Winner: X (X%) — positive tipping point
    Trap: X (X%) — negative tipping point
    Underperform: X (X%)

  CSD combined with Benford conformity:
    CSD high + Benford close conformity: X winners, X traps
    CSD high + Benford non-conforming: X winners, X traps
    CSD low + Benford close conformity: X winners, X traps
    CSD low + Benford non-conforming: X winners, X traps
```

**PASS criteria:** Both winners AND traps show elevated CSD before entry (confirming both are approaching transitions), AND the combination of CSD + Benford conformity separates the direction (positive vs negative tipping point).

---

## Test 4: S-Curve Inflection Detection

### Theory

Every DKS company follows a Bass diffusion S-curve. The S-curve has a first derivative (growth rate) and a second derivative (acceleration of growth). Before the inflection point, the second derivative is positive — growth is accelerating. At the inflection, the second derivative is zero. After, it's negative — growth decelerates even as absolute revenue rises.

The optimal buy point is during positive second derivative (growth is accelerating). The market systematically misprices this because humans anchor on the current growth rate (first derivative) and miss whether it's speeding up or slowing down.

### Method

For each calibration case with at least 8 quarters of revenue data:

**4A: Revenue derivatives**

```javascript
function revenueDerivatives(quarterlyRevenue) {
  if (quarterlyRevenue.length < 8) return null;

  // First derivative: YoY growth rate per quarter
  // Use YoY (4-quarter lag) to remove seasonality
  const d1 = [];
  for (let i = 4; i < quarterlyRevenue.length; i++) {
    if (quarterlyRevenue[i - 4] > 0) {
      d1.push({
        quarter: i,
        growthRate: (quarterlyRevenue[i] - quarterlyRevenue[i - 4]) / quarterlyRevenue[i - 4]
      });
    }
  }

  if (d1.length < 4) return null;

  // Second derivative: change in growth rate (quarter over quarter)
  const d2 = [];
  for (let i = 1; i < d1.length; i++) {
    d2.push({
      quarter: d1[i].quarter,
      acceleration: d1[i].growthRate - d1[i - 1].growthRate
    });
  }

  // Classify the final 4 quarters of second derivative
  const recent = d2.slice(-4);
  const avgD2 = recent.reduce((s, r) => s + r.acceleration, 0) / recent.length;
  const d2Trend = recent.length >= 2 ?
    recent[recent.length - 1].acceleration - recent[0].acceleration : 0;

  let phase;
  if (avgD2 > 0.01 && d2Trend > 0) phase = 'ACCELERATING';      // Growth speeding up, getting faster
  else if (avgD2 > 0.01 && d2Trend <= 0) phase = 'PEAK';          // Growth speeding up but rate slowing
  else if (avgD2 > -0.01 && avgD2 <= 0.01) phase = 'INFLECTION';  // Near the inflection point
  else if (avgD2 < -0.01 && d2Trend < 0) phase = 'DECELERATING';  // Growth slowing, getting worse
  else if (avgD2 < -0.01 && d2Trend >= 0) phase = 'BOTTOMING';    // Growth slowing but stabilizing

  return {
    d1_recent: d1.slice(-4),
    d2_recent: recent,
    avgD1: d1.slice(-4).reduce((s, r) => s + r.growthRate, 0) / Math.min(d1.length, 4),
    avgD2,
    d2Trend,
    phase,
  };
}
```

**4B: Phase classification vs outcome**

```
Report:
  Cases with sufficient data: X / 292

  Phase at entry vs outcome:
                  | Winners | Traps | Underperform | Total | Win Rate
  ACCELERATING    | X       | X     | X            | X     | X%
  PEAK            | X       | X     | X            | X     | X%
  INFLECTION      | X       | X     | X            | X     | X%
  DECELERATING    | X       | X     | X            | X     | X%
  BOTTOMING       | X       | X     | X            | X     | X%

  Average second derivative by classification:
                    | Winners | Traps
  Mean d2 (accel)   | X.XXXX  | X.XXXX
  Mann-Whitney: p = X.XXXX
```

**4C: D1 vs D2 as predictor**

Compare the predictive power of first derivative (growth rate) alone versus second derivative (acceleration) alone:

```
  Metric                | Winner mean | Trap mean | Mann-Whitney p | Effect size
  D1 (growth rate)      | X.XX%       | X.XX%     | X.XXXX         | X.XX
  D2 (acceleration)     | X.XXXX      | X.XXXX    | X.XXXX         | X.XX
  D1 + D2 combined      | —           | —         | X.XXXX         | X.XX
```

**If D2 has a larger effect size than D1, it means the acceleration of growth is more predictive than the growth rate itself.** This would validate the S-curve theory — what matters is where you are on the curve, not how steep it is at this moment.

**4D: Compare to current Growth pipeline CAGR threshold**

The Growth pipeline currently uses revenue CAGR ≥ 20% (high-growth) or ≥ 8% (compounder) as the entry gate. Check:

```
  Companies with CAGR ≥ 20% but D2 < 0 (decelerating growth): X
    Outcome: X winners, X traps, X underperform
  Companies with CAGR 8-20% but D2 > 0 (accelerating growth): X
    Outcome: X winners, X traps, X underperform
```

**If the "low CAGR + positive D2" group outperforms the "high CAGR + negative D2" group, the framework should prioritize acceleration over absolute growth rate.**

**PASS criteria:** ACCELERATING phase has the highest win rate, OR second derivative has larger effect size than first derivative, OR positive D2 companies outperform negative D2 companies regardless of CAGR level.

---

## Test 5: Zipf Rank Dynamics

### Theory

Within any sector, company revenues follow a Zipf-like power law distribution — a few large companies at the top, a long tail of smaller ones. A company's position in this distribution reflects its competitive standing. More importantly, the VELOCITY of rank change reflects competitive dynamics that scale non-linearly — moving from rank 15 to rank 8 requires ~60% revenue growth, while moving from rank 3 to rank 2 requires nearly doubling. Companies climbing the Zipf ladder are winning competitive share against exponentially increasing difficulty.

### Method

This test requires sector-wide revenue data. Use the 5,065-stock EDGAR universe grouped by sector (from sectorSignalEngine.js mapping).

**5A: Sector Zipf distribution and exponent**

For each sector at each year, rank all companies by revenue and fit the Zipf/Pareto power law:

```javascript
function zipfExponent(revenues) {
  // Sort descending
  const sorted = [...revenues].sort((a, b) => b - a);

  // Fit: log(revenue) = C - α × log(rank)
  const points = sorted
    .filter(r => r > 0)
    .map((r, i) => ({
      x: Math.log10(i + 1),  // log(rank)
      y: Math.log10(r)        // log(revenue)
    }));

  // Linear regression on log-log
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

  const alpha = -(n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  // Note: negate because slope is negative (revenue decreases with rank)

  return { alpha, n: points.length };
}
```

**5B: Rank velocity for calibration cases**

For each calibration case, determine the company's rank within its sector at each available year (or quarter if granular enough). Compute rank velocity:

```javascript
function rankVelocity(ranks, years) {
  // ranks and years are parallel arrays of the company's sector rank over time
  if (ranks.length < 3) return null;

  // Linear regression: rank = a + b × year
  // Negative b = climbing (rank number decreasing = getting bigger)
  const n = ranks.length;
  const sumX = years.reduce((s, y) => s + y, 0);
  const sumY = ranks.reduce((s, r) => s + r, 0);
  const sumXY = years.reduce((s, y, i) => s + y * ranks[i], 0);
  const sumX2 = years.reduce((s, y) => s + y * y, 0);

  const velocity = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  // velocity < 0 = climbing (improving rank)
  // velocity > 0 = falling (worsening rank)

  return {
    velocity,       // ranks per year (negative = climbing)
    startRank: ranks[0],
    endRank: ranks[ranks.length - 1],
    ranksClimbed: ranks[0] - ranks[ranks.length - 1], // positive = improved
    yearsSpanned: years[years.length - 1] - years[0],
  };
}
```

**5C: Effort-adjusted rank velocity**

Because each rank improvement requires exponentially more effort at the top, adjust the velocity by the Zipf exponent:

```
effort_adjusted_velocity = ranksClimbed / (startRank ^ (1/alpha))
```

This normalizes for the fact that climbing from rank 15 to 10 is "easier" than from rank 5 to rank 2.

### Report

```
Test 5A — Sector Zipf Distributions:
  Sector              | Companies | Zipf α | R² | Interpretation
  Technology          | X         | X.XX   | X.XX | steeper = more concentrated
  Healthcare          | X         | X.XX   | X.XX |
  ...

Test 5B — Rank Velocity vs Outcome:
  Cases with rank data: X / 292

                              | Winners | Traps | Underperform
  Mean rank velocity (neg=up) | X.XX    | X.XX  | X.XX
  Mean ranks climbed          | X.XX    | X.XX  | X.XX
  % climbing (velocity < 0)  | X%      | X%    | X%
  % falling (velocity > 0)   | X%      | X%    | X%

  Mann-Whitney (velocity, winners vs traps): p = X.XXXX, r = X.XX

Test 5C — Effort-Adjusted Velocity:
                              | Winners | Traps
  Mean effort-adjusted vel    | X.XX    | X.XX
  Mann-Whitney: p = X.XXXX

  Signal strength by sector concentration:
  Sector α quartile | Winner climb % | Trap climb % | Gap
  High α (concentrated) | X%          | X%           | Xpp
  Low α (fragmented)    | X%          | X%           | Xpp
```

**PASS criteria:** Winners show statistically more positive rank climbing than traps (p < 0.05), AND the signal is stronger in concentrated sectors (high Zipf α).

---

## Reporting Summary

```
NON-LINEAR DYNAMICS CALIBRATION RESULTS
=========================================

Data Coverage:
  Cases with 8+ quarters financial history: X / 292
  Cases with 12+ quarters (needed for CSD): X / 292
  Cases with employee data (for Test 1): X / 292
  Sectors with Zipf rankings computed: X

Test 1 — Metabolic Scaling Crossover:
  Static β discriminates? PASS / FAIL (p = X.XXXX, effect r = X.XX)
  β trajectory discriminates? PASS / FAIL
  Best feature: β level / β trend / β > 1.0 binary

Test 2 — Benford Maturity Gradient:
  Signal reverses in $100M-$1B band? YES / NO
  Winner/trap gap in scaling band: Xpp (p = X.XXXX)
  Recommended Benford application window: $X - $X revenue

Test 3 — Critical Slowing Down:
  Autocorrelation trend discriminates? PASS / FAIL
  Variance trend discriminates? PASS / FAIL
  CSD + Benford separates direction? PASS / FAIL
  Best CSD metric: revenue growth / operating margin / FCF margin

Test 4 — S-Curve Inflection:
  ACCELERATING phase win rate: X%
  D2 effect size vs D1 effect size: X.XX vs X.XX
  Low CAGR + positive D2 outperforms high CAGR + negative D2? YES / NO
  Should framework use D2 instead of / alongside CAGR threshold? YES / NO

Test 5 — Zipf Rank Dynamics:
  Rank velocity discriminates? PASS / FAIL (p = X.XXXX)
  Signal stronger in concentrated sectors? YES / NO
  Best feature: raw velocity / effort-adjusted / binary climbing
```

## Decision Criteria

**If Test 1 passes:** The scaling exponent β should be computed for every candidate in the live app and displayed alongside the attractor score. β > 1.0 is a quantitative confirmation of superlinear scaling — the mathematical definition of the DKS flywheel. β < 1.0 is a yellow flag. β declining is a sell consideration.

**If Test 2 passes:** The Benford conformity signal should only be applied to companies in the validated revenue band (likely $100M-$1B). Outside this band, Benford convergence is either not measurable (too small) or not informative (already saturated).

**If Test 3 passes:** Add CSD index to the candidate analysis as a "transition imminent" flag. Combined with Benford conformity and scaling exponent direction, this creates a three-dimensional signal: CSD says "something is about to change," Benford says "the data is real or manipulated," and β says "the change is toward efficiency or away from it."

**If Test 4 passes:** The Growth pipeline should replace or supplement the CAGR ≥ 20% threshold with a second-derivative gate. A company with 12% CAGR and positive D2 (accelerating) is a better candidate than one with 25% CAGR and negative D2 (decelerating). This is possibly the most immediately deployable change.

**If Test 5 passes:** Add Zipf rank velocity to the Regime pipeline's beneficiary screening. A company climbing the Zipf ladder in a concentrated sector is gaining competitive share against exponentially increasing difficulty — the strongest form of DKS validation available from public data.

**If multiple tests pass:** The non-linear metrics can be combined into a composite "Non-Linear Health Score" that captures scaling dynamics (Test 1), data integrity (Test 2 via Benford), transition proximity (Test 3), growth phase (Test 4), and competitive trajectory (Test 5). Each component measures a different facet of the same underlying question: is this company's competitive flywheel real, and is it strengthening?

## Notes

- EDGAR companyfacts endpoint: `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik padded to 10 digits}.json`
- User-Agent: `User-Agent: AV-Framework charles@bolinandtroy.com`
- Rate limit: 10 req/sec
- For Test 5 (Zipf), you need sector-wide revenue data. Pull from the 5,065-stock universe for the sectors represented in the calibration dataset. If full universe pull is too heavy, pull only for sectors that have ≥ 10 calibration cases.
- Employee data (dei:EntityNumberOfEmployees) is filed annually, not quarterly, and coverage is inconsistent. Use where available but do not require it — total assets is the more reliable scaling denominator.
- Seasonal effects: use YoY (4-quarter lag) for all growth rates and derivatives to remove seasonality. Do not use quarter-over-quarter.
- The Benford data already pulled for the previous test battery can be reused for Test 2. No need to re-fetch EDGAR for that test.
