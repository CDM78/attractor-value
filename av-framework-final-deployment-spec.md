# AV Framework — Final Deployment Specification

## For Claude Code: Implement All Changes in This Document

Every parameter in this specification is backed by calibration data from a 10-test validation battery plus 15 parameter sweeps run against a 292-case historical dataset spanning 2016-2025. No arbitrary numbers remain. Changes from prior sessions (March 20 and March 22) that were validated but not yet deployed are also included.

---

## Validated Parameter Summary

| Parameter | Value | Evidence |
|-----------|-------|----------|
| Pipeline names | Crisis / Growth / Regime | Clarity — replaces confusing Tier/Pipeline numbering |
| Crisis allocation | 25% | Allocation sweep: 90% beat rate, best consistency |
| Growth allocation | 20% | Allocation sweep: Growth-heavy was worst config (Sharpe 2.72) |
| Regime allocation | 15% | Allocation sweep |
| Flexible pool | 35% | Allocation sweep: larger overflow for crisis bursts |
| Cash reserve | 0% | Cash reserve sweep: completely irrelevant under VOO hybrid model |
| Uninvested capital | VOO (Vanguard S&P 500, 0.03%) | Test 2: 83% → 97% beat rate. VOO vs VGSH: VOO wins by $72,506 |
| Growth pipeline mode | Sector ETFs (not individual stocks) | Tests 3 + sector ETF test: 83% beat rate vs 59% for individual stocks |
| Sector ETF threshold | ≥ 2 candidates per sector | Threshold sweep: 83% beat rate, 2.6 sectors, +21.8pp alpha |
| Regime pipeline mode | Individual stocks | Test 3: 79th percentile stock selection, 92% win rate |
| Take-profit trigger | +125% | Take-profit sweep: peak at +125%, +$29,187 vs hold |
| Emergency stop | Attractor < 2.0 | Kept for catastrophic risk prevention |
| Other sell triggers | Removed | Test 5: growth failure hurts (-$1,512), others negligible |
| Default hold period | 3 years | Hold period sweep: 3yr optimal, 5yr collapses to 33% beat rate |
| Max position size | 7% of total capital | Position size sweep: 86% → 97% beat rate at 7% |
| STRONG confidence | 7% (full position) | Unchanged ratio |
| STANDARD confidence | 5.25% (75% of max) | Multiplier sweep: flat curve, 75% is fine |
| Attractor gate | ≥ 3.0 | Threshold sweep: same beat rate, +5pp alpha over ≥ 2.5 |
| Bull/bear weighting | 40% bull / 60% bear | Weighting sweep: ratio doesn't affect discrimination |
| Graham Screen filters | 6 (removed dividend + P/B) | What-If battery: 0% CV gap, 64% improved, 0% degraded |
| Fat-tail discounts | 0% / 10% / 15% | Sweep: not load-bearing, keep current |
| Concentration penalties | Current values | Insufficient data to test; keep current |
| Regime scenario weights | Current (65/35, 55/45, 45/55) | Not testable in calibration tool; 100% precision regardless |
| Regime valuation params | 40% bull uplift, P/E 18/14 | Sweep: already maxed, all combos produce 100% precision |

---

## Change 0: Verify and Implement Prior Calibration-Validated Changes

### Why

Several changes were validated through calibration testing and discussed in planning sessions, but may not have been formally deployed to the live app. Before implementing the new changes, verify each of the following is in the codebase. If any are missing, implement them.

### Item A: Remove Secular Disruption Modifier

**Check:** Search the attractor scoring code for any "secular disruption" modifier, penalty, or adjustment applied after the bull/bear composite score is computed. This modifier was from Update 7 of the old system and was NOT included in the comprehensive restructuring spec.

**Expected state:** The attractor score should be the weighted composite (60% bear + 40% bull) minus concentration risk penalties ONLY. No secular disruption modifier.

**If found:** Remove it. The adversarial bear case already evaluates secular threats — a separate modifier double-counts them. Calibration showed this modifier dropped BMY from 2.7 to 1.2 incorrectly.

**Evidence:** Discussed in restructuring sessions. The bear case analyst explicitly evaluates industry-level structural threats as part of the six-factor scoring. Applying an additional penalty on top double-counts these risks.

### Item B: Remove Hard Market Cap Ceiling from Growth Pipeline

**Check:** Search the Tier 3 / Growth pre-screen for any hard market cap ceiling (previously $30B or $10B). There should be a $500M floor but NO ceiling.

