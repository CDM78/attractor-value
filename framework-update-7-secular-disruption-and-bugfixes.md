# Attractor Value Framework — Update 7: Secular Disruption Modifier, Bug Fixes, and Transition-Era Calibration

## Context

This document amends the previously provided specification documents:
- **investment-framework.md** (The Attractor Value Framework — rule set)
- **attractor-value-scope.md** (Claude Code project scope)
- **framework-update-1-adjacent-possible.md** (Update 1: Adjacent Possible)
- **framework-update-2-accuracy-improvements.md** (Update 2: Capital Allocation, Dynamic P/E, Concentration Risk, Insider Patterns)
- **framework-update-3-finnhub-data-source.md** (Update 3: Finnhub Integration)
- **Updates 4–6** (preceding updates in the sequence)

It addresses three categories of issues:

1. **Bug Fixes** — Data quality and calculation errors surfaced by the first real research report (CTSH).
2. **Secular Disruption Modifier** — A new analytical dimension that the framework currently lacks, designed to catch phase-transition risks and opportunities at the industry level.
3. **Transition-Era Calibration** — Adjustments reflecting the current macro environment (AI-driven sector rotation, the "SaaSpocalypse," and the bits-to-atoms capital migration of early 2026).

---

## Part 1: Bug Fixes

These are implementation-level errors that produce incorrect outputs. They should be fixed immediately in whatever codebase or prompt template generates research reports.

### Bug 1.1: EPS Data Flattening

**Problem:** The CTSH report showed $4.00 EPS for four consecutive years (2022–2025), which is almost certainly an artifact of rounding, truncation, or normalization in the data pipeline. Cognizant's actual adjusted EPS for FY2025 was approximately $5.28. This error cascades through the entire valuation: the Graham intrinsic value, the buy-below price, and the P/E calculation all depend on accurate EPS.

**Root Cause (probable):** The data source may be returning GAAP EPS (which can be distorted by one-time charges, restructuring costs, or stock-based compensation) and the pipeline may be rounding to the nearest dollar, or the 3-year normalization is being applied before individual-year values are stored in the financial history table.

**Fix:**

1. Store individual-year EPS values at full precision (at least two decimal places) in the `financials` table before any normalization is applied.
2. The financial history table in the report should display actual reported EPS per year, not the normalized 3-year average repeated across years.
3. Normalized EPS (the 3-year average used in the Graham formula) should be computed at valuation time and displayed only in the Layer 2 valuation section, clearly labeled as "Normalized EPS (3-year avg)."
4. If using GAAP EPS, flag years where GAAP and adjusted EPS diverge by more than 15% and note the divergence in the report. For the Graham formula, prefer adjusted (operating) EPS over GAAP when the divergence is driven by non-recurring items, but document which figure is being used.

**Validation check to add:** If any stock shows identical EPS for 3+ consecutive years, flag it as a data quality warning. Genuinely flat earnings for three years is rare; identical values to the penny across three years is almost certainly an artifact.

### Bug 1.2: Margin of Safety Inconsistency

**Problem:** The CTSH report states "Margin of Safety: 45%" but labels it "Transitional = 40%." With a concentration risk penalty of 0, there is no documented reason for the extra 5%. The buy-below price is computed using 45%, which doesn't match the framework rules.

**Root Cause:** The margin of safety is being computed as the sum of the base classification MoS (40% for Transitional) plus an undocumented additional component. This may be a residual from an earlier version of the framework or a miscoded addition.

**Fix:**

The margin of safety computation must follow this explicit cascade, with each component documented in the report:

```
Base MoS (from attractor classification):
  - Stable (≥ 3.5):      25% (Classical/Soft Network) or 40% (Hard Network non-leader)
  - Transitional (2.0–3.4): 40%
  - Dissolving (< 2.0):    Do not buy

Fat-Tail Discount (from Section III of the framework):
  - Untested by major downturn:     +10%
  - Attractor score 2.0–3.4:        +15%  ← NOTE: This stacks with the Transitional base MoS

Final MoS = Base MoS + Fat-Tail Discount(s)
```

**Critical clarification:** The fat-tail discount for "Attractor score 2.0–3.4" in Section III of the original framework is ambiguous — it's unclear whether this is *additional* to the 40% Transitional MoS or whether the 40% already incorporates it. 

