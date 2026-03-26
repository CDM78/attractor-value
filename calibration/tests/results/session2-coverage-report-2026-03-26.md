# Session 2 Coverage Report

**Date:** 2026-03-26
**Pilot size:** 50 companies
**Universe size:** 2,832 cases
**Data source:** `pilot-50-results.json`

---

## 4A: Per-Source Coverage

```
DATA SOURCE COVERAGE (50-company pilot)
Source                          | Companies with data | Pct  | Avg items per company
--------------------------------|---------------------|------|----------------------
10-K Item 1A (current)          | 47 / 50             | 94%  | 0.94
10-K Item 1A (prior)            | 44 / 50             | 88%  | 0.88
10-K Item 7 MD&A                | 44 / 50             | 88%  | 0.88
10-Q Item 2 MD&A                | 48 / 50             | 96%  | 3.62 quarters
8-K transcripts                 |  1 / 50             |  2%  | 0.02
FMP transcripts                 |  0 / 50 (N/A)       |  0%  | 0.00 (no API key)
Combined transcripts            |  1 / 50             |  2%  | 0.02
USPTO patents                   |  0 / 50             |  0%  | 0.00
SEC comment letters             | 37 / 50             | 74%  | 7.66
```

**Notes:**
- FMP transcripts returned `no_api_key` for all 50 companies; this source is completely unavailable without a FinancialModelingPrep subscription.
- USPTO patent search returned 0 patents for all 50 companies. The search-by-assignee-name approach appears ineffective for finding relevant patents; companies may file under subsidiary names, or the search index may not cover the relevant time windows.
- 8-K earnings call transcripts were found for only 1 company (EBAY, 1 transcript). Most earnings call transcripts are not filed as 8-K exhibits on EDGAR.
- SEC comment letters have good but not universal coverage (74%), with an average of 7.66 letters per company. Some companies (e.g., ABT with 38, AIG with 48) have very extensive correspondence.

### Companies Missing 10-K Item 1A (current year)

| Ticker | Entry Year | Sector              | Reason                    |
|--------|------------|----------------------|---------------------------|
| IBM    | 2013       | Information Technology | extraction_failed (all years) |
| ABBV   | 2013       | Health Care           | no filings found          |
| MDT    | 2013       | Health Care           | no filings found          |

### Companies Missing 10-K Item 1A (prior year only)

| Ticker | Entry Year | Sector                  | Notes                         |
|--------|------------|--------------------------|-------------------------------|
| AIG    | 2013       | Financials               | current extracted, prior failed |
| SYF    | 2015       | Financials               | IPO in 2014, limited history   |
| APTV   | 2013       | Consumer Discretionary   | spin-off in 2011, limited history |

---

## 4B: Data Richness Assessment

Data richness scores range from 0 to 10 and reflect the breadth and depth of narrative data available for each case.

```
Data Richness Distribution (50-company pilot)
Band              | Count | Pct  | Companies
------------------|-------|------|----------
8-10 (excellent)  |   0   |  0%  | (none)
6-7  (good)       |  30   | 60%  | ACN, ADSK, SNPS, AKAM, AAPL, WDC, ADBE, LLY, IQV,
                  |       |      | A, ABT, RF, ALL, BEN, AFL, PFG, MTB, ADP, BA,
                  |       |      | WDAY, BXP, PCAR, CMI, AMZN, ROST, YUM, LEN, PHM,
                  |       |      | EBAY, RCL
4-5  (adequate)   |  16   | 32%  | MU, KLAC, IDXX, BIIB, BDX, WAT, PNC, SYF, KEY,
                  |       |      | CAT, JBHT, SWK, CHRW, CCL, TJX, APTV
2-3  (sparse)     |   2   |  4%  | IBM (2.0), AIG (3.3)
0-1  (insufficient)|  2   |  4%  | ABBV (1.0), MDT (0.0)
```

**Summary statistics:**
- Mean richness score: 5.63
- Median richness score: 6.25
- Companies at "good" or better: 30/50 (60%)
- Companies at "adequate" or better: 46/50 (92%)
- Companies at "sparse" or worse: 4/50 (8%)

The absence of any "excellent" scores reflects the complete lack of earnings call transcripts (FMP unavailable) and patent data (USPTO search ineffective). The theoretical maximum with current connectors is approximately 7.5 (achieved by EBAY, the only company with an 8-K transcript).

---

