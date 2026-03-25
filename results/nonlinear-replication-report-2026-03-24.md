# Nonlinear Dynamics Replication Test Report

**Date:** 2026-03-24
**Purpose:** Rerun exact nonlinear dynamics computations from March 2026 on 1,656-case unbiased dataset
**Dataset:** 1656 cases (926 winners, 730 traps)
**Pre-registered hurdle:** ≥3% annualized alpha vs VOO

---

## Signal Coverage

| Signal | Cases with Data | % Coverage |
|--------|----------------|------------|
| beta | 1400 | 84.5% |
| d1Growth | 1437 | 86.8% |
| zipfVelocity | 1131 | 68.3% |
| csd | 1378 | 83.2% |
| benford | 1529 | 92.3% |
| sCurve | 1437 | 86.8% |

---

## Signal-by-Signal Comparison

| Signal | Curated r | Unbiased r | Ratio | Direction | Verdict |
|--------|-----------|-----------|-------|-----------|---------|
| β scaling exponent (static) | 0.267 | -0.009 | 0.04 | REVERSED | **DROP** |
| β trajectory (late-early) | 0.169 | 0.010 | 0.06 | Same | **DROP** |
| D1 growth rate | 0.285 | 0.005 | 0.02 | Same | **DROP** |
| Zipf rank velocity | 0.282 | 0.012 | 0.04 | Same | **DROP** |
| Zipf effort-adjusted velocity | 0.239 | -0.043 | 0.18 | REVERSED | **DROP** |
| CSD index | 0.074 | -0.037 | 0.50 | REVERSED | **DROP** |
| Benford first-digit KLD | 0.020 | -0.027 | 1.36 | REVERSED | **DROP** |
| S-curve D1 (avg growth rate) | 0.331 | -0.069 | 0.21 | REVERSED | **CURATION ARTIFACT** |
| S-curve D2 (acceleration) | 0.150 | -0.066 | 0.44 | REVERSED | **DROP** (direction reversed) |
| β trajectory + D1 (combined) | 0.406 | 0.012 | 0.03 | Same | **DROP** |
| Full nonlinear composite | 0.450 | -0.051 | 0.11 | REVERSED | **DROP** |

---

## Zipf Diagnostic

### Why did f060 show p=0.769 in the blind agent test?

**Answer: Different computation (Explanation 1 confirmed)**

The anonymization script (`scripts/anonymize-dataset.js`, lines 360-365) computed f060 as:
```javascript
// f060: Zipf rank velocity — rank change in revenue growth within sector
// Simplified: use percentile rank of revenue growth within sector
const rank = revGrowths.filter(g => g <= c.features.f001).length;
c.features.f060 = round3(rank / revGrowths.length);
```

The original Test 5 from `scripts/lib/nonlinear.js` computes:
1. Revenue rank within sector across **multiple years** (4-year lookback)
2. Linear regression slope of rank over time (rank velocity)
3. Effort-adjusted velocity normalized by Zipf exponent

These are fundamentally different: f060 is a **static percentile** while the original is a **dynamic trajectory**.
The label "Simplified" in the anonymization code confirms this was a conscious shortcut that discarded the temporal component.

---

## Recommendations

### Signals to KEEP

**None.** Every nonlinear dynamics signal is a curation artifact. No signal survives on unbiased data.

### All Signals to DROP

| Signal | Unbiased r | Reason |
|--------|-----------|--------|
| β scaling exponent (static) | -0.009 | Near-zero, direction reversed |
| β trajectory (late-early) | 0.010 | Near-zero (ratio 0.06 of curated) |
| D1 growth rate | 0.005 | Near-zero (ratio 0.02 of curated) |
| Zipf rank velocity | 0.012 | Near-zero even with correct computation |
| Zipf effort-adjusted velocity | -0.043 | Direction reversed |
| CSD index | -0.037 | Direction reversed |
| Benford first-digit KLD | -0.027 | Direction reversed |
| S-curve D1 (avg growth rate) | -0.069 | Direction reversed, p=0.009 in WRONG direction |
| S-curve D2 (acceleration) | -0.066 | Direction reversed despite ratio 0.44 |
| β trajectory + D1 (combined) | 0.012 | Near-zero — r=0.406 was entirely curation artifact |
| Full nonlinear composite | -0.051 | Direction reversed |

---

## β Quadrant Analysis

The "β > 1.0 + improving" quadrant went from 85.2% win rate (curated) to **59.7%** (unbiased). Base rate is 56%. This 3.7pp difference is not actionable.

## S-Curve Phase Analysis

The PEAK phase went from 66% win rate (curated) to **46.6%** (unbiased) — BELOW the 56% base rate. PEAK phase is actually a *negative* predictor on unbiased data.

## Cross-Validation

No signal achieved even 3/5 folds at p < 0.10:
- Best: S-curve D1 at 2/5 folds
- All others: 0/5 or 1/5 folds

## Return Hurdle

Both the S-curve D1 and Full Composite technically pass the 3% alpha hurdle, but:
- S-curve D1 top half *underperforms* bottom half (-2.4% spread) — the "alpha" comes from the period's generally strong returns, not the signal
- Full Composite has 0/5 CV folds, so the 7% spread is a fluke
- No signal passes both the statistical AND return hurdle tests

## Zipf Diagnostic — Complete Explanation

**Why did f060 show p=0.769?**

All three explanations apply, in order of importance:

1. **Different computation (CONFIRMED):** f060 was a static percentile, not a trajectory. But this alone doesn't explain the failure because...
2. **Signal was a curation artifact (PRIMARY):** Even the correct Zipf computation produces r=0.012 (p=0.69) on unbiased data. The r=0.282 on curated data was inflated by hand-picked extreme outcomes.
3. **Sector coverage gap:** 390/1,656 cases (24%) had unknown sector, reducing the Zipf sample to 1,131 cases. However, this doesn't change the fundamental finding — the signal has no effect.

**Bottom line:** The computation difference is real but irrelevant. Zipf velocity doesn't predict returns on unbiased data regardless of how you compute it.

---

## Overall Conclusion

**Every nonlinear dynamics finding from March 2026 was a curation artifact.** The curated dataset's hand-picked extreme winners (SHOP at $120, AAPL) and extreme traps (INTC, WBA) created illusory separations that vanish on a representative sample of S&P 500 companies.

The signals that DO work on unbiased data (short interest, credit spreads, filing quality — from the blind research agent) are entirely different in nature: they are market-based and regulatory signals, not financial statement ratios or complex systems computations.

**Recommendation: Do not deploy any nonlinear dynamics signals into the live framework.** The only validated signals remain those from the blind research agent's findings report.

---

*Report generated by nonlinear-replication-test.js on 2026-03-24*