# AV Framework — Enhancement Backlog

Last updated: 2026-03-20
Source: Calibration study (30-case backtest, March 2026)

---

## ~~Priority 1: Franchise Quality ROE Modifier for P/E × P/B~~ ✅ DONE (2026-03-20)

Implemented ROE-based P/E×P/B ceiling modifier in both Workers screening engine and calibration tool. ROE 20-30%: ceiling × 1.25, ROE 30%+: ceiling × 1.50. AXP now passes P/E×P/B (55.96 vs ceiling 60 with ROE 30%). No traps admitted.

---

## ~~Priority 2: Live Re-Screen Mode~~ ✅ DONE (2026-03-20)

All three tiers implemented:
- **Price check**: `GET /api/price-check?ticker=CB` (existing, enhanced with confidence bands)
- **Re-screen**: `GET /api/price-check?ticker=CB&mode=rescreen` — live Layer 1 + Layer 2 with EDGAR BVPS, read-only
- **Full refresh**: `GET /api/price-check?ticker=CB&mode=full` — re-screen + new attractor analysis

---

## ~~Priority 3: Attractor Analysis Test Suite~~ ✅ DONE (2026-03-20)

Test harness created (`scripts/attractor-trap-harness.js`). All 6 trap cases run and validated:
- **INTC**: 1.0/5.0 Dissolving, advanced disruption (4/5), caught AMD/TSMC/foundry failure
- **M**: 1.0/5.0 Dissolving, advanced disruption, caught e-commerce/Amazon/mall decline
- **WBA**: 1.0/5.0 Dissolving, advanced disruption (5/5), caught PBM consolidation/Amazon Pharmacy/reimbursement
- **WFC**: 1.0/5.0 Dissolving, caught scandal/regulatory/consent order/asset cap
- **T**: 1.0/5.0 Dissolving, advanced disruption, caught DirecTV/debt/cord-cutting
- **KHC**: 1.0/5.0 Dissolving, caught brand erosion/writedowns

The attractor layer correctly rejects all 6 traps that the quant screen would have let through.

---

## ~~Priority 4: Outcome-Based Confidence Bands~~ ✅ DONE (2026-03-20)

Implemented in reports, price-check, and calibration tool:
- **STRONG**: price ≤ 90% of buy-below
- **STANDARD**: price ≤ buy-below
- **MARGINAL**: price within 5% above buy-below

---

## ~~Priority 5: Mixed Outcome Classification~~ ✅ DONE (2026-03-20)

ALLY (-3%), VZ (-30%), USB (-10%) reclassified as "mixed" in calibration dataset. Scorer excludes mixed from precision/recall, tracks separately. Dataset now: 12 winners, 15 traps, 3 mixed.
