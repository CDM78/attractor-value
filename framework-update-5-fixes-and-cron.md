# Attractor Value Framework — Update 5: Framework Fixes and Cron Schedule Design

## Context

This document amends the previously provided specification documents:
- **investment-framework.md** (The Attractor Value Framework — rule set)
- **attractor-value-scope.md** (Claude Code project scope)
- **AV-Framework-Report.md** (Technical Report — current implementation)

It addresses six issues identified during review of the technical report, plus a cron schedule redesign that separates initial data population from steady-state operation.

---

## Fix 1: Growth Rate Formula Bug (Critical)

### Problem

Layer 1 (earnings growth filter) and Layer 2 (Graham valuation growth estimate) use inconsistent CAGR formulas. Layer 1 uses `years = total years of history - 1`. Layer 2 uses `years = total years of history - 3`. Both compute growth from the average of the first 3 years to the average of the last 3 years, so the correct denominator is the midpoint-to-midpoint span, which is `total years - 3`.

With 10 years of data, Layer 1 computes growth over 9 years (too long, dilutes the CAGR) while Layer 2 computes it over 7 years (correct). This means the screening filter is harder to pass than intended — stocks are being rejected that should qualify.

### Fix

Change Layer 1's formula to match Layer 2:

**Old (Layer 1, line 101 of report):**
```
years = total years of history - 1
```

**New:**
```
years = total years of history - 3
```

Both Layer 1 and Layer 2 should now use the identical formula:

```
avg_recent = average EPS of most recent 3 years
avg_early  = average EPS of earliest 3 years
years      = total years of history - 3  (midpoint-to-midpoint span)
growth     = ((avg_recent / avg_early)^(1/years) - 1) x 100
```

**Minimum data requirement:** This formula requires at least 6 years of data (so `years` is at least 3). For stocks with exactly 5 years of data, use `years = total years - 2` as a fallback (comparing 2-year averages with a shorter span). For fewer than 5 years, the stock cannot be evaluated for earnings growth and should fail this filter.

### Impact

This will increase the earnings growth pass rate (currently 60%), potentially surfacing additional candidates that were being incorrectly excluded.

---

## Fix 2: Graduated Fat-Tail Discount

### Problem

The current fat-tail discount applies a 15% haircut to any company with any negative EPS year in its history. But a company with 1 negative year in 10 already passed the earnings stability filter (which requires 8 of 10 positive). The framework is double-penalizing normal cyclicality — once by nearly failing the stability filter, and again with a steep intrinsic value haircut. Many excellent cyclical businesses (industrials, energy, materials) had a single bad year during 2008 or 2020 and emerged stronger. The 15% discount eliminates margin that's needed to actually find buy opportunities in these stocks.

### Fix

Replace the binary fat-tail discount with a graduated scale:

**Old (report lines 161–167):**

| Condition | Discount |
|---|---|
| 10+ years of data, no negative EPS years | 0% |
| 10+ years of data, had negative EPS | 15% |
| Fewer than 10 years of data | 10% |

**New:**

| Condition | Discount | Rationale |
|---|---|---|
| 10+ years of data, 0–1 negative EPS years | 0% | Proven resilience. One bad year in a decade is normal cyclicality, not structural vulnerability. |
| 10+ years of data, 2–3 negative EPS years | 10% | Moderate earnings volatility. Needs some cushion but not a full penalty. |
| 10+ years of data, 4+ negative EPS years | 15% | Genuinely earnings-volatile. Full penalty warranted. |
| Fewer than 10 years of data | 10% | Untested through a full economic cycle. |

### Implementation

```javascript
function computeFatTailDiscount(epsHistory) {
  const totalYears = epsHistory.length;
  const negativeYears = epsHistory.filter(eps => eps < 0).length;

  if (totalYears >= 10) {
    if (negativeYears <= 1) return 0.00;
    if (negativeYears <= 3) return 0.10;
    return 0.15;
  }
  return 0.10;  // insufficient history
}
```

### Impact

Stocks with exactly one bad year (e.g., 2008 or 2020) move from a 15% discount to 0%, which raises their adjusted intrinsic value and makes it more likely they'll show a BUY signal at current prices. This primarily benefits cyclical industrials, energy companies, and materials stocks — sectors currently underrepresented in screening results.

---

## Fix 3: Allow Transitional Attractor Stocks to Receive BUY Signals

### Problem

