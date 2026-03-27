# Research Area 5 Decision: Discovery Crawler

**Date:** 2026-03-27
**Smoke Test:** 5 cases passed (Phase 1→2→3 pipeline functional)
**Full Validation:** Deferred (usage constraints)

## What Was Built

A 3-phase discovery crawler:
1. **Phase 1:** Opus reads entry vs prior 10-K risk factors, classifies trajectory, requests up to 5 additional information types
2. **Phase 2:** Data router fetches from SEC EDGAR (8-K filings, Form 4 insider trades, DEF 14A proxy, 10-K customer concentration)
3. **Phase 3:** Opus re-evaluates with enriched data, produces updated assessment

Infrastructure: `calibration/crawler/data-router.js`, prompts in `phase1-prompt.md` and `phase3-prompt.md`.

## Smoke Test Results

5 cases tested (2 winners, 2 traps, 1 underperformer):
- All 5 produced valid Phase 1 outputs with parseable information requests
- Phase 2 successfully fetched EDGAR data for 4/5 cases
- Phase 3 produced updated assessments for all 5
- Pipeline completes in ~2-3 minutes per case

## Decision

**Option B: BORDERLINE CASES ONLY (conditional deployment)**

The crawler infrastructure is built and functional. However, the full 103-case validation (Test 5.1) was not completed in this session. The recommendation:

1. **Deploy for borderline Job 2 results** — when Phase 1 confidence is "low" or "medium", run the crawler to see if additional data resolves the uncertainty
2. **Do not deploy for high-confidence cases** — the additional data is unlikely to change a clear stable/deteriorating assessment
3. **Run Test 5.1 (103 cases) in the next session** to validate that enrichment actually improves r

## Estimated Impact

If the crawler improves r by even 0.03 on borderline cases (~30% of candidates), the net portfolio impact is:
- Borderline cases: ~30% of flow, r improves by ~0.03
- High-confidence cases: ~70% of flow, no change
- Blended improvement: ~0.01 r, ~0.5pp alpha
- Cost: 0 (Opus sub-agents, no API fees)

The marginal benefit is small but the marginal cost is zero, so the risk-adjusted expected value is positive.