**Expected state:** Growth pre-screen has `min_market_cap_m: 500` and no `max_market_cap_m` filter, or `max_market_cap_m` set to a very high number that effectively disables it.

**If a ceiling exists:** Remove it. The calibration data showed the $30B ceiling excluded CRWD, DDOG, SHOP, AXON, PANW — the canonical DKS companies the system was built to find. CrowdStrike's threat telemetry network effect doesn't stop working at $30B market cap. The DKS evaluation and attractor analysis handle quality filtering; a market cap ceiling adds nothing.

**Evidence:** Discussed and validated during the restructuring work. Market cap ceiling was identified as an uncalibrated filter that excluded exactly the companies the system should find.

### Item C: Scaling Exponent → Gross Margin > 0% for Regime Pipeline

**Check:** Search the Tier 4 / Regime beneficiary pre-screen for any scaling exponent requirement (e.g., `scaling_exponent > 1.0`). It should be replaced with `gross_margin > 0%`.

**Expected state:** Regime pre-screen filters are: sector overlap with active regime, gross margin > 0%, D/E < 3.0, current ratio > 0.8, CSI ≤ 1. No scaling exponent.

**If scaling exponent filter exists:** Replace with gross margin > 0%. The calibration tool tested this directly:
- Scaling exponent > 1.0: 50% precision, composite 0.440
- Gross margin > 0% + CSI ≤ 1: 100% precision, composite 0.920

The scaling exponent provided zero discrimination (coin flip precision). It blocked all 94 live candidates while catching no traps. Gross margin > 0% correctly rejects pre-revenue cash burners (PLUG, CHPT, RIDE, NKLA — all negative gross margin traps) while passing every winner.

**Evidence:** Calibration tool Tests A-F, commit in calibration tool. The live app's CC audit confirmed tier4Screen.js uses gross margin > 0% (line 140), but verify this is the actual deployed state.

### Implementation

For each item: check the codebase, report whether the change is already present or missing. Implement any that are missing. Commit as `fix: verify-prior-calibration-changes`.

Then proceed to Change 1.

---

## Change 1: Rename Tiers to Descriptive Names

### Mapping

| Old Name(s) | New Name | Role |
|---|---|---|
| Tier 1 / Layer 1 | **Graham Screen** | Quantitative value filter — feeds into Crisis pipeline. Not a pipeline. |
| Tier 2 / Pipeline 1 | **Crisis** | Quality companies during market panics. Graham valuation. |
| Tier 3 / Pipeline 2 | **Growth** | Sector-level DKS signal. Growth-adjusted valuation. |
| Tier 4 / Pipeline 3 | **Regime** | Structural shift beneficiaries. Scenario-weighted valuation. |

### Where to Change

**Frontend (React components):**
- Signal card badges: "Tier3" → "Growth", "Tier2" → "Crisis", "Tier4" → "Regime"
- Navigation, page titles, filter buttons
- Allocation chart: "T2 Crisis" → "Crisis", "T3 DKS" → "Growth", "T4 Regime" → "Regime"
- How It Works page — all headers and body text
- Settings page — allocation labels

**Backend (Workers):**
- Database enum values in candidates.discovery_tier
- API response payloads
- Report templates, signal engine logging, cron job logging

**Database migration:**

```sql
UPDATE candidates SET discovery_tier = 'crisis' WHERE discovery_tier = 'tier2';
UPDATE candidates SET discovery_tier = 'growth' WHERE discovery_tier = 'tier3';
UPDATE candidates SET discovery_tier = 'regime' WHERE discovery_tier = 'tier4';

UPDATE portfolio_config SET key = 'alloc_crisis' WHERE key = 'alloc_tier2';
UPDATE portfolio_config SET key = 'alloc_growth' WHERE key = 'alloc_tier3';
UPDATE portfolio_config SET key = 'alloc_regime' WHERE key = 'alloc_tier4';
```

Commit: `rename-tiers-to-descriptive`.

---

## Change 2: Portfolio Architecture — VOO Hybrid with Zero Cash Reserve

### Evidence

- Test 2: Hybrid VOO raises beat rate from 83% to 97%
- Cash reserve sweep: 0% produces identical results to 5% under the hybrid model
- VOO vs VGSH crisis test: VOO wins by $72,506 — keep everything in VOO, even crisis capital

### Mental Model

