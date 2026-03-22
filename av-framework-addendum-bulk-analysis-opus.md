# AV Framework — Post-Restructuring Addendum: Bulk Analysis & Opus Toggle

## Context

This document adds two features to the restructured app. Implement these AFTER completing all current restructuring phases.

These are not changes to existing functionality — they're additions to the attractor analysis and dashboard UI that was built during the restructuring.

---

## Feature 1: Dual-Model Attractor Analysis (Sonnet Default, Opus on Demand)

### What

All automated attractor analysis (monthly Tier 3 sweep, daily regime detection, crisis screening, routine refreshes) uses Sonnet. Before committing capital to a BUY or executing a SELL, the user can manually trigger an Opus re-analysis for deeper evaluation. The Opus result replaces the Sonnet result in the database and may change the signal.

### Configuration

Add to portfolio_config:

```sql
INSERT OR IGNORE INTO portfolio_config (key, value) VALUES
  ('default_analysis_model', 'claude-sonnet-4-20250514'),
  ('deep_analysis_model', 'claude-opus-4-20250514'),
  ('bulk_analysis_concurrency', '5');
```

### Database Change

Add a column to the candidates table:

```sql
ALTER TABLE candidates ADD COLUMN analysis_model TEXT DEFAULT 'claude-sonnet-4-20250514';
```

This tracks which model produced the current analysis. When Opus re-analysis is triggered, update this field along with the analysis results.

### UI Changes

**On every BUY signal card in the Active Signals Panel, add a second button:**

```
[EXECUTE BUY →]                    [DEEP ANALYSIS (Opus) →]
```

**On every SELL signal card:**

```
[EXECUTE SELL →]                   [DEEP ANALYSIS (Opus) →]
```

**When [DEEP ANALYSIS (Opus)] is clicked:**

1. Show loading state on the card: "Running deep analysis with Opus..."
2. Call the attractor analysis endpoint with `model=claude-opus-4-20250514`
3. Run both bull and bear case analyses (same prompts, just using Opus)
4. Update the candidate record: attractor_score, bull_score, bear_score, signal, signal_confidence, signal_reason, analysis_model, attractor_analysis_date
5. Refresh the card with updated data
6. If the signal changed (e.g., BUY became NOT YET), show a notification: "Signal changed after Opus analysis: BUY → NOT YET. Opus identified [reason]."
7. Show a small badge on the card indicating analysis depth: "Analyzed: Opus" vs "Analyzed: Sonnet"

**The Opus badge should be visible on the holdings table too** — so the user can see at a glance which positions were confirmed by Opus before purchase.

### API Endpoint

```javascript
// POST /api/candidates/:id/deep-analyze
// Triggers Opus re-analysis for a specific candidate
app.post('/api/candidates/:id/deep-analyze', async (req, res) => {
  const candidate = await db.getCandidate(req.params.id);
  const model = await db.getConfig('deep_analysis_model');

  const result = await runAttractorAnalysis(candidate, model, db, env);

  // Update the candidate record
  await db.prepare(`
    UPDATE candidates SET
      attractor_score = ?,
      bull_score = ?,
      bear_score = ?,
      signal = ?,
      signal_confidence = ?,
      signal_reason = ?,
      analysis_model = ?,
      attractor_analysis_date = datetime('now')
    WHERE id = ?
  `).bind(
    result.attractor_score,
    result.bull_score,
    result.bear_score,
    result.signal,
    result.signal_confidence,
    result.signal_reason,
    model,
    req.params.id
  ).run();

  return res.json({
    previous_signal: candidate.signal,
    new_signal: result.signal,
    signal_changed: candidate.signal !== result.signal,
    attractor_score: result.attractor_score,
    model: model,
  });
});
```

---

## Feature 2: Bulk Analysis Mode

### What

An admin interface for running attractor analysis on all pending candidates in batch. Used for initial population after deployment, universe expansion, crisis activation (when Tier 2 turns on and many candidates need screening), and monthly Tier 3 refreshes.

### UI: Admin/Settings Page Addition

