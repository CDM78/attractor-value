# Job 2 SELL Signal Test (T+12 Risk Factor Evolution)

**Date**: 2026-03-26
**Method**: Opus sub-agent comparison of entry 10-K vs T+12 10-K Item 1A
**N**: 44 training cases with both entry and T+12 filings

## Results

```
JOB 2 SELL SIGNAL (T+12 evaluation)
=====================================
Cases evaluated: 44
Trajectory distribution:
  Improved:     2 ( 5%)
  Stable:      36 (82%)
  Deteriorated:  6 (14%)

TRAJECTORY vs OUTCOME:
  Trajectory      | n  | Winners | Traps | Win%  | Trap% | Mean alpha
  improved        |  2 |       1 |     0 | 50.0% |  0.0% | +27.2%
  stable          | 36 |      14 |     9 | 38.9% | 25.0% | +10.5%
  deteriorated    |  6 |       2 |     2 | 33.3% | 33.3% |  +6.3%

Sell signal value:
  Trap catch rate: 18.2% (2/11 traps caught by selling deteriorated)
  False alarm rate: 11.8% (2/17 winners lost by selling deteriorated)
  Net discrimination: +6.4pp

  Mean alpha if deteriorated: +6.3%
  Mean alpha if stable/improved: +11.0%
  Alpha delta: -4.7pp (deteriorated underperforms by 4.7pp)
```

## Assessment

**INCONCLUSIVE** — the sell signal shows the right direction (deteriorated cases
have lower alpha and higher trap rate) but the sample is too small (n=6 deteriorated)
for statistical significance. Key issues:

1. **Only 44/190 cases have T+12 filings** — EDGAR extraction failed for 116 cases
   (HTML parsing issues with older filing formats). Need better extraction.

2. **82% classified as "stable"** — risk factors rarely change dramatically year
   over year. The signal is sparse. Only 14% triggered the sell signal.

3. **6 deteriorated cases: 2 winners, 2 traps** — a coin flip on this tiny sample.

4. **Data quality**: Several cases had mismatched filing sections (Item 7 MD&A
   instead of Item 1A Risk Factors in either entry or T+12), reducing comparison quality.

## Recommendation

- **DO NOT DEPLOY as standalone sell signal** — insufficient evidence
- **Worth retesting** with larger sample if EDGAR extraction improves
- For the holdout test (Part 3): skip the sell signal component, test BUY composite only
- The entry-point Job 2 (r=0.316) remains validated; the T+12 variant needs more data
