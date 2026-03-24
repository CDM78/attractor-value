# Unconventional Data Pool Summary

| Pool | File | Total | With Data | Coverage |
|------|------|-------|-----------|----------|
| Price/Volume Dynamics | price-volume-dynamics.json | 2803 | 0 | 0% |
| FRED Economic Context | economic-context.json | 181 | 0 | 0% |
| SEC Filing Metadata | sec-filing-metadata.json | 629 | 0 | 0% |
| Wikipedia Page Views | wikipedia-pageviews.json | 321 | 130 | 40% |
| FDA Clinical Trials | clinical-trials.json | 59 | 34 | 58% |
| GitHub Activity | github-activity.json | 50 | 26 | 52% |
| Customer Concentration | customer-concentration.json | 300 | 296 | 99% |
| Federal Contracts | federal-contracts.json | 200 | 0 | 0% |
| Patent Data (USPTO) | patent-data.json | 100 | 0 | 0% |

## Notes

- Patent data: PatentsView API v1 discontinued (410 Gone), v2 requires API key
- Federal contracts: USAspending.gov API returning fetch errors (may be temporarily down)
- GitHub: Rate limited to 60 req/hr unauthenticated — partial coverage
- Wikipedia: Coverage depends on company name → article name matching quality
- Clinical trials: Only searched for healthcare/biotech/pharma sector companies
- Customer concentration: Extracted from EDGAR EFTS full-text search for concentration mentions in 10-K filings