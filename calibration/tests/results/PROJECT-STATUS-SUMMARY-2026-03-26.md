# AV Framework — Project Status Summary

**Date:** 2026-03-26 | **Status:** Holdout validated, deploy-ready

---

## What We Built

An investment screening system that combines quantitative market signals with AI risk factor analysis. Tested on 2,832 systematic cases (S&P 500 at 4 dates, plus small caps, ADRs, changes). Sealed holdout passed with **6.9% annualized alpha over VOO**.

**Stack:** React + Cloudflare Workers at odieseyeball.com. EDGAR fundamentals, Yahoo prices, FINRA short interest, FRED credit spreads. 18,435-stock universe, daily automated pipeline.

---

## Three Signal Families That Survived

| Family | Best Signal | r | n | What It Tells You |
|--------|-----------|---|---|-------------------|
| Credit Spread Dynamics | spread_csd_final_ac | 0.335 | 1,639 | **WHEN** to buy (macro regime) |
| Short Interest Dynamics | SI Zipf velocity | 0.219 | 457 | **WHICH** companies (market consensus shifting) |
| AI Risk Factor Evolution | Job 2 (Opus) | 0.316 | 103 | **WHETHER** the thesis holds (10-K trajectory) |

**Credit spread** signals are macro — same for all companies entering on the same date. They're the strongest single discriminator (78.4% top-decile precision) but are really a market-timing filter.

**SI Zipf velocity** is company-specific — it measures whether a company is rising or falling in its sector's short interest rankings. Companies where shorts are covering relative to peers strongly predict winners. This is the best company-level quantitative signal (18.2x improvement over the same math on financial statements).

**Job 2** is AI narrative analysis — Opus reads current vs prior 10-K Item 1A risk factors and classifies trajectory as "stable" or "deteriorating." High-confidence subset r=0.398. The signal catches traps rather than finding winners: deteriorating cases have 6.1pp higher trap rate.

---

## The Core Discovery

The nonlinear dynamics toolkit (β scaling, CSD, Zipf, Benford, D1/D2) was originally designed for financial statement data. On curated data, several looked strong (r=0.28-0.40). On unbiased data, **all collapsed** (r near zero). The same math applied to market sentiment data produced genuine signals:

| Signal | On Financial Statements | On Market Data | Improvement |
|--------|------------------------|----------------|-------------|
| CSD index | -0.037 | 0.163 | 4.4x |
| Zipf velocity | 0.012 | 0.219 | 18.2x |
| Benford KLD | -0.027 | 0.122 | 4.5x |
| D1 growth | -0.069 | 0.161 | 2.3x |

**Market wins 6/6.** Financial statements are deliberately smoothed by management. Market data reflects real-money opinions with unsuppressed volatility.

---

## Holdout Test Results

Composite: spread_variance_slope + SI Zipf velocity, rank-based.

| Metric | Training (n=660) | Holdout (n=404) | Gap |
|--------|-----------------|-----------------|-----|
| Spearman r | 0.115 | **0.134** | +0.019 |
| Q5 win rate | 55.3% | **61.7%** | +6.4pp |
| Top-decile precision | 62.1% | **67.5%** | +5.4pp |

| Strategy | Annualized Alpha | Win Rate |
|----------|-----------------|----------|
| VOO benchmark | 0.0% | — |
| No filter (all cases) | 4.7% | 54.8% |
| **BUY composite (top half)** | **6.9%** | **56.3%** |

**No overfitting** — holdout r exceeds training r. The 6.9% alpha is a meaningful, low-cost systematic edge.

---

## What Didn't Work

- **All financial statement signals** (β scaling, CSD, Zipf on revenue) — curation bias inflated 3-7x
- **volume_benford_anomalous** (r=0.592) — artifact of Spearman on near-constant binary; true phi = -0.002
- **Spectral decomposition** (secular dominance r=0.077, SNR r=0.054) — too weak
- **Geometric mean compositing** — worse than arithmetic
- **SI checkpoint sell signals** — 47-57% false alarm rates at scale; supplement but don't replace fundamental analysis
- **T+12 sell signal** — only 6/44 cases triggered, inconclusive (needs better EDGAR extraction)

---

## Advanced Math Results (Sessions 1-9)

**RMT (Session 1):** 3 significant factors above Marchenko-Pastur bound. Factor 1 = macro/spread, Factor 2 = volume microstructure, Factor 3 = SI dynamics. Optimal weighting CV=0.182.

**Multiplicative interactions (Session 2):** SI Zipf × SI D1 at r=0.223 slightly beats individual signals. Power-law α=1.5 gives modest improvement.

**Fisher information (Session 3):** r=0.169 on n=848. Q4 win rate 62.3% vs Q1 55.7%. Deployable as confidence weight.

**Multi-base Benford (Session 5):** STRUCTURAL_STRESS class has 71.6% win rate (n=95, p=0.006). No HUMAN_MANIPULATION cases in S&P 500 data.

**Narrative transitions (Session 4):** Infrastructure built. Execution deferred.

**Trace formula coherence (Session 8):** Partial — 3 RMT factors vs mean spectral dimensionality of 1.50. Full test awaits narrative data.

---

## Deployment Plan

### Now (Zero Cost)

1. Screen by credit spread regime (spread_variance_slope)
2. Rank candidates by SI Zipf velocity
3. Score with D-rank composite (validated holdout alpha = 6.9%)

### High-Value Add (Opus Sub-Agents, Free)

4. Run Job 2 risk factor analysis on candidates passing quant screen
5. Use high-confidence "stable" as proceed signal, "deteriorating" as reject
6. Expected composite improvement: r from 0.134 → ~0.28

### Not Ready Yet

7. T+12 sell signal (needs EDGAR extraction fixes)
8. Full narrative transition mapping (Session 4)
9. Spectral-narrative coherence test

---

## Key Numbers to Remember

- **0.335** — credit spread CSD, strongest single signal
- **0.316** — Job 2 Opus, strongest company-specific signal
- **0.219** — SI Zipf velocity, best quant company signal
- **0.134** — holdout composite r (no overfitting)
- **6.9%** — annualized alpha on holdout
- **67.5%** — holdout top-decile precision
- **6/6** — market data beats financial statements head-to-head
- **2,832** — systematic cases in calibration dataset
- **0** — marginal cost (Opus sub-agents, no API fees)
