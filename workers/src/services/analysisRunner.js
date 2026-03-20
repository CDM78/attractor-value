// Shared analysis logic extracted from analyze.js POST handler.
// Used by: POST /api/analyze, POST /api/analyze/batch, cron/attractorCheck.js

import { analyzeAttractorStability, buildFinancialContext } from './claude.js';
import { fetch10K, extractMDA } from './edgar.js';
import { getCompanyNews, formatNewsForPrompt, getInsiderTransactions, getCompanyOfficers } from './finnhub.js';
import { getFinancialsForTicker } from '../db/queries.js';
import { computeInsiderSignal } from './insiderSignals.js';
import { MARGIN_OF_SAFETY, SMALL_CAP } from '../../../shared/constants.js';
import { getOrFetchEconomicSnapshot, formatEconomicContextForPrompt } from './fred.js';

// Run a full attractor analysis for a single ticker.
// Returns { analysis, message } on success, throws on fatal error.
export async function runSingleAnalysis(env, ticker) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const stock = await env.DB.prepare(
    'SELECT * FROM stocks WHERE ticker = ?'
  ).bind(ticker).first();
  if (!stock) throw new Error(`Stock ${ticker} not found in database`);

  const financials = await getFinancialsForTicker(env.DB, ticker);
  const marketData = await env.DB.prepare(
    'SELECT * FROM market_data WHERE ticker = ?'
  ).bind(ticker).first();
  const valuation = await env.DB.prepare(
    'SELECT * FROM valuations WHERE ticker = ?'
  ).bind(ticker).first();

  // Fetch insider data (best effort — try Finnhub first, fall back to existing DB data)
  let insiderSignal = null;
  const today = new Date().toISOString().split('T')[0];
  try {
    if (env.FINNHUB_API_KEY) {
      const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const txns = await getInsiderTransactions(ticker, sixMonthsAgo, today, env.FINNHUB_API_KEY);
      for (const tx of txns) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO insider_transactions
           (ticker, filing_date, insider_name, insider_title, transaction_type, shares, price_per_share, total_value, is_10b5_1, source_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          tx.ticker, tx.filing_date, tx.insider_name, tx.insider_title,
          tx.transaction_type, tx.shares, tx.price_per_share, tx.total_value,
          tx.is_10b5_1, tx.source_url
        ).run();
      }

      const officers = await getCompanyOfficers(ticker, env.FINNHUB_API_KEY);
      const allRecent = await env.DB.prepare(
        `SELECT * FROM insider_transactions
         WHERE ticker = ? AND filing_date >= date('now', '-180 days')`
      ).bind(ticker).all();

      insiderSignal = computeInsiderSignal(allRecent.results || [], officers);
      console.log(`Insider data fetched for ${ticker}: ${txns.length} new transactions, signal=${insiderSignal.signal}`);
    }
  } catch (err) {
    console.error(`Insider fetch failed for ${ticker}:`, err.message);
  }

  // Fallback: compute signal from existing DB transactions if Finnhub fetch failed
  if (!insiderSignal) {
    try {
      const existingTxns = await env.DB.prepare(
        `SELECT * FROM insider_transactions
         WHERE ticker = ? AND filing_date >= date('now', '-180 days')`
      ).bind(ticker).all();
      const txnList = existingTxns.results || [];
      if (txnList.length > 0) {
        insiderSignal = computeInsiderSignal(txnList, []);
        console.log(`Insider signal from existing DB data for ${ticker}: ${txnList.length} transactions, signal=${insiderSignal.signal}`);
      }
    } catch (e) {
      console.error(`Insider DB fallback failed for ${ticker}:`, e.message);
    }
  }

  // Store computed signal
  if (insiderSignal) {
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO insider_signals
         (ticker, signal_date, trailing_90d_buys, trailing_90d_buy_value,
          trailing_90d_sells, trailing_90d_sell_value, unique_buyers_90d,
          signal, signal_details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ticker, today,
        insiderSignal.trailing_90d_buys, insiderSignal.trailing_90d_buy_value,
        insiderSignal.trailing_90d_sells, insiderSignal.trailing_90d_sell_value,
        insiderSignal.unique_buyers_90d, insiderSignal.signal, insiderSignal.signal_details
      ).run();
    } catch (dbErr) {
      console.error(`Failed to store insider signal for ${ticker}:`, dbErr.message);
    }
  }

  // Determine if small cap
  const isSmallCap = stock.cap_tier === 'small' ||
    (stock.market_cap && stock.market_cap >= SMALL_CAP.market_cap_min && stock.market_cap <= SMALL_CAP.market_cap_max);
  const analysisOptions = {
    isSmallCap,
    insiderOwnershipPct: marketData?.insider_ownership_pct ?? null,
  };

  const financialContext = buildFinancialContext(stock, financials, marketData, valuation, insiderSignal, analysisOptions);

  // Fetch 10-K MD&A (best effort)
  let mdaText = null;
  try {
    const filingUrl = await fetch10K(ticker);
    if (filingUrl) {
      mdaText = await extractMDA(filingUrl);
      console.log(`EDGAR: extracted ${mdaText?.length || 0} chars of MD&A for ${ticker}`);
    }
  } catch (err) {
    console.error(`EDGAR fetch failed for ${ticker}:`, err.message);
  }

  // Fetch recent news via Finnhub (best effort)
  let newsContext = '';
  try {
    if (env.FINNHUB_API_KEY) {
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const news = await getCompanyNews(ticker, thirtyDaysAgo, today, env.FINNHUB_API_KEY);
      newsContext = formatNewsForPrompt(news);
    }
  } catch (err) {
    console.error(`News fetch failed for ${ticker}:`, err.message);
  }

  // Fetch economic context for prompt enrichment
  let economicContext = '';
  try {
    if (env.FRED_API_KEY) {
      const snapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
      economicContext = formatEconomicContextForPrompt(snapshot);
    }
  } catch (err) {
    console.error(`Economic context fetch failed for ${ticker}:`, err.message);
  }

  // Run Claude analysis
  const result = await analyzeAttractorStability(
    ticker, stock.company_name, financialContext, mdaText, newsContext, env.ANTHROPIC_API_KEY, economicContext, analysisOptions
  );

  // Store secular disruption assessment
  let secularDisruptionId = null;
  const sd = result.secular_disruption;
  if (sd) {
    const sdResult = await env.DB.prepare(
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
      ticker, result.analysis_date,
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

  // Store attractor analysis
  await env.DB.prepare(
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

  // Store concentration risk
  const cr = result.concentration_risk;
  if (cr) {
    await env.DB.prepare(
      `INSERT INTO concentration_risk
       (ticker, analysis_date, largest_customer_pct, largest_customer_name,
        customers_above_10pct, single_source_supplier, supplier_details,
        largest_geo_market_pct, largest_geo_market_name,
        regulatory_dependency_pct, regulatory_details,
        concentration_penalty, analysis_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      ticker, result.analysis_date,
      cr.largest_customer_pct || null, cr.largest_customer_name || null,
      cr.customers_above_10pct || 0, cr.single_source_supplier ? 1 : 0,
      cr.supplier_details || null,
      cr.largest_geo_market_pct || null, cr.largest_geo_market_name || null,
      cr.regulatory_dependency_pct || null, cr.regulatory_details || null,
      cr.concentration_penalty || 0, result.analysis_text
    ).run();
  }

  // Update valuation with attractor-adjusted margin of safety
  const effectiveScore = result.adjusted_attractor_score ?? result.attractor_stability_score;
  if (effectiveScore != null && valuation && marketData) {
    const screenRow = await env.DB.prepare(
      `SELECT tier, miss_severity FROM screen_results
       WHERE ticker = ? ORDER BY screen_date DESC LIMIT 1`
    ).bind(ticker).first();
    const isNearMiss = screenRow?.tier === 'near_miss';
    const missSeverity = screenRow?.miss_severity;
    const isHardNetwork = result.network_regime === 'hard_network';

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

    const sdMosAdj = sd?.mos_adjustment_pct || 0;
    // Small cap MoS adjustment (+5%, stacks with secular disruption and economic environment)
    const smallCapMosAdj = isSmallCap ? SMALL_CAP.mos_adjustment : 0;
    const totalMargin = Math.min(margin + sdMosAdj / 100 + smallCapMosAdj, 0.95);

    const adjustedBuyBelow = valuation.adjusted_intrinsic_value * (1 - totalMargin);
    await env.DB.prepare(
      `UPDATE valuations SET margin_of_safety_required = ?, buy_below_price = ?,
       discount_to_iv_pct = ? WHERE ticker = ?`
    ).bind(
      totalMargin, Math.round(adjustedBuyBelow * 100) / 100,
      Math.round(((valuation.adjusted_intrinsic_value - marketData.price) / valuation.adjusted_intrinsic_value) * 1000) / 10,
      ticker
    ).run();
  }

  return { analysis: result, message: `Analysis complete for ${ticker}` };
}