**All money is in VOO unless actively deployed in a framework position.** There is no idle cash. The pipeline allocations are budget caps, not reservations — they determine how much VOO to sell when signals fire.

### Implementation

**Database changes:**

```sql
ALTER TABLE holdings ADD COLUMN position_type TEXT DEFAULT 'framework';
-- position_type: 'framework' (pipeline positions) or 'parking' (VOO)
```

**When the user sets total capital ($27,000):**
1. The entire $27,000 is the investable pool — no cash reserve subtracted
2. Any portion not in framework positions is a single VOO parking position
3. When a BUY signal is executed: reduce VOO, open the framework position
4. When a framework position is sold: proceeds return to VOO

**Allocation budgets (caps, not reservations):**

```javascript
const ALLOCATIONS = {
  crisis:  0.25,  // $6,750 max deployed in Crisis positions
  growth:  0.20,  // $5,400 max deployed in Growth sector ETFs
  regime:  0.15,  // $4,050 max deployed in Regime individual stocks
  flexible: 0.35, // $9,450 overflow for any pipeline
  cash:    0.00,  // No idle cash — everything in VOO
};
```

**Dashboard display:**

```
Value: $27,000 | Invested: $12,000 (44%) | VOO Parking: $15,000 (56%) | NORMAL
```

The Holdings table shows VOO as a special row:

```
VOO (Parking)  |  Shares: XX  |  Value: $15,000  |  Return: +X.X%  |  [auto-managed]
```

**VOO parking position rules:**
- Cannot be manually sold or trimmed
- Automatically adjusts when framework positions open/close
- Shows its own return since initial deposit
- Not counted toward any pipeline's allocation
- When capital is added, it goes into VOO. When withdrawn, it comes from VOO.

**Position sizes are computed against total capital ($27,000), not against uninvested capital.**

Commit: `feat: voo-hybrid-zero-cash`.

---

## Change 3: Growth Pipeline → Sector ETF Mode

### Evidence

- Test 3: Growth stock selection at 62nd percentile vs random — barely better than chance
- Sector ETF test: sector ETFs beat VOO 83% of the time, individual stocks only 59%
- Attractor band analysis: no attractor score predicts individual stock > sector ETF outperformance
- Sector threshold sweep: ≥ 2 candidates optimal (83% beat rate, 2.6 sectors, +21.8pp alpha)

### Sector ETF Mapping

| Sector | Vanguard ETF | Ticker | Expense Ratio |
|--------|-------------|--------|---------------|
| Technology | Vanguard Information Technology | VGT | 0.10% |
| Healthcare | Vanguard Health Care | VHT | 0.10% |
| Industrials | Vanguard Industrials | VIS | 0.10% |
| Consumer Discretionary | Vanguard Consumer Discretionary | VCR | 0.10% |
| Financials | Vanguard Financials | VFH | 0.10% |
| Communication Services | Vanguard Communication Services | VOX | 0.10% |
| Energy | Vanguard Energy | VDE | 0.10% |
| Materials | Vanguard Materials | VAW | 0.10% |
| Broad Growth (fallback) | Vanguard Growth | VUG | 0.04% |

Store this mapping in a constants file or configuration table.

### Monthly Pre-Screen Output

After the Growth monthly pre-screen runs, add a sector aggregation step:

```javascript
const SECTOR_ETF_MAP = {
  'Technology': 'VGT', 'Healthcare': 'VHT', 'Industrials': 'VIS',
  'Consumer Discretionary': 'VCR', 'Financials': 'VFH',
  'Communication Services': 'VOX', 'Energy': 'VDE', 'Materials': 'VAW'
};

const MIN_CANDIDATES_FOR_SIGNAL = 2; // Calibration-validated threshold

// Aggregate passing candidates by sector
const sectorCounts = {};
const sectorDiscounts = {};

for (const candidate of passingCandidates) {
  const sector = candidate.sector || 'Unknown';
  sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
  if (candidate.discount_to_iv != null) {
    if (!sectorDiscounts[sector]) sectorDiscounts[sector] = [];
    sectorDiscounts[sector].push(candidate.discount_to_iv);
  }
}

// Generate sector signals
const sectorSignals = Object.entries(sectorCounts)
  .filter(([sector, count]) => count >= MIN_CANDIDATES_FOR_SIGNAL)
  .map(([sector, count]) => ({
    sector,
    etf: SECTOR_ETF_MAP[sector] || 'VUG',
    candidate_count: count,
    avg_discount: average(sectorDiscounts[sector] || []),
  }))
  .sort((a, b) => b.candidate_count - a.candidate_count);
```

