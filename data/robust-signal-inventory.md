# Robust Signal Inventory — Definitive Deployment List
**Validated:** 2026-03-24 | **Dataset:** 719 cases | **Standard:** 5-fold CV, 4/5 folds significant

---

## Confirmed Robust Signals (4/5+ CV folds)

| Rank | Signal | Effect r | CV mean r | CV folds | Source |
|------|--------|----------|-----------|----------|--------|
| 1 | **Flywheel Momentum** (assets_rank × ROIC_rank) | 0.331 | 0.321 | 4/5 | Test 13 |
| 2 | **D1 growth rate** (revenue YoY growth) | 0.285 | 0.289 | 4/5 | Test 4 |
| 3 | **Zipf rank velocity** (sector rank trajectory) | 0.282 | 0.276 | 4/5 | Test 5 |
| 4 | **Revenue growth** (4Q vs prior 4Q) | 0.267 | — | 4/5 | Test 31 |
| 5 | **Scale invariance CV** (metric consistency across time horizons) | 0.241 | — | 4/5 | Test 21 |

## Best Robust Combination

| Combination | Effect r | CV folds | Status |
|-------------|----------|----------|--------|
| **Flywheel Momentum + D1 growth** | **0.397** | **5/5** | **DEPLOY** |

This pair achieves r=0.397 with 5/5 cross-validation folds significant — the strongest validated signal in the entire framework.

## Moderate Signal (3/5 CV folds — use directionally, not as hard gate)

| Signal | Effect r | CV folds |
|--------|----------|----------|
| β trajectory 12Q | 0.169 | 3/5 |

## Signals That Failed CV (do NOT deploy as gates)

All other signals from the 26-test battery achieved 0-2/5 CV folds, including: dissipative efficiency (r=0.287 but 2/5 CV), marketing efficiency (r=0.226 but 2/5), DNA direction (r=0.222 but 3/5), fracture toughness, OU theta, recovery rate, phase displacement, accrual slope, TDA path ratio, gross margin change.

## Deployment Recommendation

**Primary gate:** Flywheel Momentum + D1 growth (r=0.397, 5/5 CV)
- Compute for every candidate from EDGAR data ($0 cost)
- Flywheel Momentum = percentile_rank(assets) × percentile_rank(ROIC)
- D1 growth = most recent quarterly revenue YoY growth rate

**Secondary signals** (display, don't gate):
- Zipf rank velocity (requires sector universe data)
- Revenue growth (4Q trend)
- Scale invariance CV (consistency check)
- β trajectory (directional only)

**vs Attractor Score:** The Flywheel Momentum + D1 pair (r=0.397) substantially exceeds the attractor score's discrimination power (~0.26) at $0 computation cost. Recommended as pre-filter before expensive AI analysis.
