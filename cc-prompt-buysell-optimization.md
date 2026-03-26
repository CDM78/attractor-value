# Prompt for Claude Code: Automated BUY/SELL Prompt Optimization

## 🤖 FULLY AUTONOMOUS OPERATION

**Run with: `claude --dangerously-skip-permissions`**

This task is designed to run to completion WITHOUT human supervision. It may take many hours across multiple usage windows. Follow ALL of these rules:

1. Do NOT stop to ask for confirmation, permission, or clarification at any point
2. Do NOT use the Anthropic SDK or look for ANTHROPIC_API_KEY
3. Run ALL AI evaluations as internal Claude Code sub-agents — you ARE Claude Code, you can spawn sub-agents directly
4. Install any packages needed (npm, pip with --break-system-packages) without asking
5. Save progress after every completed step — assume you could be interrupted at any time
6. If a sub-agent fails, retry once, record null, and continue
7. Write all results to disk immediately — do not hold results in memory across long operations

### USAGE LIMIT MANAGEMENT — CRITICAL

**Do NOT exceed 90% of the usage allocation. Extra usage is DISABLED and must not be triggered.**

Before each batch of sub-agent calls:
1. Check how many sub-agent calls you've made in this session
2. If you've made more than 50 sub-agent calls in the current session, PAUSE
3. Save all progress to disk
4. Print: "USAGE PAUSE: [X] sub-agent calls made. Saving progress. Will resume when usage resets."
5. Write a resume file: `data/optimization-resume-state.json` containing:
   - Which phase you're in
   - Which batch/round you completed
   - File paths for all saved results
   - What to do next
6. STOP and wait for the user to restart you

**When restarting after a pause:**
1. Check for `data/optimization-resume-state.json`
2. If it exists, read it and resume from where you left off
3. Do NOT re-run completed work — load saved results from disk
4. Print: "RESUMING from Phase [X], Round [Y]. [Z] cases already complete."

### FILE LOCATIONS — MANDATORY

All work in: C:/Users/charl/attractor-value/
- Scripts: C:/Users/charl/attractor-value/scripts/
- Data: C:/Users/charl/attractor-value/data/prompt-optimization/
- Results: C:/Users/charl/attractor-value/results/
- Resume state: C:/Users/charl/attractor-value/data/optimization-resume-state.json

Create directories if needed. Do NOT save files anywhere else.

## ⚠️ CARDINAL RULE ⚠️

NO data from after a case's entry date may be used in BUY evaluations. For SELL evaluations, data must be restricted to what was available at the sell checkpoint date (entry + 1 year or entry + 2 years). Log all dates. Zero exceptions.

---

## What We're Optimizing

Two prompts that work as a pair to maximize 3-year portfolio return:

**BUY prompt:** Applied to candidates from the quantitative pool (credit spread + short interest filter). Reads 10-K risk factors and decides: enter this position or skip it?

**SELL prompt:** Applied annually to held positions when a new 10-K is filed. Reads the new 10-K risk factors vs the 10-K at entry and decides: keep holding or exit?

Total return = f(BUY decisions, SELL decisions, timing of exits, VOO parking of unused capital)

### Key Insight From Refinement Test (MUST BE INCORPORATED)

**Confessions and severe distress at ENTRY are BUYING signals, not red flags.** Companies bought at maximum despair (FLR: $3.8B restatement, HP: covenant breach, HRB: emergency drawdown) were the biggest winners. The market already punished them — the distress is why they're cheap.

**But NEW confessions DURING HOLDING are sell signals.** A covenant modification at entry means "this is priced in." A covenant modification 18 months after you bought at what you thought was the bottom means "things are getting worse than expected."

**Simpler prompts outperform detailed ones.** The original binary "stable vs deteriorating" (r=0.378) destroyed the refined 5-category severity scoring (r=-0.150). The optimizer must be free to discover that less detail can mean more signal.

---

## Phase 0: Data Collection (No Sub-Agents Needed)

### 0A: Select 200 Cases

From the 1,656-case dataset, select 200 cases meeting ALL criteria:
- Entry dates 2018-2021 (ensures FINRA short interest + sufficient filing history)
- Both current and prior-year 10-K Item 1A available in EDGAR before entry date
- 3-year forward return and VOO benchmark available
- Balance: 100 winners, 100 traps

Stratify by GICS sector proportionally. Include mix of well-known and obscure companies.

Save case list as `data/prompt-optimization/case-list-200.json`.

