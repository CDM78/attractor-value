# Crawler Out-of-Sample Validation — Mid-Caps (Identity-Blinded)

**Date:** 2026-03-27
**N:** 80 mid-cap cases (40 winners, 40 traps), market cap <$8B, non-tech preferred
**Method:** Financial summary + EDGAR enrichment (insider, proxy), CIK-only (no ticker/name)

## Results

```
                              | S&P 500 (n=103)  | Mid-Cap (n=80)
──────────────────────────────┼──────────────────┼─────────────────
Baseline r                    | 0.316            | 0.243
Enriched r (+ crawler)        | 0.564            | 0.234
Delta r                       | +0.248           | -0.009
──────────────────────────────┼──────────────────┼─────────────────
Classification changes        | 23/103 (22.3%)   | 1/80 (1.3%)
Correct improvements          | 17               | 0
Incorrect changes             | 0                | 1
```

## Verdict: CRAWLER NOT VALIDATED — but test is compromised

The enrichment adds nothing on mid-caps. The r=0.564 on S&P 500 contains significant
training data contamination (Opus recognizing Apple, Intel, Netflix, etc.).

**HOWEVER, this test does NOT prove the crawler concept fails.** The enrichment pipeline
is fundamentally broken on mid-caps:

1. **Insider trading parser:** Returns "0 buys, 0 sells, mixed" for ALL 80 cases.
   The Form 4 parser counts filings but doesn't extract transaction codes (buy vs sell).
   This was the #1 most impactful source on S&P 500 — it's completely inoperative here.

2. **Customer concentration:** 0/80 cases have data. Mid-caps don't have extracted 10-K
   text, so the text-search approach returns nothing. This was the #1 enrichment source
   on S&P 500 (31% of impact).

3. **Management proxy:** Works (95% coverage) but mostly returns boilerplate excerpts.
   Only 1 case triggered a reclassification.

## What We CAN Conclude

The **baseline** financial assessment (no crawler, just revenue/EPS trends) achieves:
- **r=0.243 on mid-caps** (n=80, identity-blinded)
- vs r=0.316 on S&P 500 (with full 10-K text)
- vs r=0.378 on original S&P 500 (with company names, N=33)

This confirms that Opus CAN discriminate winners from traps on unknown mid-caps
using only financial data (r=0.243 is respectable), but the effect is weaker than
on S&P 500 where Opus has more training knowledge.

## Decision: Option B — CONDITIONAL DEPLOYMENT

- **Deploy crawler on S&P 500 candidates** where it works (r=0.564 includes some
  contamination, but the mechanism is partially real — customer concentration and
  management proxy provide genuine signal when 10-K text is available)
- **Do NOT deploy crawler on mid-caps** until the Form 4 parser is fixed and
  10-K text extraction is built for mid-cap companies
- **Fix the Form 4 parser** as the highest-priority data pipeline improvement

## Items to Fix Before Re-Testing

1. **Form 4 buy/sell extraction:** Parse the XML transaction codes (A=acquisition,
   D=disposition, P=purchase, S=sale) instead of just counting filings
2. **Mid-cap 10-K text extraction:** Run the EDGAR sections connector on mid-cap
   companies to extract Item 1A risk factors
3. **Revenue data normalization:** Several cases show apparent 50-70% revenue drops
   that are actually annual-vs-quarterly mixing in the EDGAR data
