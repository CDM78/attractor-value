# Job 2 Retest Report — Anti-Sycophantic Item 1A Analysis

**Date:** 2026-03-27
**Cases:** 150 mid-cap companies ($2B-$8B market cap)
**Entry dates:** 2020-Q3 and 2022-Q1 cross-sections
**Method:** Opus sub-agents with observations-first, CANNOT_ASSESS-enabled prompt
**Data source:** SEC EDGAR 10-K Item 1A (Risk Factors), consecutive annual filings

---

## Phase 4: Stochasticity Test (20 cases x 3 runs)

See: `scripts/test_stochasticity.log`

| Gate | Threshold | Result | Status |
|------|-----------|--------|--------|
| Mean score range | <= 2.0 | **0.12** | PASS |
| Uncertainty agreement | >= 50% | **95%** | PASS |
| CANNOT_ASSESS rate | <= 80% | **5%** | PASS |

**Recommendation:** Single run (low noise). The anti-sycophantic prompt produces highly consistent results across independent evaluations.

---

## Phase 5: Full Run (150 cases)

See: `full-results.csv`

**Uncertainty distribution:**

| Rating | Count | % |
|--------|-------|---|
| CAN_ASSESS | 86 | 57% |
| MARGINAL | 40 | 27% |
| CANNOT_ASSESS | 24 | 16% |

**Scored:** 126/150 (84%)
**Score range:** 1.8 - 4.5
**Score mean:** 2.88

---

## Phase 6: Analysis

### Script 1: AI Judgment Signal

See: `scripts/analyze_scores.log`

**PRIMARY RESULT: Score vs forward_return_3yr**

| Metric | Value |
|--------|-------|
| Pearson r | **-0.146** |
| p-value | **0.101** |
| n | 126 |
| Direction | **NEGATIVE** (wrong sign) |

**5-fold cross-validation:**

| Fold | r | p | n |
|------|------|------|---|
| 0 | -0.173 | 0.397 | 26 |
| 1 | -0.037 | 0.861 | 25 |
| 2 | -0.297 | 0.149 | 25 |
| 3 | -0.126 | 0.547 | 25 |
| 4 | -0.094 | 0.657 | 25 |
| **Mean** | **-0.145** | | |
| **Positive folds** | **0/5** | | |

**CANNOT_ASSESS as signal:**

| Group | n | Mean return | Median | Std |
|-------|---|------------|--------|-----|
| CAN_ASSESS | 86 | 0.190 | 0.061 | 0.636 |
| MARGINAL | 40 | 0.394 | 0.087 | 1.115 |
| CANNOT_ASSESS | 24 | 0.247 | 0.273 | 0.372 |

t-test CAN vs CANNOT: p=0.575 (not significant)

**De-duplication:** 131 unique companies / 150 entries (12.7% duplicate rate)

### Script 2: Observational Signals (No AI Judgment)

See: `scripts/analyze_observations.log`

| Signal | r | p | n |
|--------|------|------|-----|
| Risks removed | -0.085 | 0.300 | 150 |
| Risks added | 0.083 | 0.310 | 150 |
| Word count change | 0.055 | 0.503 | 150 |
| Severity changes | -0.003 | 0.969 | 150 |
| Current risk count | -0.003 | 0.975 | 150 |

**No observational signal achieves significance.** The best (risks removed, r=-0.085) explains <1% of variance.

### Script 3: Verification

See: `scripts/verify.log`

All statistics recomputed from raw CSV. **0 discrepancies > 0.01** between analysis scripts and verification.

---

## Comparison Table

| Metric | Original Job 2 | Blinded Retest (prior) | This Retest |
|--------|---------------|----------------------|-------------|
| Prompt | Standard (prediction-oriented) | Standard (blinded) | Anti-sycophantic (observations-first) |
| Cases | Curated | 24 mid-caps | 150 mid-caps |
| Score r vs returns | r=0.219 (Spearman, binary) | r=-0.294 (Pearson, n=24) | **r=-0.146 (Pearson, n=126)** |
| p-value | 0.444 (chi-sq) | 0.149 | **0.101** |
| CV folds positive | N/A | N/A | **0/5** |
| Methodology | Spearman on synthetic categorical | Pearson on continuous | **Pearson on continuous** |

---

## Answer: AI Judgment or Observable Facts?

**Neither.** The signal is in neither the AI judgment nor the observable facts from Item 1A risk factor comparisons.

- The AI **judgment** score (1.0-5.0 risk trajectory assessment) has a **negative** correlation with forward returns (r=-0.146), meaning companies the AI rated as "improving" actually performed slightly worse. This is not significant (p=0.101) and shows 0/5 positive CV folds.

- The **observable facts** (risks added, removed, severity changes, word count changes) are all non-significant with |r| < 0.09. These pure document-comparison metrics carry no predictive content for mid-cap 3-year returns.

- The **CANNOT_ASSESS** classification is not a signal either (p=0.575 vs CAN_ASSESS).

The anti-sycophantic prompt was highly stable (score range 0.12, 95% uncertainty agreement) — the null result is not due to prompt noise. It is a genuine finding that Item 1A risk factor changes do not predict mid-cap stock returns.

---

## Decision: ABANDON

Item 1A risk factor analysis — whether through AI judgment scoring or through purely observational document comparison — does not produce a deployable signal for mid-cap stock selection.

**Do not:**
- Deploy Job 2 scores as a screening gate
- Use risk factor word count changes as a signal
- Use "number of new risks" as a signal
- Retry with a different prompt — the data source itself lacks predictive content

**The anti-sycophantic prompt design is validated** (low stochasticity, appropriate CANNOT_ASSESS rates, good observations). The failure is in the data source, not the evaluation methodology.

---

## Files

| File | Description |
|------|-------------|
| `selected-cases.csv` | 150 cases with metadata |
| `sub-agent-prompt.md` | Anti-sycophantic evaluation prompt |
| `full-results.csv` | All 150 results with scores and observations |
| `stochasticity-raw.csv` | Phase 4 stochasticity data (20 cases x 3 runs) |
| `full-run-outputs/` | Raw sub-agent outputs (150 files) |
| `stochasticity-outputs/` | Raw stochasticity outputs (50 files) |
| `scripts/analyze_scores.log` | AI judgment analysis |
| `scripts/analyze_observations.log` | Observational signal analysis |
| `scripts/verify.log` | Verification (0 discrepancies) |
| `scripts/test_stochasticity.log` | Stochasticity gate results |