### 0B: Pull ALL Required Data Per Case

For each of the 200 cases, collect and save to `data/prompt-optimization/cases/CASE-XXXX.json`:

**Entry data (for BUY prompt):**
- Current 10-K Item 1A text (most recent filing before entry date) + filing date
- Prior year 10-K Item 1A text + filing date
- FINRA historical short interest at entry (from existing data or re-pull)
- Credit spread at entry (from existing FRED data)
- Basic financials: P/E, revenue CAGR, D/E (from existing dataset)
- Sector
- Entry date

**Year 1 checkpoint data (for SELL prompt — entry + 12 months):**
- 10-K Item 1A filed nearest to (but before) entry + 12 months
- Stock price at entry + 12 months
- S&P 500 level at entry + 12 months

**Year 2 checkpoint data (for SELL prompt — entry + 24 months):**
- 10-K Item 1A filed nearest to (but before) entry + 24 months
- Stock price at entry + 24 months
- S&P 500 level at entry + 24 months

**Outcome data (DO NOT use in prompts — evaluation only):**
- 3-year forward return
- VOO 3-year return from same entry date
- Winner/trap classification

**Date integrity:** For each case, log the filing dates of all 10-Ks pulled and confirm:
- Entry 10-K: filed before entry date
- Prior 10-K: filed before entry date
- Year 1 10-K: filed before entry + 12 months
- Year 2 10-K: filed before entry + 24 months

### 0C: Data Coverage Report

```
DATA COVERAGE (200 cases)
=========================
Entry 10-K (current):     ? / 200
Entry 10-K (prior year):  ? / 200
Year 1 checkpoint 10-K:   ? / 200
Year 2 checkpoint 10-K:   ? / 200
FINRA short interest:     ? / 200
Credit spread:            ? / 200
Year 1 price:             ? / 200
Year 2 price:             ? / 200
3yr forward return:       ? / 200

Cases with COMPLETE data (all fields): ? / 200
```

**If fewer than 150 cases have complete data:** Report the gap, note which field is missing most often, and proceed with whatever cases are complete. Do NOT stop.

### 0D: Partition the Data

Split the complete cases into three FIXED partitions. Save the partition assignments to `data/prompt-optimization/partitions.json`. Once assigned, NEVER change them.

**Training set (40%):** CC uses these freely — can see outcomes, analyze patterns, iterate prompts.
**Validation set (30%):** CC tests promising prompts here. Can see aggregate metrics (win rate, r, alpha) but should NOT craft prompts targeting specific validation cases.
**Holdout set (30%):** CC NEVER evaluates these until Phase 4 (final test). Do NOT load holdout outcomes until Phase 4.

Stratify partitions by: outcome (equal winner/trap ratio in each), entry year (spread across 2018-2021), sector (proportional).

Save three separate files:
- `data/prompt-optimization/training-cases.json` (with outcomes)
- `data/prompt-optimization/validation-cases.json` (with outcomes — but CC should only compute aggregates)
- `data/prompt-optimization/holdout-case-ids.json` (IDs ONLY — no outcomes until Phase 4)

---

## Phase 1: Initial Prompt Generation (Training Set Only)

### Generate 8-10 BUY Prompt Variants

Create diverse BUY prompts exploring different angles. Each prompt receives the entry 10-K (current) and prior-year 10-K and must return structured JSON.

**Required variants (minimum):**

1. **Original binary** — "Is the risk profile stable or deteriorating?" (the r=0.378 baseline)

2. **Character change** — "Has the fundamental CHARACTER of the company's risk profile changed, or are these the same types of risks as last year?" (tests whether risk-type stability matters more than risk-count)

3. **Sector-adjusted** — "Is this deterioration company-specific, or is the entire sector experiencing similar changes?" (the one modification suggested by the refinement test)

4. **Confession as context** — "This company is being evaluated as a potential VALUE investment during a period of market stress. Confessions of current problems may indicate the distress that created the buying opportunity. Assess whether the risk evolution suggests TEMPORARY dislocation (problems are known and priced) vs STRUCTURAL decline (problems are worsening beyond what the market expects)."

5. **Resolution-focused** — "Compare the rate at which old risks are being resolved vs new risks appearing. Is the company resolving problems faster than new ones emerge?"

6. **Minimal** — "In one word, is this company's competitive position STABLE or CHANGING based on these risk factors? Return only: {\"assessment\": \"stable/changing\"}"

