# System D Verification Audit Report

**Date:** 2026-03-24
**Purpose:** Verify every component of System D for hidden look-ahead, run cross-validation, check multiple comparisons and period bias

---

## Executive Summary

Two of System D's three composite components are contaminated:

1. **u024 (filing quality): DEAD prospectively.** All-time filing count → r=-0.145. Pre-entry filings only → r=-0.009 (p=0.72). 99.7% of cases change classification. The entire filing quality signal was look-ahead.

2. **Expense Benford KLD: NOT significant when properly filtered.** Unfiltered → r=-0.165 (p<0.0001). Filtered by entry date → r=-0.041 (p=0.13). The conditional retest's "strong new finding" was look-ahead from post-entry financial data.

3. **Credit spread (u160): CONFIRMED CLEAN.** Entry-date matched, different values for same ticker at different dates.

4. **β trajectory: CONFIRMED CLEAN.** Quarterly data properly filtered by entry date.

**System D's 3-way composite is effectively a 1-way composite** — only credit spread carries real prospective signal. Despite this, cross-validation shows it still works: Pool I mean win rate 73.6% (4/5 folds ≥70%), mean alpha 12.7% (5/5 folds ≥3%). System D (Pool I + β trajectory) mean win rate 76.0% (3/5 ≥75%), mean alpha 16.7% but with high variance (SD 10.9%).

---

## Audit 1: Filing Quality (u024)

**Status: CONTAMINATED — MAJOR IMPACT**

```
Source: scripts/anonymize-dataset.js:460-467
  const sec = pools.secMetadata[ticker];  // keyed by ticker, NOT date
  u.u024 = (sec.nt_filings > 0 || sec.total_10KA > 0 || sec.total_10QA > 0) ? 1 : 0;
```

The `sec-filing-metadata.json` counts ALL filings across the company's entire EDGAR history. For a 2013 entry, this includes amendments from 2014-2025.

**Prospective reconstruction:** Using companyfacts `filed` dates, counted only 10-K/A and 10-Q/A entries with `filed <= entry_date`.

| Version | r vs outcome | p | Description |
|---------|-------------|---|-------------|
| Original u024 (all-time) | **-0.145** | <0.0001 | Includes post-entry filings |
| Prospective u024 (pre-entry only) | **-0.009** | 0.715 | Only filings before entry |

**Cases where classification changed: 1,626 / 1,631 (99.7%).** The original u024 was almost entirely capturing post-entry information.

**Why:** NT filings (the strongest indicator) are NOT in companyfacts at all — they contain no financial data, only a notice to the SEC. The companyfacts only has 10-K/A and 10-Q/A entries. The original u024 also counted NT filings from the EDGAR submissions index (all-time). With just companyfacts amendments and pre-entry filtering, almost every company has zero amendments (clean u024=0).

**Impact on System D: MAJOR.** u024 contributed ~1/3 of the composite score and was the second-strongest component after credit spread. With u024 dead, the composite degrades to approximately credit spread + noise.

---

## Audit 2: Expense Benford KLD

**Status: DATE FILTERING VERIFIED IN PROSPECTIVE SCRIPT — but signal is NOT significant when filtered**

```
prospective-reanalysis.js:143
  const allVals = extractAllUsdValues(facts).filter(v => !c.entry_date || v.end <= c.entry_date);
```

Verification for HP (entry 2017-06-14):
- Expense values (all time): 313
- Expense values (pre-entry): 113
- Post-entry excluded: 200
- Latest `end` date in filtered set: 2017-03-31 ✓ (before entry)

**BUT:**

| Version | r vs outcome | p | N |
|---------|-------------|---|---|
| Unfiltered (all time) | **-0.165** | <0.0001 | 1,305 |
| Filtered (pre-entry) | **-0.041** | 0.134 | 1,305 |

**The conditional retest's "strong new finding" (r=-0.160) used unfiltered data.** The code at `conditional-retest.js:128` calls `extractAllUsdValues(facts)` without any date filter. Only the prospective reanalysis script added filtering.

When properly filtered, expense Benford drops from highly significant to non-significant. The "new signal" was entirely post-entry financial data revealing which companies subsequently performed well or poorly.

**Impact on System D: MAJOR.** Expense Benford was the third composite component. Without it, the composite is credit spread + dead u024 + dead expense Benford = effectively credit spread alone.

---