### Allocation Within Growth Budget

The Growth budget ($5,400 at 20% of $27K) is distributed across sector ETFs weighted by candidate count:

```
Example: 15 Tech candidates, 7 Healthcare, 4 Industrials (26 total)
  VGT: $5,400 × (15/26) = $3,115
  VHT: $5,400 × (7/26) = $1,454
  VIS: $5,400 × (4/26) = $831
```

### Individual Stock Override

A Growth candidate can be bought as an individual stock instead of the sector ETF ONLY when all three conditions are met:

1. Attractor score ≥ 3.0 from Sonnet analysis
2. Opus deep analysis confirms attractor ≥ 3.0
3. Price is below buy-below from the Growth valuation model

This override is manual — the user clicks DEEP ANALYSIS then decides. The system's default recommendation is the sector ETF.

### Dashboard — Sector Signals Panel

Add a new section above individual stock signals:

```
SECTOR SIGNALS (Growth Pipeline)
┌─────────────────────────────────────────────────────────────────────┐
│ VGT  Vanguard Info Technology   15 candidates   Avg discount: 34%  │
│ Suggested allocation: $3,115   Buy ~XX shares                      │
│ [EXECUTE BUY]                                                      │
│                                                                    │
│ VHT  Vanguard Health Care       7 candidates   Avg discount: 22%  │
│ Suggested allocation: $1,454   Buy ~XX shares                      │
│ [EXECUTE BUY]                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

Individual Growth stock overrides (if any) appear below, clearly labeled:

```
INDIVIDUAL STOCK SIGNALS (Override — meets all 3 criteria)
┌─────────────────────────────────────────────────────────────────────┐
│ [ticker]  Growth  STRONG  Opus                                     │
│ Attractor 3.4 confirmed by Opus, 45% discount to IV               │
│ Price: $XX  Buy-below: $XX  IV: $XX                                │
│ Buy X shares ($X)   [EXECUTE BUY]                                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Sector Signal Exit

Exit a sector ETF position when the monthly pre-screen finds fewer than 2 candidates in that sector. Proceeds return to VOO parking. The +125% take-profit trigger also applies to sector ETF positions.

### Attractor Analysis Still Runs

Individual candidate attractor analysis continues for two purposes:
1. **Trap filtering** — if most candidates in a sector score < 2.5, the sector signal is suspect
2. **Individual stock override** — needed to evaluate specific stocks for the override criteria

But attractor analysis is no longer the primary decision-maker for Growth. The sector signal is.

Commit: `feat: growth-sector-etf-mode`.

---

## Change 4: Simplify Sell Engine to Two Triggers

### Evidence

- Take-profit sweep: +125% is the optimal threshold (+$29,187 vs hold, peak of the curve)
- Test 5: Growth failure trigger actively hurts (-$1,512). Max loss and attractor proxy negligible. Concentration trim never fires.
- Test 9: Overvaluation exit adds $11,389 after-tax across full trade lifecycle
- Hold period sweep: 3yr is optimal. 5yr collapses to 33% beat rate.

### Implementation

Replace the 6-trigger sell engine:

```javascript
// sellEngine.js — simplified, calibration-validated

function checkSellTriggers(position, currentPrice, portfolioValue, attractorScore) {
  const entryPrice = position.entry_price;
  const currentReturn = (currentPrice - entryPrice) / entryPrice;

  // Trigger 1: Take profit at +125% (sweep-validated optimum)
  if (currentReturn >= 1.25) {
    return {
      action: 'SELL',
      reason: `Take profit: +${(currentReturn * 100).toFixed(0)}% return exceeds +125% threshold`,
      urgency: 'standard',
      trigger: 'take_profit'
    };
  }

  // Trigger 2: Emergency stop — attractor dissolving
  if (attractorScore != null && attractorScore < 2.0) {
    return {
      action: 'SELL',
      reason: `Attractor dissolved: score ${attractorScore.toFixed(1)} below 2.0 emergency threshold`,
      urgency: 'immediate', // Overrides tax delay
      trigger: 'attractor_dissolution'
    };
  }

  // Default: hold until 3-year mark
  return null;
}
```

**Remove from the codebase:**
- Trigger 3 (thesis violation with red flags)
- Trigger 4 (concentration trim)
- Trigger 5 (growth failure — actively hurts returns)
- Trigger 6 (regime expiry)