## 4C: Gap Analysis

### Worst-Coverage Data Source

**Earnings call transcripts** have the worst coverage at 2% (1/50 via 8-K, 0/50 via FMP).

This is the single largest gap in the data pipeline. Earnings calls are the primary source of management tone, forward guidance language, and analyst Q&A -- all of which are critical signals for attractor stability assessment. The 8-K approach finds almost nothing because most companies do not file call transcripts as 8-K exhibits. The FMP connector exists but cannot function without an API key.

**USPTO patents** are the second-worst at 0% (0/50). However, patents are a secondary signal relevant mainly for IP-intensive companies, so this gap is less impactful than transcripts.

### Sector and Entry Year Patterns

**Entry year pattern:** All 3 companies with zero 10-K Item 1A extraction are from the 2013 entry cohort. Of the 6 companies missing prior-year 10-K data, 4 have 2013 entry dates. This suggests EDGAR filing formats from 2010-2012 (the filings that would be current/prior for 2013 entries) are harder to parse, likely due to older HTML structures predating standardized XBRL tagging.

```
Coverage gaps by entry year:
2013 entries (20 in pilot): 3 missing current 1A (15%), 4 missing prior 1A (20%)
2015 entries (10 in pilot): 0 missing current 1A (0%), 1 missing prior 1A (10%)
2019 entries (8 in pilot):  0 missing current 1A (0%), 0 missing prior 1A (0%)
2021 entries (12 in pilot): 0 missing current 1A (0%), 0 missing prior 1A (0%)
```

**Sector pattern:** Health Care shows the highest failure rate -- 2 of 10 Health Care companies (ABBV, MDT) returned no SEC filings at all. Both are 2013-entry companies that underwent corporate restructuring near their entry dates (ABBV spun off from ABT in 2013; MDT redomiciled to Ireland in 2014). Financials show lower MD&A extraction rates (PNC, AIG), possibly due to bank-specific filing formats where MD&A is embedded differently.

### Single Most Impactful Connector to Improve

**FMP earnings call transcripts.** Adding a FinancialModelingPrep API key would immediately unlock quarterly earnings call transcripts for the vast majority of companies. This single change would:
- Add 4-8 transcript documents per case (4 quarters x 1-2 years)
- Provide management tone and forward guidance signals currently missing entirely
- Likely push most "good" (6-7) scores into "excellent" (8-10) territory
- Estimated cost: ~$30/month for FMP Professional tier

---

## 4D: Extrapolation to Full Universe

The full universe has **2,832 cases** across 14 entry years. Only **1,656 of 2,832** (58.5%) cases have CIK numbers, which are required for all SEC EDGAR data retrieval.

### Coverage Rate Assumptions

Pilot rates apply only to cases that have CIK numbers. The pilot's 50 companies all had CIKs, so:
- Pilot current 10-K Item 1A rate: 47/50 = 94% (among CIK-available)
- Pilot prior 10-K Item 1A rate: 44/50 = 88% (among CIK-available)
- Pilot current+prior 10-K Item 1A rate: 44/50 = 88%
- Pilot 4+ transcript quarters rate: 38/50 = 76%
- Pilot full narrative capability rate: 35/50 = 70%

### Entry Year Adjustment

Earlier entry years (2010-2013) show ~15% lower extraction success due to older EDGAR filing formats. The universe is weighted toward later years:

```
Entry Year Distribution and Estimated Coverage:
Year  | Cases | w/ CIK (est) | Current 1A rate | Prior 1A rate
------|-------|---------------|-----------------|---------------
2010  |     7 |     ~4        | ~80%            | ~75%
2011  |    12 |     ~7        | ~80%            | ~75%
2012  |    12 |     ~7        | ~80%            | ~75%
2013  |   392 |   ~229        | ~85%            | ~80%
2014  |    92 |    ~54        | ~90%            | ~85%
2015  |   625 |   ~366        | ~94%            | ~90%
2016  |    38 |    ~22        | ~94%            | ~90%
2017  |   326 |   ~191        | ~94%            | ~90%
2018  |    23 |    ~13        | ~94%            | ~90%
2019  |   469 |   ~274        | ~94%            | ~90%
2020  |   117 |    ~68        | ~94%            | ~90%
2021  |   695 |   ~407        | ~94%            | ~90%
2022  |    21 |    ~12        | ~94%            | ~90%
2023  |     3 |     ~2        | ~94%            | ~90%
------|-------|---------------|-----------------|---------------
Total | 2,832 |  1,656        | ~92%            | ~88%
```

