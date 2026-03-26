# Benford Anomalous Investigation

**Date**: 2026-03-26
**Signal under investigation**: `volume_benford_anomalous`
**Reported metrics**: r=0.592, CV mean=0.599, p=0.000
**Source test**: market-dynamics-expanded-2026-03-26

---

## 1. How volume_benford_anomalous Is Computed

### Pipeline
1. `getVolumeSeries()` fetches 2 years of daily volume from Yahoo Finance
2. `volumeBenford(volSeries)` in `calibration/warehouse/connectors/market-dynamics.js:372` calls `benfordAnalysis()` with the volume values
3. `benfordAnalysis()` (line 325) computes first-digit distribution, then:
   - KL divergence from Benford's law expected distribution
   - Chi-square statistic
   - **Binary flag**: `anomalous: kld > 0.05`
4. In `test-market-dynamics-expanded.js:268`:
   ```js
   scores.volume_benford_anomalous = vb.anomalous ? 1 : 0;
   ```

### Result: It is a **binary 0/1 variable** with a fixed KLD threshold of 0.05.

---

## 2. Distribution Analysis

### Value counts (n=456)
| Value | Count | Percentage | Winners | Traps | Win Rate |
|-------|-------|-----------|---------|-------|----------|
| 0     | 11    | 2.4%      | 5       | 6     | 45.5%    |
| 1     | 445   | 97.6%     | 205     | 240   | 46.1%    |

**This is a near-constant variable.** 97.6% of all cases are flagged as "anomalous."

### Why the threshold is wrong
Daily trading volume almost universally deviates from Benford's law because volume is driven by market microstructure (lot sizes, tick sizes, algorithmic trading), not scale-invariant processes. The KLD distribution:

| KLD Range     | Count | Cumulative |
|---------------|-------|------------|
| [0.00, 0.05)  | 11    | 2.4%       |
| [0.05, 0.10)  | 17    | 6.1%       |
| [0.10, 0.15)  | 28    | 12.3%      |
| [0.15, 0.20)  | 48    | 22.8%      |
| [0.20, 0.30)  | 177   | 61.6%      |
| [0.30, 0.40)  | 152   | 94.9%      |
| [0.40, 0.50)  | 20    | 99.3%      |
| [0.50+)        | 3     | 100.0%     |

Median KLD = 0.267. The threshold of 0.05 catches only the bottom 2.4%.

---

## 3. Root Cause of r=0.592

### The artifact mechanism

The testing framework computes Spearman correlation using the standard shortcut formula:

```
r = 1 - 6 * sum(d^2) / (n * (n^2 - 1))
```

This formula assumes **no ties** (or minimal ties). With 445 values tied at 1 and 11 tied at 0:

- All 445 ones receive average rank = (12 + 456) / 2 = **234.0**
- All 11 zeros receive average rank = (1 + 11) / 2 = **6.0**

The rank difference of 228 between these two groups creates enormous squared-difference terms that dominate the statistic, producing a spurious r=0.592.

### Verification

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Uncorrected Spearman r | 0.592 | **ARTIFACT** (no tie correction) |
| Tie-corrected Spearman r | 0.867 | Even more inflated with correction |
| Phi coefficient (proper binary-binary measure) | **-0.002** | True correlation |
| Chi-square (2x2) | 0.002 | p >> 0.05, completely non-significant |
| Win rate difference | 0.6 pp | Indistinguishable from zero |

The tie correction factor T_x/12 = 7,343,500 accounts for **46.5%** of the denominator term A = 15,803,060. The shortcut Spearman formula is invalid when ties dominate the data this heavily.

### The real correlation is approximately zero.

The 5-fold cross-validation also shows inflated values (0.536-0.627) because every fold inherits the same degenerate distribution (~2% zeros).

---

## 4. volume_benford_kld (the continuous version)

The continuous KLD signal tells the honest story:

| Metric | Value |
|--------|-------|
| Spearman r | 0.122 |
| CV mean r | 0.123 |
| CV fold range | -0.023 to 0.256 |

### Quintile win rates (volume_benford_kld)
| Quintile | Win Rate | Mean KLD |
|----------|----------|----------|
| Q1 (lowest) | 49.5% | 0.124 |
| Q2 | 47.3% | 0.218 |
| Q3 | 38.5% | 0.267 |
| Q4 | 50.5% | 0.318 |
| Q5 (highest) | 44.6% | 0.386 |

**Pattern**: Non-monotonic. Q3 dips to 38.5%, Q4 rebounds to 50.5%. No coherent gradient.

One CV fold produced r=-0.023, indicating the signal is unstable. The r=0.122 is likely noise or a weak effect at best. The top-decile precision of 54.3% (25/46) is marginally above the base rate of 46.1% but on a very small sample.