**Resolution — adopt the following rule:** The Section III fat-tail discount applies to the *intrinsic value* (reducing IV before the margin of safety is applied), not to the margin of safety percentage itself. This avoids double-counting. The cascade becomes:

```
Step 1: Compute raw Graham IV
Step 2: Apply fat-tail discount to IV → Adjusted IV
  - Untested by downturn: IV × 0.90
  - Transitional (2.0–3.4): IV × 0.85
  - Both: IV × 0.90 × 0.85 = IV × 0.765
Step 3: Apply MoS to Adjusted IV → Buy-Below Price
  - Stable: Adjusted IV × 0.75 (25% MoS)
  - Transitional: Adjusted IV × 0.60 (40% MoS)
```

This is cleaner than stacking percentages on the MoS itself and produces more conservative (lower) buy-below prices for Transitional stocks, which is the correct behavior.

**For CTSH specifically:** As a Transitional company that has survived downturns (10+ years, 0-1 negative EPS years), the fat-tail discount should be 0% (Resilient designation in the report is correct). The correct MoS is 40%, giving a buy-below of $74.72 × 0.60 = $44.83.

The report displayed $41.09, which implies 45% MoS. This is a bug. Fix the computation.

### Bug 1.3: P/E Inconsistency Between Screening and Valuation

**Problem:** The market data table shows P/E of 13.3, but at a price of $61.32 with normalized EPS of $4.00, the implied P/E is 15.3. These are different numbers being used in different sections of the same report.

**Root Cause:** The P/E in the market data table is likely trailing twelve-month P/E from the market data API (using actual TTM EPS), while the Graham valuation uses 3-year normalized EPS. Both are valid for their respective purposes, but the report doesn't distinguish between them.

**Fix:**

1. The market data table should display **TTM P/E** and label it as such: "P/E (TTM)."
2. Layer 1 screening should use the **3-year normalized P/E** (price ÷ 3-year avg EPS) and label it: "P/E (3yr normalized)."
3. If the two diverge by more than 20%, add a note explaining why (e.g., "TTM earnings significantly above/below 3-year average due to [reason]").
4. The P/E × P/B composite filter should use the same P/E figure as Layer 1 screening (3-year normalized), since that's what Graham intended.

### Bug 1.4: P/E × P/B Arithmetic

**Problem:** 13.3 × 2.7 = 35.91, but the report shows 35.6. Minor rounding discrepancy.

**Fix:** Carry at least two decimal places through all intermediate calculations. Round only for display. The P/E × P/B value in the report should match the product of the displayed P/E and P/B to within 0.1.

### Bug 1.5: Sector-Relative P/B Threshold

**Problem:** The report uses a sector-relative P/B threshold of 3.34 (Technology 33rd percentile, backstop 5.0), which is a departure from the framework's original fixed P/B ≤ 1.5 rule. This sector-relative adjustment isn't documented in any of the existing updates.

**Fix:** This is actually a reasonable adaptation — the original P/B ≤ 1.5 filter screens out virtually every technology company because tech firms carry little tangible book value. But it needs to be formally documented. Add the following to the framework:

**Amendment to Layer 1 P/B filter:**

The original rule (P/B ≤ 1.5, with composite P/E × P/B ≤ 22.5) was calibrated for asset-heavy industrials. For sectors where intangible assets dominate (Technology, Healthcare, Consumer Discretionary), the fixed P/B threshold screens out nearly the entire universe, which defeats the purpose.

**Revised rule:**

- **Asset-heavy sectors** (Industrials, Materials, Energy, Utilities, Real Estate, Financials): Retain P/B ≤ 1.5 and P/E × P/B ≤ 22.5.
- **Asset-light sectors** (Technology, Healthcare, Communication Services, Consumer Discretionary): Use a sector-relative P/B threshold set at the **33rd percentile of the sector's current P/B distribution**, with a backstop ceiling of 5.0 (to prevent absurd valuations from passing in bubble conditions). Retain P/E × P/B ≤ 22.5 as a composite backstop.
- **Mixed sectors** (Consumer Staples): Use the more permissive of the fixed or sector-relative threshold.

This creates a screening universe that includes high-quality asset-light businesses while preserving Graham's intent that you shouldn't pay too much for what you're getting on a balance-sheet basis.

**Data requirement:** The sector P/B distribution must be computed from a reasonably broad universe (S&P 500 or Russell 1000 constituents within each sector). Cache and refresh monthly.