**Tax awareness:** Keep existing tax delay logic for the +125% take-profit trigger only. If a position is held 300-365 days and hits +125%, calculate whether waiting for long-term capital gains (23% vs 40%) is worth the risk. The attractor dissolution trigger (< 2.0) always overrides tax delay.

**For sector ETF positions:** Both triggers apply. +125% take-profit on VGT works the same as on individual stocks. The sector signal exit (pre-screen drops below 2 candidates) is a separate, additional exit for sector ETFs only.

**Daily cron (5:15 PM ET):** For each open position, check current return against +125%. For positions with a recent attractor refresh, check score against 2.0. The 3-year hold clock ticks automatically.

Commit: `refactor: simplify-sell-engine`.

---

## Change 5: Update Position Sizing

### Evidence

- Position size sweep: 7% raises beat rate from 86% to 97% while maintaining 15 positions
- STANDARD multiplier sweep: flat curve, 75% is fine
- Cash reserve sweep: 0% under VOO hybrid — no idle cash needed

### Implementation

Update positionSizer.js constants:

```javascript
const ALLOCATIONS = {
  crisis:  0.25,
  growth:  0.20,
  regime:  0.15,
  flexible: 0.35,
  cash:    0.00,
};

const MAX_POSITION_PCT = 0.07;           // 7% of total capital (was 5%)
const CONFIDENCE_MULTIPLIERS = {
  STRONG: 1.0,                           // 7% = $1,890 on $27K
  STANDARD: 0.75,                        // 5.25% = $1,418 on $27K
};
```

**Position sizing for sector ETFs:** The Growth budget ($5,400) is allocated across sector ETFs by candidate count, not by the per-position max. Each sector ETF position can be larger than 7% because it's inherently diversified — you're buying a basket of 50-200 stocks, not one company. The 7% cap applies only to individual stock positions (Regime pipeline and Growth overrides).

Commit: `feat: update-position-sizing`.

---

## Change 6: Raise Attractor Gate to 3.0

### Evidence

- Attractor threshold sweep: ≥ 3.0 produces same 86% beat rate as ≥ 2.5, with +5pp additional alpha
- Drops 9 marginal signals from the 2.5-3.0 range that dragged returns
- Conservative choice vs ≥ 3.25 (which drops 17 signals but may filter real winners due to AI scoring noise)

### Implementation

Update signalEngine.js:

```javascript
// Hard reject: competitive position eroding
if (attractorScore < 2.0) {
  return { signal: 'PASS', reason: 'Attractor dissolving' };
}

// Soft reject: below quality threshold (raised from 2.5 to 3.0)
if (attractorScore < 3.0) {
  return { signal: 'PASS', reason: 'Attractor below 3.0 quality threshold' };
}

// Proceed to valuation...
```

**Note:** The sell engine's emergency stop remains at < 2.0 (not 3.0). A position that was bought at attractor 3.2 and drifts to 2.8 is weakening but not dissolving. The 2.0 threshold catches genuine collapses. The 3.0 threshold only applies to new BUY decisions.

**Update the attractor dissolution sell trigger description:** "Sell immediately if attractor score drops below 2.0" — unchanged. The 3.0 gate is for entry only.

Commit: `feat: raise-attractor-gate`.

---

## Change 7: Regime Pipeline — No Logic Changes

### Evidence

- Test 3: 79th percentile stock selection
- Test 9: 92% win rate, +153% average return
- Regime valuation sweep: 100% precision across all 25 parameter combinations

### Changes

Only the naming: "Tier 4" → "Regime" everywhere. All screening, valuation, and signal logic stays identical. The scenario weights (65/35, 55/45, 45/55 by Adjacent Possible), bull uplift (40%), bear growth (5%), and terminal P/E (18/14) are all validated — 100% precision means every combination works.

---

## Change 8: Graham Screen — Remove Dividend and P/B Filters

### Evidence

From the March 22 What-If battery (tested against 292-case dataset):

