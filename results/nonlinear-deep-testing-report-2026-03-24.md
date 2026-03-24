# Non-Linear Dynamics — Deep Testing & Dataset Expansion Report

**Date:** 2026-03-24
**Dataset:** 719 cases (445 unique tickers) across 6 tiers
**Specs executed:** nonlinear-deep-testing-spec.md, expanded-nonlinear-testing-spec.md (Parts 1-3)

---

## 1. Dataset

### Composition

| Tier | Source | Cases | Winners | Traps | Underperf | Mixed |
|------|--------|------:|--------:|------:|----------:|------:|
| 1 | Stable Value (curated) | 50 | 21 | 19 | 5 | 5 |
| 2 | Crisis/Dislocation (curated) | 80 | 47 | 11 | 14 | 8 |
| 3 | Emerging DKS (curated) | 112 | 48 | 36 | 22 | 6 |
| 4 | Regime Transition (curated) | 50 | 29 | 15 | 1 | 5 |
| 5 | S&P 500 additions/removals 2010-2024 | 263 | 77 | 90 | 70 | 26 |
| 6 | Multi-entry dates (3+ yr apart) | 164 | 75 | 23 | 47 | 19 |
| **Total** | | **719** | **297** | **194** | **159** | **69** |

### Expansion Method

**Source 1 (Tier 5):** Parsed `sp500_ticker_start_end.csv` for S&P 500 index additions (winner candidates) and removals (trap candidates) from 2010-2024. EDGAR companyfacts pulled for each, 3-year forward returns computed via Yahoo Finance. Classified by: winner (3yr return > S&P 500 + 20pp), trap (3yr return < 0%), underperform/mixed (between). Quality filters: 8+ quarters EDGAR XBRL, revenue > $50M.

**Source 3 (Tier 6):** For each of the 214 tickers in tiers 1-4, generated additional entry dates at 2012, 2015, 2018, 2021 — each 3+ years from existing entries, max 3 entries per company. Same forward return classification.

---

## 2. Deep Test 1: Scaling Exponent Robustness

### 1A. Alternative Denominators (n=719)

| Denominator | Winner β | Trap β | Gap | p-value | Effect r | N |
|-------------|----------|--------|-----|---------|----------|---|
| Assets (original) | 0.746 | 0.696 | 0.050 | 0.1424 | 0.069 | 457 |
| **Equity** | **0.609** | **0.533** | **0.077** | **0.0481** | **0.092** | **458** |
| Cost of revenue | 0.952 | 0.937 | 0.015 | 0.0654 | 0.097 | 361 |
| **OpEx** | **0.989** | **0.942** | **0.047** | **0.0476** | **0.111** | **316** |
| Employees | — | — | — | N/A | N/A | 2 |
| Liabilities | 0.639 | 0.579 | 0.061 | 0.2000 | 0.066 | 373 |

**Finding:** Assets denominator no longer significant (p=0.14). Equity (p=0.048) and OpEx (p=0.048) are marginally significant. The strong p=0.0006 from the original 292-case dataset was partially a sample artifact.

### 1B. Minimum Data Requirements

Signal stable across 4-16 quarter minimums (p=0.12-0.15 range). No optimal cutoff — the signal is uniformly weak regardless of data depth.

### 1C. R² Quality Filter

No improvement with R² filtering. High-R² cases (>0.5) lose all discrimination — suggesting the β gap is driven by noisy fits, not clean power laws.

### 1D. β Threshold Sweep

| β threshold | Cases above | Precision | Coverage |
|------------|------------|-----------|----------|
| > 0.5 | 349 | 63.9% | 78.8% |
| > 0.7 | 269 | 65.1% | 61.8% |
| > 0.9 | 148 | 66.2% | 34.6% |
| **> 1.1** | **74** | **67.6%** | **17.7%** |
| > 1.2 | 51 | 66.7% | 12.0% |

Optimal threshold >1.1 achieves 67.6% precision but covers only 17.7% of winners.

### 1E. 5-Fold Cross-Validation

| Fold | Train p | Test p | Test effect r |
|------|---------|--------|---------------|
| 1 | 0.1545 | 0.9599 | 0.005 |
| 2 | 0.5317 | 0.0485 | 0.207 |
| 3 | 0.2013 | 0.5083 | 0.069 |
| 4 | 0.1001 | 0.9616 | 0.005 |
| 5 | 0.1337 | 0.9814 | 0.002 |
| **Mean** | | **0.6919** | **0.058 ± 0.079** |

**1/5 folds significant.** β level does NOT generalize. This was 2/5 on 292 cases and got worse, not better, with more data.

### 1F. Sector-Specific β

Absolute β p=0.14, sector-relative p=0.40. Neither approach works at scale.

---

## 3. Deep Test 2: β Trajectory as Leading Indicator

### 2A. Lead Time Analysis

| Lookback | Win % improving | Trap % improving | Gap | p-value |
|----------|----------------|-----------------|-----|---------|
| 4 quarters | 70.0% | 50.6% | 19pp | 0.0005 |
| 8 quarters | 67.7% | 46.8% | 21pp | 0.0002 |
| **12 quarters** | **74.0%** | **48.0%** | **26pp** | **<0.0001** |
| 16 quarters | 68.7% | 47.3% | 21pp | 0.0002 |