---

## Part 2: Secular Disruption Modifier

### The Problem This Solves

The current attractor stability analysis evaluates individual companies against their existing competitive landscape. It asks: "Is this business model self-reinforcing?" What it does *not* systematically assess is whether the **entire industry's demand function** is being structurally altered by an exogenous force — a technological paradigm shift, a regulatory transformation, or a macroeconomic regime change.

This is not a theoretical gap. Right now, in early 2026, we're watching it play out in real time:

- The IT services industry (Cognizant, Infosys, TCS, Wipro, Accenture) is being challenged by AI coding agents that threaten the labor-arbitrage model that has been the industry's core value proposition for thirty years.
- The SaaS software sector has experienced a 21–30% drawdown as "seat compression" from agentic AI threatens per-user pricing models.
- Capital is rotating from "bits" (software, SaaS, digital services) to "atoms" (energy infrastructure, materials, industrials, data center hardware) — a sector rotation not seen at this scale since the post-dotcom period.

The existing attractor stability factors can partially capture this (Industry Structure = 2/5, Demand Feedback = 2/5 would flag some risk). But the current framework lacks a formal mechanism to:

1. Identify when an entire industry is in a **secular phase transition** (not just a cyclical downturn).
2. Quantify the impact on required margin of safety.
3. Distinguish between companies that are **genuinely adapting** versus companies that are **performing adaptation theater** (announcing AI initiatives while their core revenue model remains structurally threatened).
4. Flip the lens to identify the **beneficiaries** of the same disruption on the other side.

### Amendment to Framework — Section II: Add Secular Disruption Modifier

**Insert after the Concentration Risk Modifier, before Layer 3 (Network Regime Classification).**

#### Secular Disruption Modifier

After computing the attractor stability score (with capital allocation factor and concentration risk modifier applied), assess whether the company's **primary industry** is undergoing a secular phase transition — a structural shift in the demand function, cost structure, or competitive regime that is not cyclical and will not revert.

**This is distinct from the existing attractor stability factors.** The attractor score evaluates the company's position within its industry. The secular disruption modifier evaluates whether the industry itself is undergoing a regime change. A company can score 4/5 on competitive reinforcement within an industry that is being made obsolete — this is precisely the "Kodak pattern" the framework already warns about, now formalized as a scoring mechanism.

#### Classification

Assess the company's primary industry against these five indicators. Each is scored as Present (1) or Absent (0):

| # | Indicator | Description | How to Detect |
|---|-----------|-------------|---------------|
| 1 | **Demand Substitution** | A new technology, product, or business model is emerging that can fulfill the same customer need at dramatically lower cost or higher quality, and adoption is accelerating (not merely theoretical). | Look for: new entrants growing >30% annually in the same customer base; customer budget reallocation away from the incumbent category; "seat compression" or "vendor consolidation" language in customer earnings calls. |
| 2 | **Labor Model Disruption** | The industry's cost structure and margin model depend on a labor input whose unit cost is being structurally deflated by automation, AI, or process innovation. | Look for: revenue-per-employee trending flat while headcount grows (labor is getting less productive relative to revenue); AI tools that directly substitute for the industry's core labor function; offshore labor-arbitrage advantages narrowing as AI equalizes productivity across geographies. |
| 3 | **Pricing Power Erosion** | The industry is experiencing structural (not cyclical) pricing pressure — customers demanding lower rates, outcome-based pricing replacing input-based pricing, or new entrants commoditizing the offering. | Look for: declining average deal values despite stable volume; customer procurement language shifting from "vendor selection" to "vendor rationalization"; industry-wide margin compression not explained by input costs. |
| 4 | **Capital Migration** | Investment capital (both corporate capex and financial market flows) is moving away from the industry and toward adjacent or replacement sectors, not as a short-term rotation but as a structural reallocation. | Look for: declining forward P/E multiples across the industry (not just individual companies); venture capital funding drying up for new entrants in the category; corporate customers redirecting IT/operational budgets from the industry's services toward alternatives. |
| 5 | **Incumbent Response Paradox** | The industry's leading companies are investing heavily in the disruptive technology but cannot clearly articulate how it grows (rather than cannibalizes) their existing revenue. Their "transformation" narrative relies on selling the disruptive capability back to customers, but those customers could increasingly access it directly. | Look for: "AI strategy" announcements that describe cost reduction but not revenue growth; partnerships with disruptive technology providers that position the incumbent as a reseller rather than a value-creator; growing R&D spend with flat or declining organic revenue growth. |