Add a "Bulk Analysis" section to the settings or admin page:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bulk Analysis                                                       │
│                                                                      │
│  Pending candidates: 127                                             │
│  Last bulk run: Never                                                │
│                                                                      │
│  Model:       [Sonnet ▼]     (Recommended for bulk sweeps)          │
│  Concurrency: [5 ▼]          (Parallel API calls)                   │
│  Tier:        [All ▼]        (All / Tier 2 / Tier 3 / Tier 4)      │
│                                                                      │
│  Estimated cost: ~$3.81 (127 candidates × ~$0.03 each)             │
│  Estimated time: ~7 minutes                                          │
│                                                                      │
│  [Run Bulk Analysis →]                                               │
└─────────────────────────────────────────────────────────────────────┘
```

When the user selects Opus as the model, update the cost estimate accordingly (~$0.25 per candidate instead of ~$0.03).

### Progress Display

While bulk analysis is running, replace the panel with a live progress view:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bulk Analysis in Progress                                           │
│                                                                      │
│  ████████████████░░░░░░░░░░░░░░  78 / 127 analyzed                 │
│                                                                      │
│  Passed attractor (≥2.5):  22                                       │
│  BUY signals:               6                                        │
│  NOT YET:                  16                                        │
│  PASS:                     56                                        │
│  Errors:                    0                                        │
│                                                                      │
│  Latest: CRWD — score 3.8 — BUY (STRONG)                           │
│  Estimated time remaining: ~3 minutes                                │
│                                                                      │
│  [Cancel]                                                            │
└─────────────────────────────────────────────────────────────────────┘
```

After completion, show summary and link to the dashboard:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bulk Analysis Complete ✓                                            │
│                                                                      │
│  Analyzed:                127                                        │
│  Passed attractor (≥2.5): 28                                        │
│  BUY signals:              8                                         │
│  NOT YET (watchlist):     20                                        │
│  PASS:                    99                                        │
│  Errors:                   0                                        │
│  Cost:                    ~$3.81                                    │
│  Time:                     6m 42s                                   │
│                                                                      │
│  [View BUY Signals on Dashboard →]                                  │
│  [Run Again]                                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### API Endpoint

```javascript
// POST /api/admin/bulk-analyze
// Body: { tier: "all" | "tier2" | "tier3" | "tier4", concurrency: 5, model: "claude-sonnet-4-20250514" }

app.post('/api/admin/bulk-analyze', async (req, res) => {
  const { tier = 'all', concurrency = 5, model } = req.body;
  const analysisModel = model || await db.getConfig('default_analysis_model');

  // Get all candidates pending analysis
  const query = tier === 'all'
    ? `SELECT * FROM candidates WHERE prescreen_pass = 1
       AND (attractor_analysis_date IS NULL
            OR attractor_analysis_date < date('now', '-90 days'))
       ORDER BY discovered_date DESC`
    : `SELECT * FROM candidates WHERE prescreen_pass = 1
       AND discovery_tier = ?
       AND (attractor_analysis_date IS NULL
            OR attractor_analysis_date < date('now', '-90 days'))
       ORDER BY discovered_date DESC`;

  const pending = tier === 'all'
    ? await db.prepare(query).all()
    : await db.prepare(query).bind(tier).all();

  const total = pending.results.length;
  const results = { analyzed: 0, passed: 0, buy: 0, not_yet: 0, pass: 0, errors: 0 };

  // Stream progress via SSE or poll endpoint
  // Process in parallel batches
  for (let i = 0; i < total; i += concurrency) {
    const batch = pending.results.slice(i, i + concurrency);

    const promises = batch.map(async (candidate) => {
      try {
        const result = await runAttractorAnalysis(candidate, analysisModel, db, env);
        results.analyzed++;
        if (result.attractor_score >= 2.5) results.passed++;
        if (result.signal === 'BUY') results.buy++;
        else if (result.signal === 'NOT_YET') results.not_yet++;
        else results.pass++;
      } catch (err) {
        results.errors++;
        if (err.status === 429) {
          // Rate limited — pause before continuing
          await new Promise(r => setTimeout(r, 30000));
        }
      }
    });

    await Promise.all(promises);
    // Brief pause between batches
    await new Promise(r => setTimeout(r, 2000));

    // Update progress (via SSE or database progress record)
    await db.prepare(`
      INSERT OR REPLACE INTO portfolio_config (key, value, updated_at)
      VALUES ('bulk_analysis_progress', ?, datetime('now'))
    `).bind(JSON.stringify({ ...results, total })).run();
  }

  return res.json({ ...results, total, model: analysisModel });
});

// GET /api/admin/bulk-analyze/progress
// Poll this endpoint from the UI during bulk analysis
app.get('/api/admin/bulk-analyze/progress', async (req, res) => {
  const progress = await db.getConfig('bulk_analysis_progress');
  return res.json(progress ? JSON.parse(progress) : null);
});
```

---

## Recommended Initial Population Workflow

After the restructuring is fully deployed:

1. Navigate to Settings → Bulk Analysis
2. Run with: Model = Sonnet, Concurrency = 5, Tier = All
3. Wait ~7-10 minutes for completion
4. Go to Dashboard — BUY signals will be populated
5. For each BUY signal you're considering acting on, click [DEEP ANALYSIS (Opus)]
6. If Opus confirms the signal, click [EXECUTE BUY]

This gets the full system producing actionable signals in under an hour at ~$5-8 total cost.