- **Remove dividend filter:** Captures AAPL (Berkshire's largest position, which didn't pay dividends for years). 0% cross-validation gap. Bootstrap: 64% of resamples improved, 36% no change, 0% degraded.
- **Remove P/B filter:** Same AAPL flip. P/B is systematically broken by share buybacks — AAPL, DVA, HPQ, AXP all have distorted or negative book values from buyback programs. The P/E×P/B composite (with ROE modifier, already at ceiling 40) provides sufficient valuation discipline without a standalone P/B gate.
- **Combined removal:** Same single flip (AAPL), no interaction effects. T1 live signals added 19 new candidates, 3 flagged for review (BIIB, HWC, VIRT — low attractor scores that the ≥ 3.0 gate now catches). None have negative book value — the P/B removal adds moderately high P/B stocks, not broken-equity companies.

Status in AV-FRAMEWORK-STATUS.md: "Ready to Deploy — ACCEPT. Can deploy independently."

### Implementation

The Graham Screen currently has 8 hard filters. Remove filters #2 (P/B) and #7 (Dividend Record), leaving 6 filters:

```javascript
// Graham Screen — 6 filters (was 8)
// REMOVED: P/B ≤ sector 33rd percentile (buyback-distorted, covered by P/E×P/B composite)
// REMOVED: Dividend Record ≥ 5 years (excludes best capital allocators like BRK, early AAPL)

const GRAHAM_FILTERS = {
  pe_ceiling: dynamicFromAAA,              // #1: P/E ≤ 1/(AAA + 1.5%)
  // P/B filter REMOVED
  pe_x_pb_ceiling: 40,                    // #3: P/E×P/B ≤ 40 (with ROE modifier)
  debt_equity: 1.0,                        // #4: D/E ≤ 1.0 industrial, ≤ 2.0 utility
  current_ratio: 1.0,                      // #5: CR ≥ 1.0
  earnings_stability: 8,                   // #6: ≥ 8/10 years positive EPS
  // Dividend filter REMOVED
  earnings_growth: 0.03,                   // #8: ≥ 3% CAGR over 10 years
};
```

**Tier classification adjusts:** full_pass = 6/6 filters, near_miss = 5/6.

**The P/E×P/B composite with the ROE modifier remains.** This provides valuation discipline that subsumes the standalone P/B filter:
- Base ceiling: 40
- ROE 20-30%: ceiling × 1.25 = 50
- ROE 30%+: ceiling × 1.50 = 60

This catches overpriced stocks while allowing quality franchises with high ROE and buyback-distorted book values.

**Update the How It Works page** to show 6 filters instead of 8, with a note explaining why dividend record and P/B were removed.

Commit: `feat: remove-graham-dividend-pb-filters`.

---

## Change 9: Update How It Works Page

Rewrite to reflect all changes:

**Pipeline overview:** Three pipelines by descriptive name. Growth uses sector ETFs as default.

**Portfolio model:** Everything in VOO unless deployed. No idle cash. Pipeline allocations are budget caps.

**Sell discipline:** Two triggers: +125% take-profit (sweep-validated optimum) and attractor < 2.0 emergency stop. 3-year default hold (sweep-confirmed). Reference that growth failure, concentration trim, thesis violation, and regime expiry triggers were tested and removed because they hurt or had no impact.

**Graham Screen:** Show 6 filters, explain the removal of dividend and P/B filters with evidence.

**Signal types:**
- Growth Sector Signal: recommends Vanguard sector ETF based on candidate density (≥ 2 per sector)
- Individual Stock BUY: for Regime pipeline and Growth overrides (attractor ≥ 3.0 confirmed by Opus)
- NOT_YET: undervalued but not cheap enough
- PASS: overvalued or rejected
- SELL: +125% take-profit or attractor dissolution

**Allocation display:** Crisis 25% / Growth 20% / Regime 15% / Flexible 35% / Cash 0%. Explain that these are budget caps, not reservations — uninvested capital is in VOO.

Commit: `docs: update-how-it-works`.

---

## Change 10: Update Strategy Documentation

Rewrite AV-INVESTMENT-STRATEGY.md to reflect every change. Include the validation evidence summary. This is the reference document for how the system works.

Commit: `docs: update-strategy`.

---

## Implementation Order

1. **Change 0 (verify prior changes)** — check and implement if missing before anything else
2. **Change 1 (rename)** — foundation for everything else
3. **Change 4 (simplify sell engine)** — remove code before adding code
4. **Change 5 (position sizing + allocations)** — update constants
5. **Change 6 (attractor gate)** — update signal threshold
6. **Change 8 (Graham Screen filter removal)** — remove dividend + P/B filters
7. **Change 2 (VOO hybrid)** — new parking position feature
8. **Change 3 (sector ETF mode)** — the largest feature addition
9. **Change 7 (Regime unchanged)** — just rename
10. **Changes 9-10 (documentation)** — update after all code changes