**Finding:** β trajectory DOES generalize. Optimal lookback = 12 quarters (p<0.0001). Unlike static β, the trajectory signal strengthened with more data.

### 2B. β Velocity

| Band | Cases | Winners | Traps | Win Rate |
|------|------:|--------:|------:|---------:|
| Rapidly improving (>+0.05/q) | 185 | 124 | 61 | 67.0% |
| Moderately improving | 58 | 44 | 14 | **75.9%** |
| Stable | 37 | 27 | 10 | **73.0%** |
| Moderately degrading | 27 | 13 | 14 | 48.1% |
| Rapidly degrading (<-0.05/q) | 146 | 74 | 72 | **50.7%** |

Mann-Whitney: p=0.0076, r=0.125. Velocity discriminates — degrading β is a strong trap signal (50.7% win rate vs baseline 62%).

### 2C. β Level × Trajectory Matrix

| Quadrant | Winners | Traps | Win Rate |
|----------|--------:|------:|---------:|
| β>1 + improving | 117 | 50 | **70.1%** |
| β>1 + degrading | 10 | 3 | 76.9% (small n) |
| β<1 + improving | 72 | 31 | **69.9%** |
| **β<1 + degrading** | **82** | **87** | **48.5%** |

**"β<1 but improving" = 69.9% win rate** — identifies early-stage DKS formation.
**"β<1 and degrading" = 48.5% win rate** — strong trap signal.

---

## 4. Deep Test 3: Combined Non-Linear Score

### 3A. Individual Signal Strength (n=719)

| Signal | Effect r | p-value | Status |
|--------|----------|---------|--------|
| **D1 growth rate** | **0.285** | **<0.0001** | **ROBUST** |
| **Zipf rank velocity** | **0.282** | **<0.0001** | **ROBUST** |
| **β trajectory** | **0.169** | **0.0003** | **ROBUST** |
| β level (assets) | 0.069 | 0.1424 | Failed |
| CSD index | 0.015 | 0.7430 | Failed |

### 3B. Pairwise Combinations

| Pair | Effect r | p-value | vs best single |
|------|----------|---------|----------------|
| **Zipf velocity + D1 growth** | **0.312** | **<0.0001** | **+0.027** |
| β trajectory + Zipf velocity | 0.284 | <0.0001 | +0.002 |
| β trajectory + D1 growth | 0.266 | <0.0001 | -0.019 |
| β level + Zipf velocity | 0.257 | <0.0001 | -0.025 |

**Best pair: Zipf velocity + D1 growth (r=0.312).** Only combination that exceeds its best individual component.

### 3C. Composite Threshold Sweep

| Threshold | Cases | Winners | Traps | Precision |
|-----------|------:|--------:|------:|----------:|
| > 0.3 | 422 | 267 | 155 | 63.3% |
| > 0.5 | 248 | 171 | 77 | 69.0% |
| **> 0.6** | **131** | **98** | **33** | **74.8%** |
| > 0.7 | 42 | 32 | 10 | 76.2% |

Optimal deployment threshold: **>0.6** (74.8% precision, 131 cases — good balance of precision and coverage).

---

## 5. Deep Test 4: Pipeline-Specific Signals

| Pipeline | Best Signal | Effect r | p-value |
|----------|-------------|----------|---------|
| Stable Value (T1) | β trajectory | 0.489 | 0.003 |
| Crisis (T2) | D1 growth | 0.325 | 0.019 |
| Growth (T3) | D1 growth | 0.269 | 0.022 |
| Regime (T4) | β level | 0.512 | 0.002 |
| SP500 Expansion (T5) | D1 growth | 0.237 | 0.002 |
| Multi-Entry (T6) | D1 growth | 0.172 | 0.089 |

**D1 growth is the most universally applicable signal.** β trajectory excels in Stable Value cases; β level only works for Regime Transition (Tier 4).

### Pre-Filter Analysis

| β gate | Cases kept | Winners kept | Winners missed | Miss rate |
|--------|-----------|-------------|----------------|-----------|
| > 0.5 | 76.4% | 223 | 60 | 21.2% |
| > 0.6 | 70.7% | 205 | 78 | 27.6% |
| > 0.7 | 58.9% | 175 | 108 | 38.2% |

β > 0.5 as pre-filter: saves 23.6% of attractor analyses but misses 21.2% of winners. **Not recommended** — miss rate too high.

---

## 6. Deep Test 5: Vintage Simulation Gate Analysis

| β gate | Cases | Win Rate | Coverage |
|--------|------:|---------:|---------:|
| No gate | 457 | 61.9% | 100% |
| > 0.7 | 269 | 65.1% | 58.9% |
| > 1.0 | 102 | 64.7% | 22.3% |