#### Scoring and Impact

| Indicators Present | Classification | Effect on Framework |
|---|---|---|
| 0–1 | **No secular disruption detected** | No adjustment. Proceed with existing attractor score. |
| 2 | **Early-stage disruption** | Reduce attractor stability score by 0.5. Add a note to the report: "Early-stage secular disruption detected — monitor for acceleration." |
| 3 | **Active disruption** | Reduce attractor stability score by 1.0. Increase required margin of safety by 10 percentage points (e.g., Transitional 40% → 50%). Flag the stock as a potential value trap regardless of quantitative attractiveness. |
| 4–5 | **Advanced disruption** | Reduce attractor stability score by 1.5. If the adjusted attractor score falls below 2.0, the stock is reclassified as Dissolving and is rejected regardless of valuation. If it remains above 2.0, increase required MoS by 15 percentage points. |

**Interaction with existing factors:** The secular disruption modifier stacks with the concentration risk modifier. Both are applied after the base six-factor attractor score is computed. The adjusted score has a floor of 1.0.

**CTSH Example — How This Would Have Changed the Report:**

Cognizant (CTSH) as of March 2026:

| Indicator | Assessment | Score |
|---|---|---|
| Demand Substitution | Present — AI coding tools (Claude Code, Devin, Copilot) are directly substituting for the work IT services firms sell; enterprises report "seat compression" and vendor rationalization | 1 |
| Labor Model Disruption | Present — Cognizant's business model is fundamentally labor-arbitrage (350K employees, offshore delivery centers); AI agents directly substitute for the core labor input | 1 |
| Pricing Power Erosion | Present — industry-wide margin compression; customers demanding outcome-based pricing; management estimates 7-8 year transition timeline | 1 |
| Capital Migration | Present — massive capital rotation from software/IT services into infrastructure, energy, and industrials; CTSH down 24% from 52-week high; industry forward P/E multiples compressed | 1 |
| Incumbent Response Paradox | Partially Present — Cognizant's AI Factory, Palantir partnership, and Microsoft Copilot deployment are all real, but the core question remains unanswered: if AI makes 100 developers as productive as 500, does Cognizant's revenue grow or shrink? | 1 |

**Score: 5/5 → Advanced Disruption**

- Base attractor score: 3.0 (as reported)
- Secular disruption modifier: -1.5
- Adjusted attractor score: **1.5 → Dissolving → REJECT**

Under the updated framework, CTSH would not receive a WAIT signal. It would receive a **REJECT** signal — the adjusted attractor score falls below 2.0, indicating this is likely a melting ice cube regardless of current valuation attractiveness.

This is a stronger and, I believe, more honest conclusion than "wait for the price to drop to $41." The price might well drop to $41 — but if the business model is structurally impaired, $41 might not be cheap enough.

#### The Flip Side: Using Secular Disruption to Find Opportunities

The secular disruption modifier is not just a risk filter. **The industries that are disrupting others are the adjacent possible for opportunity identification.** When the framework detects Advanced Disruption in an industry, it should automatically flag the *beneficiary* sectors for screening.

Add the following to the report generation logic:

When a stock is flagged with Active or Advanced Disruption, the report should include a section titled **"Disruption Beneficiary Scan"** that identifies:

1. **The disruptive technology or business model** causing the disruption (e.g., "AI coding agents and agentic automation").
2. **The sectors and companies that benefit** from the same force that is damaging the analyzed company. These fall into three categories:
   - **Enablers:** Companies providing the infrastructure, hardware, or platforms that power the disruption (e.g., GPU manufacturers, cloud infrastructure, energy for data centers).
   - **Adopters:** Companies in other industries that become more efficient/profitable by using the disruptive technology (e.g., a manufacturer that dramatically reduces IT costs by replacing outsourced development with AI tools).
   - **Adjacent Possible Entrants:** Companies positioned to capture the market share or revenue pool being vacated by the disrupted industry.
3. **A flag for the Asymmetric Opportunity tier** — any beneficiary that also passes Layer 1 screening should be automatically added to the watchlist as an Asymmetric Opportunity candidate with a note referencing the disruption it benefits from.

