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

Win/trap rates:
  Stable trajectory:        35.8% win rate, 23.9% trap rate
  Deteriorating trajectory: 29.3% win rate, 22% trap rate
  Win rate delta:           6.5pp

5-fold cross-validation:
  Per-fold r values: 0.521, -0.045, 0.291, 0.302, 0.186
  Mean r: 0.251
  SD: 0.184

VERDICT: PARTIALLY REPLICATED
```

## Incremental Value

```
INCREMENTAL VALUE TEST
=======================
Job 2 binary r with forward returns: 0.229
Job 2 continuous (composite score) r: 0.097
```

## Methodology Note

This replication uses a keyword-density heuristic rather than AI evaluation:
- Counts escalation keywords (material, adverse, impairment, etc.) per 1000 words
- Measures word count growth (expansion = new risks)
- Detects new paragraph additions
- Composite score → binary trajectory classification

The original Job 2 used human/AI judgment, which likely captures semantic nuance
that keyword density misses. A proper replication requires AI sub-agent evaluation
(Opus or Sonnet) on each case pair.