The current buy recommendation logic (report lines 403–404) requires attractor score ≥ 3.5 for a BUY signal. But the framework explicitly designed the transitional range (2.0–3.4) as buyable at a higher margin of safety, not as a reject. As implemented, a stock could pass all 8 quantitative filters, trade at a 40% discount to intrinsic value, have a reasonable attractor score of 3.2, and never receive a BUY signal. This contradicts the framework's own design and eliminates a category of investment — transitional companies bought cheaply enough — where deep value investors historically find outsized returns.

The higher margin of safety requirement for transitional stocks (40%) already accounts for the additional risk. Requiring both a high attractor score AND a large margin is redundant protection that results in buying almost nothing.

### Fix

**Old buy recommendation logic:**

| Condition | Signal |
|---|---|
| Full Pass + Price ≤ Buy Below + Attractor ≥ 3.5 | **BUY** |
| Full Pass + Price > Buy Below but < IV | **WAIT** |
| Full Pass + Price > IV | **OVER** |
| Near Miss (7/8) + Price ≤ Buy Below | **REVIEW** |

**New buy recommendation logic:**

| Condition | Signal | Display |
|---|---|---|
| Full Pass + Price ≤ Buy Below + Attractor ≥ 3.5 | **BUY** | Green |
| Full Pass + Price ≤ Buy Below + Attractor 2.0–3.4 | **BUY (TRANSITIONAL)** | Green with amber badge |
| Near Miss (marginal) + Price ≤ Buy Below + Attractor ≥ 3.5 + Claude "proceed" | **BUY (NEAR MISS)** | Amber |
| Near Miss (marginal) + Price ≤ Buy Below + Attractor 2.0–3.4 + Claude "proceed" | **BUY (NEAR MISS — TRANSITIONAL)** | Amber with caution icon |
| Full Pass or Near Miss + Price > Buy Below but < IV | **WAIT** | Grey-amber |
| Full Pass or Near Miss + Price > IV | **OVER** | Red |
| Attractor < 2.0 | **DO NOT BUY** | Red |
| Fail (≤ 6/8) | No signal | — |

**Key principle:** The attractor score determines the *margin of safety*, not whether you can buy at all. Scores below 2.0 are the only hard reject. The margin of safety is the mechanism that adjusts for risk — that's what Graham designed it for.

### UI Treatment

BUY (TRANSITIONAL) should display a note: "This stock has a transitional attractor score (X.X). A 40% margin of safety has been applied to account for this. Monitor attractor score quarterly — if it drops below 2.0, the sell discipline requires immediate exit."

---

## Fix 4: Reorder Pipeline — Attractor Analysis Before Price Check

### Problem

The current pipeline (report lines 427–446) runs attractor analysis after the price check. This means the price check uses a default 25% margin of safety, and the actual margin (which depends on the attractor score) is only applied afterward. This creates two problems:

1. **False positives:** A stock passes the price check at the default 25% margin, then attractor analysis reveals it's transitional (40% margin required), and the stock no longer qualifies. Wasted analysis isn't the issue — misleading intermediate signals are.