7. **Quantified only** — "Identify ONLY risks that include specific dollar amounts, percentages, customer names, or regulatory actions. Ignore all qualitative/boilerplate risks. How many quantified material risks are new this year?"

8. **Forward-looking** — "Based on the risk factors, is the company's FUTURE risk profile likely to improve, stay the same, or worsen? Focus on whether current risks are transient (will resolve naturally) or structural (will persist or intensify)."

**All BUY prompts must:**
- Accept: current 10-K Item 1A text, prior year 10-K Item 1A text, sector, entry date context
- Return structured JSON with at minimum: an assessment and a confidence level
- Include the instruction: "Do NOT attempt to identify this company"
- NOT include company name, ticker, or identifiable details

### Generate 5-6 SELL Prompt Variants

Each SELL prompt receives the ORIGINAL entry 10-K and the NEW annual 10-K (filed during holding period) and must return structured JSON.

**Required variants:**

1. **Thesis drift** — "Compare the new 10-K risk factors to the ones present at entry. Have NEW material risks appeared that were NOT part of the original investment thesis? If the original risks are the same, the thesis is intact. If fundamentally new problems have emerged, the thesis may be broken."

2. **Escalation only** — "Focus ONLY on risks that existed at entry but have ESCALATED in language. 'May face' becoming 'are experiencing' means a hypothetical risk has materialized. How many risks have escalated?"

3. **New confessions** — "At entry, the following confessions were present: [list from BUY evaluation]. Since entry, have ANY new confessions appeared — restatements, covenant modifications, quantified declines, customer losses, or regulatory actions that were NOT present at entry?"

4. **Simple comparison** — "Is the company's risk profile BETTER, SAME, or WORSE than at entry? Return only: {\"trajectory\": \"better/same/worse\"}"

5. **Exit urgency** — "On a scale of 1-5, how urgently should an investor consider exiting this position based on the risk factor evolution since entry? 1 = no concern, hold. 5 = exit immediately, thesis is broken."

**All SELL prompts must:**
- Accept: entry 10-K Item 1A text, new 10-K Item 1A text, time since entry
- Return structured JSON
- NOT include company name or identifiable details

---

## Phase 2: Training Evaluation + Iteration (3-5 Rounds)

### Round 1: Test All Initial Variants on Training Set

For each BUY prompt variant, run it on every training case (entry 10-K data). Record the assessment.

For each SELL prompt variant, run it on every training case that has Year 1 and/or Year 2 checkpoint data. Use the entry 10-K as the baseline and the checkpoint 10-K as the "new" filing.

**Use Sonnet sub-agents for Round 1** (faster, cheaper for broad exploration).

### Scoring Each BUY Variant

For each BUY variant on the training set:
1. What % of cases does it let through (pass rate)?
2. Among cases it lets through, what % are winners (precision)?
3. Point-biserial r between assessment and outcome
4. Within-training 3-fold CV: does the signal hold across all folds?

### Scoring Each SELL Variant

For each SELL variant on training cases with checkpoint data:
1. Among cases where it says "sell" at Year 1 or Year 2: what % are actual traps (true positive rate)?
2. Among cases where it says "sell": what % are actual winners (false positive rate)?
3. Damage avoided: mean return of traps caught (if sold at checkpoint price vs 3yr price)
4. Upside forfeited: mean return lost from winners falsely sold

### Scoring BUY × SELL Pairs

The real test: simulate a portfolio for each BUY × SELL combination.

For each pair, on each training case:
1. BUY prompt says pass/fail → if fail, capital stays in VOO
2. If pass, position is entered at entry price
3. At Year 1 checkpoint: SELL prompt evaluates → if sell, exit at Year 1 price, return to VOO
4. If held, at Year 2 checkpoint: SELL prompt evaluates again → if sell, exit at Year 2 price
5. If still held at Year 3: exit at 3yr price (or +125% take-profit if triggered earlier)
6. Compute total return including VOO parking for uninvested/exited capital

**Objective function:** Mean annualized 3-year portfolio return across all training cases, where:
- Cases rejected by BUY prompt earn VOO return
- Cases accepted but sold early earn: (entry→exit return) + (exit→3yr VOO return)
- Cases accepted and held earn: 3yr actual return

Rank all BUY × SELL pairs by this objective function.

### Round 1 Output

```
TOP 10 BUY × SELL PAIRS (Training Set)
=======================================
Rank | BUY Prompt | SELL Prompt | Portfolio Return | BUY Precision | SELL True Pos | SELL False Pos
1    | [name]     | [name]      | ?%               | ?%            | ?%            | ?%
...
```

