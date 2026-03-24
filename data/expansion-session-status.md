# Dataset Expansion — Session Status
Updated: 2026-03-24

## Completed
- Phase 1: Parsed 537 candidates from S&P 500 constituent changes 2010-2024
- Phase 2: EDGAR pull for 537 tickers (290 ok, 247 failed/delisted)
- Phase 3: Yahoo Finance forward returns (281 ok, 256 failed/no data)
- Phase 4: Classified 263 cases (77 winners, 90 traps, 70 underperform, 26 mixed)
- Phase 5: Built tier5-sp500-expansion.json, updated calibration-data.js loader
- Re-ran all deep tests (1-4) and expanded theories (6-9) on 473-case dataset

## Key Finding: Signal Dilution
The expanded dataset WEAKENED most signals:
- β(assets): p=0.0006 → p=0.056 (no longer significant)
- β(equity): p=0.0001 → p=0.004 (still significant, best denominator)
- Cross-validation: 2/5 → 1/5 folds (worse, not better)
- Hurst, MI: PASS → FAIL on expanded dataset
- D1 growth (p<0.0001) and Zipf velocity (p<0.0001) remain strong
- β trajectory (p=0.001) still significant
- Best pair shifted: β traj+D1 → Zipf vel+D1 (r=0.357)

## Interpretation
The S&P 500 expansion cases are primarily large-cap companies where
non-linear dynamics signals behave differently. The original 292-case
dataset was biased toward mid-cap and small-cap opportunities where
DKS flywheels are more detectable. The signals that survive the
expansion (D1 growth, Zipf velocity, β equity, β trajectory) are
genuinely robust across market caps.

## Remaining Work
- Source 2: Russell 2000→1000 promotions (not yet attempted)
- Source 3: Multiple entry dates for existing companies (not yet attempted)
- Vintage simulation with surviving signals
