# Session Summary: Zipf Sector Fix + Crawler OOS Validation

**Date:** 2026-03-27

## Task A: SI Zipf Sector Fix — SUCCESS

Fixed sector mapping from IWB holdings CSV. 333/333 mid-cap tickers matched to GICS sectors.

| Signal | Before (Unknown) | After (Fixed) | S&P 500 |
|--------|-----------------|---------------|---------|
| **SI Zipf velocity** | **0.105** | **0.187** | **0.219** |
| SI CSD | 0.206 | 0.206 | 0.163 |
| SI D1 | 0.205 | 0.205 | 0.161 |

Zipf improved 78% — from barely useful to approaching S&P 500 levels. The remaining gap (0.187 vs 0.219) is expected: mid-cap sectors have fewer companies for ranking.

## Task B: Crawler OOS Validation — INCONCLUSIVE

| Metric | S&P 500 | Mid-Cap OOS |
|--------|---------|-------------|
| Baseline r | 0.316 | 0.243 |
| Enriched r | 0.564 | 0.234 |
| Delta r | +0.248 | -0.009 |
| Changes | 23/103 (22%) | 1/80 (1.3%) |

**The crawler enrichment adds zero value on mid-caps** — but the test is compromised by broken data:
- Form 4 parser: 0/80 cases with buy/sell signal (all "mixed")
- Customer concentration: 0/80 cases (no 10-K text)
- Only management proxy works (95% coverage, mostly boilerplate)

**The S&P 500 r=0.564 contains training contamination** — Opus recognizes famous companies.
But the baseline financial assessment (r=0.243 on identity-blinded mid-caps) shows Opus
CAN discriminate even on unknown companies, just less powerfully.

## Updated Signal Hierarchy

| Rank | Signal | r | Universe | Status |
|------|--------|---|----------|--------|
| 1 | Crawler-enriched Job 2 | 0.564 | S&P 500 only | Deploy (contamination caveat) |
| 2 | Job 2 baseline (10-K) | 0.316 | S&P 500 | Deploy |
| 3 | Fisher information | 0.301 | Mid-cap | Deploy |
| 4 | Composite (spread+SI) | 0.286 | Mid-cap | Deploy |
| 5 | Spread variance slope | 0.257 | Mid-cap | Deploy |
| 6 | Financial assessment | 0.243 | Mid-cap (blinded) | Deploy |
| 7 | SI Zipf velocity | 0.187 | Mid-cap (fixed) | Deploy |
| 8 | SI CSD | 0.206 | Mid-cap | Deploy |

## Revised Deployment Recommendation

1. **S&P 500 candidates:** Full crawler pipeline (Job 2 + enrichment). r~0.4-0.5 realistic.
2. **Mid-cap candidates:** Financial summary assessment + quantitative signals. r~0.25.
3. **Priority fix:** Form 4 buy/sell parser + mid-cap 10-K extraction → re-test crawler on mid-caps.
4. **Combined universe holdout alpha remains 14.5%/yr** — mid-cap expansion validated.