Save to `data/prompt-optimization/round1-results.json`.

### Round 2: Analyze and Mutate

Take the top 3 BUY prompts and top 3 SELL prompts from Round 1.

**Analyze WHY they worked:**
- Which specific phrases or instructions drove correct classifications?
- What did the best BUY prompt do differently from the worst?
- What did the best SELL prompt catch that others missed?

**Create 5 new BUY variants** that combine winning elements:
- Take the best framing from Prompt A, the specific instructions from Prompt B
- Try inversions: if "focus on confessions" failed, try "explicitly ignore confessions"
- Try combining: if "character change" and "sector-adjusted" both worked, merge them
- Try simplifying: if a long prompt ties a short one, prefer the short one

**Create 3 new SELL variants** using the same mutation approach.

Run all new variants on training set. Re-rank all pairs (old + new).

### Rounds 3-5: Continue Iterating

Repeat the analyze → mutate → test cycle. Each round:
1. Take top 3 BUY and top 3 SELL from all rounds so far
2. Create 3-5 new mutations
3. Test on training set
4. Re-rank

**Complexity penalty:** If two prompts achieve similar portfolio return (within 1%), prefer the shorter/simpler one. Long prompts overfit.

**Convergence check:** If the top pair hasn't changed for 2 consecutive rounds, stop iterating early.

**After each round:** Test the current best pair on the VALIDATION set (see Phase 3).

---

## Phase 3: Validation Check (After Each Round)

After each training round, take the current best BUY × SELL pair and evaluate on the validation set.

**Run the pair on all validation cases.** Compute:
- Portfolio return (same simulation as training)
- BUY precision
- SELL true/false positive rates

**Track validation performance across rounds:**

```
VALIDATION TRACKING
====================
Round | Best Pair | Training Return | Validation Return | Gap | Overfitting?
1     | [pair]    | ?%              | ?%                | ?pp | YES/NO
2     | [pair]    | ?%              | ?%                | ?pp | YES/NO
3     | [pair]    | ?%              | ?%                | ?pp | YES/NO
...
```

**Overfitting detection:**
- If validation return IMPROVES along with training → optimization is working
- If validation return PLATEAUS while training improves → approaching overfit, slow down
- If validation return DECLINES while training improves → STOP ITERATING, revert to previous round's best

---

## Phase 4: Final Holdout Test

After the optimizer converges (or overfitting is detected):

1. Load the holdout cases (NOW you can load their outcomes)
2. Run the single best BUY × SELL pair on all holdout cases
3. Simulate the portfolio
4. Report:

```
HOLDOUT RESULTS (Final — No Further Optimization Allowed)
==========================================================
N holdout cases: ?
BUY pass rate: ?%
BUY precision: ?%
SELL activation rate: ?%
SELL true positive rate: ?%
SELL false positive rate: ?%

Portfolio metrics:
  Mean annualized return: ?%
  Mean annualized VOO return (same periods): ?%
  Annualized alpha: ?%
  Win rate (positions entered): ?%
  Trap damage avoided by SELL: $? (mean per trap)
  Winner upside forfeited by SELL: $? (mean per winner falsely sold)

Comparison:
  No AI filter (just quantitative): ?% alpha
  BUY only (no SELL): ?% alpha
  BUY + SELL (optimized pair): ?% alpha
```

**Pass/fail (pre-registered):**
- Holdout alpha ≥ 5%: STRONG PASS
- Holdout alpha 3-5%: PASS
- Holdout alpha 1-3%: MARGINAL
- Holdout alpha < 1%: FAIL

**Holdout-validation gap:**
- If holdout return is within 3pp of validation: generalizes well
- If holdout is 3-8pp below validation: mild overfit, results still useful
- If holdout is >8pp below validation: significant overfit, results unreliable

---

## Phase 5: Final Report

Write a comprehensive report including:

### 1. The Winning Prompt Pair

Print the exact text of the best BUY prompt and best SELL prompt. These are the prompts that would be deployed.

### 2. Optimization Journey

How did the prompts evolve across rounds? What was discovered? Which ideas worked and which didn't?

### 3. Performance Summary

```
FINAL SYSTEM
=============
Quantitative layer: Credit spread + short interest + valuation
AI BUY filter: [prompt name] — [1 sentence description]
AI SELL monitor: [prompt name] — [1 sentence description]

Training return:    ?% alpha (N=?)
Validation return:  ?% alpha (N=?)
Holdout return:     ?% alpha (N=?)

BUY prompt pass rate: ?%
BUY precision: ?%
SELL activation rate: ?%
SELL true positive rate: ?%

Estimated annual API cost: $? (at ~$0.05/call, ? calls/year)
```

