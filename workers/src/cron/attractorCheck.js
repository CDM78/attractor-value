// Daily Attractor Check — runs stale/missing attractor analyses for qualifying stocks
// Implements caching policy from framework-update-5, Fix 4:
//   - No analysis on record → run
//   - > 90 days old → run
//   - > 30 days old AND on watchlist/portfolio → run
//   - Score < 3.0 → re-analyze after 45 days instead of 90
//   - Otherwise → use cached score

import { runSingleAnalysis } from '../services/analysisRunner.js';

const MAX_ANALYSES_PER_RUN = 3; // Keep Claude API costs manageable

export async function dailyAttractorCheck(env) {
  if (!env.ANTHROPIC_API_KEY) {
    console.log('Attractor check skipped: ANTHROPIC_API_KEY not configured');
    return;
  }

  const db = env.DB;
  const startTime = Date.now();
  console.log('Daily attractor check started:', new Date().toISOString());

  // Find stocks that need attractor analysis, ordered by priority:
  // 1. Full pass / near miss stocks with NO analysis at all
  // 2. Watchlist/portfolio stocks with stale analysis (> 30 days)
  // 3. Stocks with score < 3.0 and analysis > 45 days old
  // 4. Any qualifying stock with analysis > 90 days old
  const candidates = await db.prepare(`
    WITH qualifying AS (
      SELECT DISTINCT sr.ticker, sr.tier, sr.miss_severity
      FROM screen_results sr
      WHERE (sr.tier = 'full_pass' OR sr.tier = 'near_miss')
        AND sr.screen_date = (SELECT MAX(screen_date) FROM screen_results)
    ),
    watchlist_portfolio AS (
      SELECT ticker FROM watchlist
      UNION
      SELECT DISTINCT ticker FROM holdings
    ),
    latest_analysis AS (
      SELECT ticker,
             MAX(analysis_date) as analysis_date,
             attractor_stability_score
      FROM attractor_analysis
      GROUP BY ticker
    )
    SELECT q.ticker, q.tier, q.miss_severity,
           la.analysis_date,
           la.attractor_stability_score,
           CASE WHEN wp.ticker IS NOT NULL THEN 1 ELSE 0 END as is_watched,
           CASE
             WHEN la.analysis_date IS NULL THEN 0
             WHEN wp.ticker IS NOT NULL AND la.analysis_date < date('now', '-30 days') THEN 1
             WHEN la.attractor_stability_score < 3.0 AND la.analysis_date < date('now', '-45 days') THEN 2
             WHEN la.analysis_date < date('now', '-90 days') THEN 3
             ELSE 99
           END as priority
    FROM qualifying q
    LEFT JOIN latest_analysis la ON q.ticker = la.ticker
    LEFT JOIN watchlist_portfolio wp ON q.ticker = wp.ticker
    WHERE CASE
      WHEN la.analysis_date IS NULL THEN 1
      WHEN wp.ticker IS NOT NULL AND la.analysis_date < date('now', '-30 days') THEN 1
      WHEN la.attractor_stability_score < 3.0 AND la.analysis_date < date('now', '-45 days') THEN 1
      WHEN la.analysis_date < date('now', '-90 days') THEN 1
      ELSE 0
    END = 1
    ORDER BY priority ASC, is_watched DESC
    LIMIT ?
  `).bind(MAX_ANALYSES_PER_RUN).all();

  const tickers = candidates.results || [];
  if (tickers.length === 0) {
    console.log('Attractor check: all analyses are fresh, nothing to do');
    return;
  }

  console.log(`Attractor check: ${tickers.length} stocks need analysis`);
  let analyzed = 0;

  for (const row of tickers) {
    try {
      const result = await runSingleAnalysis(env, row.ticker);
      analyzed++;

      const analysis = result.analysis;
      const sdLabel = analysis.secular_disruption?.classification !== 'none'
        ? `, secular=${analysis.secular_disruption?.classification}` : '';
      console.log(`Attractor analysis complete for ${row.ticker}: base=${analysis.attractor_stability_score}, adjusted=${analysis.adjusted_attractor_score}, regime=${analysis.network_regime}${sdLabel} (${row.analysis_date ? 'refreshed' : 'new'})`);
    } catch (err) {
      console.error(`Attractor analysis failed for ${row.ticker}:`, err.message);
    }
  }

  console.log(`Daily attractor check complete: ${analyzed}/${tickers.length} analyzed in ${Date.now() - startTime}ms`);
}
