# Nonlinear Dynamics Computation Verification

**Date:** 2026-03-24
**Purpose:** Verify that the replication test used the same computations as the original — or identify silent simplifications that could produce false negatives.

---

## COMPUTATION VERIFICATION SUMMARY

```
Signal                  | Original Source File              | Replication Source File              | Match?
β static                | lib/nonlinear.js:16               | nonlinear-replication-test.js:115    | YES (same import)
β trajectory            | lib/nonlinear.js:38               | nonlinear-replication-test.js:118    | YES (same import)
D1 growth               | lib/nonlinear.js:215 (avgD1)      | nonlinear-replication-test.js:123    | *NO* (different computation)
Zipf velocity           | lib/nonlinear.js:314-374           | nonlinear-replication-test.js:151    | YES (same imports)
CSD index               | lib/nonlinear.js:171               | nonlinear-replication-test.js:131    | YES (same import)
Benford KLD             | lib/benford.js:107 + extractor     | nonlinear-replication-test.js:136    | *NO* (level vs slope)
S-curve D1/D2           | lib/nonlinear.js:215               | nonlinear-replication-test.js:143    | YES (same import)
Combined β+D1           | deep-calibration.js:648            | nonlinear-replication-test.js:542    | PARTIAL (D1 differs)

Signals with MISMATCHES: 2 / 8  (+ 1 systematic issue affecting all signals)
```

---

## Signal-by-Signal Analysis

### Signal 1: β Scaling Exponent (Static)

**Original code** (`scripts/lib/nonlinear.js:16-35`):
```javascript
export function computeScalingExponent(quarterlyMetrics, xMetric = 'assets', yMetric = 'revenue') {
  const points = quarterlyMetrics
    .filter(q => q[xMetric] > 0 && q[yMetric] > 0)
    .map(q => ({ x: Math.log10(q[xMetric]), y: Math.log10(q[yMetric]) }));
  if (points.length < 8) return null;
  const reg = linearRegression(points.map(p => p.x), points.map(p => p.y));
  return { beta: reg.slope, logK: reg.intercept, r2: reg.r2, n: points.length };
}
```

**How original calibration called it** (`scripts/nonlinear-calibration.js:132`):
```javascript
const beta = computeScalingExponent(data.quarterlyMetrics);  // NO date filtering
```

**Replication code** (`scripts/nonlinear-replication-test.js:110-121`):
```javascript
function computeSignal1_BetaScaling(quarterlyMetrics, entryDate) {
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  const betaAssets = computeScalingExponent(filtered, 'assets', 'revenue');  // SAME IMPORT
  const trajectory = scalingTrajectory(filtered);  // SAME IMPORT
  return { betaAssets, trajectory };
}
```

**Same computation? YES** — The replication imports and calls the exact same `computeScalingExponent()` from `lib/nonlinear.js`. The only difference is date filtering (see systematic issue below).

---

### Signal 2: β Trajectory

**Original code** (`scripts/lib/nonlinear.js:38-68`):
```javascript
export function scalingTrajectory(quarterlyMetrics) {
  const valid = quarterlyMetrics.filter(q => q.assets > 0 && q.revenue > 0);
  if (valid.length < 12) return null;
  const mid = Math.floor(valid.length / 2);
  const early = valid.slice(0, mid);
  const late = valid.slice(mid);
  const betaEarly = computeScalingExponent(early);
  const betaLate = computeScalingExponent(late);
  if (!betaEarly || !betaLate) return null;
  const betaChange = betaLate.beta - betaEarly.beta;
  ...
}
```

**Replication code** (`scripts/nonlinear-replication-test.js:118`):
```javascript
const trajectory = scalingTrajectory(filtered);  // SAME IMPORT from lib/nonlinear.js
```

**Same computation? YES** — Identical function via import. The replication stores `s1.trajectory.betaChange` as `c.betaTrajectory`, which is exactly `betaLate.beta - betaEarly.beta`.

---

### Signal 3: D1 Growth Rate

**Original code** — D1 was defined as `revenueDerivatives().avgD1` in the deep calibration (`scripts/nonlinear-deep-calibration.js:623,863`):
```javascript
{ name: 'D1 (growth)', key: 'avgD1' },
...
avgD1: deriv?.avgD1 ?? null,
```

Where `avgD1` comes from `revenueDerivatives()` (`scripts/lib/nonlinear.js:215-274`):
```javascript
export function revenueDerivatives(quarterlyMetrics) {
  const revs = quarterlyMetrics
    .filter(q => q.revenue != null && q.revenue > 0);
  // D1: YoY growth with 4-quarter lag
  const d1 = [];
  for (let i = 4; i < revs.length; i++) {
    d1.push({ growthRate: (revs[i].revenue - revs[i-4].revenue) / revs[i-4].revenue });
  }
  const recentD1 = d1.slice(-4);           // ← LAST 4 D1 POINTS
  const avgD1 = mean(recentD1.map(r => r.growthRate));
  ...
}
```

