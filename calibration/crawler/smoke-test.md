# Discovery Crawler Smoke Test Results

**Run date**: 2026-03-26
**Cases tested**: 5/5 complete, 0 skipped

## Pipeline Summary

Three-phase pipeline executed end-to-end for all 5 cases:

1. **Phase 1** — Heuristic risk factor analysis comparing current vs prior 10-K Item 1A text (keyword density, length change, paragraph count)
2. **Phase 2** — Data router fetched supplementary SEC data (8-K search, Form 4 insider filings, DEF 14A proxy, customer concentration text search)
3. **Phase 3** — Enriched assessment incorporating Phase 2 data signals

## Results by Case

| Ticker | Outcome | Sector | Phase 1 | Phase 3 | Changed? | Key Insight |
|--------|---------|--------|---------|---------|----------|-------------|
| BIIB | winner | Health Care | stable/high | stable/high | No | Limited supplementary data; stable assessment maintained |
| EXPE | underperform | Unknown | stable/medium | stable/medium | No | 3 data sources confirmed stable trajectory |
| ADM | trap | Unknown | deteriorating/high | deteriorating/high | No | Management data confirmed deteriorating trajectory |
| APD | underperform | Unknown | stable/high | stable/high | No | 3 data sources confirmed stable trajectory |
| WM | winner | Unknown | deteriorating/medium | deteriorating/medium | No | Limited supplementary data; deteriorating maintained |

## Phase 2 Data Source Availability

- **SEC_FILING (EFTS 8-K search)**: Returned 404 for all queries — EFTS `search-index` endpoint may require different URL format or is deprecated
- **INSIDER_TRADING (Form 4)**: Successfully returned data for EXPE, ADM, APD; BIIB and WM had no Form 4s in trailing 12 months (historical dates too old)
- **MANAGEMENT (DEF 14A)**: Successfully found proxy statements and extracted compensation sections for ADM and APD
- **CUSTOMER_CONCENTRATION**: Found concentration references in EXPE, ADM, APD text; not found in BIIB or WM risk factors

## Observations

1. The heuristic Phase 1 analysis correctly flagged ADM (trap) as deteriorating — its risk factor text nearly doubled in length
2. WM (winner) was flagged as deteriorating due to 24% length increase, which is a false positive — length increase alone is insufficient
3. Phase 2 enrichment did not change any classifications in this run; the data sources provide confirmation rather than contradiction
4. The EFTS search-index endpoint needs investigation — may need to use the full-text search API (`/LATEST/search-index` vs `/LATEST/search-index`)
5. For older cases (2012-2013 entry dates), fewer SEC data sources return results since the submissions endpoint only covers recent filings

## Next Steps

- Replace heuristic Phase 1 with actual Claude Opus analysis of risk factor text
- Fix EFTS 8-K search URL (may need `/LATEST/search-index` or EDGAR full-text search API)
- Add caching layer to avoid redundant EDGAR fetches
- Evaluate against larger case set for statistical significance
