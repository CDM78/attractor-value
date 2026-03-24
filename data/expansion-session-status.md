# Dataset Expansion — Final Session Status
Updated: 2026-03-24

## Dataset Summary
- **719 total cases** (target was 500+)
  - Tier 1-4 (original): 292 cases
  - Tier 5 (S&P 500 expansion): 263 cases
  - Tier 6 (multi-entry dates): 164 cases
- **Outcomes**: 297 winners, 194 traps, 159 underperform, 69 mixed
- **445 unique tickers** across all tiers

## Sources Completed
- Source 1: S&P 500 constituent changes 2010-2024 (263 cases) ✓
- Source 2: Russell 2000→1000 promotions (not available — no free data source found)
- Source 3: Multiple entry dates for existing companies (164 cases) ✓

## Signal Robustness at 719 Cases

| Signal | 292 cases | 719 cases | Status |
|--------|-----------|-----------|--------|
| D1 growth rate | r=0.331, p<0.001 | r=0.285, p<0.001 | **ROBUST** |
| Zipf velocity | r=0.239, p=0.004 | r=0.282, p<0.001 | **ROBUST** (improved!) |
| β trajectory | r=0.259, p=0.001 | r=0.169, p=0.0003 | **ROBUST** (weakened) |
| β level (assets) | r=0.267, p=0.0006 | r=0.069, p=0.14 | **FAILED** |
| β level (equity) | r=0.299, p=0.0001 | ~marginal | **WEAKENED** |
| Hurst exponent | r=0.183, p=0.021 | r=0.021, p=0.71 | **FAILED** |
| Mutual information | r=0.181, p=0.023 | r=0.069, p=0.23 | **FAILED** |
| CSD index | directional | r=0.015, p=0.74 | **FAILED** |
| Best pair (Zipf+D1) | — | r=0.312, p<0.001 | **BEST COMBO** |

## Interpretation
The expansion reveals that only 3 signals are genuinely robust:
1. **D1 growth rate** (revenue momentum) — strongest individual signal
2. **Zipf rank velocity** (competitive position trajectory) — actually improved with more data
3. **β trajectory** (scaling improvement over time) — weakened but still significant

The static β level, Hurst exponent, mutual information, and CSD were
sample artifacts that disappeared with a larger, more diverse dataset.
The best deployment strategy uses Zipf velocity + D1 growth as the
primary quantitative gate (r=0.312).

## Cross-Validation
Still only 1/5 folds significant on β. The cross-validation concern
from the original deep test remains unresolved for β. However, D1 growth
and Zipf velocity were not originally cross-validated — they should be
tested next.