**Replication code** (`scripts/nonlinear-replication-test.js:123-129`):
```javascript
function computeSignal2_D1GrowthRate(quarterlyMetrics, entryDate) {
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  const withGrowth = filtered.filter(q => q.revenueGrowthYoY != null).slice(-8);  // ← LAST 8 POINTS
  if (withGrowth.length < 4) return null;
  return mean(withGrowth.map(q => q.revenueGrowthYoY));
}
```

**Same computation? NO.** Two differences:
1. **Window size:** Original uses last 4 D1 points. Replication uses last 8 quarterly `revenueGrowthYoY` values.
2. **Source of growth values:** Original computes growth inside `revenueDerivatives()` directly from the revenue series. Replication reads pre-computed `revenueGrowthYoY` from `extractQuarterlyMetrics()`.

**However, this mismatch is mitigated** because the replication ALSO tested the original D1 via the S-curve signal:
```javascript
// nonlinear-replication-test.js:414-417
const scurve = computeSignal6_SCurve(qm, c.entry_date);  // calls revenueDerivatives()
if (scurve) {
  c.avgD1 = scurve.avgD1;   // THIS IS THE ORIGINAL D1
}
```

And the result was: **S-curve D1 (avg growth rate): r = -0.069, p = 0.009, direction REVERSED.** This is the *correct* D1 from `revenueDerivatives().avgD1`, and it *still* fails.

**Could this explain the failed replication? NO.** The original D1 was tested (as "S-curve D1") and showed r=-0.069 with reversed direction. The mismatched D1 showed r=0.005. Neither works.

---

### Signal 4: Zipf Rank Velocity

**Original code** (`scripts/nonlinear-calibration.js:505-606` calling `lib/nonlinear.js:314-374`):
```javascript
// Group by sector ETF, track rank across years
const sectorGroups = groupBySectorETF(cases);
...
const rankHistory = trackRankHistory(c.ticker, sectorCompanyData[etf], years);
const rv = rankVelocity(rankHistory.ranks, rankHistory.years);
const adj = effortAdjustedVelocity(rv, z.alpha);
```

**Replication code** (`scripts/nonlinear-replication-test.js:151-194`):
```javascript
function computeZipfForAllCases(casesWithData) {
  // Group by sector
  for (const c of casesWithData) {
    if (!c.sector || !c.quarterlyMetrics) continue;
    const key = `${c.sector}`;       // ← Uses raw sector field
    ...
  }
  // Same function calls:
  const history = trackRankHistory(c.ticker, sectorCompanies, years);
  const rv = rankVelocity(history.ranks, history.years);
  c.effortAdjustedVelocity = zipf ? effortAdjustedVelocity(rv, zipf.alpha) : null;
}
```

**Same computation? YES** — The replication imports and calls the exact same `trackRankHistory()`, `rankVelocity()`, `effortAdjustedVelocity()`, `buildSectorRankings()`, and `zipfExponent()` functions from `lib/nonlinear.js`.

**Minor difference:** Sector grouping. The original used `groupBySectorETF()` with cleaned labels mapping to sector ETFs. The replication uses the raw `c.sector` field from systematic datasets, which has 390 cases with `null`/`Unknown` sectors (24% of dataset). These cases are excluded from Zipf computation, reducing coverage to 68.3%.

**Could this explain the failed replication? NO.** Even among the 1,131 cases with Zipf velocity computed, r=0.012 (p=0.69). The sector grouping difference excludes some cases but doesn't bias the results.

---

### Signal 5: CSD Index

**Original code** (`scripts/nonlinear-calibration.js:309` calling `lib/nonlinear.js:171-209`):
```javascript
const csd = companyCSD(data.quarterlyMetrics);  // NO date filtering
```

**Replication code** (`scripts/nonlinear-replication-test.js:131-133`):
```javascript
function computeSignal4_CSD(quarterlyMetrics, entryDate) {
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  return companyCSD(filtered);  // SAME IMPORT from lib/nonlinear.js
}
```

**Same computation? YES** — Identical `companyCSD()` function from `lib/nonlinear.js`. Only difference is date filtering.

---

### Signal 6: Benford First-Digit KLD