This is where the framework's value thesis connects with the complex systems insight: **phase transitions create simultaneous value destruction and value creation.** The same force that makes CTSH a potential value trap may make a company on the other side of the transition a genuine asymmetric opportunity.

---

## Part 3: Transition-Era Calibration

### The Current Macro Regime (March 2026)

The framework should not be recalibrated for every market mood swing. But the current environment represents a genuine structural transition that requires explicit acknowledgment in how the framework operates — not because the rules change, but because the *inputs* to those rules need to account for what's happening.

Key features of the current regime:

1. **The SaaSpocalypse.** Software sector P/E multiples have compressed from 39x to 21x in months. The iShares Software ETF (IGV) is down ~30% from its late-2025 peak. Per-seat SaaS pricing models are under existential pressure from agentic AI.

2. **Bits-to-Atoms rotation.** Capital is flowing from asset-light digital businesses into asset-heavy infrastructure: energy (natural gas, nuclear), materials (copper, lithium), industrials (heavy machinery, data center cooling), and AI hardware (semiconductors, GPU supply chain). This mirrors the post-dotcom rotation but with AI infrastructure replacing telecom infrastructure as the driver.

3. **AI labor substitution.** AI tools are reaching a capability threshold where they directly substitute for white-collar knowledge work — software development, content creation, legal research, financial analysis, customer support. This compresses the value proposition of companies whose business model is selling that labor.

4. **Domestic policy tailwinds for physical assets.** Tax incentives for domestic manufacturing (OBBBA) and tariff policies are creating tailwinds for US-based producers and infrastructure builders while creating headwinds for asset-light, globally-distributed service companies.

5. **Interest rates remain elevated.** With AAA yields around 5.3%, the dynamic P/E ceiling is approximately 14.7, which is historically restrictive. This actually benefits the framework — Graham-Dodd screening works best when rates are high enough to create meaningful discipline.

### Calibration Adjustments

These are not rule changes. They are parameter adjustments reflecting current conditions.

#### 3.1: Technology Sector Screen Requires Secular Disruption Assessment

**New rule:** Any stock classified in the Technology sector (SIC codes 7371–7379 or GICS sector 45) that passes Layer 1 quantitative screening **must** undergo the Secular Disruption Modifier assessment before receiving a BUY or WAIT signal. This is mandatory, not optional.

**Rationale:** Technology stocks that pass Graham-Dodd screens in 2026 are cheap for a reason. Some are genuinely undervalued (the baby thrown out with the bathwater in the sector rotation). Others are value traps where current earnings overstate sustainable earning power because the business model is being disrupted. The secular disruption modifier is the mechanism that distinguishes between these cases.

This mandatory assessment applies during the current transition period and should be reviewed annually. If the tech sector stabilizes and the disruption dynamics mature (i.e., winners and losers become clear), this mandatory flag can be relaxed.

#### 3.2: "Adaptation Capacity" Factor — Tighter Scoring Criteria

**Problem identified:** The CTSH report scored Adaptation Capacity at 4/5 (Strong), which was too generous. Cognizant has announced AI initiatives (AI Factory, Palantir partnership, Microsoft Copilot deployment), but these are responses to an existential threat, not evidence of a self-reinforcing adaptation capability.

**Amendment to the Adaptation Capacity scoring rubric in the Claude API prompt:**

Update the scoring guidance for the Adaptation Capacity factor to include this clarifying instruction:

```
IMPORTANT: Adaptation Capacity does not measure whether a company
is *announcing* responses to disruption. It measures whether the
company has a *track record* of successfully navigating prior
disruptions and whether its current adaptations are likely to
*grow* revenue rather than merely *slow its decline*.

Score 4-5 ONLY if:
- The company has previously navigated a major industry disruption
  and emerged with equal or greater market share.
- Current adaptation efforts have a clear path to revenue growth
  (not just cost reduction or defensive repositioning).
- The adaptation creates new competitive advantages rather than
  merely maintaining existing ones.

Score 2-3 if:
- The company is making credible adaptation efforts but lacks a
  track record of navigating disruption.
- Current adaptations are primarily defensive (cost reduction,
  efficiency gains) rather than offensive (new revenue streams,
  new competitive positions).
- The adaptation narrative is plausible but unproven.

Score 1 if:
- The company's adaptation efforts consist primarily of press
  releases, partnerships, and rebranding rather than measurable
  changes to the business model.
- Management uses the disruption as a sales pitch ("we'll help
  you adopt AI") while the core revenue model remains dependent
  on the disrupted paradigm.
```