2. **False negatives:** A stock that would qualify at a 40% margin (because it's deeply discounted and transitional) might not be run through attractor analysis at all because it didn't show a BUY signal at the default 25% margin.

### Fix

Reorder the pipeline so attractor analysis feeds the valuation step:

**Old pipeline:**
```
~700 stocks
    |  Layer 1: 8 hard filters
~5-15 Full Pass + ~10-20 Near Miss
    |  Layer 2: Graham valuation (default 25% margin)
    |  Price check: is current price <= buy-below?
~2-5 stocks showing BUY signal
    |  Layer 3: Claude attractor analysis
Margin adjusted, signal may change
    |  Portfolio rules check
BUY
```

**New pipeline:**
```
~700 stocks
    |  Layer 1: 8 hard filters
~5-15 Full Pass + ~10-20 Near Miss
    |  Layer 3: Claude attractor analysis (all pass + near miss)
Attractor score + regime determined for each
    |  Layer 2: Graham valuation (with attractor-informed margin)
Correct buy-below price calculated using actual margin
    |  Price check: is current price <= buy-below?
~2-8 stocks showing BUY signal
    |  Portfolio rules check
BUY
```

### Cost Impact

This increases Claude API usage from ~2–5 analyses per cycle to ~25–35. At ~$0.025 per analysis, that's roughly $0.60–$0.90 per screening cycle instead of $0.05–$0.13. On a daily schedule, this is ~$20–25/month instead of ~$2/month. Still very manageable for a personal tool.

### Implementation Note — Caching Attractor Analyses

Not every stock needs a fresh attractor analysis every cycle. Attractor scores change slowly — the underlying factors (competitive position, industry structure, capital allocation track record) shift over quarters, not days. Implement a caching policy:

| Condition | Action |
|---|---|
| Stock has no attractor analysis on record | Run analysis |
| Most recent analysis is > 90 days old | Run fresh analysis |
| Most recent analysis is > 30 days old AND stock is on watchlist or in portfolio | Run fresh analysis |
| Most recent analysis is ≤ 30 days old | Use cached score |
| Stock's attractor score was < 3.0 on last analysis (higher monitoring priority) | Re-analyze after 45 days instead of 90 |

With this caching, the actual Claude API calls per daily cycle will be much lower — typically 3–8 fresh analyses per day (newly passing stocks plus stale cache refreshes), with the rest using cached scores. Monthly Claude API cost drops back to ~$5–10.

---

## Fix 5: Complete Near-Miss Margin of Safety Table

### Problem

Update 4 specified additional margin requirements for near-miss stocks, but the report's margin table (lines 175–181) doesn't include them. There's no defined path from a REVIEW signal to an actual buy decision with specified margins.

### Fix

Replace the margin of safety table with the complete version:

| Screen Tier | Attractor Score | Network Regime | Margin of Safety |
|---|---|---|---|
| Full Pass | ≥ 3.5 (Stable) | Classical / Soft Network | 25% |
| Full Pass | ≥ 3.5 (Stable) | Hard Network (non-leader) | 40% |
| Full Pass | 2.0–3.4 (Transitional) | Any | 40% |
| Near Miss (marginal) | ≥ 3.5 (Stable) | Classical / Soft Network | 30% |
| Near Miss (marginal) | ≥ 3.5 (Stable) | Hard Network (non-leader) | 45% |
| Near Miss (marginal) | 2.0–3.4 (Transitional) | Any | 45% |
| Near Miss (clear) | ≥ 2.0 | Any | 45% + Claude "proceed" required |
| Any | < 2.0 (Dissolving) | Any | Do not buy |

### Implementation

```javascript
function getMarginOfSafety(screenTier, attractorScore, networkRegime, missSeverity, claudeRecommendation) {
  // Dissolving attractor — hard reject
  if (attractorScore < 2.0) return null;  // null = do not buy

  // Near miss with clear miss — requires Claude approval
  if (screenTier === 'near_miss' && missSeverity === 'clear') {
    if (claudeRecommendation !== 'proceed') return null;
    return 0.45;
  }

  // Near miss (marginal)
  if (screenTier === 'near_miss') {
    if (attractorScore >= 3.5) {
      return (networkRegime === 'hard_network') ? 0.45 : 0.30;
    }
    return 0.45;  // transitional near miss
  }

  // Full pass
  if (attractorScore >= 3.5) {
    return (networkRegime === 'hard_network') ? 0.40 : 0.25;
  }
  return 0.40;  // transitional full pass
}
```

---

## Fix 6: Verify Alpha Vantage Fallback (Low Priority)

### Problem

The original scope specified Alpha Vantage as a detailed fundamentals source, supplementing Yahoo Finance for bulk data and Finnhub for insider transactions. The report's data source table (lines 452–458) lists Finnhub for fundamentals (via 10-K XBRL) but doesn't mention Alpha Vantage.

### Fix

This is a verification item, not necessarily a code change. If Finnhub's XBRL-based fundamental data is providing complete coverage for the screening universe (10 years of EPS, book value, balance sheet items, cash flow, dividends), then Alpha Vantage is unnecessary and removing it simplifies the data layer.

If there are gaps — particularly for smaller S&P 400 MidCap companies where Finnhub's XBRL coverage may be less complete — add Alpha Vantage as a fallback:

```javascript
async function getFundamentals(ticker) {
  // Try Finnhub first (60 calls/min, better rate limit)
  const finnhubData = await finnhub.getFundamentals(ticker);
  if (isComplete(finnhubData)) return finnhubData;

  // Fallback to Alpha Vantage (25 calls/day — use sparingly)
  const avData = await alphaVantage.getFundamentals(ticker);
  return avData;
}
```

**Action:** Run a data completeness check across the screening universe. Count how many stocks have null or missing values for key fundamental fields. If completeness is > 95%, Finnhub alone is sufficient. If there are meaningful gaps, add the Alpha Vantage fallback.

---

## Fix 7: Two-Mode Cron Schedule

### Problem

The current cron schedule (screening every 2 minutes, Finnhub refresh on odd minutes) was built for initial data population — backfilling ~570 stocks with fundamentals, metrics, and sector data. This is appropriate during the population sprint but inappropriate for steady-state operation. Graham-Dodd inputs (EPS history, book value, debt/equity, dividend records) change quarterly at most. Rescreening every 40 minutes produces identical results hundreds of times per day, burns through Cloudflare Workers invocations, and creates the illusion of dynamism in a strategy designed for patience.

### Fix — Two-Mode Cron System

#### Mode Detection

Add a mode flag to the system. The simplest approach is an automatic check:

```javascript
// In the cron handler
async function determineMode(db) {
  // Count stocks missing fundamental data
  const result = await db.prepare(`
    SELECT COUNT(*) as missing FROM stocks s
    LEFT JOIN financials f ON s.ticker = f.ticker
    WHERE f.ticker IS NULL
  `).first();

  // Count stocks missing screening results
  const unscreened = await db.prepare(`
    SELECT COUNT(*) as missing FROM stocks s
    LEFT JOIN screen_results sr ON s.ticker = sr.ticker
    WHERE sr.ticker IS NULL
  `).first();

  // Population mode if more than 10% of stocks lack data
  const totalStocks = await db.prepare('SELECT COUNT(*) as total FROM stocks').first();
  const threshold = totalStocks.total * 0.10;

  if (result.missing > threshold || unscreened.missing > threshold) {
    return 'population';
  }
  return 'maintenance';
}
```

#### Population Mode (Initial Setup)

**Triggers:** Automatic when > 10% of stocks lack fundamental data or screening results. Also activatable manually via an admin endpoint (`POST /api/admin/mode?mode=population`).

**Schedule:**
- Finnhub data fetch: every odd minute (sectors 20/run, metrics 30/run, fundamentals 5/run) — **unchanged from current**
- Screening: every even minute, 30 stocks/batch — **unchanged from current**
- Target: full universe populated within 2–3 hours

**Exit condition:** When < 10% of stocks have missing data, automatically transitions to maintenance mode. Log the transition: "Population complete. Switching to maintenance mode. [X] stocks with complete data, [Y] stocks with gaps."

#### Maintenance Mode (Steady-State Operation)

**Daily schedule (market days, US Eastern time):**

| Time | Job | What It Does |
|---|---|---|
| 4:45 PM ET | `dailyPriceRefresh` | Fetch end-of-day prices for full universe from Yahoo Finance. Single batch run. |
| 5:00 PM ET | `dailyScreen` | Run all Layer 1 filters against updated prices and cached fundamentals. Single pass, full universe. |
| 5:15 PM ET | `dailyAttractorCheck` | Run attractor analysis on any Full Pass or Near Miss stock with stale or missing analysis (per caching policy in Fix 4). |
| 5:30 PM ET | `dailyAlertCheck` | Run portfolio rules engine. Generate alerts for position limits, sector concentration, attractor deterioration, etc. |

**Intraday schedule (market hours, 9:30 AM – 4:00 PM ET):**

| Interval | Job | What It Does |
|---|---|---|
| Every 15 minutes | `watchlistPriceCheck` | Lightweight price-only fetch for watchlist and portfolio stocks. Compare against pre-computed buy-below prices. Fire `buy_opportunity` or `price_above_iv` alerts if thresholds are crossed. No screening, no fundamental data refresh. |

**Weekly schedule:**

| Day/Time | Job | What It Does |
|---|---|---|
| Saturday 6:00 AM ET | `weeklyFundamentalRefresh` | Refresh fundamental data (EPS, book value, balance sheet, cash flow) for full universe from Finnhub. Batch at comfortable rate (5/min to stay well within limits). |
| Saturday 8:00 AM ET | `weeklyInsiderRefresh` | Refresh insider transaction data from Finnhub for all watchlist and portfolio stocks. |

**Earnings season override (January, April, July, October):**

During earnings reporting months, add a second screening run:

| Time | Job | What It Does |
|---|---|---|
| 9:30 AM ET | `earningsSeasonMorningScreen` | Run a second daily screen to catch fundamentals updated by pre-market earnings releases. Only runs during the 4 peak earnings weeks per quarter. |

#### Manual Population Trigger

Add an admin endpoint to force re-population — useful when expanding the universe (e.g., adding S&P 400 MidCap stocks) or after a schema migration:

```javascript
// POST /api/admin/mode
// Body: { "mode": "population" } or { "mode": "maintenance" }
app.post('/api/admin/mode', async (req, res) => {
  const { mode } = req.body;
  await db.prepare('UPDATE system_config SET value = ? WHERE key = ?')
    .bind(mode, 'cron_mode').run();
  return res.json({ mode, message: `Switched to ${mode} mode` });
});
```

#### Resource Usage Comparison

| Metric | Population Mode (current) | Maintenance Mode |
|---|---|---|
| Worker invocations/day | ~1,440 (every 2 min × 24 hr) | ~50–60 (daily jobs + intraday price checks) |
| Finnhub API calls/day | ~2,000+ | ~600 (daily) / ~3,000 (weekly refresh Saturday) |
| Claude API calls/day | 0 (not yet implemented) | 3–8 (stale cache refreshes) |
| Screening runs/day | ~720 | 1 (2 during earnings season) |
| Approximate monthly cost | ~$2 Claude API | ~$5–10 Claude API |

### Implementation — Cron Handler Routing

```javascript
// wrangler.toml
// Keep the existing every-minute cron trigger
// [triggers]
// crons = ["* * * * *"]

// In the scheduled handler:
export default {
  async scheduled(event, env, ctx) {
    const db = env.DB;
    const mode = await determineMode(db);
    const minute = new Date(event.scheduledTime).getMinutes();
    const hour = new Date(event.scheduledTime).getUTCHours();
    const dayOfWeek = new Date(event.scheduledTime).getUTCDay();

    if (mode === 'population') {
      // Current aggressive schedule
      if (minute % 2 === 0) {
        await runScreeningBatch(db, 30);
      } else {
        await runFinnhubRefresh(db);
      }
      return;
    }

    // Maintenance mode — check what's scheduled
    const etHour = convertToET(hour);
    const isMarketDay = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isMarketHours = etHour >= 9.5 && etHour < 16;
    const isSaturday = dayOfWeek === 6;

    // Daily post-market jobs (4:45-5:30 PM ET on market days)
    if (isMarketDay && etHour === 16 && minute === 45) {
      await dailyPriceRefresh(db);
    }
    if (isMarketDay && etHour === 17 && minute === 0) {
      await dailyScreen(db);
    }
    if (isMarketDay && etHour === 17 && minute === 15) {
      await dailyAttractorCheck(db);
    }
    if (isMarketDay && etHour === 17 && minute === 30) {
      await dailyAlertCheck(db);
    }

    // Intraday watchlist price check (every 15 min during market hours)
    if (isMarketDay && isMarketHours && minute % 15 === 0) {
      await watchlistPriceCheck(db);
    }

    // Weekly Saturday refresh
    if (isSaturday && etHour === 6 && minute === 0) {
      await weeklyFundamentalRefresh(db);
    }
    if (isSaturday && etHour === 8 && minute === 0) {
      await weeklyInsiderRefresh(db);
    }
  }
};
```

---

## Database Addition — System Config Table

Add a simple config table for mode tracking and other system-level settings:

```sql
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Initial values
INSERT OR IGNORE INTO system_config (key, value) VALUES ('cron_mode', 'population');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_full_screen', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_fundamental_refresh', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_insider_refresh', '');
```

---

## Summary of All Changes

| Fix | Priority | Phase Impact | Change |
|---|---|---|---|
| 1. Growth rate formula bug | **Critical** | Immediate | Change Layer 1 CAGR denominator from `years - 1` to `years - 3` |
| 2. Graduated fat-tail discount | High | Immediate | Replace binary 0%/15% with graduated 0%/10%/15% based on count of negative EPS years |
| 3. Transitional stocks get BUY signals | High | Immediate | Attractor 2.0–3.4 produces BUY (TRANSITIONAL) at 40% margin instead of no signal |
| 4. Pipeline reorder | Medium | Requires attractor analysis caching | Run attractor analysis before price check; cache scores for 30–90 days |
| 5. Complete near-miss margin table | Medium | Immediate | Add full margin of safety matrix including near-miss tiers |
| 6. Alpha Vantage fallback verification | Low | When convenient | Check Finnhub fundamental completeness; add AV fallback if gaps > 5% |
| 7. Two-mode cron schedule | Medium | After population completes | Auto-detect population completeness; switch to maintenance mode with daily/weekly/intraday schedule |