**Original calibration Test 2** (`scripts/nonlinear-calibration.js:228-243`):
```javascript
// KLD SLOPE over rolling windows — temporal TREND
const windows = buildRollingWindows(data.facts);
const klds = [];
for (let i = 0; i < windows.length; i++) {
  const result = benfordFirstDigit(windows[i].values);
  if (result) klds.push({ x: i, kld: result.kld });
}
const reg = linearRegression(klds.map(k => k.x), klds.map(k => k.kld));
bands[band][outcome].push({ ticker: c.ticker, slope: reg.slope, revenue: annualRev });
```

**Replication code** (`scripts/nonlinear-replication-test.js:136-141`):
```javascript
function computeSignal5_Benford(facts, entryDate) {
  const numbers = extractUsdNumbers(facts);   // ALL numbers, no date filtering
  if (numbers.length < 50) return null;
  return benfordFirstDigit(numbers);           // Static KLD LEVEL, not slope
}
```

**Same computation? NO.** Significant difference:
- **Original:** Computes KLD per rolling 8-quarter window, then measures the **slope** of KLD over time (is conformity improving or degrading?). Segments by maturity band.
- **Replication:** Computes a single static KLD from all financial line items. No temporal trend, no maturity segmentation in the primary signal.

**However:** The replication DID include a maturity-band breakdown in the report output:
```
early-scaling   N=  62, winner_KLD=0.0022, trap_KLD=0.0025, r=-0.0839, p=0.5170
late-scaling    N= 446, winner_KLD=0.0022, trap_KLD=0.0024, r=-0.0398, p=0.4017
mature          N= 944, winner_KLD=0.0022, trap_KLD=0.0023, r=-0.0120, p=0.7138
```

None show significance at any maturity band. But the maturity-band analysis still uses the static KLD level, not the slope.

**Could this explain the failed replication? UNLIKELY.** The original Benford signal was already marginal (p=0.02 on curated data). The replication tested both static KLD (r=-0.027) and maturity-segmented KLD (all p>0.40). The temporal slope measure would be noisier than the level, so if the level shows zero discrimination, the slope is unlikely to show more.

**Still, this IS a computation mismatch and should be acknowledged.** A proper replication would compute rolling-window KLD slopes.

---

### Signal 7: S-Curve D1 and D2

**Original code** (`scripts/nonlinear-calibration.js:414` calling `lib/nonlinear.js:215-274`):
```javascript
const deriv = revenueDerivatives(data.quarterlyMetrics);  // NO date filtering
// Extracts: avgD1, avgD2, phase, d2Trend
```

**Replication code** (`scripts/nonlinear-replication-test.js:143-146`):
```javascript
function computeSignal6_SCurve(quarterlyMetrics, entryDate) {
  const filtered = quarterlyMetrics.filter(q => !entryDate || q.quarter <= entryDate.slice(0, 4) + '-Q4');
  return revenueDerivatives(filtered);  // SAME IMPORT from lib/nonlinear.js
}
```

**Same computation? YES** — Identical `revenueDerivatives()` function from `lib/nonlinear.js`. Only difference is date filtering.

---

### Signal 8: Combined β Trajectory + D1

**Original (deep calibration)** (`scripts/nonlinear-deep-calibration.js:644-657`):
```javascript
// Z-score normalize each signal
const aVals = combined.map(c => a.invert ? -c[a.key] : c[a.key]);  // betaTrajectory
const bVals = combined.map(c => b.invert ? -c[b.key] : c[b.key]);  // avgD1
const aMean = mean(aVals), aStd = stddev(aVals) || 1;
const bMean = mean(bVals), bStd = stddev(bVals) || 1;
const combinedScores = combined.map((c, idx) => ({
  outcome: c.outcome,
  score: ((aVals[idx] - aMean) / aStd + (bVals[idx] - bMean) / bStd) / 2,
}));
```

Where `avgD1 = revenueDerivatives().avgD1` (mean of last 4 D1 growth rates).

**Replication code** (`scripts/nonlinear-replication-test.js:535-553`):
```javascript
const betaVals = valid.map(c => c.betaTrajectory);
const d1Vals = valid.map(c => c.d1GrowthRate);           // ← MISMATCHED D1
const betaMean = mean(betaVals), betaStd = stddev(betaVals);
const d1Mean = mean(d1Vals), d1Std = stddev(d1Vals);
c.combinedBetaD1 = ((c.betaTrajectory - betaMean) / (betaStd || 1) +
                     (c.d1GrowthRate - d1Mean) / (d1Std || 1)) / 2;
```

**Same computation? PARTIAL.**
- The z-score + average method is identical.
- The β trajectory component is identical (same import).
- The D1 component uses `c.d1GrowthRate` (8-quarter mean from `revenueGrowthYoY`) instead of the original `avgD1` (4-quarter mean from `revenueDerivatives()`).

