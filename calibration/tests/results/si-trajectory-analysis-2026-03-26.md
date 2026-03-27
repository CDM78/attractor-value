# SI Trajectory Analysis

**Date**: 2026-03-26
**Status**: PRELIMINARY OBSERVATION ONLY — sample too small to validate

```
SI TRAJECTORY ANALYSIS
=======================
Cases with SI checkpoint data: 30
  Winners: 13
  Traps: 2
  Other (underperform/mixed): 15

CRITICAL LIMITATION: Only 2 traps in sample. All findings below are
anecdotal, not statistical. Cannot compute meaningful rates from n=2.

Among traps (n=2):
  SI D1 turned positive (2 consec) before T+12: 1/2 (AAL caught, ALK not)
  SI theta declined below entry before T+12:    0/2

Among winners (n=13):
  SI D1 false alarm before T+12: 2/13 (A, ADSK)
  SI theta false alarm before T+12: 6/13

Raw 2x2 table (SI D1 signal x outcome, n=15 winners+traps only):
               Caught  Not caught
  Traps:         1        1         (2)
  Winners:       2       11         (13)

This table has NO statistical power. Fisher exact p would be meaningless.

The "50% trap catch, 15% false alarm" framing is technically correct
arithmetic on these counts but MUST NOT be interpreted as a validated
finding. It is 1 trap out of 2. That is an anecdote, not a rate.
```

## What is needed for validation

- Minimum 50 traps and 50 winners with SI checkpoint data
- Requires bulk FINRA SI import for 2018+ cases (currently only 30 cases fetched)
- The validated SI signals from market-dynamics-expanded (n=457) showed:
  SI Zipf velocity r=0.219, SI CSD r=0.163, SI D1 r=0.161
  Those are the real benchmarks, not this n=30 checkpoint analysis.