#### 3.3: New Red Flag — "Transformation Theater"

Add to the Phase Transition Red Flags list in the framework:

```
- **Transformation Theater:** The company announces frequent
  AI/digital/transformation initiatives, partnerships, and
  product launches, but organic revenue growth remains flat or
  negative, and the announced initiatives are primarily about
  reselling the disruptive technology rather than using it to
  build new competitive advantages. This pattern is especially
  common in IT services and consulting firms during technology
  transitions.
```

#### 3.4: Beneficiary Sector Watchlist — Current Period

Based on the current macro regime, the following sectors and themes should receive enhanced screening attention as potential sources of undervalued beneficiaries:

| Theme | Why It Matters | What to Screen For |
|---|---|---|
| **Energy infrastructure for AI** | Data centers require massive power; AI compute is energy-intensive; grid infrastructure is constrained | Utilities, natural gas producers, nuclear energy companies, grid equipment manufacturers that pass Layer 1 screens. Look for companies with long-duration contracted revenue (stable attractor) that benefit from increasing demand. |
| **Physical infrastructure / industrials** | The "bits to atoms" rotation favors companies that build physical things; tariff policy creates domestic tailwinds | Heavy equipment manufacturers, construction/engineering firms, domestic materials producers. These are classic Graham-Dodd territory — asset-heavy, often overlooked, sometimes genuinely cheap. |
| **AI hardware supply chain** | Semiconductor manufacturers, cooling systems, networking equipment are the enabling layer of the AI transition | Be cautious of elevated valuations (NVDA, AMD are not value stocks). Look downstream — the less glamorous suppliers and component makers where the market hasn't fully priced in the demand increase. |
| **Companies that become MORE profitable with AI** | Some businesses become dramatically more efficient when they can replace expensive outsourced IT with AI tools | Look for companies currently spending heavily on IT services/outsourcing (financial services, healthcare payers, insurance companies) that could see meaningful margin expansion as AI reduces those costs. These are the "adopter" beneficiaries. |
| **Distressed quality in software** | The SaaSpocalypse may be creating genuine bargains among software companies with real moats, not just depressed multiples | Apply Layer 1 screens to the beaten-down software sector. Any company that passes quantitative screens AND has a secular disruption score of 0-1 (meaning its specific niche is NOT directly threatened by AI) may represent genuine value. Cybersecurity and observability platforms are candidates — enterprises need these regardless of whether they use AI agents or human workers. |

This watchlist is informational, not prescriptive. It identifies sectors where the framework's screening is most likely to surface opportunities during the current transition period. The stocks themselves still must pass all framework layers.

---

## Part 4: Amended Claude API Prompt Template

The following additions should be inserted into the Claude API prompt used for attractor stability analysis, after the existing six-factor assessment and concentration risk extraction.

```
SECULAR DISRUPTION ASSESSMENT

After completing the attractor stability analysis, evaluate whether this
company's PRIMARY INDUSTRY is undergoing a secular phase transition. This
is distinct from the company-level analysis above — you are evaluating the
industry, not the company.

Assess each of the following five indicators as Present (1) or Absent (0):

1. DEMAND SUBSTITUTION: Is a new technology, product, or business model
   emerging that can fulfill the same customer need at dramatically lower
   cost or higher quality, with adoption accelerating (not merely
   theoretical)?

2. LABOR MODEL DISRUPTION: Does the industry's cost structure depend on
   a labor input whose unit cost is being structurally deflated by
   automation or AI?

3. PRICING POWER EROSION: Is the industry experiencing structural (not
   cyclical) pricing pressure — customers demanding outcome-based pricing,
   new entrants commoditizing the offering, or declining average deal
   values despite stable volume?

4. CAPITAL MIGRATION: Is investment capital (corporate capex and financial
   market flows) moving away from the industry toward adjacent or
   replacement sectors as a structural reallocation, not a short-term
   rotation?

5. INCUMBENT RESPONSE PARADOX: Are the industry's leading companies
   investing heavily in the disruptive technology but unable to clearly
   articulate how it grows (rather than cannibalizes) their existing
   revenue?

For each indicator, provide a brief explanation of your assessment.

Add to your JSON response:
"secular_disruption": {
    "demand_substitution": { "present": true/false, "explanation": "..." },
    "labor_model_disruption": { "present": true/false, "explanation": "..." },
    "pricing_power_erosion": { "present": true/false, "explanation": "..." },
    "capital_migration": { "present": true/false, "explanation": "..." },
    "incumbent_response_paradox": { "present": true/false, "explanation": "..." },
    "total_indicators": N,
    "classification": "none|early|active|advanced",
    "attractor_score_adjustment": -N.N,
    "mos_adjustment_pct": N,
    "beneficiary_sectors": ["...", "..."],
    "beneficiary_rationale": "..."
}

IMPORTANT GUIDANCE ON ADAPTATION CAPACITY SCORING:
Adaptation Capacity does not measure whether a company is *announcing*
responses to disruption. It measures whether the company has a *track
record* of successfully navigating prior disruptions and whether its
current adaptations are likely to *grow* revenue rather than merely
*slow its decline*.

Score 4-5 ONLY if the company has previously navigated a major industry
disruption and emerged stronger, AND current adaptations have a clear
path to revenue growth (not just defensive repositioning).

Score 2-3 if adaptation efforts are credible but unproven, or primarily
defensive.

Score 1 if adaptation efforts consist primarily of press releases,
partnerships, and rebranding without measurable business model changes.
```

