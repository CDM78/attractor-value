// Daily Attractor Check — runs stale/missing attractor analyses for qualifying stocks
// Implements caching policy from framework-update-5, Fix 4:
//   - No analysis on record → run
//   - > 90 days old → run
//   - > 30 days old AND on watchlist/portfolio → run
//   - Score < 3.0 → re-analyze after 45 days instead of 90
//   - Otherwise → use cached score

import { analyzeAttractorStability, buildFinancialContext } from '../services/claude.js';
import { fetch10K, extractMDA } from '../services/edgar.js';
import { getCompanyNews, formatNewsForPrompt, getInsiderTransactions, getCompanyOfficers } from '../services/finnhub.js';
import { getFinancialsForTicker } from '../db/queries.js';
import { computeInsiderSignal } from '../services/insiderSignals.js';
import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { upsertValuation } from '../db/queries.js';
import { MARGIN_OF_SAFETY } from '../../../shared/constants.js';

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
      const stock = await db.prepare('SELECT * FROM stocks WHERE ticker = ?').bind(row.ticker).first();
      if (!stock) continue;

      const financials = await getFinancialsForTicker(db, row.ticker);
      const marketData = await db.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(row.ticker).first();
      const valuation = await db.prepare('SELECT * FROM valuations WHERE ticker = ?').bind(row.ticker).first();

      // Fetch insider signal (best effort)
      let insiderSignal = null;
      try {
        const sig = await db.prepare('SELECT * FROM insider_signals WHERE ticker = ?').bind(row.ticker).first();
        insiderSignal = sig;
      } catch (e) { /* ignore */ }

      const financialContext = buildFinancialContext(stock, financials, marketData, valuation, insiderSignal);

      // Fetch 10-K MD&A (best effort)
      let mdaText = null;
      try {
        const filingUrl = await fetch10K(row.ticker);
        if (filingUrl) mdaText = await extractMDA(filingUrl);
      } catch (e) {
        console.error(`EDGAR fetch failed for ${row.ticker}:`, e.message);
      }

      // Fetch recent news (best effort)
      let newsContext = '';
      try {
        if (env.FINNHUB_API_KEY) {
          const today = new Date().toISOString().split('T')[0];
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const news = await getCompanyNews(row.ticker, thirtyDaysAgo, today, env.FINNHUB_API_KEY);
          newsContext = formatNewsForPrompt(news);
        }
      } catch (e) {
        console.error(`News fetch failed for ${row.ticker}:`, e.message);
      }

      // Run Claude analysis
      const result = await analyzeAttractorStability(
        row.ticker, stock.company_name, financialContext, mdaText, newsContext, env.ANTHROPIC_API_KEY
      );

      // Store secular disruption assessment (Update 7)
      let secularDisruptionId = null;
      const sd = result.secular_disruption;
      if (sd) {
        const sdResult = await db.prepare(
          `INSERT INTO secular_disruption
           (ticker, analysis_date, demand_substitution, demand_substitution_note,
            labor_model_disruption, labor_model_disruption_note,
            pricing_power_erosion, pricing_power_erosion_note,
            capital_migration, capital_migration_note,
            incumbent_response_paradox, incumbent_response_paradox_note,
            total_indicators, classification, attractor_score_adjustment,
            mos_adjustment_pct, beneficiary_sectors, beneficiary_rationale)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          row.ticker, result.analysis_date,
          sd.demand_substitution, sd.demand_substitution_note,
          sd.labor_model_disruption, sd.labor_model_disruption_note,
          sd.pricing_power_erosion, sd.pricing_power_erosion_note,
          sd.capital_migration, sd.capital_migration_note,
          sd.incumbent_response_paradox, sd.incumbent_response_paradox_note,
          sd.total_indicators, sd.classification, sd.attractor_score_adjustment,
          sd.mos_adjustment_pct, sd.beneficiary_sectors, sd.beneficiary_rationale
        ).run();
        secularDisruptionId = sdResult.meta?.last_row_id || null;
      }

      // Store attractor analysis (with secular disruption link and adjusted score)
      await db.prepare(
        `INSERT INTO attractor_analysis
         (ticker, analysis_date, revenue_durability_score, competitive_reinforcement_score,
          industry_structure_score, demand_feedback_score, adaptation_capacity_score,
          capital_allocation_score, attractor_stability_score, network_regime,
          red_flags, analysis_text, sources_used, secular_disruption_id, adjusted_attractor_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        result.ticker, result.analysis_date,
        result.revenue_durability_score, result.competitive_reinforcement_score,
        result.industry_structure_score, result.demand_feedback_score,
        result.adaptation_capacity_score, result.capital_allocation_score,
        result.attractor_stability_score, result.network_regime,
        result.red_flags, result.analysis_text, result.sources_used,
        secularDisruptionId, result.adjusted_attractor_score
      ).run();

      // Store concentration risk if extracted
      const cr = result.concentration_risk;
      if (cr) {
        await db.prepare(
          `INSERT INTO concentration_risk
           (ticker, analysis_date, largest_customer_pct, largest_customer_name,
            customers_above_10pct, single_source_supplier, supplier_details,
            largest_geo_market_pct, largest_geo_market_name,
            regulatory_dependency_pct, regulatory_details,
            concentration_penalty, analysis_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          row.ticker, result.analysis_date,
          cr.largest_customer_pct || null, cr.largest_customer_name || null,
          cr.customers_above_10pct || 0, cr.single_source_supplier ? 1 : 0,
          cr.supplier_details || null,
          cr.largest_geo_market_pct || null, cr.largest_geo_market_name || null,
          cr.regulatory_dependency_pct || null, cr.regulatory_details || null,
          cr.concentration_penalty || 0, result.analysis_text
        ).run();
      }

      // Update valuation with attractor-adjusted margin (using adjusted score with secular disruption)
      const effectiveScore = result.adjusted_attractor_score ?? result.attractor_stability_score;
      if (effectiveScore != null && valuation && marketData) {
        const isHardNetwork = result.network_regime === 'hard_network';
        const isNearMiss = row.tier === 'near_miss';
        const missSeverity = row.miss_severity;

        let margin;
        if (effectiveScore < 2.0) {
          margin = 1.0;
        } else if (isNearMiss) {
          if (missSeverity === 'clear') {
            margin = MARGIN_OF_SAFETY.near_miss_clear;
          } else if (effectiveScore >= 3.5) {
            margin = isHardNetwork
              ? MARGIN_OF_SAFETY.near_miss_stable_hard_network
              : MARGIN_OF_SAFETY.near_miss_stable_classical;
          } else {
            margin = MARGIN_OF_SAFETY.near_miss_transitional;
          }
        } else {
          if (effectiveScore >= 3.5) {
            margin = isHardNetwork
              ? MARGIN_OF_SAFETY.stable_hard_network_non_leader
              : MARGIN_OF_SAFETY.stable_classical;
          } else {
            margin = MARGIN_OF_SAFETY.transitional_any;
          }
        }

        // Add secular disruption MoS adjustment
        const sdMosAdj = sd?.mos_adjustment_pct || 0;
        const totalMargin = Math.min(margin + sdMosAdj / 100, 0.95);

        const adjustedBuyBelow = valuation.adjusted_intrinsic_value * (1 - totalMargin);
        await db.prepare(
          `UPDATE valuations SET margin_of_safety_required = ?, buy_below_price = ?,
           discount_to_iv_pct = ? WHERE ticker = ?`
        ).bind(
          totalMargin, Math.round(adjustedBuyBelow * 100) / 100,
          Math.round(((valuation.adjusted_intrinsic_value - marketData.price) / valuation.adjusted_intrinsic_value) * 1000) / 10,
          row.ticker
        ).run();
      }

      analyzed++;
      const sdLabel = sd?.classification !== 'none' ? `, secular=${sd.classification}` : '';
      console.log(`Attractor analysis complete for ${row.ticker}: base=${result.attractor_stability_score}, adjusted=${result.adjusted_attractor_score}, regime=${result.network_regime}${sdLabel} (${row.analysis_date ? 'refreshed' : 'new'})`);
    } catch (err) {
      console.error(`Attractor analysis failed for ${row.ticker}:`, err.message);
    }
  }

  console.log(`Daily attractor check complete: ${analyzed}/${tickers.length} analyzed in ${Date.now() - startTime}ms`);
}
