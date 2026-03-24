# Dataset Build Status
Updated: 2026-03-24

## Calibration Cases: 2,832 total

| Source | File | Cases | W | T | U | M | Status |
|--------|------|-------|---|---|---|---|--------|
| S&P 500 cross-section 2013 | systematic-sp500-crosssection-2013.json | 373 | 155 | 62 | 83 | 73 | DONE |
| S&P 500 cross-section 2016 | systematic-sp500-crosssection-2016.json | 399 | 135 | 98 | 94 | 72 | DONE |
| S&P 500 cross-section 2019 | systematic-sp500-crosssection.json | 433 | 137 | 33 | 222 | 41 | DONE |
| S&P 500 cross-section 2022 | systematic-sp500-crosssection-2022.json | 468 | 110 | 194 | 97 | 67 | DONE |
| S&P 500 changes 2010-24 | systematic-sp500-changes.json | 263 | 77 | 90 | 70 | 26 | DONE |
| Small-cap | systematic-smallcap.json | 169 | 72 | 51 | 31 | 15 | DONE |
| ADR/International | systematic-adr.json | 100 | 29 | 33 | 23 | 15 | DONE |
| Multi-entry expansion | systematic-multi-entry.json | 596 | 212 | 138 | 148 | 98 | DONE |
| Fraud/SEC enforcement | systematic-fraud.json | 31 | 0 | 31 | 0 | 0 | DONE |

## Unconventional Data Pools

| Pool | File | Coverage | Status |
|------|------|----------|--------|
| Price/Volume | unconventional/price-volume-dynamics.json | 2,803 entries | DONE |
| FRED Economic Context | unconventional/economic-context.json | 181 dates | DONE |
| SEC Filing Metadata | unconventional/sec-filing-metadata.json | 629 tickers | DONE |
| Patents (USPTO) | — | 0% | BLOCKED (API discontinued) |
| Federal Contracts | — | 0% | NOT STARTED |

## EDGAR Cache
- 700 companyfacts JSON files in data/edgar-cache/
- Covers all tickers across all sources

## Research Agent Manifest
- data/research-agent-manifest.json — complete inventory for autonomous research

## What's NOT Done
- Part 2 (expanded ADR) — kept at 100 cases, sufficient for cross-population analysis
- Part 3 (expanded small-cap) — kept at 169 cases
- Part 4A (patents) — PatentsView API v1 discontinued, v2 requires registration
- Part 4B (federal contracts) — USAspending API not attempted