**Verdict on volume_benford_kld**: Weak, unstable, non-monotonic. Not reliable enough for production use.

---

## 5. STRUCTURAL_STRESS Classification (Financial Statement Benford)

This is a **completely different analysis** from volume_benford_anomalous. It uses:
- **Data source**: EDGAR XBRL financial statement values (all reported figures)
- **Method**: Multi-base Benford analysis (bases 6, 10, 12, 60) via `multi-base-benford.js`
- **Classification logic**:
  - `STRUCTURAL_STRESS`: ALL bases show KLD > 0.005 (genuine cross-base deviation)
  - `HUMAN_MANIPULATION`: ONLY base-10 > 0.005, others < 0.003 (base-10 specific)
  - `NATURAL_PROCESS`: Everything else

### Results (from advanced-math-s1-6-2026-03-26.json, Session 5)
| Classification | Winners | Traps | Total | Win Rate |
|---------------|---------|-------|-------|----------|
| STRUCTURAL_STRESS | 68 | 27 | 95 | **71.6%** |
| NATURAL_PROCESS | 454 | 343 | 797 | 57.0% |
| HUMAN_MANIPULATION | 0 | 0 | 0 | N/A |

**14.6 percentage point difference** between STRUCTURAL_STRESS and NATURAL_PROCESS.

### Interpretation
STRUCTURAL_STRESS identifies companies whose financial figures deviate from Benford's law in ALL number bases -- not just base-10. This suggests genuine structural anomalies in the business (rapid growth, acquisitions, restructuring) rather than human number manipulation. The 71.6% win rate in 95 cases is a meaningful signal, though it needs formal statistical validation (Fisher exact test, cross-validation on the classification itself).

### Independence from spread signals
STRUCTURAL_STRESS is derived entirely from EDGAR financial data (balance sheet / income statement values). It is **structurally independent** from credit spread signals (FRED-based). However, companies under genuine structural stress may also show credit spread anomalies -- the overlap would be economic, not methodological.

---

## 6. Verdict

### volume_benford_anomalous

**ARTIFACT**

The r=0.592 is entirely caused by computing Spearman rank correlation on a near-constant binary variable (97.6% ones) without tie correction. The proper phi coefficient is -0.002. The signal has zero discriminative power.

### volume_benford_kld

**WEAK / UNRELIABLE**

r=0.122 with non-monotonic quintiles and one negative CV fold. Not suitable for production.

### STRUCTURAL_STRESS (financial multibase Benford)

**PARTIALLY REAL -- NEEDS VALIDATION**

The 71.6% win rate in 95 cases is promising but has not been formally tested with cross-validation or confirmed on an independent sample. It uses a fundamentally sound method (multi-base Benford detects genuine anomalies vs. base-10 manipulation) on a legitimate data source (financial statements). Worth pursuing as a separate investigation.

---

## 7. Recommendations

### DROP: `volume_benford_anomalous`
- Remove from all signal lists and composite scores immediately
- The binary threshold of KLD > 0.05 is meaningless for volume data (97.6% positive rate)
- If ever used again, the testing framework needs a tie-corrected Spearman or a guard against near-constant inputs

### DROP: `volume_benford_kld` (from validated signals)
- Do not include in production composites
- Non-monotonic quintiles, unstable CV, and weak effect size
- Can remain as a research variable for future investigation

### KEEP (separate track): `STRUCTURAL_STRESS` classification
- This is a different signal from a different data source
- Run a proper discrimination test with:
  - Binary classification: STRUCTURAL_STRESS (1) vs NATURAL_PROCESS (0)
  - Cross-validated win-rate difference
  - Fisher exact test for the 2x2 table
  - Check overlap with spread_variance_slope and spread_theta (the validated signals)
- If it survives validation, integrate as a financial-statement quality signal

### FIX: Testing framework
- Add a guard in `analyze()` to flag or reject signals with fewer than 3 unique values
- Consider implementing tie-corrected Spearman for robustness
- Add a distribution check that warns when >90% of values are identical

---

## 8. Summary Table

| Signal | Reported r | True Effect | Verdict | Action |
|--------|-----------|-------------|---------|--------|
| volume_benford_anomalous | 0.592 | ~0.000 (phi=-0.002) | ARTIFACT | DROP |
| volume_benford_kld | 0.122 | ~0.05-0.12 (unstable) | WEAK | DROP from production |
| volume_benford_chi | 0.119 | ~0.05-0.12 (unstable) | WEAK | DROP from production |
| STRUCTURAL_STRESS (financial) | N/A (71.6% WR) | Promising, unvalidated | PARTIALLY REAL | Validate separately |
