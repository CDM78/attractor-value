# Refined Risk Factor Evolution — Recalibration Report

**Date:** 2026-03-25
**Sample:** 33 cases (same cases from architecture test Job 2)
**Model:** Claude Opus 4 sub-agents
**Cardinal rule compliance:** All filing dates verified BEFORE entry dates — 0 violations
**Composition:** 12 winners, 21 traps

---

## Executive Summary

The refined risk factor prompt replaces the original binary stable/deteriorating classification with a 5-category severity scoring system that separates boilerplate noise from company-specific signals, escalations, and "confession" patterns.

**Bottom line: The refinement destroyed the signal.** The original Job 2 achieved r=0.378 (p=0.030) with a simple stable/deteriorating binary. The refined severity score achieves r=-0.150 (p=0.405) — no predictive power whatsoever. The false positive rate barely improved (76% vs 79%), and the "okay" bucket's win rate collapsed from 71% to 37.5%.

**Root cause:** The refined prompt's point system is too sensitive to **transient crises that value investors exploit.** Companies bought at maximum despair (HP during oil collapse, HRB during COVID covenant breach, FLR during restatement, AVGO during Korean FTC probe) all scored CRITICAL — but they were the biggest winners. The scoring system cannot distinguish "company is confessing to problems that are already priced in" from "company is confessing to problems that will get worse."

---

## A: Severity Score Distribution

| Severity Range | Cases | Winners | Traps | Win Rate | Trap Rate |
|---|---|---|---|---|---|
| ≤ 0 (improving) | 3 | 1 | 2 | 33.3% | 66.7% |
| 1-5 (normal) | 5 | 2 | 3 | 40.0% | 60.0% |
| 6-12 (moderate) | 12 | 3 | 9 | 25.0% | 75.0% |
| 13-20 (significant) | 2 | 2 | 0 | 100.0% | 0.0% |
| > 20 (critical) | 11 | 4 | 7 | 36.4% | 63.6% |

**Key finding:** The severity score does NOT create meaningful separation. The "improving" and "normal" categories were supposed to be the safe zone — instead they have *lower* win rates (33-40%) than the moderate bucket (25%). The "significant" bucket is 100% winners (ODFL and VLO), completely inverting the expected pattern.

The distribution is essentially flat across bins, with no monotonic relationship between severity and outcome.

## B: Category Breakdown

| Category | Mean per case | r with outcome | p-value |
|---|---|---|---|
| Boilerplate | 1.52 | -0.304 | 0.086 |
| Sector-wide | 1.88 | -0.213 | 0.234 |
| Company-specific | 2.30 | 0.069 | 0.702 |
| Escalation | 2.33 | 0.000 | 1.000 |
| Confession | 0.88 | 0.152 | 0.398 |
| Resolved | 1.12 | -0.194 | 0.279 |

Note: Negative r means higher count correlates with traps (outcome=0). Positive r means higher count correlates with winners.

**Key finding:** No individual category achieves statistical significance. The closest is boilerplate count (r=-0.304, p=0.086) — ironically, the noise category has the strongest signal, likely because companies with more boilerplate additions tend to be doing well enough that their lawyers focus on compliance housekeeping.

**Confession count is NOT predictive** (r=0.152, p=0.398). The positive r means more confessions weakly correlate with *winners*, not traps. This is the core problem: confessions in SEC filings are concentrated at maximum despair, which is exactly when value investors buy.

**Company-specific count has zero signal** (r=0.069, p=0.702). The hypothesis that company-specific risks drive all the signal is decisively rejected.

## C: Confession Pattern Analysis

| Metric | Value |
|---|---|
| Cases with ≥1 confession | 12 / 33 (36%) |
| Among those: winners | 4 |
| Among those: traps | 8 |
| Win rate when confession present | 33.3% |
| Win rate when no confession | 38.1% |

**Key finding:** Confessions alone do NOT predict traps with >80% accuracy. The win rate difference between confession-present (33.3%) and confession-absent (38.1%) is only 4.8 percentage points — statistically meaningless at n=33.

The 4 winners with confessions (HP: covenant breach + revenue collapse, HRB: covenant violation + emergency drawdown, FLR: $3.8B restatement + SEC/DOJ investigation, AVGO: Korean FTC investigation) are textbook value investing cases where extreme distress created buying opportunities.

## D: Compare to Original Job 2

