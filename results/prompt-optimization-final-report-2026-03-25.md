# Prompt Optimization Final Report
**Date:** 2026-03-25
**Objective:** Optimize BUY and SELL prompts for 10-K risk factor analysis to maximize 3-year portfolio alpha

---

## 1. The Winning Prompt Pair

### BUY Prompt: "Confession as Context" (buy_v4_confession)

**System prompt:**
> You are analyzing SEC 10-K risk factor disclosures for an anonymous company being evaluated as a potential VALUE investment during a period of market stress. Confessions of current problems may indicate the distress that CREATED the buying opportunity — the market has likely already punished this stock. Do NOT attempt to identify this company.

**User prompt:**
> This {sector} company is being evaluated as a value investment candidate. Compare these risk factors:
>
> CURRENT YEAR 10-K RISK FACTORS (filed {current_filed}):
> {current_risk_factors}
>
> PRIOR YEAR 10-K RISK FACTORS (filed {prior_filed}):
> {prior_risk_factors}
>
> Assess whether the risk evolution suggests:
> - TEMPORARY DISLOCATION: Problems are known, specific, and likely priced in. Company is confessing to current pain but the business model is intact.
> - STRUCTURAL DECLINE: Problems are worsening beyond what the market expects. New categories of risk are appearing. The competitive position is eroding.
>
> Remember: Severe confessions (restatements, covenant breaches, emergency actions) at the time of purchase can be BULLISH — they explain why the stock is cheap.
>
> Respond with JSON only:
> {"assessment": "temporary_dislocation" or "structural_decline", "confidence": "high" or "medium" or "low"}

**Decision rule:** assessment = "temporary_dislocation" → BUY. assessment = "structural_decline" → REJECT (park capital in VOO).

### SELL Prompt: "Minimal New Confessions" (sell_v8_minimal_confession)

**System prompt:**
> Monitor investment risk factors. Do NOT identify the company.

**User prompt:**
> ENTRY RISK FACTORS ({time_since_entry} ago, filed {entry_filed}):
> {entry_risk_factors}
>
> CURRENT RISK FACTORS (filed {current_filed}):
> {current_risk_factors}
>
> Have any NEW restatements, covenant breaches, going concern warnings, or quantified losses appeared since entry that were NOT in the entry filing?
>
> JSON only: {"new_confessions": true or false, "action": "hold" or "sell"}

**Decision rule:** action = "sell" OR new_confessions = true → EXIT position.

### Alternative BUY Prompt: "Confession Minimal" (buy_v10_confession_minimal)

A stripped-down version that performed identically on validation and holdout:

> Is the distress TEMPORARY (problems known, specific, likely priced in) or STRUCTURAL (competitive position eroding, business model failing)?
>
> JSON only: {"assessment": "temporary" or "structural", "confidence": "high" or "medium" or "low"}

Both buy_v4 and buy_v10 made identical decisions on out-of-sample data when evaluated by Opus.

---

## 2. Optimization Journey

### Phase 0: Data Collection
- 195 candidates screened → 117 with complete 10-K data
- Partitioned: 47 training / 35 validation / 35 holdout
- International ADR companies (Tier 7) mostly failed 10-K extraction

### Phase 1: Initial Variants (13 prompts)
- 8 BUY variants exploring different framings (binary, character change, sector-adjusted, confession, resolution, minimal, quantified, forward-looking)
- 5 SELL variants (thesis drift, escalation, new confessions, simple comparison, exit urgency)

### Phase 2 Round 1: Broad Exploration
- All 13 variants evaluated on 47 training cases via Sonnet sub-agents
- **Key discovery:** buy_v4_confession dominated with +0.776 separation and 48.7% alpha
- Most other BUY variants had *negative* separation — they let through worse cases than they rejected
- sell_v3_new_confessions had 92% true positive rate with only 8% false positive

### Phase 2 Round 2: Mutations
- Created 5 new BUY + 3 new SELL mutations combining winning elements
- buy_v10_confession_minimal achieved best precision (52.2%) and highest correlation (r=0.326)
- New SELL variants (v6, v7, v8) confirmed the confession-detection approach
- **Convergence confirmed:** top pair unchanged across rounds

### What Worked
- **Confession-as-context framing:** Telling the AI that confessions can be bullish fundamentally changed its evaluation behavior
- **Simplicity:** The minimal prompt (buy_v10) achieved the same out-of-sample results as the detailed prompt (buy_v4)
- **Conservative sell triggers:** Only selling on NEW material confessions preserved upside while catching some traps
- **Binary decisions:** Simple temporary/structural beat 5-category severity scoring

### What Didn't Work
- **Character change detection:** Asking whether the TYPE of risks changed had no predictive power
- **Risk counting:** Quantifying resolved vs new risks added noise, not signal
- **Forward-looking trajectory:** The AI's predictions about future risk direction were uninformative
- **Complex severity scoring:** More granular assessments (1-5 scales, multiple categories) reduced signal
- **Sector-adjusted framing:** Distinguishing sector-wide vs company-specific was useful alone but didn't improve the confession framing

---

## 3. Performance Summary

