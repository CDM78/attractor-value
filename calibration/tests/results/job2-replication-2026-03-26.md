# Job 2 Replication (Risk Factor Evolution)

**Date**: 2026-03-26
**Method**: Keyword density heuristic (programmatic, no AI API)

## Original Result
- N=33, r=0.378, p=0.030

## Replication

```
JOB 2 REPLICATION (N=190 training cases)
==========================================
Cases evaluated: 190
Spearman r with outcome: 0.219
p-value: 0.0024
Return correlation r: 0.229 (p=0.0015)

Trajectory distribution:
  Stable:        67 (35%)
  Deteriorating: 123 (65%)

Outcome distribution in sample:
  Winners: 60, Traps: 43, Underperform: 52, Mixed: 35
  Unique tickers: 147

Win/trap rates:
  Stable trajectory:        35.8% win rate (24/67), 23.9% trap rate (16/67)
  Deteriorating trajectory: 29.3% win rate (36/123), 22.0% trap rate (27/123)
  Win rate delta:           6.5pp

Win rate delta chi-squared (Yates): 0.585, p=0.444 (NOT SIGNIFICANT)

5-fold cross-validation:
  Per-fold r values: 0.521, -0.045, 0.291, 0.302, 0.186
  Mean r: 0.251
  SD: 0.184

VERDICT: PARTIALLY REPLICATED
```

## IMPORTANT: Methodological Issues

1. **The r=0.219 is Spearman correlation of a BINARY signal (stable=1, deteriorating=0)
   against a SYNTHETIC 4-level outcome (winner=1, mixed=0.5, underperform=0.3, trap=0).**
   This is NOT a clean binary-vs-binary or continuous-vs-continuous comparison.
   Spearman on a 2-value x 4-value variable is essentially a rank-biserial correlation.

2. **The 6.5pp win rate delta (35.8% vs 29.3%) is NOT statistically significant.**
   Chi-squared with Yates correction: 0.585, p=0.444. The 2x2 table is:
   ```
                 Winner  Not-winner
   Stable:        24       43       (67)
   Deteriorating: 36       87       (123)
   ```
   This delta could easily arise by chance.

3. **The r=0.229 "return correlation" is Spearman of the same binary signal (stable=1,
   deteriorating=0) against continuous forward_return_3yr.** It and r=0.219 are different
   because one uses the synthetic outcome encoding, the other uses raw returns.

4. **UNTESTED HYPOTHESIS (CONTRADICTED):** The original report stated "AI sub-agent
   evaluation would likely recover closer to original r=0.378." This is speculation.
   A blinded mid-cap retest with Opus produced r=-0.294, directly contradicting this
   claim. AI evaluation of risk factor text has NOT been shown to improve over the
   keyword heuristic in controlled conditions.

## Incremental Value

```
INCREMENTAL VALUE TEST
=======================
Job 2 binary r with forward returns: 0.229
Job 2 continuous (composite score) r: 0.097
```

## Methodology Detail

The keyword density heuristic (code: `evaluateRiskFactorEvolution` in job2-replication.js):

1. Counts occurrences of 26 escalation keywords in current and prior 10-K Item 1A:
   significant, material, substantial, severe, critical, unprecedented, adverse,
   adversely, failure, inability, impairment, deterioration, decline, loss, default,
   litigation, investigation, regulatory action, enforcement, cybersecurity, breach,
   pandemic, supply chain disruption, going concern, covenant, restatement, delisted

2. Normalizes to density per 1000 words

3. Computes three sub-scores:
   - density_delta > 2: +1.0, > 0.5: +0.5, else: 0
   - word_count_change > 0.15: +0.75, > 0.05: +0.25, else: 0
   - new_paragraph_ratio > 0.2: +0.5, > 0.1: +0.25, else: 0

4. Composite score >= 0.5 -> "deteriorating", else -> "stable"
   (Threshold is very low: 65% of cases classified as deteriorating)

## Raw Data Export

Full 190-case dataset: `calibration/export-job2-keyword-heuristic.csv`
