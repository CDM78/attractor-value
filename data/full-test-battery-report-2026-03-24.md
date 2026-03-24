# Full Test Battery Report — Tests 10-41
**Date:** 2026-03-24
**Dataset:** 719 cases (467 winner/trap), 445 unique tickers, 6 tiers
**Benchmark:** Zipf velocity + D1 growth (r=0.312, p<0.0001)

---

## Executive Summary

21 tests implemented and run on the 719-case expanded dataset. **13 passed** (p<0.05), **7 failed**, **1 skipped** (external data needed). The strongest new signal is **dissipative efficiency** (Test 20, r=0.287) — nearly matching D1 growth rate (r=0.285) as an individual discriminator. Several novel signals add unique information not captured by existing signals.

---

## 1. Complete Signal Inventory (p < 0.05)

### Tier 1: Strong Signals (r > 0.20)

| Rank | Signal | Test | Effect r | p-value | N | Direction |
|------|--------|------|----------|---------|---|-----------|
| 1 | **Dissipative efficiency** (rev growth / OpEx growth) | 20 | 0.287 | <0.0001 | 352 | Winners higher |
| 2 | D1 growth rate (baseline) | — | 0.285 | <0.0001 | — | Winners higher |
| 3 | Zipf rank velocity (baseline) | — | 0.282 | <0.0001 | — | Winners climbing |
| 4 | **Revenue growth** (recent vs earlier) | 31 | 0.266 | <0.0001 | 459 | Winners higher |
| 5 | **Scale invariance CV** | 21 | 0.236 | <0.0001 | 453 | Winners lower CV (more consistent) |
| 6 | **Marketing efficiency slope** (Rev/SGA trend) | 39 | 0.226 | 0.0003 | 256 | Winners improving |
| 7 | **DNA net direction** (4D ratio space trajectory) | 36 | 0.222 | <0.0001 | 391 | Winners improving |

### Tier 2: Moderate Signals (r = 0.10-0.20)

| Rank | Signal | Test | Effect r | p-value | N | Direction |
|------|--------|------|----------|---------|---|-----------|
| 8 | **Fracture toughness** (stress response) | 26 | 0.188 | 0.0003 | 377 | Winners LOWER (less stress damage) |
| 9 | Gross margin change | 31 | 0.171 | 0.006 | 263 | Winners higher |
| 10 | β trajectory 12Q (baseline) | — | 0.169 | 0.0003 | — | Winners improving |
| 11 | Recovery rate (stress) | 12 | 0.140 | 0.007 | 377 | Winners higher |
| 12 | **Phase displacement direction** | 16 | 0.136 | 0.008 | 385 | Winners above equilibrium |
| 13 | Fragile fraction | 35 | 0.124 | 0.017 | 372 | Winners lower |
| 14 | **OU θ** (mean-reversion speed) | 23 | 0.124 | 0.008 | 459 | Winners LOWER θ (slower mean-reversion = more persistent) |
| 15 | **Accrual slope** | 32 | 0.120 | 0.010 | 458 | Winners lower |
| 16 | TDA path ratio | 34 | 0.111 | 0.029 | 391 | Winners higher |

### Tier 3: Weak Signals (r = 0.05-0.10)

| Signal | Test | r | p | Note |
|--------|------|---|---|------|
| Conversion slope | 32 | 0.092 | 0.048 | Marginal |
| Skewness | 38 | 0.085 | 0.070 | Below threshold |
| Participation ratio | 24 | 0.084 | 0.091 | Below threshold |

---

## 2. Failed Tests

| Test | Signal | p-value | Why It Failed |
|------|--------|---------|---------------|
| 30: Revenue-Expense Coupling | Coupling gain | 0.320 | No discrimination — most companies have similar cost structure coupling |
| 40: Structural Breaks | CUSUM breaks | N/A | Zero breaks detected with current threshold — needs threshold tuning |
| 38: Temporal Asymmetry | Asymmetry index | 0.754 | No discrimination — financial time series equally irreversible for both groups |
| 24: Fitness Landscape | Coordination index | 0.503 | Marginal only on participation ratio (p=0.09) |
| 33: Percolation | Average degree | 0.621 | Most companies percolated+positive regardless of outcome |
| 19: Spectral Decomposition | SNR, slope α | 0.706-0.831 | No spectral signature difference — growth noise equally distributed |
| 17: Fisher Information | Fisher level | 0.379 | No discrimination — data quality similar across outcomes |

---

## 3. Key Cross-Tabs and Interaction Findings

### Accrual × Benford (Test 32E)
| Pattern | Winners | Traps | Win Rate |
|---------|---------|-------|----------|
| Improving cash + Benford ok | 94 | 44 | **68.1%** |
| Improving cash + Benford bad | 24 | 20 | 54.5% |
| Deteriorating cash + Benford ok | 141 | 82 | 63.2% |
| Deteriorating cash + Benford bad | 27 | 26 | **50.9%** |

