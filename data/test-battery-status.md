# Test Battery Execution Status
Updated: 2026-03-24

## Completed
- Phase 0: Data loading + shared intermediates (691 cases, 467 W/T)
- Phase 2: Tests 30, 31, 32, 39, 40 — 3 PASS, 2 FAIL
- Phase 3: Tests 26, 35, 12, 23, 38, 41 — 4 PASS, 1 FAIL, 1 INCONCLUSIVE
- Phase 4: Tests 24, 33, 36, 34, 16 — 3 PASS, 2 FAIL
- Phase 5-8 partial: Tests 19, 17, 20, 21, 29 — 2 PASS, 2 FAIL, 1 SKIP
- Phase 9: Signal inventory (20 signals at p<0.05)

## Not Yet Run
- Test 10 (Lyapunov exponent) — computationally expensive
- Test 11 (Correlation dimension) — computationally expensive
- Test 13 (Flywheel momentum) — needs rank-based computation
- Test 14 (Ergodicity gap) — needs post-entry price data
- Test 15 (Symmetry breaking) — needs sector-wide data
- Test 18 (Transfer entropy) — very computationally expensive
- Test 22 (Competitive ecology) — needs sector competitors
- Test 25 (Control theory) — needs investment lag analysis
- Test 27 (Adverse selection) — needs Form 4 data
- Test 28 (Information efficiency) — needs analyst/institutional data
- Test 37 (Earnings gravity) — needs IV estimates + post-entry prices

## Remaining Phase 9 Work
- 5-fold cross-validation on all 20 passing signals
- Spearman correlation matrix for redundancy
- Greedy forward selection from Zipf+D1 baseline
- Final combination recommendation

## Key Finding
Test 20 (dissipative efficiency, r=0.287) is a NEW top-tier signal nearly
matching D1 growth. Marketing efficiency (Test 39, 75.8% WR for network
effect candidates) is the strongest categorical signal.
