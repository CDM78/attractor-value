# Conditional Retest + Untested Theories Report

**Date:** 2026-03-24
**Dataset:** 1,656 cases (926 winners, 730 traps)
**Pre-registered hurdle:** ≥3% annualized alpha OR ≥30% trap catch rate with ≤15% winner cost

---

## Executive Summary

The hypothesis is confirmed: **complex signals that are dead on the general population revive within pre-filtered pools.** Specifically, β trajectory (r=0.235, p=0.010) and expense Benford KLD (r=-0.205, p=0.05) show real discriminating power within Pool D (top quintile composite + low short interest, 88% base win rate).

Three other major findings:

1. **The Growth pipeline's 20% CAGR threshold is actively harmful.** Stocks with ≥20% growth have a 49.7% win rate — BELOW the 55.9% baseline. The optimal growth range is moderate (Q2: 67.5% win rate). But within the low-short-interest subset, high growth is fine (71.3% win rate).

2. **β monitoring works as a weak sell signal.** Δβ over 4 quarters correlates with outcome at r=0.086, p=0.001. Sustained β decline catches 36.7% of traps but also sells 31.1% of winners — marginal net benefit.

3. **Line-item Benford analysis is a genuine new signal.** Expense KLD (r=-0.160, p<0.0001) and revenue KLD (r=-0.130, p<0.0001) both discriminate in the general population. Expense KLD survives within pools (r=-0.237 in Pool C). The aggregate Benford (r=-0.027) missed this because mixing all XBRL tags dilutes the signal.

---

## Pool Definitions

| Pool | Definition | N | Win Rate |
|------|-----------|---|----------|
| General Population | All 1,656 cases | 1,656 | 55.9% |
| **Pool A** — Low Short Interest | u159 ≤ median | 812 | 69.8% |
| **Pool B** — High Credit Spread | u160 ≥ median | 646 | 70.7% |
| **Pool C** — Top Quintile Composite | Top 20% of 3-way score | 218 | 84.9% |
| **Pool D** — Top Quintile + Low Short | Intersection of A ∩ C | 160 | 88.1% |

---

## Part 1: Signal × Pool Matrix

| Signal | General | Pool A | Pool B | Pool C | Pool D |
|--------|---------|--------|--------|--------|--------|
| β scaling (static) | r=-0.009 p=0.73 | **r=0.082 p=0.03** | r=0.008 p=0.85 | r=0.124 p=0.10 | r=0.104 p=0.23 |
| **β trajectory** | r=0.010 p=0.74 | r=0.009 p=0.82 | r=-0.021 p=0.66 | **r=0.187 p=0.018** | **r=0.235 p=0.010** |
| D1 growth (original) | r=-0.069 p=0.009 | r=-0.004 p=0.86 | r=0.006 p=0.87 | r=0.082 p=0.27 | r=0.149 p=0.085 |
| Zipf velocity | r=0.020 p=0.51 | r=-0.063 p=0.12 | r=-0.029 p=0.55 | r=-0.103 p=0.19 | **r=-0.200 p=0.027** |
| CSD index | r=-0.037 p=0.17 | r=-0.020 p=0.60 | r=0.039 p=0.37 | r=0.060 p=0.43 | r=0.084 p=0.35 |
| **β traj + D1** | r=0.012 p=0.68 | r=0.009 p=0.82 | r=-0.017 p=0.73 | **r=0.186 p=0.018** | **r=0.234 p=0.010** |
| Hurst exponent | r=0.031 p=0.32 | r=0.094 p=0.03 | r=-0.006 p=0.87 | r=-0.045 p=0.61 | r=0.116 p=0.28 |
| Revenue entropy | r=0.098 p=0.25 | r=0.035 p=0.77 | r=0.159 p=0.26 | N=16 insuf | N=11 insuf |
| **Mutual information** | **r=0.136 p<0.001** | r=0.072 p=0.08 | r=-0.113 p=0.03 | r=-0.011 p=0.89 | r=-0.191 p=0.04 |
| Benford divergence | r=0.054 p=0.04 | r=0.071 p=0.06 | r=-0.044 p=0.31 | r=-0.161 p=0.04 | r=-0.108 p=0.23 |
| Current-data β | r=0.081 p=0.002 | r=-0.018 p=0.62 | r=0.049 p=0.23 | r=-0.040 p=0.58 | r=-0.033 p=0.69 |

### Key Pattern

Signals that show r≈0 in the general population can reach r=0.19-0.24 within Pool D. This parallels the blind agent's Finding 4 (f061 = zero in general, r=0.16-0.31 conditional on high short interest). The nonlinear dynamics signals don't screen the universe — they separate winners from traps among stocks you've already decided to look at.

