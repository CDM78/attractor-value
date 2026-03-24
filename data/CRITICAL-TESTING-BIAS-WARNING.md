# CRITICAL: Curated Dataset Testing Bias — Read Before Using Any Test Results

**Date discovered:** 2026-03-24
**Severity:** HIGH — Invalidates all quantitative signal effect sizes from curated testing

---

## The Problem

Tests 1-59 were developed and validated on a **curated dataset** (Tiers 1-6, 719 cases) where winners and traps were hand-selected as clear examples of business success and failure. This created a severe selection bias: the signals easily separated extreme endpoints (SHOP at $120 vs INTC in competitive collapse) but this discrimination has **zero predictive value** on real-world stock selection.

When the work computer rebuilt the dataset systematically — taking EVERY S&P 500 company at specific dates and classifying by actual 3-year returns — **every signal collapsed to near-zero effect size:**

| Signal | Curated r | Systematic r | Status |
|--------|-----------|-------------|--------|
| Flywheel Momentum | 0.331 | 0.050 | COLLAPSED |
| D1 growth rate | 0.285 | 0.042 | COLLAPSED |
| Zipf rank velocity | 0.282 | 0.103 | WEAKENED |
| Revenue growth | 0.267 | 0.065 | COLLAPSED |
| Scale invariance | 0.241 | 0.086 | WEAKENED |
| FM + D1 pair | 0.397 | 0.047 | COLLAPSED |

**None achieved 4/5 cross-validation folds on the systematic dataset.**

---

## Dataset Classification

### CURATED (Tiers 1-6) — DO NOT use for signal validation

| Tier | Source | Problem |
|------|--------|---------|
| 1: Stable Value | Hand-picked clear winners/traps | Selection bias |
| 2: Crisis/Dislocation | Hand-picked crisis entries | Selection bias |
| 3: Emerging DKS | Hand-picked growth/trap cases | Selection bias |
| 4: Regime Transition | Hand-picked regime shifts | Selection bias |
| 5: S&P 500 Changes | Index additions/removals | Survivorship + selection bias |
| 6: Multi-Entry Dates | Re-entries for Tier 1-4 tickers | Inherits Tier 1-4 bias |

**These datasets are valid for:**
- Understanding what winners and traps look like (descriptive)
- Testing whether the attractor score correctly classifies known cases
- Developing intuition about signal direction

**These datasets are NOT valid for:**
- Measuring effect sizes (r values are inflated 3-7x)
- Cross-validation (curated extremes pass CV that random samples wouldn't)
- Claiming any signal "works" for stock selection
- Comparing signals to each other (all inflated by the same bias)

### SYSTEMATIC (data/systematic-*.json) — Use for all future validation

| Source | File | Cases | Method |
|--------|------|-------|--------|
| S&P 500 cross-section 2013 | systematic-sp500-crosssection-2013.json | 373 | Every company in index |
| S&P 500 cross-section 2016 | systematic-sp500-crosssection-2016.json | 399 | Every company in index |
| S&P 500 cross-section 2019 | systematic-sp500-crosssection.json | 433 | Every company in index |
| S&P 500 cross-section 2022 | systematic-sp500-crosssection-2022.json | 468 | Every company in index |
| S&P 500 changes | systematic-sp500-changes.json | 263 | Index additions/removals |
| Small-cap | systematic-smallcap.json | 169 | Systematic selection |
| ADR/International | systematic-adr.json | 100 | IFRS filers |
| Multi-entry | systematic-multi-entry.json | 596 | Systematic re-entries |
| Fraud | systematic-fraud.json | 31 | Confirmed SEC/fraud cases |

**Total systematic cases: 2,832**

---

## Rules for Future Testing

1. **ALL signal validation must use the systematic dataset.** Never validate on curated tiers 1-6 alone.

2. **Effect sizes from curated testing are invalid.** Do not cite r=0.331 for Flywheel Momentum. The real effect is r=0.050.

3. **Cross-validation on curated data is meaningless.** 4/5 folds on 719 curated cases does not mean the signal works. It means the curation was consistent across random splits.

4. **The only valid CV is on systematic data.** A signal that achieves 4/5 folds on the 1,592-case systematic dataset is genuinely robust.

5. **Report curated results only as "descriptive" or "exploratory."** They show what's different about extreme cases, not what predicts returns.

6. **The `loadCalibrationCases()` function loads curated data. The `loadSystematicCases()` function loads systematic data.** Use the right one.

---

## What Still Works

- **The Graham screen** (valuation filter) — not tested on curated data, uses price ratios
- **The attractor analysis** (AI moat assessment) — qualitative, not ratio-based
- **The vintage simulation** — used real buy signals, not curated cases (but should be re-validated)
- **Zipf velocity** — the only signal with marginal significance (p=0.004, r=0.103) on systematic data, though it failed CV

## What Doesn't Work

- Every quantitative signal tested in Tests 1-59 as a standalone stock picker
- The FM + D1 pair as a replacement for attractor analysis
- Any claim that quantitative signals can replace the AI analysis at $0 cost

---

## How This Was Discovered

The work computer couldn't pull the curated tier files from the av-calibration-tool repo. It was forced to reconstruct the dataset from scratch using systematic methods. When it re-ran the signals on this unbiased dataset, everything collapsed. The accident of a failed data transfer revealed a fundamental methodological flaw.