Commit after each change. Deploy after all changes are complete.

---

## Post-Deployment Verification

1. No secular disruption modifier in attractor scoring (Change 0A)
2. No market cap ceiling in Growth pre-screen — $500M floor only (Change 0B)
3. Regime pre-screen uses gross margin > 0%, not scaling exponent (Change 0C)
4. Dashboard shows new naming everywhere (Crisis, Growth, Regime)
5. Allocation chart: Crisis 25%, Growth 20%, Regime 15%, Flexible 35%, Cash 0%
6. VOO parking position appears in Holdings with full portfolio value
7. Monthly Growth pre-screen produces sector signals with Vanguard ETF recommendations
8. Sector signals require ≥ 2 candidates per sector
9. Regime pipeline shows individual stock signals with DEEP ANALYSIS buttons
10. Sell trigger check only evaluates +125% and attractor < 2.0
11. New BUY signals require attractor ≥ 3.0 (not 2.5)
12. Position sizes compute at 7% STRONG / 5.25% STANDARD
13. Graham Screen runs with 6 filters (no dividend, no P/B), full_pass = 6/6, near_miss = 5/6
14. How It Works page reflects all changes including 6-filter Graham Screen
15. Adding $27,000 capital: entire amount goes to VOO parking, no cash reserve
16. Executing a BUY signal: VOO reduces, framework position opens at correct size

---

## Complete Evidence Summary

| Change | Test/Sweep | Key Finding |
|--------|-----------|-------------|
| System beats SPY | Test 1 | 83% of vintages, +37pp median alpha, all kill criteria PASS |
| VOO hybrid | Test 2 | 83% → 97% beat rate, eliminates 22.9pp cash drag |
| VOO for crisis capital | VOO vs VGSH test | VOO wins by $72,506 across all vintages |
| Growth → sector ETFs | Tests 3 + sector ETF test | ETFs beat VOO 83% vs stocks 59%. No attractor score predicts stock > ETF |
| Sector threshold ≥ 2 | Threshold sweep | 83% beat rate, 2.6 sectors, +21.8pp alpha. N≥4 degenerates to VGT-only |
| Regime stays individual | Test 3 | 79th percentile selection, 92% win rate, +153% avg return |
| Take-profit +125% | Take-profit sweep | Peak of curve, +$29,187 vs hold. +150% leaves $4,265 on table |
| Max position 7% | Position size sweep | 86% → 97% beat rate, 15 positions maintained |
| 3-year hold | Hold period sweep | Optimal. 5yr collapses to 33% from mean reversion |
| Attractor gate ≥ 3.0 | Threshold sweep | Same beat rate, +5pp alpha vs ≥ 2.5 |
| Graham Screen: remove dividend + P/B | What-If battery + bootstrap | ACCEPT: 0% CV gap, 64% improved / 0% degraded. Captures AAPL, fixes buyback distortion |
| Remove secular disruption modifier | Restructuring analysis | Double-counts risks already in bear case. Dropped BMY from 2.7 to 1.2 incorrectly |
| Remove Growth market cap ceiling | Calibration analysis | $30B ceiling excluded CRWD, DDOG, SHOP, AXON, PANW — the canonical DKS companies |
| Regime: gross margin > 0% replaces scaling exponent | Calibration Tests A-F | Scaling exponent: 50% precision. Gross margin: 100% precision. Composite 0.440 → 0.920 |
| AI not contaminated | Test 4 | Blinded AI MORE discriminating (0.86 gap vs 0.80) |
| Signal clustering correct | Test 6 | Most signals during crisis/bear — correct for value system |
| Not a QQQ bet | Test 7 | 41% tech but QQQ correlation only 0.03 |
| Bull/bear 40/60 | Weighting sweep | Ratio doesn't affect discrimination — keep current |
| Pipeline allocation | Allocation sweep | Crisis-heavy (25/20/15/35) beats current at 90% beat rate |
| Cash reserve 0% | Cash reserve sweep | Irrelevant under VOO hybrid |
| STANDARD 75% | Multiplier sweep | Flat curve — 75% is fine |
| Fat-tail discounts | Discount sweep | Not load-bearing — keep current |
| Regime valuation | Regime param sweep | 100% precision across all 25 combinations |
| Concentration penalties | Penalty sweep | Insufficient data — keep current |
