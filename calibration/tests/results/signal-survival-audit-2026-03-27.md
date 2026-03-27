# Signal Survival Audit — Corrected

**Date**: 2026-03-27

## What Actually Survives Proper Methodology

Criteria: Pearson on continuous returns, all outcome classes included, de-duplicated
to unique companies, Newey-West correction for overlapping returns where applicable.

| Signal | r | p | n | Method | Status |
|--------|---|---|---|--------|--------|
| SI CSD | 0.119 | 0.005 | 554 unique companies | Pearson, continuous, de-duped | VALIDATED |
| spread_variance (1yr macro timing) | 0.594 | 0.001 NW | ~96 OOS months | Pearson, Newey-West | VALIDATED (1yr horizon only) |

## What Was Removed and Why

| Signal | Claimed r | Actual | Problem |
|--------|-----------|--------|---------|
| Crawler enrichment | 0.455 | ~0.183 Pearson | Spearman on categoricals, not comparable to continuous r-values |
| Insider net direction | 0.485 | -0.050 | Collapsed after de-duplication; AVTR outlier not excluded |
| Job 2 (Opus AI) | 0.316 | -0.294 blinded | Identity contamination — Opus recognizes S&P 500 companies |
| BUY composite | 0.134 | N/A | Spearman on winner/trap only; both component signals dead on mid-caps |
| Job 2 keyword heuristic | 0.219 | p=0.444 win rate | Spearman on synthetic 4-level encoding; actual win rate delta not significant |

## Pending

- Job 2 retest with fixed parser (n=150, seed=73) — scripts committed, results not yet in
- Crawler Pearson on continuous returns — needs formal test