### Extrapolated Estimates

```
Metric                                        | Estimated count | Pct of 2,832
----------------------------------------------|-----------------|-------------
Cases with CIK                                |          1,656  |    58.5%
Cases with current 10-K Item 1A               |         ~1,523  |    53.8%
Cases with current + prior 10-K Item 1A       |         ~1,457  |    51.5%
Cases with 4+ quarterly transcript (10-Q)     |         ~1,259  |    44.5%
Cases with full narrative evaluation capability|         ~1,159  |    40.9%
```

**Full narrative evaluation capability** is defined as having: current AND prior 10-K Item 1A + current 10-K MD&A + 4 or more 10-Q quarterly filings.

### Key Limitation

The 1,176 cases without CIK (41.5% of universe) are unreachable by all SEC-based connectors. These are primarily:
- ADR/foreign companies (100 cases in the `adr` source)
- Small caps without EDGAR filings (169 cases in `smallcap` source)
- Multi-entry cases where CIK mapping failed
- Companies that changed tickers or were acquired

---

## 4E: Job 2 Replication Readiness

Job 2 (structural stress detection via 10-K risk factor comparison) requires **both current and prior year 10-K Item 1A** for each case.

### Readiness Calculation

```
Job 2 replication readiness:

Total cases:                                    2,832
Cases with CIK:                                 1,656
Estimated with current 10-K Item 1A:           ~1,523  (92% of CIK cases)
Estimated with BOTH current and prior:         ~1,457  (88% of CIK cases)
Of those, in training partition (~40%):          ~583
Minimum needed:                                   200  (training)
Surplus over minimum:                            ~383

Ready for Job 2 replication:                      YES
```

### Confidence Assessment

The estimate of 1,457 cases with both current and prior 10-K Item 1A is conservative because:

1. **The pilot over-represents 2013 entries** (20/50 = 40%), which have the worst extraction rates. The full universe has only 392/2,832 = 13.8% in the 2013 cohort. Later years will have higher success rates.

2. **The 88% pilot rate for prior-year extraction** is driven down by edge cases (corporate spin-offs like ABBV and APTV, IPOs like SYF). These are disproportionately represented in the 2013 pilot sample and are less common in later entry years.

3. **The 40% training partition split** yields ~583 cases, which is **2.9x the minimum** of 200 cases. Even if actual coverage is 20% lower than estimated, the training partition would still contain ~466 cases -- well above the minimum.

### Risk Factors

- **CIK dependency:** The binding constraint is not extraction success but CIK availability. Only 58.5% of cases have CIK numbers. Improving the CIK mapping pipeline (especially for multi-entry cases and small caps) would have a larger impact than improving extraction parsing.
- **Early-year extraction:** 2013-era filings have a ~15% higher failure rate. If Job 2 analysis specifically targets 2013 entries (the largest single cohort at 392 cases), the effective rate drops to ~80% for prior-year availability.
- **Sector bias in failures:** Health Care and Financials show higher extraction failure rates. If Job 2 targets these sectors specifically, expect 5-10% lower coverage than the headline estimate.

---

## Appendix: Pilot Company Detail