---

## Part 5: Database Schema Additions

```sql
-- Secular disruption assessment (one per stock per analysis date)
CREATE TABLE secular_disruption (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL REFERENCES stocks(id),
    analysis_date TEXT NOT NULL,
    demand_substitution INTEGER NOT NULL DEFAULT 0,       -- 0 or 1
    demand_substitution_note TEXT,
    labor_model_disruption INTEGER NOT NULL DEFAULT 0,     -- 0 or 1
    labor_model_disruption_note TEXT,
    pricing_power_erosion INTEGER NOT NULL DEFAULT 0,      -- 0 or 1
    pricing_power_erosion_note TEXT,
    capital_migration INTEGER NOT NULL DEFAULT 0,          -- 0 or 1
    capital_migration_note TEXT,
    incumbent_response_paradox INTEGER NOT NULL DEFAULT 0, -- 0 or 1
    incumbent_response_paradox_note TEXT,
    total_indicators INTEGER NOT NULL,
    classification TEXT NOT NULL,  -- 'none', 'early', 'active', 'advanced'
    attractor_score_adjustment REAL NOT NULL DEFAULT 0,
    mos_adjustment_pct INTEGER NOT NULL DEFAULT 0,
    beneficiary_sectors TEXT,     -- JSON array of sector names
    beneficiary_rationale TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_secular_disruption_stock ON secular_disruption(stock_id, analysis_date);

-- Sector P/B distribution (for sector-relative P/B thresholds)
CREATE TABLE sector_pb_distribution (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector TEXT NOT NULL,
    computed_date TEXT NOT NULL,
    p33_pb REAL NOT NULL,       -- 33rd percentile P/B
    p50_pb REAL NOT NULL,       -- median P/B
    sample_size INTEGER NOT NULL,
    UNIQUE(sector, computed_date)
);
```

Also add a column to `attractor_analysis`:

```sql
ALTER TABLE attractor_analysis ADD COLUMN secular_disruption_id INTEGER
    REFERENCES secular_disruption(id);
ALTER TABLE attractor_analysis ADD COLUMN adjusted_attractor_score REAL;
```

The `adjusted_attractor_score` stores the final score after both concentration risk and secular disruption modifiers are applied. The signal generation logic should use this value, not the base score.

---

## Part 6: UI Additions

### 6.1: Secular Disruption Panel

In the stock detail / research report view, add a **Secular Disruption** panel below the Concentration Risk panel.

Display:
- Five indicators as a checklist (green check / red X for each)
- One-line explanation for each indicator
- Classification badge: "None" (green), "Early" (yellow), "Active" (orange), "Advanced" (red)
- Score adjustment shown clearly: "Attractor Score: 3.0 → 1.5 (secular disruption: -1.5)"
- MoS adjustment if applicable: "Required MoS: 40% → 55% (+15% secular disruption)"

### 6.2: Disruption Beneficiary Scan

