# Dataset Build Status — Final
Updated: 2026-03-24

## Calibration Cases: 2,832 total (frozen)

| Source | File | Cases | W | T | U | M |
|--------|------|-------|---|---|---|---|
| S&P 500 cross-section 2013 | systematic-sp500-crosssection-2013.json | 373 | 155 | 62 | 83 | 73 |
| S&P 500 cross-section 2016 | systematic-sp500-crosssection-2016.json | 399 | 135 | 98 | 94 | 72 |
| S&P 500 cross-section 2019 | systematic-sp500-crosssection.json | 433 | 137 | 33 | 222 | 41 |
| S&P 500 cross-section 2022 | systematic-sp500-crosssection-2022.json | 468 | 110 | 194 | 97 | 67 |
| S&P 500 changes 2010-24 | systematic-sp500-changes.json | 263 | 77 | 90 | 70 | 26 |
| Small-cap | systematic-smallcap.json | 169 | 72 | 51 | 31 | 15 |
| ADR/International | systematic-adr.json | 100 | 29 | 33 | 23 | 15 |
| Multi-entry expansion | systematic-multi-entry.json | 596 | 212 | 138 | 148 | 98 |
| Fraud/SEC enforcement | systematic-fraud.json | 31 | 0 | 31 | 0 | 0 |

**Totals:** 927 winners, 730 traps, 768 underperform, 407 mixed

## Unconventional Data Pools

| # | Pool | File | Entries | With Data | Coverage |
|---|------|------|---------|-----------|----------|
| 16 | Price/Volume | price-volume-dynamics.json | 2,803 | 2,803 | ~99% |
| 17 | FRED Economic | economic-context.json | 181 | 181 | 100% |
| 3 | SEC Filing Metadata | sec-filing-metadata.json | 629 | 629 | ~95% |
| 9 | Customer Concentration | customer-concentration.json | 300 | 296 | 99% |
| 14 | Wikipedia Page Views | wikipedia-pageviews.json | 321 | 130 | 40% |
| 5 | FDA Clinical Trials | clinical-trials.json | 59 | 34 | 58% (healthcare only) |
| 13 | GitHub Activity | github-activity.json | 50 | 26 | 52% (tech only) |
| 1 | Patents (USPTO) | patent-data.json | 100 | 0 | BLOCKED (API discontinued) |
| 2 | Federal Contracts | federal-contracts.json | 200 | 0 | BLOCKED (API unreachable) |

## EDGAR Cache
- 700+ companyfacts JSON files in data/edgar-cache/
- Covers all tickers across all systematic sources

## Research Agent Manifest
- `data/research-agent-manifest.json` — complete inventory

## Not Built (lower priority)
- Pool 4: H-1B Visa Filings (DOL bulk download — not attempted)
- Pool 6: EPA Compliance (ECHO database — not attempted)
- Pool 7: OSHA Safety (DOL enforcement data — not attempted)
- Pool 8: Executive Compensation (DEF 14A parsing — complex, not attempted)
- Pool 10: Options Market (limited historical depth)
- Pool 11: Short Interest (limited historical depth)
- Pool 12: Related Party Transactions (10-K text mining — not attempted)
- Pool 15: WARN Act Layoffs (scattered state databases — not attempted)
