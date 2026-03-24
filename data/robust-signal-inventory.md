# Robust Signal Inventory — REVISED
**Revised:** 2026-03-24 | **Status:** ALL SIGNALS INVALIDATED on systematic data

---

## !! SEE data/CRITICAL-TESTING-BIAS-WARNING.md !!

All effect sizes below were measured on a **curated** dataset with severe selection bias. When re-tested on the systematic 1,592-case dataset, every signal collapsed. These numbers are retained for historical reference only.

---

## CURATED DATASET RESULTS (INVALID — historical reference only)

| Signal | Curated r | Curated CV | Systematic r | Systematic CV | Real Status |
|--------|-----------|------------|-------------|--------------|-------------|
| Flywheel Momentum | 0.331 | 4/5 | 0.050 | 0/5 | **INVALID** |
| D1 growth rate | 0.285 | 4/5 | 0.042 | 2/5 | **INVALID** |
| Zipf rank velocity | 0.282 | 4/5 | 0.103 | 1/5 | **MARGINAL** |
| Revenue growth | 0.267 | 4/5 | 0.065 | 2/5 | **INVALID** |
| Scale invariance CV | 0.241 | 4/5 | 0.086 | 1/5 | **MARGINAL** |
| FM + D1 pair | 0.397 | 5/5 | 0.047 | 0/5 | **INVALID** |

## WHAT REMAINS VALID

1. **Graham valuation screen** — not affected (uses market prices, not curated outcomes)
2. **Attractor analysis (Claude AI)** — not affected (qualitative moat assessment)
3. **The app's deployed pipeline** — needs re-validation on systematic data but wasn't built on the curated signals

## WHAT TO DO NEXT

1. Re-validate the full app pipeline (Graham + attractor + valuation) using the systematic dataset
2. If Zipf velocity (r=0.103, p=0.004) holds up on a larger systematic sample, it may serve as a weak but real supplementary signal
3. Do NOT deploy any quantitative signal as a hard gate based on curated test results