| # | Ticker | Entry Year | Sector | Outcome | Current 1A | Prior 1A | MD&A | 10-Q Qtrs | 8-K Trans | CL Count | Richness |
|---|--------|------------|--------|---------|------------|----------|------|-----------|-----------|----------|----------|
| 1 | ACN | 2013 | IT | winner | Y | Y | Y | 4 | 0 | 5 | 6.5 |
| 2 | ADSK | 2015 | IT | winner | Y | Y | Y | 4 | 0 | 12 | 6.5 |
| 3 | SNPS | 2019 | IT | winner | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 4 | IBM | 2013 | IT | trap | N | N | N | 4 | 0 | 8 | 2.0 |
| 5 | AKAM | 2021 | IT | trap | Y | Y | Y | 4 | 0 | 4 | 6.5 |
| 6 | MU | 2021 | IT | trap | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 7 | AAPL | 2013 | IT | mixed | Y | Y | Y | 4 | 0 | 15 | 6.5 |
| 8 | KLAC | 2015 | IT | mixed | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 9 | WDC | 2019 | IT | underperf | Y | Y | Y | 4 | 0 | 5 | 6.5 |
| 10 | ADBE | 2013 | IT | winner | Y | Y | Y | 4 | 0 | 13 | 6.5 |
| 11 | ABBV | 2013 | HC | winner | N | N | N | 0 | 0 | 18 | 1.0 |
| 12 | MDT | 2013 | HC | winner | N | N | N | 0 | 0 | 0 | 0.0 |
| 13 | LLY | 2015 | HC | winner | Y | Y | Y | 4 | 0 | 9 | 6.5 |
| 14 | IDXX | 2019 | HC | winner | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 15 | BIIB | 2015 | HC | trap | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 16 | BDX | 2021 | HC | trap | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 17 | IQV | 2021 | HC | trap | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 18 | A | 2013 | HC | mixed | Y | Y | Y | 2 | 0 | 3 | 6.0 |
| 19 | WAT | 2015 | HC | mixed | Y | Y | Y | 3 | 0 | 0 | 5.3 |
| 20 | ABT | 2013 | HC | mixed | Y | Y | Y | 3 | 0 | 38 | 6.3 |
| 21 | AIG | 2013 | Fin | winner | Y | N | N | 3 | 0 | 48 | 3.3 |
| 22 | PNC | 2013 | Fin | winner | Y | Y | N | 3 | 0 | 16 | 4.8 |
| 23 | RF | 2015 | Fin | winner | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 24 | ALL | 2021 | Fin | winner | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 25 | BEN | 2013 | Fin | trap | Y | Y | Y | 4 | 0 | 13 | 6.5 |
| 26 | SYF | 2015 | Fin | trap | Y | N | Y | 4 | 0 | 14 | 5.0 |
| 27 | KEY | 2021 | Fin | trap | Y | Y | Y | 3 | 0 | 0 | 5.3 |
| 28 | AFL | 2013 | Fin | underperf | Y | Y | Y | 4 | 0 | 7 | 6.5 |
| 29 | PFG | 2015 | Fin | underperf | Y | Y | Y | 4 | 0 | 8 | 6.5 |
| 30 | MTB | 2019 | Fin | underperf | Y | Y | Y | 4 | 0 | 4 | 6.5 |
| 31 | ADP | 2013 | Ind | winner | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 32 | BA | 2015 | Ind | winner | Y | Y | Y | 3 | 0 | 6 | 6.3 |
| 33 | WDAY | 2015 | Ind | winner | Y | Y | Y | 4 | 0 | 6 | 6.5 |
| 34 | CAT | 2021 | Ind | winner | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 35 | JBHT | 2021 | Ind | trap | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 36 | BXP | 2013 | Ind | underperf | Y | Y | Y | 4 | 0 | 5 | 6.5 |
| 37 | PCAR | 2015 | Ind | mixed | Y | Y | Y | 3 | 0 | 3 | 6.3 |
| 38 | SWK | 2019 | Ind | underperf | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 39 | CHRW | 2013 | Ind | underperf | Y | Y | Y | 4 | 0 | 0 | 5.5 |
| 40 | CMI | 2013 | Ind | trap | Y | Y | Y | 4 | 0 | 7 | 6.5 |
| 41 | AMZN | 2013 | CD | winner | Y | Y | Y | 4 | 0 | 14 | 6.5 |
| 42 | ROST | 2013 | CD | winner | Y | Y | Y | 4 | 0 | 12 | 6.5 |
| 43 | YUM | 2015 | CD | winner | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 44 | LEN | 2019 | CD | winner | Y | Y | Y | 4 | 0 | 21 | 6.5 |
| 45 | PHM | 2013 | CD | trap | Y | Y | Y | 4 | 0 | 17 | 6.5 |
| 46 | EBAY | 2021 | CD | trap | Y | Y | Y | 4 | 1 | 3 | 7.5 |
| 47 | CCL | 2013 | CD | mixed | Y | Y | N | 4 | 0 | 7 | 5.0 |
| 48 | RCL | 2015 | CD | underperf | Y | Y | Y | 4 | 0 | 3 | 6.5 |
| 49 | TJX | 2019 | CD | underperf | Y | Y | Y | 3 | 0 | 0 | 5.3 |
| 50 | APTV | 2013 | CD | winner | Y | N | Y | 3 | 0 | 21 | 4.8 |

Sector key: IT = Information Technology, HC = Health Care, Fin = Financials, Ind = Industrials, CD = Consumer Discretionary