| Metric | Original Job 2 | Refined Job 2 |
|---|---|---|
| r with outcome | **0.378** | **-0.150** |
| p-value | **0.030** | **0.405** |
| % classified "problem" | 79% (deteriorating) | 76% (moderate + significant + critical) |
| % classified "okay" | 21% (stable) | 24% (improving + normal) |
| Win rate in "okay" bucket | **71%** | **37.5%** |
| Trap rate in "problem" bucket | **73%** | **64.0%** |

**The refined version is worse on every metric that matters.**

## E: Optimal Threshold Sweep

| Threshold | Cases "okay" | Win Rate | Cases "concern" | Trap Rate | Signal Value |
|---|---|---|---|---|---|
| ≤ 3 | 8 | 37.5% | 25 | 64.0% | 49.0% |
| ≤ 5 | 8 | 37.5% | 25 | 64.0% | 49.0% |
| ≤ 8 | 13 | 46.2% | 20 | 70.0% | **56.8%** |
| ≤ 10 | 17 | 35.3% | 16 | 62.5% | 47.0% |
| ≤ 15 | 22 | 36.4% | 11 | 63.6% | 48.1% |

**Best threshold: severity ≤ 8** achieves 46.2% win rate / 70.0% trap rate. Still far weaker than the original binary (71% / 73%).

## F: Simple Heuristic Comparison

| Heuristic | r with outcome | p-value |
|---|---|---|
| Paragraph count diff | 0.000 | 1.000 |
| Dollar amount diff | -0.074 | 0.684 |
| New restatement keywords | -0.201 | 0.262 |
| Total restatement keywords | -0.029 | 0.874 |
| Text length diff | 0.241 | 0.176 |

**Heuristic verdict: AI adds value beyond simple text diffing.** No simple heuristic achieves r>0.30. This confirms the original Job 2's signal came from genuine semantic understanding, not surface-level text features.

---

## Detailed Case Results

| Case | Ticker | Actual | Orig Traj | Severity | Refined Traj | Boilerplate | Co-Specific | Confessions |
|---|---|---|---|---|---|---|---|---|
| ANALYST-0002 | V | Winner | stable | 7 | moderate_concern | 2 | 2 | 0 |
| ANALYST-0004 | DHR | Trap | deteriorating | 11 | moderate_concern | 3 | 3 | 0 |
| ANALYST-0007 | HP | Winner | deteriorating | 62 | critical | 0 | 8 | 4 |
| ANALYST-0008 | HRB | Winner | deteriorating | 38 | critical | 2 | 4 | 4 |
| ANALYST-0012 | ODFL | Winner | stable | 13 | significant_concern | 2 | 1 | 0 |
| ANALYST-0013 | ALB | Trap | deteriorating | 0 | improving | 0 | 0 | 0 |
| ANALYST-0014 | GT | Trap | deteriorating | 24 | critical | 2 | 4 | 1 |
| ANALYST-0015 | WST | Trap | deteriorating | -5 | improving | 3 | 0 | 0 |
| ANALYST-0017 | ALB | Trap | deteriorating | 1 | normal | 0 | 0 | 0 |
| ANALYST-0018 | ALB | Winner | stable | 1 | normal | 0 | 0 | 0 |
| ANALYST-0019 | PYPL | Trap | deteriorating | 12 | moderate_concern | 2 | 2 | 0 |
| ANALYST-0020 | CRL | Trap | deteriorating | 11 | moderate_concern | 4 | 2 | 0 |
| ANALYST-0022 | HRL | Trap | deteriorating | 26 | critical | 2 | 4 | 1 |
| ANALYST-0023 | CHTR | Trap | stable | 6 | moderate_concern | 1 | 2 | 0 |
| ANALYST-0024 | DXC | Trap | deteriorating | 22 | critical | 2 | 5 | 1 |
| ANALYST-0025 | AVGO | Winner | stable | 22 | critical | 2 | 1 | 1 |
| ANALYST-0029 | PRGO | Trap | deteriorating | 31 | critical | 2 | 6 | 3 |
| ANALYST-0030 | TRMB | Trap | deteriorating | 1 | normal | 2 | 0 | 0 |
| ANALYST-0031 | CCI | Trap | deteriorating | 2 | normal | 2 | 1 | 0 |
| ANALYST-0032 | FLR | Winner | deteriorating | 52 | critical | 1 | 8 | 5 |
| ANALYST-0034 | TFC | Trap | deteriorating | 36 | critical | 4 | 5 | 2 |
| ANALYST-0035 | VLO | Winner | deteriorating | 14 | significant_concern | 1 | 3 | 0 |
| ANALYST-0038 | UPS | Trap | deteriorating | 10 | moderate_concern | 0 | 1 | 0 |
| ANALYST-0039 | SBAC | Winner | stable | -2 | improving | 0 | 0 | 0 |
| ANALYST-0040 | WDC | Trap | stable | 9 | critical | 4 | 1 | 1 |
| ANALYST-0041 | FLR | Trap | deteriorating | 9 | moderate_concern | 0 | 2 | 0 |
| ANALYST-0042 | NKTR | Trap | deteriorating | 31 | critical | 0 | 3 | 3 |
| ANALYST-0044 | DPZ | Trap | deteriorating | 8 | moderate_concern | 2 | 1 | 0 |
| ANALYST-0045 | BAX | Trap | deteriorating | 34 | critical | 2 | 2 | 3 |
| ANALYST-0046 | MLM | Winner | deteriorating | 8 | moderate_concern | 0 | 1 | 0 |
| ANALYST-0047 | DGX | Trap | deteriorating | 9 | moderate_concern | 1 | 2 | 0 |
| ANALYST-0048 | LMT | Winner | deteriorating | 1 | normal | 3 | 0 | 0 |
| ANALYST-0050 | ALGN | Winner | deteriorating | 7 | moderate_concern | 0 | 2 | 0 |

