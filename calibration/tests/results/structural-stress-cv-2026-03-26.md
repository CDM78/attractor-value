# Structural Stress Formal Cross-Validation
Date: 2026-03-26

## Overview

Tests whether the multi-base Benford STRUCTURAL_STRESS classification
(all bases deviate from Benford's law, not just base 10) is a robust
predictor of winner/trap outcomes using stratified 5-fold CV.

- **Total cases**: 892 (winners + traps only)
- **STRUCTURAL_STRESS**: 95 cases (68W / 27T)
- **NATURAL_PROCESS**: 797 cases (454W / 343T)

## Full-Sample Results

| Metric | STRUCTURAL_STRESS | NATURAL_PROCESS | Delta |
|--------|-------------------|-----------------|-------|
| Win rate | 71.6% | 57.0% | 14.6pp |
| Count | 95 | 797 | |

**Fisher exact test**: p = 0.005938 (**significant at 1%**)

**Cohen's h**: 0.307 (small effect)

**Odds ratio**: 1.90 [95% CI: 1.19-3.04]

## 5-Fold Stratified Cross-Validation

Stratified on (classification x outcome) to preserve class proportions in each fold.

| Fold | n | SS win% | NP win% | Delta | Fisher p |
|------|---|---------|---------|-------|----------|
| 1 | 180 | 70.0% | 56.9% | 13.1pp | 0.3386 |
| 2 | 180 | 70.0% | 56.9% | 13.1pp | 0.3386 |
| 3 | 179 | 73.7% | 56.9% | 16.8pp | 0.2189 |
| 4 | 177 | 72.2% | 57.2% | 15.0pp | 0.3132 |
| 5 | 176 | 72.2% | 57.0% | 15.3pp | 0.3129 |
| **Mean** | | **71.6%** | **57.0%** | **14.7pp** | |
| **SD** | | | | 1.6pp | |

- Delta positive in **5/5** folds
- Combined Fisher p (summed fold tables) = **0.005938**

### CV Stability Assessment

The STRUCTURAL_STRESS effect is **stable across folds** and **statistically significant**.

## STRUCTURAL_STRESS x Credit Spread Independence

Joined 779 Benford cases with credit spread data (by ticker).

### Contingency Table

|  | Q1 | Q2 | Q3 | Q4 | Q5 | Total |
|--|----|----|----|----|----| ------|
| SS | 23 | 21 | 15 | 3 | 12 | 74 |
| NP | 133 | 135 | 141 | 153 | 143 | 705 |

**Chi-squared test**: chi2 = 18.814, df = 4, p = 0.0009

The STRUCTURAL_STRESS classification is **not independent** of credit spread regime (p < 0.05).
Some confounding between Benford classification and credit market conditions may exist.

### Win Rates by (Classification x Spread Quintile)

| Class | Q1 | Q2 | Q3 | Q4 | Q5 |
|-------|----|----|----|----|----|
| SS | 91% (n=23) | 81% (n=21) | 67% (n=15) | 67% (n=3) | 42% (n=12) |
| NP | 66% (n=133) | 68% (n=135) | 72% (n=141) | 35% (n=153) | 48% (n=143) |

## Methodology

1. **Data**: 892 cases from the calibration universe with EDGAR XBRL financial data.
   Multi-base Benford analysis classifies each company's financial values in bases 6, 10, 12, 60.
   STRUCTURAL_STRESS = all bases deviate (KLD > 0.005), indicating genuine complexity.
   NATURAL_PROCESS = deviations only in base 10 or none at all.

2. **Cross-validation**: 5-fold stratified on (classification x outcome) to preserve
   class balance. Each fold computes SS and NP win rates independently.

3. **Fisher exact test**: Hypergeometric probability of the 2x2 table
   (STRUCTURAL_STRESS x outcome) under the null of independence. Two-sided.

4. **Spread independence**: Chi-squared test of the 2x5 contingency table
   (classification x credit spread quintile) to verify that Benford classification
   is not merely proxying for credit market conditions.

5. **Effect size**: Cohen's h for proportion differences; odds ratio with 95% CI.
