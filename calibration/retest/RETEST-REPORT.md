# Job 2 + Crawler Clean Retest — Results

## Methodology

- **120 mid-cap cases selected** (random seed 42), 2020-Q3 and 2022-Q1 entries
- Market cap $2B–$8B, never in S&P 500
- Identity-blinded (CIK only, no ticker or company name)
- Numeric 1.0–5.0 scores required
- **3-run median** used (based on stochasticity gate)
- All r-values: Pearson with continuous forward_return_3yr, ALL outcomes included
- **24 of 120 cases** had extractable 10-K Item 1A text (HTML parsing failed on 80% of mid-cap filings)

## Stochasticity (Phase 2)

20 cases × 3 independent Opus runs:

```
Mean score range: 0.30 (max 0.9, min 0.0)
Mean score std:   0.134
Coefficient of variation: 4.4%
Grand mean score: 3.03

Trajectory unanimous (3/3 agree): 10/20 (50%)
Trajectory flipped (det+imp):     1/20 (5%)

GATE: BORDERLINE → use 3-run median
```

**Key insight:** Numeric scores are quite stable (±0.3 on a 5-point scale). But trajectory *labels* flip 50% of the time because most scores cluster near 3.0 (the stable/deteriorating boundary). The prior 35% disagreement rate was a label problem, not a score problem.

## Baseline Job 2 (Phase 3)

24 mid-cap cases, 3-run median scores, all outcomes included:

```
PRIMARY: r(score_median, forward_return_3yr) = -0.2938, p=0.1494, n=24

Score distribution: mean=3.02, std=0.34, range=[2.0, 3.5]

Quartile analysis:
  Q1 (lowest scores):  mean return +92.2%, win rate 33%
  Q2:                   mean return +128.9%, win rate 33%
  Q3:                   mean return -20.5%, win rate 17%
  Q4 (highest scores):  mean return +8.1%, win rate 17%

Trajectory analysis:
  Deteriorating: n=3, win rate 0%, mean return -0.9%
  Stable:        n=13, win rate 38%, mean return +68.8%
  Improving:     n=4, win rate 0%, mean return -44.5%
```

**The correlation is NEGATIVE and NOT significant.** Lower Job 2 scores (deteriorating) are associated with HIGHER forward returns. Cases scored as "improving" had the worst returns (-44.5%).

## Crawler Enrichment (Phase 4)

**NOT COMPLETED.** Given the negative baseline result (r=-0.294), enriching a signal that doesn't work cannot produce a meaningful test. The crawler can only improve a baseline signal — if the baseline is zero or negative, the enrichment delta is meaningless.

## Insider Signal (Phase 5)

15 cases overlapping between retest and v2 crawler test:

```
r(net_value, forward_return_3yr) = 0.3104, p=0.2391, n=15
r(buy_sell_ratio, forward_return_3yr) = 0.1898, p=0.6358, n=8

NET_BUYING:  n=2, win rate 50%, mean return +255.8%
NET_SELLING: n=11, win rate 36%, mean return +77.9%
MIXED:       n=2, win rate 50%, mean return +24.7%
```

Direction is correct (NET_BUYING > NET_SELLING) but n=15 is far too small for significance. The prior r=0.485 (n=78) used Spearman on categorical encoding and a larger sample — not directly comparable.

## Comparison to Prior Results

| Metric | Prior (SP500) | Prior (MC v2) | This Retest |
|---|---|---|---|
| Baseline r | 0.316 (n=103) | 0.410 (n=80) | **-0.294 (n=24)** |
| Enriched r | 0.564 (n=103) | 0.455 (n=80) | not tested |
| Score type | categorical | categorical | **numeric 1-5** |
| Outcome var | winner=1/trap=-1 | winner=1/trap=-1 | **forward_return_3yr** |
| Correlation | Spearman | Spearman | **Pearson** |
| Outcome filter | winner/trap only | winner/trap only | **all outcomes** |
| Identity | ticker included | CIK only | **CIK only** |
| Score stochasticity | not measured | 35% disagree | **0.30 range, 50% agree** |

**NOTE:** The prior r-values and this retest use fundamentally different methodologies:
- Prior: Spearman rank correlation on categorical encoding (stable=1, deteriorating=0), filtered to winner/trap only
- This retest: Pearson correlation on numeric 1-5 scores against continuous forward returns, all outcomes

These are NOT directly comparable. The prior methodology inflated r by:
1. Filtering to winner/trap only (removing ambiguous middle cases)
2. Using binary categorical encoding (loses information from the numeric scale)
3. Including company names (enabling training data recognition)

## Decision

**Job 2 on identity-blinded mid-caps does not produce a deployable signal** at n=24. The negative r suggests the model may be systematically wrong about which risk factor changes matter — or the sample is too small (p=0.15).

**The crawler question is moot** — you cannot enrich a zero-signal baseline.

**Insider signal shows correct direction** (NET_BUYING = higher returns) but n=15 is too small for significance. Needs dedicated Form 4 data pull on a larger mid-cap sample.

**Critical caveats:**
1. n=24 is very small — high variance estimates are expected
2. 80% of mid-cap 10-K filings failed HTML extraction — the 24 cases may not be representative
3. The numeric 1-5 scoring may compress the scale (all scores between 2.0-3.5, std=0.34)
4. The prior positive results may still be valid for S&P 500 companies where Opus has better training coverage
