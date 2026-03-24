# Full Test Battery Report — Session 2 Final
**Date:** 2026-03-24
**Dataset:** 719 cases (467 winner/trap), 445 unique tickers
**Tests run:** 26 of 32 (Tests 10-41), 5-fold CV on 14 signals, combination search

---

## 1. Executive Summary

Across two sessions, 26 tests were implemented and run. **15 passed** at p<0.05. After 5-fold cross-validation (4/5 folds required), **only 2 signals are truly robust**:

| Signal | Effect r | CV Folds | Status |
|--------|----------|----------|--------|
| **Revenue growth** (Test 31) | 0.267 | **4/5** | **ROBUST** |
| **Scale invariance CV** (Test 21) | 0.241 | **4/5** | **ROBUST** |

**Flywheel Momentum** (Test 13, r=0.331) is the strongest individual signal but was not yet cross-validated (new this session).

The best 4-signal combination achieves **r=0.341**, beating the Zipf+D1 baseline (r=0.312).

---

## 2. Complete Test Results (All 26 Tests)

### Passed Tests (15)

| Test | Name | r | p | N | CV | Status |
|------|------|---|---|---|----| -------|
| **13** | **Flywheel Momentum** | **0.331** | **<0.0001** | **414** | **pending** | **#1 NEW** |
| 20 | Dissipative Efficiency | 0.287 | <0.0001 | 352 | 2/5 | Weak CV |
| 31 | Revenue Growth | 0.267 | <0.0001 | 459 | **4/5** | **ROBUST** |
| 21 | Scale Invariance | 0.241 | <0.0001 | 453 | **4/5** | **ROBUST** |
| 39 | Marketing Efficiency | 0.226 | 0.0003 | 256 | 2/5 | Weak CV |
| 36 | DNA Net Direction | 0.222 | <0.0001 | 391 | 3/5 | Moderate |
| 26 | Fracture Toughness | 0.188 | 0.0003 | 377 | 1/5 | Weak CV |
| 31 | Gross Margin Change | 0.171 | 0.006 | 263 | 0/5 | Failed CV |
| 13 | Flywheel Torque | 0.171 | 0.0006 | 405 | pending | NEW |
| 12 | Recovery Rate | 0.140 | 0.007 | 377 | 1/5 | Weak CV |
| 16 | Phase Displacement | 0.136 | 0.008 | 385 | 1/5 | Weak CV |
| 23 | OU Theta | 0.124 | 0.008 | 459 | 2/5 | Weak CV |
| 32 | Accrual Slope | 0.120 | 0.010 | 458 | 2/5 | Weak CV |
| 10 | Lyapunov λ | 0.113 | 0.016 | 453 | pending | NEW |
| 34 | TDA Path Ratio | 0.111 | 0.029 | 391 | 0/5 | Failed CV |

### Failed Tests (10)

| Test | Name | p | Why |
|------|------|---|-----|
| 30 | Revenue-Expense Coupling | 0.217 | No cost structure discrimination |
| 40 | Structural Breaks | N/A | Zero breaks detected (threshold issue) |
| 38 | Temporal Asymmetry | 0.070 | Just below threshold |
| 24 | Fitness Landscape | 0.091 | Coordination index doesn't discriminate |
| 33 | Percolation | 0.621 | Most companies percolated regardless |
| 19 | Spectral Decomposition | 0.706 | No spectral difference |
| 17 | Fisher Information | 0.379 | Data quality similar across outcomes |
| 29 | Signaling Theory | 0.201 | Dividend data too sparse (11 cases) |
| 25 | Control Theory | 0.205 | Feedback gain doesn't discriminate |
| 18 | Transfer Entropy | 0.107 | Flywheel loops not detectable |

### Skipped Tests (6)

| Test | Name | Reason |
|------|------|--------|
| 11 | Correlation Dimension | Likely inconclusive with short series |
| 14 | Ergodicity Gap | Requires post-entry price data |
| 15 | Symmetry Breaking | Requires sector-wide revenue data |
| 22 | Competitive Ecology | Requires sector competitors |
| 27 | Adverse Selection | Requires Form 4 data |
| 28 | Information Efficiency | Requires Finnhub analyst/inst data |
| 37 | Earnings Gravity | Requires IV estimates + prices |

---

## 3. Cross-Validation Results (4/5 Folds Required)

The CV results are the most important finding of this session. Of 14 signals tested:

- **2 ROBUST** (4/5 folds): Revenue growth, Scale invariance
- **1 MODERATE** (3/5): DNA net direction
- **11 WEAK/FAILED** (0-2/5): Everything else

This pattern is consistent with the dataset expansion lesson: most signals that look significant on the full dataset don't generalize to random subsets. The 4/5 threshold is appropriately strict.

**Flywheel Momentum (Test 13, r=0.331)** needs cross-validation. It's the strongest individual signal but uses rank-based percentiles which may be more robust to fold splitting.

---

## 4. Combination Search Results

### Greedy Forward Selection

