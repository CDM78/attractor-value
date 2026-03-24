# Systematic Dataset Validation Report
**Date:** 2026-03-24
**Dataset:** 1592 cases from 6 sources
**EDGAR data loaded:** 1584 case-entries

## Dataset Composition

| Source | Cases | Winners | Traps | Underperform | Mixed |
|--------|-------|---------|-------|-------------|-------|
| sp500-crosssection | 433 | 137 | 33 | 222 | 41 |
| sp500-changes | 263 | 77 | 90 | 70 | 26 |
| smallcap | 169 | 72 | 51 | 31 | 15 |
| adr | 100 | 29 | 33 | 23 | 15 |
| multi-entry | 596 | 212 | 138 | 148 | 98 |
| fraud | 31 | 0 | 31 | 0 | 0 |
| **TOTAL** | **1592** | | | | |

## Validation 1: Per-Source Signal Performance

| Source | FM r | D1 r | Zipf r | RevG r | SI r | FM+D1 r |
|--------|------|------|--------|--------|------|---------|
| sp500-crosssection | 0.102 (0/5) | 0.135 (1/5) | 0.154 (2/5) | 0.181 (2/5) | 0.174 (0/5) | 0.112 (0/5) |
| sp500-changes | 0.107 (0/5) | 0.013 (1/5) | 0.018 (0/5) | 0.044 (0/5) | 0.065 (0/5) | 0.133 (1/5) |
| smallcap | 0.140 (2/5) | 0.036 (0/5) | 0.159 (1/5) | 0.124 (1/5) | 0.066 (0/5) | 0.071 (0/5) |
| adr | 0.048 (1/5) | 0.178 (0/5) | 0.244 (0/5) | 0.398 (0/5) | 0.245 (0/5) | 0.217 (0/5) |
| multi-entry | 0.011 (0/5) | 0.077 (0/5) | 0.089 (0/5) | 0.046 (0/5) | 0.070 (0/5) | 0.024 (0/5) |
| fraud | N/A | N/A | N/A | N/A | N/A | N/A |
| ALL | 0.050 (0/5) | 0.042 (2/5) | 0.103 (1/5) | 0.065 (2/5) | 0.086 (1/5) | 0.047 (0/5) |

## Validation 3: 5-Fold CV on Full Dataset

| Signal | Effect r | p-value | CV Folds | CV Mean r | Status |
|--------|----------|---------|----------|-----------|--------|
| Flywheel Momentum | 0.050 | 0.153559 | 0/5 | 0.065 | WEAK |
| D1 Growth | 0.042 | 0.229954 | 2/5 | 0.088 | WEAK |
| Zipf Velocity | 0.103 | 0.004474 | 1/5 | 0.101 | WEAK |
| Revenue Growth (4Q) | 0.065 | 0.074228 | 2/5 | 0.078 | WEAK |
| Scale Invariance CV | 0.086 | 0.026385 | 1/5 | 0.063 | WEAK |
| FM + D1 (pair) | 0.047 | 0.191669 | 0/5 | 0.024 | WEAK |

## Validation 6: Fraud Detection

Fraud cases tested: 27

| Signal | Flagged (bottom 25%) | Detection Rate |
|--------|---------------------|---------------|
| Flywheel Momentum | 7/27 | 26% |
| D1 Growth | 7/27 | 26% |
| Zipf Velocity | 9/27 | 33% |
| Revenue Growth (4Q) | 5/27 | 19% |
| Scale Invariance CV | 4/27 | 15% |
| FM + D1 (pair) | 6/27 | 22% |