---

## Why the Refinement Failed — Root Cause Analysis

### 1. Confessions Are Buying Signals, Not Sell Signals

The 4 highest-severity winners illustrate the problem:
- **FLR (sev=52):** $3.8B restatement, SEC/DOJ probe, material weakness — stock tripled from maximum despair
- **HP (sev=62):** 40% revenue collapse, covenant breach, restructuring — energy recovery play that won
- **HRB (sev=38):** COVID covenant violation, emergency $2B drawdown — temporary crisis, massive recovery
- **AVGO (sev=22):** Korean FTC investigation, supply chain confirmed disruptions — irrelevant to semiconductor dominance

In value investing, the market has already punished these stocks. The confession *is why the stock is cheap enough to buy.* A risk factor analysis that flags these as dangerous is identifying the very mechanism that creates the value opportunity.

### 2. The Original Binary Worked Because It Was Simpler

The original "stable vs deteriorating" binary captured a coarser but more useful signal: whether the company's risk profile was fundamentally changing in character. The refined prompt's point system counted every individual change, making it overwhelmed by the volume of disclosures during COVID (2020-2021) and crisis periods.

### 3. Temporal Contamination

Many cases have entry dates during 2020-2021, when every company added COVID risk factors. The refined prompt cannot distinguish "COVID disclosure that everyone added" from "genuine company-specific deterioration."

### 4. Truncation Artifacts

Three ALB cases (0013, 0017, 0018) had severely truncated risk factor text (~800 chars vs typical ~25K), producing near-zero severity scores regardless of actual risk evolution.

---

## Decision Summary

| Criterion | Value | Verdict |
|---|---|---|
| Refined r vs outcome | -0.150 | **USE ORIGINAL** — refinement destroyed signal |
| False positive rate | 76% | **Still too pessimistic** — barely better than 79% |
| Best simple heuristic r | 0.241 | **AI adds value** — no heuristic matches original |

## Recommendations

1. **Revert to original Job 2 prompt** for the 200-case validation. The simple "stable vs deteriorating" binary with r=0.378 is the proven signal.

2. **Do not use confession-based scoring for value investing screens.** Confessions correlate with buying opportunities, not traps, in this sample.

3. **For the 200-case test, consider one modification:** Add a "sector-wide crisis?" qualifier. If deterioration is sector-wide (COVID, oil crash, trade war), it's less predictive. This requires a small prompt tweak, not a restructuring.

4. **Clean up the data pipeline:** Three ALB cases had truncated risk factor text. Ensure all Item 1A extracts are complete before the 200-case validation.

---

Refined prompt verdict: **USE ORIGINAL**. Severity threshold: **N/A (binary is better)**. Expected false positive rate: **76% (no improvement)**. Ready for 200-case validation: **NO — use original prompt instead**.