| Composite gate | Cases | Win Rate | Coverage |
|----------------|------:|---------:|---------:|
| No gate | 467 | 62.1% | 100% |
| > 0.5 | 248 | 69.0% | 53.1% |
| **> 0.6** | **131** | **74.8%** | **28.1%** |
| > 0.7 | 42 | 76.2% | 9.0% |

467 cases scored for vintage simulation feed-in (saved in `nonlinear-deep-results-2026-03-24.json`).

---

## 7. Expanded Theories (6-9) — All Failed at Scale

| Theory | 292 cases | 719 cases | Verdict |
|--------|-----------|-----------|---------|
| 6: Hurst exponent (revenue persistence) | p=0.021, r=0.183 | p=0.42, r=0.038 | **Sample artifact** |
| 7: Revenue entropy (diversification) | p=0.31 (5.4% coverage) | p=0.51 | **Insufficient data** |
| 8: Hurst of β (meta-persistence) | p=0.22, r=0.103 | p=0.97, r=0.002 | **No signal** |
| 9: Mutual information (sector independence) | p=0.023, r=0.181 | p=0.38, r=0.042 | **Sample artifact** |

**Note on Theory 6:** On the original dataset, traps showed HIGHER Hurst (more persistent growth) — because persistent decline IS persistent. This counterintuitive direction plus failure to replicate confirms it was noise.

---

## 8. Signal Robustness Summary

### Signals that survived 292→719 expansion

| Rank | Signal | Effect r | p-value | Interpretation |
|------|--------|----------|---------|----------------|
| 1 | D1 growth rate | 0.285 | <0.0001 | Revenue momentum — winners are growing faster |
| 2 | Zipf rank velocity | 0.282 | <0.0001 | Competitive position — winners are climbing sector ranks |
| 3 | β trajectory | 0.169 | 0.0003 | Scaling improvement — winners are getting more efficient |
| — | **Zipf vel + D1 pair** | **0.312** | **<0.0001** | **Best combination** |

### Signals that failed the expansion test

| Signal | Original p | Expanded p | Cause |
|--------|-----------|------------|-------|
| β level (assets) | 0.0006 | 0.14 | Large-cap S&P 500 companies don't show β discrimination |
| β level (equity) | 0.0001 | 0.048 | Marginal — barely survives |
| Hurst exponent | 0.021 | 0.42 | Counterintuitive direction; noise |
| Mutual information | 0.023 | 0.38 | Sector independence doesn't predict returns at scale |
| CSD index | directional | 0.74 | Never had a strong standalone signal |

---

## 9. Deployment Recommendations

### Recommended Quantitative Signals for Live App

1. **D1 growth rate (revenue YoY growth)** — Display on every candidate. Gate: high growth + positive acceleration is a strong buy signal. Already computed from EDGAR quarterly data.

2. **Zipf rank velocity** — Display sector rank trajectory. Requires sector-level universe data. Climbing ranks = bullish.

3. **β trajectory (12-quarter lookback)** — Display as "scaling momentum." 74% of winners improving vs 48% of traps. Binary flag: improving/degrading.

4. **Composite gate > 0.6** — For automated screening: 74.8% precision as a pre-filter before attractor analysis.

### Not Recommended for Deployment

- **Static β level** — Does not generalize. Only useful for Tier 4 (Regime Transition) cases.
- **Hurst exponent** — Sample artifact.
- **Mutual information** — Sample artifact.
- **CSD index** — No standalone discrimination.
- **Revenue entropy** — Insufficient XBRL segment data coverage.

### Decision Framework (from spec)

| Condition | Recommendation |
|-----------|---------------|
| D ≈ A (β alone ≈ attractor) | **NO** — β alone is weak (p=0.14) |
| E > D (best pair > β alone) | **YES** — Zipf+D1 pair (r=0.312) far exceeds β (r=0.069) |
| F > B (pipeline-specific > universal) | **YES** — D1 for Growth/Crisis, β traj for Stable Value |
| G < E (full suite < best pair) | **YES** — composite (r=0.184) < best pair (r=0.312) |

**Bottom line:** Deploy Zipf velocity + D1 growth as the primary quantitative gate. Use β trajectory as a secondary directional indicator. Do NOT rely on static β level.

---

## 10. Files & Artifacts

| File | Content |
|------|---------|
| `data/nonlinear-deep-results-2026-03-24.json` | Full deep test results (719 cases) |
| `data/nonlinear-expanded-results-2026-03-24.json` | Theories 6-9 results (719 cases) |
| `data/expansion/candidates.json` | 537 S&P 500 expansion candidates |
| `data/expansion/classified.json` | 263 classified expansion cases |
| `data/expansion/forward-returns.json` | 3-year forward returns |
| `av-calibration-tool/data/tier5-sp500-expansion.json` | Tier 5 dataset |
| `av-calibration-tool/data/tier6-multi-entry.json` | Tier 6 dataset |
| `scripts/nonlinear-deep-calibration.js` | Deep test runner |
| `scripts/nonlinear-expanded-calibration.js` | Theories 6-9 runner |
| `scripts/dataset-expansion.js` | 5-phase expansion pipeline |
| `scripts/multi-entry-expansion.js` | Multi-entry date generator |