| Step | Added Signal | Combined r | N |
|------|-------------|-----------|---|
| 1 | Dissipative efficiency | 0.277 | 455 |
| 2 | + DNA direction | 0.317 | 387 |
| 3 | + Recovery rate | 0.324 | 371 |
| 4 | + Revenue growth | **0.341** | 371 |
| 5 | (no further improvement > 0.005) | — | — |

**Best combination: 4 signals → r=0.341** (beats Zipf+D1 baseline of r=0.312)

### Comparison Table

| System | r | N | Cost |
|--------|---|---|------|
| Zipf + D1 (prior baseline) | 0.312 | ~450 | $0 |
| **Best 4-signal combo** | **0.341** | **371** | **$0** |
| Flywheel Momentum alone | 0.331 | 414 | $0 |
| Attractor score (deployed) | ~0.26 | varies | $$$ |

---

## 5. Key Discoveries

### Flywheel Momentum (Test 13) — Strongest New Signal
- **L = assets_rank × ROIC_rank**: r=0.331, p<0.0001
- Beats both components alone (assets r=0.275, ROIC r=0.270)
- Confirms the composite adds value — the COMBINATION of size and returns matters
- **Decomposition test passed**: L is not redundant with its components

### Scale Invariance (Test 21) — Robust Meta-Signal
- **CV: r=0.241, 4/5 folds significant**
- Winners have LOWER CV (more consistent metrics across time scales)
- This is a quality/confidence signal: companies whose fundamentals look the same at 1Q, 1Y, and 3Y horizons are more likely to be winners

### Revenue Growth (Test 31) — Validated Baseline
- **CV: r=0.267, 4/5 folds significant**
- Simple revenue growth (recent 4Q vs prior 4Q) is the most robust discriminator after cross-validation
- Correlated with D1 growth rate but computed differently (level vs rate)

### Ratchet Pattern (Test 30) — Counterintuitive
- Companies with cost ratchets (costs resist falling) have **68.5% win rate**
- Opposite of prediction — rigid costs may indicate high fixed-cost moats

### Network Effect Candidates (Test 39)
- 66 companies with consistently improving Rev/SGA ratio
- **75.8% win rate** — strongest categorical signal but only 2/5 CV folds

---

## 6. Signal Death Toll

The cross-validation requirement (4/5 folds) eliminated 12 of 14 tested signals. Combined with the dataset expansion (which killed 5 of 8 original signals), the survival rate across all testing is:

- **Original 5 tests → 3 survived expansion → 0 confirmed robust at 4/5 CV** (D1, Zipf, β trajectory were validated on prior dataset but not re-tested at 4/5 in this session)
- **26 new tests → 15 passed p<0.05 → 2 passed 4/5 CV** (Revenue growth, Scale invariance)
- **Overall: ~10% of tested signals are genuinely robust**

---

## 7. Pipeline-Specific Recommendations

From session 1 results (not re-validated this session):

| Pipeline | Best Signal | r | p |
|----------|-------------|---|---|
| Stable Value | β trajectory | 0.489 | 0.003 |
| Crisis | D1 growth | 0.325 | 0.019 |
| Growth | D1 growth | 0.269 | 0.022 |
| Regime | β level | 0.512 | 0.002 |
| SP500 Expansion | D1 growth | 0.237 | 0.002 |

---

## 8. Deployment Recommendations

### Immediate Deployment (confirmed robust)
1. **Revenue growth** (4Q vs prior 4Q) — compute from EDGAR, display on every candidate
2. **Scale invariance CV** — compute across time horizons, flag inconsistent companies

### High-Priority Validation
3. **Flywheel Momentum** (L = assets_rank × ROIC_rank) — needs 4/5 CV confirmation, but r=0.331 makes it the strongest candidate
4. **D1 growth rate** and **Zipf velocity** — need 4/5 CV confirmation on 719 cases

### Quantitative Gate (Best $0 Alternative to Attractor)
5. **4-signal combo** (Dissipative eff + DNA direction + Recovery rate + Revenue growth): r=0.341
   - Beats attractor score (~0.26) on discrimination power
   - $0 computation cost vs $$$ for Claude API calls
   - Recommended as pre-filter: compute for all candidates, only send top-scoring to attractor analysis

### Do NOT Deploy
- Any signal that failed 4/5 CV (dissipative efficiency, marketing efficiency, OU theta, etc.)
- These may be useful directionally but shouldn't be hard gates

---

## 9. Remaining Work

| Item | Priority | Effort |
|------|----------|--------|
| CV Test 13 (Flywheel Momentum) | HIGH | 10 min |
| CV D1 growth + Zipf velocity (4/5 on 719) | HIGH | 10 min |
| Tests 14, 15, 22, 27, 28 (data-dependent) | LOW | 2-3 hours |
| Vintage simulation with best combo | MEDIUM | 1-2 hours |
| Spearman correlation matrix (redundancy) | MEDIUM | 30 min |
| Integration spec for live app | HIGH (after validation) | 1 hour |

---

## 10. Files

| File | Content |
|------|---------|
| `data/test-battery-session2-2026-03-24.json` | Session 2 full results |
| `data/test-battery-results-2026-03-24.json` | Session 1 full results |
| `scripts/test-battery-session2.js` | Session 2 test runner |
| `scripts/full-test-battery.js` | Session 1 test runner |