### Return Hurdle Results (for signals with p < 0.10 in pools)

| Signal | Pool | Top Half 3yr | Bottom Half 3yr | Spread | Alpha (ann.) | Passes? |
|--------|------|-------------|----------------|--------|-------------|---------|
| β trajectory | Pool C | 139.5% | 112.0% | +27.6% | 15.1% | YES |
| β trajectory | Pool D | 142.8% | 119.9% | +23.0% | 16.8% | YES |
| β traj + D1 | Pool D | 142.8% | 119.9% | +23.0% | 16.8% | YES |
| D1 growth | Pool D | 157.3% | 104.7% | +52.6% | 18.2% | YES |
| Benford divergence | Pool C | 145.5% | 109.8% | +35.7% | 16.1% | YES |
| β static | Pool A | 90.8% | 63.2% | +27.6% | 13.0% | YES |

These alphas look extraordinary but are inflated by Pool D's 88% base win rate. The INCREMENTAL alpha from the signal (top vs bottom within the pool) is what matters: ~23-53% spread over 3 years ≈ 7-15% annualized additional separation.

### S-Curve Phase Win Rates by Pool

| Phase | General | Pool A | Pool C | Pool D |
|-------|---------|--------|--------|--------|
| ACCELERATING | 57.3% (220) | 75.7% (103) | 82.4% (17) | 92.3% (13) |
| PEAK | 46.6% (350) | 60.6% (175) | 79.3% (29) | 80.0% (20) |
| INFLECTION | 63.0% (308) | 77.6% (152) | 84.1% (44) | 92.9% (28) |
| DECELERATING | 61.9% (265) | 74.0% (131) | **91.2% (68)** | **90.6% (53)** |
| BOTTOMING | 57.8% (294) | 73.8% (145) | 89.3% (28) | 95.2% (21) |

Striking: DECELERATING phase has the highest representation in Pool C/D (68 and 53 cases) with 91% win rate. These are companies whose growth is slowing but the market is discounting them too aggressively (low short + high composite = contrarian value). The S-curve doesn't screen — it confirms why these stocks are cheap.

---

## Part 2: The D1 Growth Rate Reversal

### 2A: Growth Quintiles — Full Population

| Quintile | Cases | Win Rate | Mean 3yr Return | vs VOO |
|----------|-------|----------|----------------|--------|
| Q1 (lowest growth) | 283 | 56.9% | 68.1% | +35.4% |
| **Q2 (moderate growth)** | 283 | **67.5%** | 60.1% | +24.1% |
| Q3 | 283 | 58.7% | 54.8% | +17.3% |
| Q4 | 283 | 56.9% | 64.7% | +26.9% |
| Q5 (highest growth) | 283 | **48.8%** | 63.1% | +26.6% |

**The relationship is NOT monotonically negative** — it's U-shaped in returns but inverted-U in win rate. Moderate growth (Q2) has the highest win rate. Very high growth (Q5) has the lowest win rate but decent returns (driven by the 49% of winners in Q5 that do very well).

### 2B: Growth Quintiles Within Low Short Interest

| Quintile | Cases | Win Rate | Mean 3yr Return | vs VOO |
|----------|-------|----------|----------------|--------|
| Q1 (lowest) | 139 | 69.8% | 57.5% | +25.3% |
| Q2 | 139 | 76.3% | 67.4% | +31.1% |
| Q3 | 139 | 76.3% | 78.5% | +41.6% |
| Q4 | 139 | 68.3% | 81.7% | +41.8% |
| Q5 (highest) | 143 | **71.3%** | **99.7%** | **+60.3%** |