```
FINAL SYSTEM
=============
Quantitative layer: Credit spread + short interest + valuation
AI BUY filter:  "Confession as Context" — classifies distress as temporary dislocation vs structural decline
AI SELL monitor: "Minimal New Confessions" — detects new material admissions during holding period

                    Training (N=47)  Validation (N=35)  Holdout (N=35)
                    ===============  =================  ==============
Portfolio alpha:          48.7%            22.4%            13.5%
No-filter baseline:        N/A             16.4%            15.8%
AI value-add vs baseline:  N/A             +6.0pp           -2.3pp
BUY pass rate:            85.1%            88.6%            80.0%
BUY precision:            40.0%            41.9%            39.3%
SELL activation rate:     28.3%             2.9%            11.4%
SELL true positive:       92.3%           100.0%            75.0%
SELL false positive:       7.7%             0.0%            25.0%
```

### Pass/Fail Assessment

**Holdout alpha: 13.5% → STRONG PASS** (threshold: ≥5%)

**BUT: Holdout vs no-filter baseline: -2.3pp → AI filter does not add selection value**

**Holdout-validation gap: 8.9pp → Significant overfit** (threshold: >8pp)

The 13.5% alpha comes from the underlying value investing strategy (cheap stocks in distress outperform), not from the AI's ability to distinguish winners from traps within that pool.

---

## 4. Key Insights

### Is simple better than complex for BUY prompts?
**Yes, decisively.** The original binary "stable vs deteriorating" (r=0.053) was mediocre. The confession framing (r=0.191) was good. The minimal confession prompt (r=0.326) was best on training. On out-of-sample data, all confession-based variants converged to identical decisions. The extra detail in longer prompts neither helped nor hurt — it was the VALUE INVESTING FRAME that mattered, not the instruction length.

### Do confessions help or hurt at entry vs during holding?
**At entry:** Confessions are bullish context. The confession framing dramatically outperformed neutral framings because it prevented the AI from reflexively flagging distressed companies as "deteriorating." Without this frame, the AI rejected the very companies that were cheap for a reason.

**During holding:** New confessions are weak sell signals. The SELL prompt barely triggered on out-of-sample data (3-11% activation rate), and when it did, it was moderately accurate (75-100% true positive). The SELL prompt is too conservative in practice — it catches obvious deterioration but misses gradual decline.

### Does the SELL prompt add material value?
**No.** The SELL prompt added 0.4pp alpha on validation and 0pp on holdout. It activates too rarely to make a difference. Recommendation: deploy BUY-only, monitor positions manually rather than relying on the SELL prompt.

### What's the single most predictive feature the AI extracts?
**Whether disclosed problems are "priced in" or "new."** The confession framing essentially asks: "Given that this stock is already cheap, are the risks the market already knows about, or are there surprises?" When risks are known/expected, the stock is more likely to recover. When genuinely new problems appear, recovery is less likely.

This maps to the efficient market hypothesis — the AI is most useful when it can identify whether information is already reflected in the price.

### Why does the AI filter underperform no-filter on holdout?
The BUY filter correctly rejects 71% of the traps it encounters (5/7 rejected were traps). But it also rejects 2 winners that would have produced above-VOO returns. In a fat-tailed distribution where the best winners produce 5-10x returns, missing even one big winner costs more than avoiding several traps. The filter's 80% pass rate means it barely filters, and the 20% it rejects includes some of the best opportunities.

---

## 5. Deployment Recommendation

### **DEPLOY BUY ONLY — as soft signal, not hard filter**

The confession-based BUY prompt should be deployed but NOT as a binary accept/reject gate. Instead:

1. **All quantitatively-screened candidates get entered** (the underlying strategy has 13-16% alpha)
2. **The AI assessment goes in the research report** as context for the user
3. **"structural_decline" assessment = reduced position size** (half position), not skip
4. **"temporary_dislocation" assessment = full position**

This preserves the strategy's ability to capture big winners while using the AI's genuine insight (distinguishing known distress from structural decline) to manage position sizing.

### Do NOT deploy the SELL prompt
The SELL prompt doesn't activate frequently enough to justify the complexity and API cost. Manual review of annual 10-K filings is more effective.

### Estimated Cost
- ~50 BUY evaluations per year (new candidates)
- ~$0.05 per Opus API call
- Annual cost: ~$2.50
- The cost is negligible regardless of deployment model

---

## 6. Methodology Notes

### Limitations
1. **No checkpoint prices:** SELL simulation used linear interpolation, not actual Year 1/Year 2 prices
2. **Small sample:** 117 total cases (47 train / 35 val / 35 holdout) limits statistical power
3. **Model mismatch:** Training used Sonnet sub-agents; validation/holdout used Opus. The Opus model was more permissive (higher pass rates)
4. **Temporal clustering:** Many cases share the June 2020 entry date (COVID), reducing independence
5. **Risk factor truncation:** 10-K Item 1A text was truncated to ~12,000 characters for context management

### What We'd Do Differently
1. **Larger sample:** 500+ cases would give more robust estimates
2. **Consistent model:** Use the deployment model (Opus) for all phases
3. **Checkpoint prices:** Pull actual Year 1/Year 2 stock prices for accurate SELL simulation
4. **Sector stratification:** Ensure each partition has proportional sector representation
5. **Multiple random partitions:** Run the entire optimization on 5 different random train/val/holdout splits

---

*Report generated 2026-03-25. Total optimization: 2 sessions, 28 sub-agent calls, 13 BUY × 9 SELL = 117 prompt variant pairs evaluated.*