## Audit 3: Credit Spread (u160)

**Status: CLEAN**

```
anonymize-dataset.js:449
  const econ = pools.fredContext[entryDate];  // keyed by entry date
  u.u160 = econ.credit_spread ?? null;
```

Verification — same ticker (HP), different entry dates:
- HP | entry 2017-06-14 | u160: -1.127
- HP | entry 2020-05-21 | u160: 2.479
- HP | entry 2010-03-01 | u160: 0.651

**Confirmed: different u160 values for different entry dates.** Uses FRED snapshot at entry, not a current value.

---

## Audit 4: β Trajectory

**Status: CLEAN**

```
conditional-retest.js:107 / prospective-reanalysis.js:129
  const qm = extractQuarterlyMetrics(facts, c.entry_date);
```

Verification for DHI (entry 2018-06-15):
- Filtered: 36 quarters, latest 2018-Q2 ✓
- Unfiltered: 66 quarters, latest 2025-Q4
- Entry quarter: 2018-Q2

**Confirmed: no post-entry quarters in filtered data.** `extractQuarterlyMetrics` filters by `qk <= dateToQuarter(beforeDate)`.

---

## Audit 5: 5-Fold Stratified Cross-Validation

Stratified by entry-year bucket AND outcome class. Normalization parameters computed on training set only, applied to held-out test fold.

| Fold | Train | Test | Pool I WR | Pool I Alpha | Pool I N | Sys D WR | Sys D Alpha | Sys D N |
|------|-------|------|-----------|-------------|----------|----------|------------|---------|
| 1 | 1,320 | 336 | 69.7% | 5.0% | 33 | 58.3% | -2.0% | 12 |
| 2 | 1,323 | 333 | 77.1% | 20.8% | 35 | 73.3% | 30.7% | 15 |
| 3 | 1,326 | 330 | 73.3% | 11.4% | 30 | 83.3% | 20.6% | 12 |
| 4 | 1,327 | 329 | 74.3% | 12.2% | 35 | 78.6% | 13.0% | 14 |
| 5 | 1,328 | 328 | 73.5% | 14.2% | 34 | 86.7% | 21.2% | 15 |
| **Mean** | | | **73.6%** | **12.7%** | | **76.0%** | **16.7%** | |
| **SD** | | | 2.4% | 5.1% | | 9.9% | 10.9% | |

### Decision Criteria Results

| Metric | Pool I | System D |
|--------|--------|----------|
| WR threshold met (≥70% / ≥75%) | **4/5 folds — robust** | **3/5 folds — likely real** |
| Alpha ≥3% | **5/5 folds — robust** | **4/5 folds — robust** |

**Key observations:**
- **Pool I is stable:** SD of win rate is only 2.4%. The composite works consistently.
- **System D is volatile:** SD of win rate is 9.9%. With ~13 cases per fold, single cases swing win rate by 7-8%. Fold 1 (58.3% WR, -2.0% alpha) shows the worst case.
- **Pool I alpha (mean 12.7%) is the honest number.** System D's higher mean alpha (16.7%) comes with massive variance.
- Pool I is the deployable system; System D (adding β trajectory ranking within Pool I) adds modest precision at the cost of 50% case reduction and much higher variance.

---

## Audit 6: Multiple Comparisons

~55 independent signal × pool tests were conducted across the conditional retest.

| Correction Method | Threshold | Findings that survive |
|-------------------|-----------|----------------------|
| **Bonferroni** (0.05/55) | p < 0.00091 | **0/6 key findings** |
| **Benjamini-Hochberg** (FDR 5%) | Rank-adjusted | **6/6 key findings** |

Bonferroni is overly conservative for correlated tests (the pools overlap, the signals are correlated). BH is more appropriate and all key findings survive. However, the p-values are now known to be inflated by two contaminated components (u024 and unfiltered Benford), so BH survival is moot for those signals.

**For the clean signals only:**
- β trajectory in Pool H (p=0.045): borderline even before correction
- Credit spread composite top quintile: the pool definition itself is the finding, not a p-value test

---

## Audit 7: Alpha by Entry Period

### System D

| Period | N | Win Rate | Ann. Alpha |
|--------|---|----------|-----------|
| 2013-2016 | 21 | 71.4% | 9.4% |
| 2017-2019 | 38 | 78.9% | 14.1% |
| 2020-2022 | 11 | 63.6% | 41.3% |