When a stock is classified as Active or Advanced disruption, add a collapsible section titled "Disruption Beneficiaries" that lists:
- The identified beneficiary sectors
- Any stocks in the current watchlist or portfolio that are in beneficiary sectors
- A button: "Screen Beneficiary Sectors" that triggers a Layer 1 scan filtered to the identified sectors

### 6.3: Report Signal Logic Update

The signal generation logic must be updated to incorporate the adjusted attractor score:

```javascript
function generateSignal(stock) {
    const adjustedScore = stock.attractor_score
        - stock.concentration_penalty
        - stock.secular_disruption_adjustment;

    // Dissolving → REJECT regardless of valuation
    if (adjustedScore < 2.0) {
        return { signal: 'REJECT', reason: 'Adjusted attractor score below 2.0' };
    }

    // Compute MoS with secular disruption adjustment
    let baseMoS;
    if (adjustedScore >= 3.5) {
        baseMoS = stock.network_regime === 'hard_non_leader' ? 0.40 : 0.25;
    } else {
        baseMoS = 0.40; // Transitional
    }

    const totalMoS = baseMoS + (stock.secular_disruption_mos_adjustment / 100);
    const buyBelow = stock.adjusted_iv * (1 - totalMoS);

    if (stock.current_price <= buyBelow) {
        return { signal: 'BUY', buyBelow, totalMoS };
    } else if (stock.current_price <= stock.adjusted_iv) {
        return { signal: 'WAIT', buyBelow, totalMoS };
    } else {
        return { signal: 'OVERVALUED', buyBelow, totalMoS };
    }
}
```

---

## Part 7: Phasing

| Addition | Phase | Rationale |
|---|---|---|
| Bug fixes (1.1–1.4) | Phase 1 (Screening Engine) | These are data quality issues that affect the foundation. Fix immediately. |
| Sector-relative P/B (Bug 1.5) | Phase 1 (Screening Engine) | Requires sector P/B distribution computation, which is part of the screening pipeline. |
| Secular Disruption Modifier | Phase 3 (Attractor Analysis) | Extracted by Claude API alongside attractor factors. Same infrastructure, same prompt call. |
| Adaptation Capacity tighter scoring | Phase 3 (Attractor Analysis) | Prompt template change only. |
| Disruption Beneficiary Scan | Phase 3 (Attractor Analysis) | Output from the secular disruption assessment. UI work only. |
| Mandatory tech sector assessment | Phase 3 (Attractor Analysis) | Logic gate in signal generation. Trivial to implement once secular disruption is available. |
| Transition-era watchlist themes | Informational | Not a code change. Reference material for human judgment when reviewing screening output. |

---

## Summary of All Changes

| Document | Section | Change |
|---|---|---|
| Framework | Section II, Layer 1 | Fix P/E display to distinguish TTM vs normalized; add sector-relative P/B threshold for asset-light sectors |
| Framework | Section II, Layer 2 | Tighten Adaptation Capacity scoring rubric |
| Framework | Section II, post-Concentration Risk | Add Secular Disruption Modifier (5 indicators, 4 classifications, score/MoS adjustments) |
| Framework | Section II, Red Flags | Add "Transformation Theater" red flag |
| Framework | Section III | Clarify fat-tail discount vs margin of safety interaction (discount applies to IV, not MoS) |
| Framework | Section IV | Add disruption beneficiary identification logic |
| Scope | Database schema | Add `secular_disruption` and `sector_pb_distribution` tables; add columns to `attractor_analysis` |
| Scope | Claude API prompt | Add secular disruption assessment block; add adapted scoring guidance for Adaptation Capacity |
| Scope | Screening engine | Fix EPS precision; fix MoS computation; add sector-relative P/B; add P/E labeling |
| Scope | Signal generation | Update to use adjusted attractor score; incorporate secular disruption MoS adjustment |
| Scope | UI — Report view | Add Secular Disruption panel, Disruption Beneficiary scan |
| Scope | UI — Screener | Display both TTM and normalized P/E; show sector-relative P/B threshold |
| Scope | Data quality | Add validation check for identical multi-year EPS values |
| Scope | Tech sector gate | Mandatory secular disruption assessment for Technology sector stocks |
| Scope | Phasing | Bug fixes → Phase 1; All secular disruption features → Phase 3 |

---

*This update was produced on 2026-03-18. The transition-era calibration in Part 3 reflects market conditions as of that date and should be reviewed quarterly.*