### 4. Key Insights

What did the optimizer discover about:
- Is simple better than complex for BUY prompts?
- Do confessions help or hurt at entry vs during holding?
- Does the SELL prompt add material value, or should we just hold for 3 years?
- What's the single most predictive feature the AI extracts?

### 5. Deployment Recommendation

One of:
- **DEPLOY BUY + SELL** — both add value, implement in the live app
- **DEPLOY BUY ONLY** — BUY prompt adds value, SELL prompt doesn't justify complexity
- **DEPLOY SELL ONLY** — BUY prompt doesn't help, but SELL monitoring catches traps during holding
- **DO NOT DEPLOY** — neither prompt adds meaningful alpha over the quantitative baseline

Save as `results/prompt-optimization-final-report-2026-03-25.md`.

---

## Operational Notes

### Sub-Agent Budget Per Session

Rough estimates (adjust based on actual counts):
- Phase 0: 0 sub-agent calls (data collection only)
- Phase 1: 0 sub-agent calls (prompt writing only)
- Phase 2 Round 1: ~8 BUY variants × 80 training cases + ~5 SELL variants × 60 cases = ~940 calls
- Phase 2 Round 2: ~5 new variants × 80 cases = ~400 calls
- Phase 2 Rounds 3-5: ~300 calls each
- Phase 3: ~5 validation runs × 60 cases = ~300 calls
- Phase 4: ~60 holdout cases × 1 run = ~60 calls

**Total: ~2,500-3,000 sub-agent calls across all phases.**

At 50 calls per session before pausing, this requires roughly 50-60 sessions. Each session: run 50 calls, save state, pause. User restarts when usage resets.

**Optimize for session efficiency:**
- Do Phase 0 (data collection) in the first session — no sub-agent calls
- Do Phase 1 (prompt generation) in the same session if time allows
- Phase 2+ runs 50 sub-agent calls per session, saves results, pauses
- The resume state file makes this seamless across sessions

### Progress Tracking

After each session, update `data/prompt-optimization/progress-log.md`:

```
SESSION LOG
===========
Session 1: [date] — Phase 0 complete. 200 cases collected. ? with complete data.
Session 2: [date] — Phase 2 Round 1, BUY variants 1-3 evaluated on training (48 calls).
Session 3: [date] — Phase 2 Round 1, BUY variants 4-6 evaluated (50 calls). PAUSED.
...
```

### If Data Collection (Phase 0) Fails Partially

- If 10-K Item 1A extraction fails for many cases: try alternative extraction (EDGAR full-text search, different HTML parser)
- If Year 1/Year 2 checkpoint 10-Ks are unavailable: the SELL prompt can still be tested on cases WITH data; just note reduced N
- If FINRA data is missing for pre-2018 cases: exclude them, only use 2018-2021 entries
- Minimum viable: 120 complete cases (48 training, 36 validation, 36 holdout)

### Model Selection for Sub-Agents

- Phase 2 Rounds 1-2: Use **Sonnet** sub-agents (faster for broad exploration of many variants)
- Phase 2 Rounds 3+: Switch to **Opus** sub-agents for the top-performing variants (deeper analysis on the finalists)
- Phase 3 validation: Use **Opus** (must match what would be deployed)
- Phase 4 holdout: Use **Opus**

---

## Guardrails Against Common Failures

### Do NOT:
- Use the Anthropic SDK or look for API keys
- Run more than 50 sub-agent calls per session
- Change the partition assignments after Phase 0
- Look at holdout outcomes before Phase 4
- Optimize prompts based on validation case-level results (only aggregates)
- Prefer complex prompts when simple ones perform equally
- Assume "more information to the AI = better results" — the refinement test proved otherwise

### DO:
- Save progress obsessively
- Log every sub-agent call (case ID, prompt variant, result, success/failure)
- Track session usage counts explicitly
- Test whether simpler prompts beat complex ones
- Include at least one "minimal" prompt variant (1-2 sentences)
- Report results honestly even if the AI adds no value
- Remember: confessions at entry = bullish, confessions during holding = bearish

---

*This spec is designed for fully autonomous execution across multiple CC sessions. The resume state mechanism allows the optimization to span days or weeks of usage windows without losing progress.*