"Improving cash conversion + clean Benford" is the best quality signal (68% WR). "Deteriorating + bad Benford" is a strong trap indicator (51% WR).

### Ratchet Pattern (Test 30D)
| Pattern | Winners | Traps | Win Rate |
|---------|---------|-------|----------|
| Anti-ratchet (costs fall aggressively) | 40 | 31 | 56.3% |
| Symmetric | 132 | 89 | 59.7% |
| **Ratchet (costs resist falling)** | **61** | **28** | **68.5%** |

Counterintuitive: ratchet (costs that resist falling) correlates with WINNING, not trapping. This may reflect companies with high fixed-cost moats (infrastructure, R&D) where the cost rigidity IS the barrier to entry.

### Network Effect Candidates (Test 39)
- 66 companies with consistently improving Rev/SGA ratio (slope > 0, R² > 0.3)
- **75.8% win rate** (50W/16T) — strongest categorical signal in the battery

### Quiet Period Breakouts (Test 41)
- 118 cases with 8+ quarter quiet periods detected
- Up breakout: 74.5% WR (41W/14T)
- Down breakout: 80.0% WR (24W/6T) — small N, surprising direction

---

## 4. Redundancy Analysis

Several signals likely measure the same underlying dynamics:

**Recovery Cluster** (expect high inter-correlation):
- Recovery rate (Test 12): r=0.140
- Elastic fraction (Test 26): r=0.035 (weak)
- Antifragile fraction (Test 35): r=0.031 (weak)
- OU half-life (Test 23): r=0.124
- Fracture toughness (Test 26): r=0.188

→ Keep toughness (strongest) and OU θ (most interpretable). Drop recovery rate, elastic fraction, antifragile fraction.

**Growth/Direction Cluster** (expect high inter-correlation):
- D1 growth rate (baseline): r=0.285
- Revenue growth (Test 31): r=0.266
- DNA net direction (Test 36): r=0.222
- Dissipative efficiency (Test 20): r=0.287
- Phase displacement (Test 16): r=0.136

→ D1 growth and dissipative efficiency may be measuring similar things (growing companies have higher efficiency). Need Spearman correlation to confirm.

**Quality Cluster** (may be independent):
- Accrual slope (Test 32): r=0.120
- Gross margin change (Test 31): r=0.171
- Marketing efficiency (Test 39): r=0.226
- Scale invariance (Test 21): r=0.236

→ These may capture different aspects of quality — worth testing combinations.

---

## 5. Recommended Next Steps

### Immediate (this session if time allows)
1. **5-fold cross-validation** on top 10 signals to identify which are robust (4/5 folds)
2. **Spearman correlation matrix** of all 20 passing signals to identify redundancy clusters
3. **Greedy forward selection** starting from Zipf+D1 (r=0.312) to find best 3-4 signal combination

### Next Session
4. Implement Test 10 (Lyapunov) and Test 18 (Transfer Entropy) — computationally expensive, skipped in this run
5. Implement Test 13 (Flywheel Momentum), Test 14 (Ergodicity), Test 15 (Symmetry Breaking), Test 22 (Ecology), Test 25 (Control Theory) — require additional data or sector-wide data
6. Acquire Form 4 data for Test 27 (Adverse Selection) and Test 28 (Information Efficiency)
7. Fix Test 40 (Structural Breaks) — threshold too high, no breaks detected

### Deployment
8. Final combination search with cross-validated robust signals only
9. Vintage simulation with recommended configuration
10. Integration spec for live app

---

## 6. Updated Signal Ranking (All Sources)

| Rank | Signal | Source | r | p | Deployment Ready |
|------|--------|--------|---|---|-----------------|
| 1 | Dissipative efficiency | Test 20 | 0.287 | <0.0001 | Needs CV |
| 2 | D1 growth rate | Baseline | 0.285 | <0.0001 | YES |
| 3 | Zipf rank velocity | Baseline | 0.282 | <0.0001 | YES |
| 4 | Revenue growth | Test 31 | 0.266 | <0.0001 | Likely redundant with D1 |
| 5 | Scale invariance | Test 21 | 0.236 | <0.0001 | Needs CV |
| 6 | Marketing efficiency | Test 39 | 0.226 | 0.0003 | 54% coverage only |
| 7 | DNA net direction | Test 36 | 0.222 | <0.0001 | Needs CV |
| 8 | Fracture toughness | Test 26 | 0.188 | 0.0003 | Needs CV |
| 9 | β trajectory | Baseline | 0.169 | 0.0003 | YES |
| — | **Best pair: Zipf + D1** | — | **0.312** | **<0.0001** | **YES** |

---

## 7. Files

| File | Content |
|------|---------|
| `data/test-battery-results-2026-03-24.json` | Full JSON results for all 21 tests |
| `scripts/full-test-battery.js` | Complete test battery implementation |
| `scripts/lib/edgar-extractor.js` | Extended with 8 new XBRL fields |
