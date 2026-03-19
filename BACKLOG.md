# AV Framework — Enhancement Backlog

Last updated: 2026-03-19
Source: Calibration study (30-case backtest, March 2026)

---

## Priority 1: Franchise Quality ROE Modifier for P/E × P/B

**Problem:** American Express (AXP) returned +42% at 3yr and +115% at 5yr but was rejected because pe_x_pb = 56, exceeding even the calibrated ceiling of 40. Companies with durable brand franchises and high returns on equity (AXP, Visa, Mastercard) permanently trade at elevated P/B because their competitive advantage is intangible — brand equity, network effects, customer switching costs — not physical assets.

**Proposed solution:** Add an ROE-based modifier to the pe_x_pb ceiling. If a company has sustained ROE above a threshold (e.g., 20%+ averaged over 5 years), increase the pe_x_pb ceiling proportionally. For example:
- Base ceiling: 40
- ROE 20-30%: ceiling × 1.25 = 50
- ROE 30%+: ceiling × 1.50 = 60

**Calibration need:** Test this against the 30-case dataset to verify it captures AXP without letting in traps. Most traps in the dataset had mediocre ROE, so the modifier should be fairly safe.

**Risk:** Could let in overvalued high-ROE stocks during bubble conditions. Mitigated by the Graham formula's AAA yield adjustment and the margin of safety.

---

## Priority 2: Live Re-Screen Mode

**Problem:** Reports are generated at a point in time, but stock prices and financial data change. The CB (Chubb) report showed the stock oscillating around the buy-below price within a single trading session. The P/B drifted from 1.67 to 1.75 between the report and live market data, potentially flipping a filter from pass to fail.

**Proposed solution:** Three-tier on-demand checking:
- **Price check mode:** Pull current price, compare against stored buy-below from last report. One API call. Answers "is this still actionable?"
- **Re-screen mode:** Pull current price, P/E, P/B, recompute Layer 1 filters and Layer 2 valuation with live data. 2-3 API calls. Catches data drift like the P/B issue.
- **Full refresh mode:** Re-run everything including attractor analysis via Claude API call. More expensive but gives complete updated picture.

Build price check first, re-screen second, full refresh later.

---

## Priority 3: Attractor Analysis Test Suite

**Problem:** The calibration study identified 4 false positives (INTC, M, WBA, WFC) that pass quantitative screening but were destroyed by competitive collapse, secular disruption, or regulatory risk. No ratio threshold catches these without also rejecting good stocks. The attractor stability analysis is the intended mechanism, but it has no empirical validation.

**Proposed solution:** Use these 4 cases plus the traps that marginally failed screening (AT&T, Kraft Heinz) as a test suite for the attractor analysis. For each case, run the bull/bear attractor scoring using the financial data available at the entry date and verify that:
- The bear case identifies the specific risk that destroyed the stock
- The composite attractor score is low enough to either reject the stock or demand a sufficient margin of safety
- The secular disruption module flags the relevant indicators

This is manual testing, not automated — run the 6 cases through the attractor prompt and review the output qualitatively.

---

## Priority 4: Outcome-Based Confidence Bands

**Problem:** The framework generates binary BUY / NO_SIGNAL outputs. A stock at $329 with a buy-below of $330.81 (CB) gets the same BUY signal as a stock at $200 with a buy-below of $330. The calibration study showed that stocks right on the threshold are the most likely to flip signals on small data changes.

**Proposed solution:** Add confidence bands to the signal:
- STRONG BUY: price ≤ 90% of buy-below (significant discount)
- BUY: price ≤ buy-below (standard signal)
- MARGINAL BUY: price within 5% above buy-below (technically actionable but fragile)
- NO_SIGNAL: price > 105% of buy-below

---

## Priority 5: Mixed Outcome Classification

**Problem:** The calibration dataset forced binary winner/trap classification, but several Buffett picks (VZ, USB, ALLY) delivered flat to negative returns. Treating negative-return Buffett picks as "winners" inflates the apparent false negative rate; treating them as traps inflates the false positive rate.

**Proposed solution:** Add a third outcome class "mixed" for cases with ambiguous results. Adjust the scoring logic to handle three classes — exclude mixed cases from precision/recall calculations but track them separately. This improves the calibration tool's accuracy for future parameter tuning.