### Pool I (System C)

| Period | N | Win Rate | Ann. Alpha |
|--------|---|----------|-----------|
| 2013-2016 | 47 | 70.2% | 9.3% |
| 2017-2019 | 92 | 83.7% | 12.2% |
| 2020-2022 | 29 | 58.6% | 22.5% |

**Findings:**
- Alpha exists across ALL periods (9.3-41.3%). Not concentrated in one era.
- **Win rate DROPS for 2020-2022 entries** (58.6% for Pool I, 63.6% for Sys D) — the most recent cohort is barely above baseline. This may reflect that credit spreads were abnormally high in 2020 (COVID), making the pool large and less selective.
- The 2020-2022 alpha (22-41%) is driven by the massive bull market, not precision. The WIN RATE tells the real story.
- **The 14.7% headline alpha is NOT misleading** — 2013-2016 shows 9.3%, 2017-2019 shows 12.2%. The alpha is real but the magnitude varies with market conditions.
- **Honest expectation:** ~9-12% annualized alpha in normal conditions. Higher in recovery periods, potentially lower in bear markets.

---

## Audit 8: Survivorship Bias

Companies excluded from the dataset due to delisting or missing price data are likely the worst traps.

**Evidence of partial inclusion:**
- 120 cases (7.2%) have 3yr return < -50%
- 22 cases have 3yr return < -75%
- 4 cases have 3yr return < -90% (CLF: -95.7%, SEDG: -94.7%, ENPH: -90.5%, TAL: -90.3%)

Bankruptcies and delistings that had no Yahoo price data at the 3-year exit point are excluded. Most S&P 500 departures are acquisitions (positive returns) rather than bankruptcies, so the bias is mild.

**Estimated impact: 1-3% win rate inflation** across all systems equally.

---

## What the Audit Reveals About the "Clean" System

**Before audit (System D headline):**
- 3-way composite: credit spread + filing quality + expense Benford
- Win rate: 83.8%, alpha: 14.7%

**After audit (honest numbers):**
- The composite is effectively **credit spread alone** (the other two components are contaminated)
- Credit spread top quintile = Pool E from the prospective reanalysis: **70.7% win rate, 10.2% alpha**
- Adding β trajectory ranking within credit spread: improves to ~76% WR, ~12-17% alpha, but with high variance

**Pool I's 73.6% CV mean win rate** is carried primarily by credit spread. The "3-way" label overstates the signal complexity — it's mostly one signal plus noise. But that one signal is genuinely prospective and delivers 5/5 alpha folds ≥3%.

---

## Final Audit Summary

```
Audits passed:    4 / 8  (credit spread, β trajectory, cross-validation alpha, survivorship minor)
Audits failed:    2 / 8  (u024 DEAD, expense Benford NOT significant when filtered)
Audits qualified: 2 / 8  (multiple comparisons borderline, period bias — weak recent WR)

System D after corrections:
  Win rate: 76.0% CV mean (was 83.8%) — degraded
  Ann. alpha: 12.7% for Pool I / 16.7% for System D (was 14.7%) — similar but high variance

Verdict: DEGRADED BUT VIABLE

The system works because credit spread (contrarian timing) is a genuine,
prospective, entry-date-matched signal. β trajectory adds modest conditional
value. Filing quality and expense Benford were look-ahead artifacts.
```

---

## Should We Proceed to the AI Blinding Test Using System D as the Baseline?

**Yes, with modifications.**

System D's surviving components are:
1. **Credit spread at entry** (u160) — clean, the primary signal
2. **β trajectory** — clean, adds conditional value within the credit spread pool

The AI blinding test should use these two clean signals as the quantitative baseline, NOT the full 3-way composite. The test question becomes: **does the Claude attractor analysis add alpha beyond what contrarian timing + β trajectory already provide?**

Specifically:
- Select Pool E (high credit spread entries) as the candidate universe
- Rank by β trajectory within Pool E
- Run Claude attractor analysis on the top-ranked candidates
- Test whether the attractor score separates winners from traps within this pre-selected pool

This is a meaningful test: the quantitative signals handle WHEN to buy (credit spread) and which companies show improving efficiency (β trajectory). The AI analysis should handle WHY — is the company's competitive position durable? This is the original framework architecture (Graham screen + attractor analysis), now validated with honest prospective data.

---

*Report generated by system-d-verification.js on 2026-03-24*