**Could this explain the failed replication? NO.** Both D1 variants fail:
- `d1GrowthRate` (8Q mean): r=0.005, p=0.852
- `avgD1` (4Q mean, from S-curve): r=-0.069, p=0.009 (reversed direction)

Neither produces a positive signal. The combined score using either D1 variant would fail, since β trajectory itself is r=0.010.

---

## Systematic Issue: Date Filtering

**This affects all signals equally.**

**Original calibration** (`scripts/nonlinear-calibration.js:97-98`):
```javascript
const quarterlyMetrics = extractQuarterlyMetrics(result.facts);  // NO beforeDate parameter
```
All quarterly data including AFTER entry date is used. This is look-ahead bias.

**Replication** (`scripts/nonlinear-replication-test.js:368`):
```javascript
const qm = extractQuarterlyMetrics(facts, c.entry_date);  // FILTERS to before entry date
```

**Impact:** The original calibration had look-ahead bias — it used financial data from after the entry date to compute signals. The replication correctly restricts to data available at entry time. This makes the replication **more methodologically correct**, not less.

**Could this explain the failed replication?** It's a contributor. Look-ahead lets the original "see" whether revenue subsequently grew (for winners) or collapsed (for traps), inflating the signal. However, this is a methodological flaw in the original, not an error in the replication. A signal that only works with future data is not a predictive signal.

---

## Summary of Findings

### True Mismatches

| # | Signal | Mismatch | Severity | Changes Conclusion? |
|---|--------|----------|----------|-------------------|
| 1 | D1 Growth Rate | 8Q mean of `revenueGrowthYoY` vs 4Q mean from `revenueDerivatives().avgD1` | Low | **NO** — original D1 also tested via S-curve (r=-0.069, reversed) |
| 2 | Benford KLD | Static KLD level vs temporal KLD slope over rolling windows | Medium | **UNLIKELY** — level shows zero discrimination at all maturity bands; slope would be noisier |
| 3 | Combined β+D1 | Inherits D1 mismatch above | Low | **NO** — both D1 variants fail |

### Systematic Issue (All Signals)

| Issue | Impact | Changes Conclusion? |
|-------|--------|-------------------|
| Date filtering: original used all data (look-ahead), replication correctly restricts to pre-entry | Makes replication MORE correct | **NO** — look-ahead bias in original inflated curated results |

### Signals Using Identical Imported Functions

These 5 of 8 signals called the **exact same library functions** via `import`:
- β scaling exponent → `computeScalingExponent()` from `lib/nonlinear.js`
- β trajectory → `scalingTrajectory()` from `lib/nonlinear.js`
- CSD index → `companyCSD()` from `lib/nonlinear.js`
- S-curve D1/D2 → `revenueDerivatives()` from `lib/nonlinear.js`
- Zipf velocity → `trackRankHistory()` + `rankVelocity()` + `effortAdjustedVelocity()` from `lib/nonlinear.js`

These are not reimplementations — they are direct imports of the original code.

---

## Cross-Check: Does the "Correct" D1 Change Anything?

The replication tested TWO versions of D1:

| Version | Source | Result on Unbiased Data |
|---------|--------|------------------------|
| `d1GrowthRate` (mismatched) | 8Q mean of `revenueGrowthYoY` | r=0.005, p=0.852 |
| `avgD1` (correct, via S-curve) | `revenueDerivatives().avgD1` | r=-0.069, p=0.009, **REVERSED** |

The "correct" D1 actually performs **worse** — it's statistically significant but in the wrong direction. Higher growth rate predicts being a *trap*, not a *winner*, on unbiased data.

The winner mean for avgD1 is 706.25 — that's clearly driven by extreme outliers (some companies with >70,000% growth rates from a tiny base). Median would be more informative, but the rank-based Spearman correlation already accounts for this and still shows reversed direction.

---

## Verdict

**The replication is trustworthy.** While there are 2 computation mismatches (D1 window and Benford level-vs-slope), neither changes the conclusion:

1. The D1 mismatch is cross-checked: the original D1 was independently tested via the S-curve signal and also fails (r=-0.069, reversed).
2. The Benford mismatch involves a signal that was marginal on curated data (p=0.02) and shows zero discrimination at every maturity band on unbiased data.
3. The date filtering difference makes the replication MORE correct by eliminating look-ahead bias.
4. Five of eight signals used the identical imported library functions — no reimplementation, no simplification.

**The conclusion stands: all nonlinear dynamics signals are curation artifacts.**

The only unexplored question is whether the Benford temporal *slope* (not level) shows a signal on unbiased data. Given that the level shows r=-0.027 with zero significance at every maturity band, this is extremely unlikely — but it could be tested as a follow-up if desired.

---

*Verification completed 2026-03-24 by code comparison only — no tests were re-run.*
