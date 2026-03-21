import { getDynamicPECeiling, runLayer1Screen, computeSectorPBThresholds } from '../services/screeningEngine.js';
import { calculateGrahamValuation } from '../services/valuationEngine.js';
import { getFinancialsForTicker, saveScreenResult } from '../db/queries.js';
import { getOrFetchBondYield } from '../services/fred.js';

export async function screenRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);

  // POST /api/screen/tier3 — Tier 3 emerging DKS pre-screen
  if (request.method === 'POST' && path.startsWith('/api/screen/tier3')) {
    try {
      const { ensureMultiTierTables } = await import('../db/queries.js');
      await ensureMultiTierTables(env.DB);

      // Backfill market_cap for stocks missing it (uses Yahoo bulk quote)
      const missingMcap = await env.DB.prepare(
        "SELECT ticker FROM stocks WHERE market_cap IS NULL AND ticker NOT LIKE '\\_\\_%' ESCAPE '\\' LIMIT 100"
      ).all();
      if (missingMcap.results?.length > 0) {
        try {
          const { fetchBulkQuotes } = await import('../services/yahooFinance.js');
          const tickers = missingMcap.results.map(r => r.ticker);
          const quotes = await fetchBulkQuotes(tickers, 10, 500);
          let filled = 0;
          for (const q of quotes) {
            if (q.marketCapMillions && q.marketCapMillions > 0) {
              await env.DB.prepare('UPDATE stocks SET market_cap = ? WHERE ticker = ?')
                .bind(q.marketCapMillions, q.ticker).run();
              filled++;
            }
          }
          console.log(`Market cap backfill: ${filled}/${tickers.length} stocks updated`);
        } catch (e) {
          console.error('Market cap backfill error:', e.message);
        }
      }

      // Also seed candidates from existing Graham screener BUY signals
      // (stocks that pass Layer 1 and are below buy-below price)
      const seedFromScreener = url.searchParams.get('seed') !== 'false';
      if (seedFromScreener) {
        try {
          const screenBuys = await env.DB.prepare(`
            SELECT sr.ticker, s.company_name, s.sector, s.market_cap, md.price,
              v.buy_below_price, v.adjusted_intrinsic_value, v.normalized_eps
            FROM screen_results sr
            JOIN stocks s ON sr.ticker = s.ticker
            JOIN market_data md ON sr.ticker = md.ticker
            JOIN valuations v ON sr.ticker = v.ticker
            WHERE sr.tier IN ('full_pass', 'near_miss')
              AND sr.screen_date = (SELECT MAX(sr2.screen_date) FROM screen_results sr2 WHERE sr2.ticker = sr.ticker)
              AND md.price <= v.buy_below_price
              AND md.price > 0
              AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.ticker = sr.ticker AND c.status = 'active')
          `).all();
          const seeds = screenBuys.results || [];
          if (seeds.length > 0) {
            const { upsertCandidate } = await import('../db/queries.js');
            for (const s of seeds) {
              await upsertCandidate(env.DB, {
                ticker: s.ticker,
                discovery_tier: 'tier3',
                discovered_date: new Date().toISOString(),
                prescreen_pass: true,
                prescreen_data: {
                  source: 'graham_screener_seed',
                  growth_track: 'steady_compounder',
                  market_cap_m: s.market_cap,
                },
                intrinsic_value: s.adjusted_intrinsic_value,
                buy_below_price: s.buy_below_price,
                valuation_method: 'graham',
                valuation_date: new Date().toISOString(),
                signal: 'BUY',
                signal_confidence: s.price <= s.buy_below_price * 0.90 ? 'STRONG' : 'STANDARD',
                signal_reason: `Graham screener: ${Math.round((1 - s.price / s.adjusted_intrinsic_value) * 100)}% below IV`,
              });
            }
            console.log(`Seeded ${seeds.length} candidates from Graham screener BUY signals`);
          }
        } catch (e) {
          console.error('Screener seed error:', e.message);
        }
      }

      const { tier3PreScreen, storeTier3Candidates } = await import('../services/tier3Screen.js');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      const results = await tier3PreScreen(env.DB, { limit, offset });

      // Store passes as candidates
      if (results.candidates.length > 0) {
        const stored = await storeTier3Candidates(env.DB, results.candidates);
        results.stored = stored;
      }

      // Optionally run DKS evaluation on first N candidates
      const evalLimit = parseInt(url.searchParams.get('eval') || '0');
      if (evalLimit > 0 && results.candidates.length > 0) {
        const { evaluateDKS, storeDKSResults } = await import('../services/dksEvaluator.js');
        const dksResults = [];
        for (const candidate of results.candidates.slice(0, evalLimit)) {
          try {
            const dks = await evaluateDKS(candidate.ticker, env, env.DB);
            await storeDKSResults(env.DB, candidate.ticker, dks);
            dksResults.push(dks);
          } catch (e) {
            dksResults.push({ ticker: candidate.ticker, error: e.message });
          }
        }
        results.dks_evaluations = dksResults;
      }

      return jsonResponse(results);
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // GET /api/screen/tier3 — Get existing Tier 3 candidates
  if (request.method === 'GET' && path.startsWith('/api/screen/tier3')) {
    try {
      const { getCandidatesByTier } = await import('../db/queries.js');
      const signal = url.searchParams.get('signal') || null;
      const candidates = await getCandidatesByTier(env.DB, 'tier3', signal);
      return jsonResponse({ candidates, count: candidates.length });
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // POST /api/screen/tier2 — Tier 2 crisis dislocation pre-screen
  if (request.method === 'POST' && path.startsWith('/api/screen/tier2')) {
    try {
      const { ensureMultiTierTables } = await import('../db/queries.js');
      await ensureMultiTierTables(env.DB);

      const { getEnvironmentStatus } = await import('../services/regimeDetector.js');
      const envStatus = await getEnvironmentStatus(env.DB, env);
      const crisisContext = envStatus.crisis;

      if (!crisisContext?.crisis_active) {
        return jsonResponse({
          crisis_active: false,
          message: 'No crisis detected — Tier 2 screening is inactive. Crisis requires >=2 severe signals (S&P 500 ≤-15%, VIX >30, credit spreads elevated) or S&P 500 ≤-20%.',
        });
      }

      const { tier2PreScreen, assessCrisisImpact, storeTier2Candidates } = await import('../services/tier2Screen.js');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      const results = await tier2PreScreen(env.DB, crisisContext, { limit, offset });

      // Store passes as candidates
      if (results.candidates.length > 0) {
        const stored = await storeTier2Candidates(env.DB, results.candidates);
        results.stored = stored;
      }

      // Optionally run crisis impact assessment on first N candidates
      const assessLimit = parseInt(url.searchParams.get('assess') || '0');
      if (assessLimit > 0 && results.candidates.length > 0) {
        const assessments = [];
        for (const candidate of results.candidates.slice(0, assessLimit)) {
          try {
            const assessment = await assessCrisisImpact(candidate.ticker, crisisContext, env, env.DB);
            assessments.push(assessment);
            // Update candidate with crisis assessment classification
            candidate.crisis_assessment = assessment.classification;
            // Only temporary_dislocation proceeds — mark others as PASS
            if (assessment.classification !== 'temporary_dislocation') {
              await env.DB.prepare(
                "UPDATE candidates SET signal = 'PASS', signal_reason = ? WHERE ticker = ? AND discovery_tier = 'tier2' AND status = 'active'"
              ).bind(`Crisis impact: ${assessment.classification}`, candidate.ticker).run();
            }
          } catch (e) {
            assessments.push({ ticker: candidate.ticker, error: e.message });
          }
        }
        results.crisis_assessments = assessments;
        results.dislocations = assessments.filter(a => a.classification === 'temporary_dislocation');
      }

      return jsonResponse(results);
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // GET /api/screen/tier2 — Get existing Tier 2 candidates
  if (request.method === 'GET' && path.startsWith('/api/screen/tier2')) {
    try {
      const { getCandidatesByTier } = await import('../db/queries.js');
      const signal = url.searchParams.get('signal') || null;
      const candidates = await getCandidatesByTier(env.DB, 'tier2', signal);
      return jsonResponse({ candidates, count: candidates.length });
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // POST /api/screen/tier4 — Tier 4 regime transition beneficiary screen
  if (request.method === 'POST' && path.startsWith('/api/screen/tier4')) {
    try {
      const { ensureMultiTierTables, getActiveRegimes } = await import('../db/queries.js');
      await ensureMultiTierTables(env.DB);

      const regimes = await getActiveRegimes(env.DB);
      if (regimes.length === 0) {
        return jsonResponse({
          active_regimes: 0,
          message: 'No active regimes in regime_registry — Tier 4 screening is inactive. Register a regime first via /api/regime.',
        });
      }

      const { tier4BeneficiaryScreen, storeTier4Candidates } = await import('../services/tier4Screen.js');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const regimeId = url.searchParams.get('regime_id');

      // Screen against specified regime or first active regime
      const targetRegime = regimeId
        ? regimes.find(r => r.id === parseInt(regimeId))
        : regimes[0];

      if (!targetRegime) {
        return errorResponse(`Regime ID ${regimeId} not found among active regimes`, 404);
      }

      const results = await tier4BeneficiaryScreen(env.DB, targetRegime, { limit, offset });

      // Store passes as candidates
      if (results.candidates.length > 0) {
        // Attach regime_id to candidates before storing
        for (const c of results.candidates) {
          c.regime_id = targetRegime.id;
        }
        const stored = await storeTier4Candidates(env.DB, results.candidates);
        results.stored = stored;
      }

      return jsonResponse(results);
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // GET /api/screen/tier4 — Get existing Tier 4 candidates
  if (request.method === 'GET' && path.startsWith('/api/screen/tier4')) {
    try {
      const { getCandidatesByTier } = await import('../db/queries.js');
      const signal = url.searchParams.get('signal') || null;
      const candidates = await getCandidatesByTier(env.DB, 'tier4', signal);
      return jsonResponse({ candidates, count: candidates.length });
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // POST /api/screen/batch — batch screen stocks (small caps or by tier)
  if (request.method === 'POST' && path.startsWith('/api/screen/batch')) {
    return await batchScreen(env, url, jsonResponse, errorResponse);
  }

  if (request.method === 'GET') {
    // Include current AAA yield and dynamic P/E ceiling for UI display
    const bondRow = await env.DB.prepare(
      "SELECT price, fetched_at FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
    ).first();

    const aaaBondYield = bondRow?.price || null;
    const dynamicPECeiling = aaaBondYield != null
      ? parseFloat(getDynamicPECeiling(aaaBondYield).toFixed(1))
      : 15;

    // Try full screen results first
    const results = await env.DB.prepare(
      `SELECT sr.*, s.company_name, s.sector, md.price, md.pe_ratio, md.pb_ratio,
              v.graham_intrinsic_value, v.adjusted_intrinsic_value, v.buy_below_price,
              v.discount_to_iv_pct, v.fat_tail_discount, v.margin_of_safety_required,
              aa.attractor_stability_score, aa.adjusted_attractor_score,
              aa.network_regime as attractor_regime, aa.analysis_date as attractor_date
       FROM screen_results sr
       JOIN stocks s ON sr.ticker = s.ticker
       LEFT JOIN market_data md ON sr.ticker = md.ticker
       LEFT JOIN valuations v ON sr.ticker = v.ticker
       LEFT JOIN attractor_analysis aa ON sr.ticker = aa.ticker
         AND aa.id = (SELECT id FROM attractor_analysis WHERE ticker = sr.ticker ORDER BY analysis_date DESC, id DESC LIMIT 1)
       WHERE sr.screen_date = (
         SELECT MAX(sr2.screen_date) FROM screen_results sr2 WHERE sr2.ticker = sr.ticker
       )
       ORDER BY
         CASE sr.tier
           WHEN 'full_pass' THEN 0
           WHEN 'near_miss' THEN 1
           ELSE 2
         END,
         v.discount_to_iv_pct DESC,
         sr.ticker`
    ).all();

    const screenedStocks = results.results || [];

    // If we have screened stocks, return them
    if (screenedStocks.length > 0) {
      // Compute tier counts
      const fullPassCount = screenedStocks.filter(s => s.tier === 'full_pass').length;
      const nearMissCount = screenedStocks.filter(s => s.tier === 'near_miss').length;
      const failCount = screenedStocks.length - fullPassCount - nearMissCount;

      // Get sector P/B thresholds from the most recent screen results
      const sectorPBRows = await env.DB.prepare(
        `SELECT DISTINCT s.sector, sr.sector_pb_threshold
         FROM screen_results sr
         JOIN stocks s ON sr.ticker = s.ticker
         WHERE sr.sector_pb_threshold IS NOT NULL AND s.sector IS NOT NULL
         ORDER BY s.sector`
      ).all();
      const sectorPBThresholds = {};
      for (const row of (sectorPBRows.results || [])) {
        sectorPBThresholds[row.sector] = row.sector_pb_threshold;
      }

      return jsonResponse({
        stocks: screenedStocks,
        meta: {
          aaa_bond_yield: aaaBondYield,
          dynamic_pe_ceiling: dynamicPECeiling,
          bond_yield_date: bondRow?.fetched_at || null,
          full_pass_count: fullPassCount,
          near_miss_count: nearMissCount,
          fail_count: failCount,
          sector_pb_thresholds: sectorPBThresholds,
        },
      });
    }

    // Fallback: show all stocks with market data (preliminary view while fundamentals load)
    const preliminary = await env.DB.prepare(
      `SELECT s.ticker, s.company_name, s.sector,
              md.price, md.pe_ratio, md.pb_ratio,
              v.graham_intrinsic_value, v.adjusted_intrinsic_value, v.buy_below_price,
              v.discount_to_iv_pct,
              CASE WHEN md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ? THEN 1 ELSE 0 END as passes_pe,
              CASE WHEN md.pb_ratio IS NOT NULL AND md.pb_ratio <= 1.5 THEN 1 ELSE 0 END as passes_pb,
              CASE WHEN md.pe_ratio IS NOT NULL AND md.pb_ratio IS NOT NULL AND (md.pe_ratio * md.pb_ratio) <= 40 THEN 1 ELSE 0 END as passes_pe_x_pb,
              CASE WHEN EXISTS (SELECT 1 FROM financials f WHERE f.ticker = s.ticker) THEN 1 ELSE 0 END as has_fundamentals,
              0 as passes_debt_equity, 0 as passes_current_ratio,
              0 as passes_earnings_stability, 0 as passes_dividend_record,
              0 as passes_earnings_growth, 0 as passes_all_hard
       FROM stocks s
       INNER JOIN market_data md ON s.ticker = md.ticker
       LEFT JOIN valuations v ON s.ticker = v.ticker
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND md.price IS NOT NULL
       ORDER BY
         (CASE WHEN md.pe_ratio > 0 AND md.pe_ratio <= ? AND md.pb_ratio <= 1.5 THEN 1 ELSE 0 END) DESC,
         md.pe_ratio ASC
       LIMIT 500`
    ).bind(dynamicPECeiling, dynamicPECeiling).all();

    const fundCount = await env.DB.prepare(
      "SELECT COUNT(DISTINCT ticker) as count FROM financials"
    ).first();

    return jsonResponse({
      stocks: preliminary.results || [],
      meta: {
        aaa_bond_yield: aaaBondYield,
        dynamic_pe_ceiling: dynamicPECeiling,
        bond_yield_date: bondRow?.fetched_at || null,
        preliminary: true,
        note: `Showing preliminary data. ${fundCount?.count || 0} stocks have full fundamentals. Fundamentals are fetched at 6/day — full screening will appear once data is available.`,
      },
    });
  }

  return errorResponse('Method not allowed', 405);
}

/**
 * Batch screen stocks that have fundamentals but no recent screen results.
 * POST /api/screen/batch?tier=small&limit=50
 */
async function batchScreen(env, url, jsonResponse, errorResponse) {
  const tier = url.searchParams.get('tier') || 'small';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  try {
    // Get bond yield for dynamic P/E ceiling
    let bondYield;
    try {
      bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
    } catch {
      bondYield = { yield: 5.0 };
    }

    const screenDate = new Date().toISOString().split('T')[0];

    // Build tier filter
    const tierFilter = tier === 'small'
      ? "AND s.cap_tier = 'small'"
      : tier === 'all'
        ? ''
        : `AND s.cap_tier = '${tier === 'mid' ? 'mid' : 'large'}'`;

    // Find stocks with fundamentals but no recent screen results
    const candidates = await env.DB.prepare(
      `SELECT s.* FROM stocks s
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         ${tierFilter}
         AND EXISTS (SELECT 1 FROM financials f WHERE f.ticker = s.ticker)
         AND EXISTS (SELECT 1 FROM market_data md WHERE md.ticker = s.ticker AND md.price > 0)
         AND NOT EXISTS (
           SELECT 1 FROM screen_results sr
           WHERE sr.ticker = s.ticker AND sr.screen_date >= date('now', '-7 days')
         )
       ORDER BY s.ticker
       LIMIT ?`
    ).bind(limit).all();

    const stocks = candidates.results || [];
    if (stocks.length === 0) {
      return jsonResponse({ screened: 0, message: 'No unscreened stocks with fundamentals found' });
    }

    // Compute sector P/B thresholds
    const allPB = await env.DB.prepare(
      `SELECT s.sector, md.pb_ratio FROM stocks s
       JOIN market_data md ON s.ticker = md.ticker
       WHERE md.pb_ratio IS NOT NULL AND md.pb_ratio > 0 AND s.sector IS NOT NULL`
    ).all();
    const sectorPBThresholds = computeSectorPBThresholds(allPB.results || []);

    const results = [];
    for (const stock of stocks) {
      try {
        const financials = await getFinancialsForTicker(env.DB, stock.ticker);
        const marketData = await env.DB.prepare(
          'SELECT * FROM market_data WHERE ticker = ?'
        ).bind(stock.ticker).first();
        if (!marketData || financials.length === 0) continue;

        const isSmallCap = stock.cap_tier === 'small' ||
          (stock.market_cap && stock.market_cap >= 300000000 && stock.market_cap <= 2000000000);

        const screenResult = runLayer1Screen(stock, financials, marketData, {
          aaa_bond_yield: bondYield?.yield,
          sector_pb_thresholds: sectorPBThresholds,
          is_small_cap: isSmallCap,
        });

        await saveScreenResult(env.DB, stock.ticker, screenDate, screenResult);

        // Quick Graham IV estimate for candidates that pass
        let buyBelowEstimate = null;
        if (screenResult.tier === 'full_pass' || screenResult.tier === 'near_miss') {
          const val = calculateGrahamValuation(
            financials, marketData, bondYield?.yield, null,
            { tier: screenResult.tier, miss_severity: screenResult.miss_severity, is_small_cap: isSmallCap },
            null
          );
          buyBelowEstimate = val?.buy_below_price || null;
        }

        results.push({
          ticker: stock.ticker,
          name: stock.company_name,
          sector: stock.sector,
          market_cap: stock.market_cap,
          cap_tier: stock.cap_tier,
          price: marketData.price,
          pe: marketData.pe_ratio,
          pb: marketData.pb_ratio,
          pass_count: screenResult.pass_count,
          tier: screenResult.tier,
          buy_below_estimate: buyBelowEstimate,
          accruals_ratio: screenResult.accruals_ratio,
          goodwill_ratio: screenResult.goodwill_ratio,
          liquidity_flag: screenResult.liquidity_flag,
          revenue_quality_flag: screenResult.revenue_quality_flag,
        });
      } catch (err) {
        console.error(`Batch screen error for ${stock.ticker}:`, err.message);
      }
    }

    // Sort: full_pass first, then near_miss, then by pass count desc
    results.sort((a, b) => {
      const tierOrder = { full_pass: 0, near_miss: 1, fail: 2 };
      const tierDiff = (tierOrder[a.tier] || 2) - (tierOrder[b.tier] || 2);
      return tierDiff !== 0 ? tierDiff : (b.pass_count - a.pass_count);
    });

    return jsonResponse({
      screened: results.length,
      candidates: results.filter(r => r.tier !== 'fail').length,
      results,
      meta: {
        tier_filter: tier,
        screen_date: screenDate,
        bond_yield: bondYield?.yield,
      },
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}
