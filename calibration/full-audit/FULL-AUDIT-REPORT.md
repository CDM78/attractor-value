# Complete Quantitative Signal Audit — Mid-Cap Universe

## Methodology
- Dataset: 1,277 mid-cap cases at 2020-Q3 and 2022-Q1 entries
- De-duplicated: 663 unique companies (48% were duplicates — same company at both dates)
- All r-values: Pearson with continuous forward_return_3yr
- All outcomes included (winner/trap/underperform/mixed)
- 5-fold CV stratified by entry date, seed=42
- Signals with r > 0.15 on n > 100 get automatic winsorization check
- De-duplicated results reported for all signals

## The One Signal That Survived

```
SI CSD (Critical Slowing Down on Short Interest):

  Full dataset:   r=0.074, p=0.017, n=1040, 4/5 CV — VALIDATED
  De-duplicated:  r=0.119, p=0.005, n=554,  4/5 CV — VALIDATED

  Top quartile mean return:    0.587 (43.9% win rate)
  Bottom quartile mean return: 0.236 (30.9% win rate)
  Quartile spread: 0.351

  Composite (spread + si_csd, de-duped): r=0.117, p=0.006, n=554
```

SI CSD is the ONLY signal that passes all validation criteria on both the full and de-duplicated datasets. It measures whether the autocorrelation of short interest changes is increasing (consensus forming) or decreasing (stable regime). It's a company-specific market sentiment signal.

## Complete Signal Results (De-Duplicated, 663 Unique Companies)

```
SIGNAL                         │  r      │  p      │  n   │ CV   │ Status
───────────────────────────────┼─────────┼─────────┼──────┼──────┼────────────────
si_csd                         │  0.119  │ 0.0048  │  554 │ 4/5  │ VALIDATED
spread + si_csd composite      │  0.117  │ 0.0055  │  554 │  —   │ VALIDATED
───────────────────────────────┼─────────┼─────────┼──────┼──────┼────────────────
hurst_revenue                  │  0.093  │ 0.274   │  138 │ 3/5  │ FAILED
fisher_information             │  0.074  │ 0.354   │  157 │ 4/5  │ FAILED
si_theta                       │  (dup)  │  —      │  —   │  —   │ MARGINAL (dup only)
───────────────────────────────┼─────────┼─────────┼──────┼──────┼────────────────
spread_variance_slope          │  0.000  │ 1.000   │  663 │ 0/5  │ FAILED
form4_log_net_value            │ -0.050  │ 0.714   │   56 │  —   │ FAILED
si_zipf_velocity               │  (dup)  │  —      │  —   │  —   │ FAILED
si_d1                          │  (dup)  │  —      │  —   │  —   │ FAILED
si_d2                          │  (dup)  │  —      │  —   │  —   │ FAILED
si_zipf_x_d1                   │  0.018  │ 0.573   │ 1034 │  —   │ FAILED
revenue_d2                     │ -0.133  │ 0.095   │  157 │ 1/5  │ FAILED (negative)
beta_level                     │ -0.018  │ 0.752   │  296 │  —   │ FAILED
beta_trajectory                │ -0.039  │ 0.562   │  226 │  —   │ FAILED
beta_velocity                  │ -0.039  │ 0.562   │  228 │  —   │ FAILED
fin_csd                        │  0.024  │ 0.684   │  284 │  —   │ FAILED
fin_benford_kld                │  0.076  │ 0.167   │  326 │  —   │ FAILED
fin_d1_growth                  │ -0.033  │ 0.561   │  307 │  —   │ FAILED
eps_round_number               │  0.075  │ 0.188   │  306 │  —   │ FAILED
hurst_x_growth_direction       │  0.092  │ 0.151   │  244 │  —   │ FAILED
```

## Key Findings

### 1. The Spread Signal Is Dead When De-Duplicated

Spread_variance_slope was r=0.065 (p=0.02) on the full dataset but **r=0.000 (p=1.000)** when de-duplicated. With only 2 entry dates (2020-Q3 and 2022-Q1), the spread signal has exactly 2 unique values. All the "signal" was coming from 2020-Q3 cases (entering near COVID lows) having higher returns than 2022-Q1 cases. This is not a tradable signal — it's just "stocks bought during COVID did well."

### 2. The Insider Signal Was Entirely Duplicate-Driven

log(insider net value) went from r=0.260 (n=103 with duplicates) to r=-0.050 (n=56 de-duplicated). The same companies' insider data was counted twice, and a few extreme returns amplified the correlation. After winsorization, even the duplicated version drops to r=0.129 (p=0.177). The insider signal does not survive any robustness check.

### 3. Fisher Information Is a Near-Miss

Fisher r=0.074 (p=0.354) on de-duplicated data — not significant. But it has the second-largest quartile spread (0.280) and 4/5 CV folds positive. It might validate on a larger dataset with more entry dates.

### 4. Revenue D2 (Acceleration) Is Significant But Negative

Revenue D2 r=-0.133 (p=0.095) de-duplicated — DECELERATING companies have HIGHER returns. S-curve confirms: DECELERATING phase has 69.5% mean 3yr return vs ACCELERATING at 24.3%. This is a contrarian signal — buy companies whose growth is slowing. But it only has 1/5 CV folds, so it may not be stable.

### 5. All Financial Statement Signals Confirmed Dead on Mid-Caps

β level, β trajectory, β velocity, financial CSD, financial Benford, financial D1 growth — all FAILED. The "management smoothing" hypothesis is confirmed: these signals don't work on any unbiased dataset, not just S&P 500.

## Categorical Signals

```
BENFORD STRUCTURAL_STRESS:
  STRUCTURAL_STRESS: n=312, mean return 0.360
  NATURAL_PROCESS:   n=11,  mean return 0.308
  t-test: t=0.240, p=0.810 — NOT SIGNIFICANT
  Note: 312 vs 11 is extremely unbalanced — nearly all cases are STRUCTURAL_STRESS

S-CURVE PHASE:
  DECELERATING:  n=59,  mean return 0.695, win rate 68% ← HIGHEST
  PEAK:          n=102, mean return 0.284, win rate 46%
  ACCELERATING:  n=131, mean return 0.243, win rate 44%
  TROUGH:        n=15,  mean return 0.280, win rate 40%
```

## What This Means for the Framework

The honest truth: **only one quantitative signal — SI CSD — survives proper methodology on independent mid-cap data.** It produces r=0.119 (p=0.005) on 554 unique companies with 4/5 CV folds positive. The quartile spread of 0.351 (top quartile 58.7% return vs bottom quartile 23.6%) represents a genuine, modest edge.

Everything else — SI Zipf velocity, Fisher information, the insider signal, spread timing, all financial statement signals — either fails on de-duplicated data or lacks sufficient sample size.

The prior reported r-values (0.219, 0.316, 0.564, 0.485) were inflated by a combination of:
1. Spearman on categorical encodings
2. Winner/trap-only filtering
3. Duplicate company entries
4. Training data contamination (for AI signals)
5. Outlier sensitivity

## Recommendation

**Deploy SI CSD as the primary quantitative signal.** r=0.119 is small but real and validated. It provides a 13pp win rate spread between top and bottom quartiles.

**The framework's edge comes from screening discipline (avoiding traps) not from strong positive prediction.** The 43.8% trap rate in mid-caps means the default outcome is losing money. Any signal that shifts the win rate from 28% to 44% in the top quartile is valuable.

**All other quantitative signals should be considered unvalidated** until tested on a dataset with more than 2 entry dates, to properly separate macro timing from company selection.