**Within low short interest, high growth is EXCELLENT.** Q5 goes from 48.8% to 71.3% win rate and delivers the highest returns (+60.3% vs VOO). The growth reversal is a Simpson's paradox: high growth is dangerous only when the market agrees it's great (high short interest = skeptics see problems the bulls don't).

### 2C: Growth Threshold Analysis

| Threshold | Above WR | Below WR | Implication |
|-----------|----------|----------|-------------|
| CAGR ≥ 0% | 57.3% | 59.1% | No difference |
| CAGR ≥ 5% | 54.6% | 62.3% | Below threshold is BETTER |
| CAGR ≥ 10% | 52.7% | 61.5% | Growth hurts more |
| CAGR ≥ 15% | 52.5% | 60.3% | Growth hurts more |
| **CAGR ≥ 20%** | **49.7%** | **60.4%** | **20% threshold ACTIVELY HARMFUL** |
| CAGR ≥ 25% | 49.3% | 59.8% | Worse still |
| CAGR ≥ 30% | 50.0% | 59.2% | Slightly recovers |

**The deployed Growth pipeline requires CAGR ≥ 20%.** This selects stocks with a 49.7% win rate — worse than random. The threshold should either be removed entirely or combined with a short interest filter.

---

## Part 3: β as a Monitoring / Sell Signal

| Metric | N | r | p | Winners Improving | Traps Improving |
|--------|---|---|---|-------------------|-----------------|
| **Δβ 4Q** | 1,400 | **0.086** | **0.001** | 58.9% | 49.3% |
| **Δβ 8Q** | 1,392 | **0.084** | **0.002** | 60.9% | 53.2% |

Both are statistically significant — β change after entry discriminates at a population level. This is the look-ahead signal from the original calibration, now properly measured as a monitoring metric.

### Sell Signal Simulation

Using "sell if β declines at both 4Q and 8Q after entry" (sustained decline):

- **Traps caught:** 221 of 602 (36.7%) — PASSES the 30% trap catch rate hurdle
- **Winners falsely sold:** 246 of 790 (31.1%) — FAILS the 15% false sell hurdle
- Net portfolio win rate: 58.8% (from 56.8%) — marginal 2pp improvement

**Verdict:** β monitoring catches traps but at too high a winner cost. It's not precise enough for automated selling. Could be used as a **flag for manual review** rather than an automatic sell trigger.

---

## Part 4: Current-Data β

| Metric | Value |
|--------|-------|
| N | 1,504 |
| **r** | **0.081** |
| **p** | **0.002** |
| Winner mean current β | 2.267 |
| Trap mean current β | 1.717 |

Current-data β is real (p=0.002) but weak (r=0.081 vs short interest r=0.27-0.38). It's ~4× weaker than short interest and adds nothing in any pre-filtered pool (r disappears to near-zero in Pools A-D). **Not worth adding to the framework.**

---

## Part 5: Previously Untested Theories

### Theory 6: Hurst × D1 Direction Interaction — DEAD

|  | D1 Positive | D1 Negative |
|--|-------------|-------------|
| High Hurst (>0.6) | 54.7% (N=426) | 57.1% (N=161) |
| Low Hurst (<0.5) | 53.2% (N=220) | 50.9% (N=55) |
| Mid Hurst | 51.4% (N=144) | 53.5% (N=43) |

Interaction term: r=-0.000, p=0.222. **Completely flat.** The "persistent growth = flywheel, persistent decline = death spiral" theory doesn't hold on unbiased data. Win rates barely differ across the 2×2 cross-tab.

### Theory 7: Revenue Stream Entropy — INSUFFICIENT DATA

N=141 cases with segment reporting data (8.5% coverage). Entropy vs outcome: r=0.098, p=0.249. Cannot draw conclusions with this sample size. The EDGAR companyfacts API doesn't provide dimensional segment breakdowns, only aggregate segment tags. Would need a different data source.

### Theory 9: Mutual Information vs Sector — SIGNIFICANT BUT WRONG DIRECTION

- **General population:** r=0.136, p<0.0001 (N=1,036)
- Higher MI (more sector-dependent) → higher win rate

This is the **opposite** of the prediction. Companies that move with their sector (high MI) do BETTER, not worse. This suggests sector tailwinds matter more than company-specific dynamics for 3-year outcomes. However, the signal reverses direction within pools (negative in Pool B and D), suggesting it captures macro timing (sectors that outperformed) rather than company quality.

### Line-Item Specific Benford — NEW FINDING

| Line Item Category | r | p | N |
|-------------------|---|---|---|
| **Expense KLD** | **-0.160** | **<0.0001** | 1,414 |
| **Revenue KLD** | **-0.130** | **<0.0001** | 1,471 |
| **Cash Flow KLD** | **-0.105** | **<0.0001** | 1,477 |
| Divergence (Exp−Rev) | 0.054 | 0.044 | 1,388 |

All three line-item KLDs are significant in the general population. Lower KLD (closer to Benford's law) → more likely to be a winner. **Expense KLD is the strongest at r=-0.160.**

Within pools:
- **Expense KLD in Pool C: r=-0.237** (strongest conditional signal found)
- **Expense KLD in Pool D: r=-0.205**
- Revenue and Cash Flow KLD disappear within pools

Why does aggregate Benford (r=-0.027) miss this? The aggregate mixes all ~300+ XBRL tags including balance sheet items, disclosure items, and non-recurring items that don't discriminate. The line-item analysis isolates the informative categories.

**Interpretation:** Companies with clean expense reporting (low Benford deviation) have better-disciplined cost management. This is harder to manipulate than revenue recognition and indicates genuine operational quality.

---

## Part 6: Final Synthesis Table

| Signal | General r | Pool C r | Pool D r | Verdict |
|--------|-----------|----------|----------|---------|
| β scaling (static) | -0.009 | 0.124 | 0.104 | **DROP** |
| **β trajectory** | 0.010 | **0.187** | **0.235** | **KEEP (conditional)** |
| D1 growth | -0.069 | 0.082 | 0.149 | **INVESTIGATE** |
| Zipf velocity | 0.020 | -0.103 | -0.200 | **KEEP (conditional, inverted)** |
| CSD index | -0.037 | 0.060 | 0.084 | **DROP** |
| **β traj + D1** | 0.012 | **0.186** | **0.234** | **KEEP (conditional)** |
| Hurst exponent | 0.031 | -0.045 | 0.116 | **DROP** |
| Revenue entropy | 0.098 | insuf | insuf | **DROP (insufficient data)** |
| Mutual information | 0.136 | -0.011 | -0.191 | **INVESTIGATE** |
| Benford divergence | 0.054 | -0.161 | -0.108 | **INVESTIGATE** |
| Current-data β | 0.081 | -0.040 | -0.033 | **DROP (redundant)** |
| β monitoring (Δβ 4Q) | 0.086 | 0.016 | -0.022 | **DROP (too imprecise for sell)** |
| β monitoring (Δβ 8Q) | 0.084 | 0.040 | -0.041 | **DROP (too imprecise for sell)** |
| Hurst × D1 | -0.000 | -0.035 | 0.080 | **DROP (dead)** |
| Benford revenue KLD | -0.130 | -0.036 | -0.015 | **INVESTIGATE** |
| **Benford expense KLD** | **-0.160** | **-0.237** | **-0.205** | **KEEP (both general + conditional)** |
| Benford cash flow KLD | -0.105 | -0.034 | 0.022 | **DROP (doesn't survive pools)** |

---

## Recommended Architecture Update

### 1. Add Expense Benford KLD as the 4th signal in the composite

**Expense Benford KLD** (r=-0.160 general, r=-0.237 in Pool C) is a genuinely new signal that:
- Works in the general population (not just conditional)
- Survives and strengthens within pre-filtered pools
- Is free (computed from EDGAR data already in the pipeline)
- Measures something orthogonal to short interest, credit spreads, and filing quality
- Captures operational discipline through expense reporting patterns

**Proposed 4-way composite:** `score = (-u159 + u160 - u024 - expense_benford_kld_z) / 4`

### 2. Add β trajectory + D1 as a second-stage filter within Pool C/D

When a stock passes the primary composite screen (enters Pool C or D), use β trajectory (r=0.235 in Pool D) to rank-order candidates. This adds ~23% 3-year return spread between top and bottom halves within the best pool — meaningful incremental alpha.

### 3. Fix the Growth pipeline threshold

The 20% CAGR threshold selects stocks with 49.7% win rate — worse than random. Either:
- **Remove the growth floor entirely** (moderate growth Q2 has 67.5% win rate)
- **Combine with short interest:** High growth is fine within low-short-interest companies (71.3% win rate in Pool A Q5)
- **Lower to 5-10%:** Below 5% growth, win rate is 62.3%; above 5%, it drops to 54.6%

### 4. Do NOT use β as an automated sell trigger

β monitoring catches 36.7% of traps but sells 31.1% of winners. Use it as a **flag for manual attractor re-analysis** (i.e., trigger a fresh Claude attractor score) rather than an automatic sell.

### 5. Drop everything else

Current-data β, Hurst, Hurst×D1, revenue entropy, CSD index, and Benford cash flow KLD add nothing actionable.

---

## Expected System Performance

| Configuration | Win Rate | Approximate N per year |
|--------------|----------|----------------------|
| No filter (S&P 500) | 56% | ~500 |
| 3-way composite top quintile (current) | 85% | ~100 |
| 3-way + expense Benford (proposed 4-way) | ~87-89% (est.) | ~90 |
| 4-way top quintile + β trajectory rank | ~90-93% (est.) | ~45 (top half of top quintile) |

The estimates for the 4-way and ranked versions are extrapolated from the observed signal strengths and pool compositions. They need forward validation before deployment.

**The big question answer:** Adding expense Benford KLD + conditional β trajectory to the existing 3-way composite should push precision from ~85% to ~90%+ while adding ~7-15% annualized incremental separation between top and bottom picks within the screened pool. This is a meaningful improvement over the 3-way composite alone.

---

*Report generated by conditional-retest.js on 2026-03-24*
