import { getBasicMetrics, getCompanyProfile } from '../services/finnhub.js';
import { getDynamicPECeiling } from '../services/screeningEngine.js';
import { SCREEN_DEFAULTS } from '../../../shared/constants.js';

// POST /api/fill-metrics?limit=50&offset=0
// Fills market_data ratios (P/E, P/B, etc.) from Finnhub for stocks missing them
// This runs much faster than Alpha Vantage (50 calls/min vs 6/day)
export async function fillMetricsRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'POST') {
    // GET: return fill status
    if (request.method === 'GET') {
      const total = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
      ).first();
      const withRatios = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM market_data WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\' AND pe_ratio IS NOT NULL"
      ).first();
      const withFundamentals = await env.DB.prepare(
        "SELECT COUNT(DISTINCT ticker) as cnt FROM financials"
      ).first();

      // Stocks that look promising (have ratios, might pass P/E + P/B)
      const bondRow = await env.DB.prepare(
        "SELECT price FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
      ).first();
      const peCeiling = bondRow?.price ? getDynamicPECeiling(bondRow.price) : 15;

      const promising = await env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM market_data
         WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
           AND pe_ratio IS NOT NULL AND pe_ratio > 0 AND pe_ratio <= ?
           AND pb_ratio IS NOT NULL AND pb_ratio <= ?
           AND ticker NOT IN (SELECT DISTINCT ticker FROM financials)`
      ).bind(peCeiling, SCREEN_DEFAULTS.pb_max).first();

      return jsonResponse({
        total_stocks: total?.cnt || 0,
        with_ratios: withRatios?.cnt || 0,
        with_fundamentals: withFundamentals?.cnt || 0,
        promising_without_fundamentals: promising?.cnt || 0,
        dynamic_pe_ceiling: peCeiling.toFixed(1),
      });
    }
    return errorResponse('Method not allowed', 405);
  }

  if (!env.FINNHUB_API_KEY) {
    return errorResponse('FINNHUB_API_KEY not configured', 500);
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  // Find stocks missing P/E ratios OR market_cap (needed for Tier 3 pre-screen)
  const missing = await env.DB.prepare(
    `SELECT s.ticker FROM stocks s
     LEFT JOIN market_data md ON s.ticker = md.ticker
     WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND (md.pe_ratio IS NULL OR md.pb_ratio IS NULL OR s.market_cap IS NULL)
     ORDER BY s.ticker
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const tickers = (missing.results || []).map(r => r.ticker);
  const stats = { updated: 0, skipped: 0, errors: 0, total: tickers.length };

  for (const ticker of tickers) {
    try {
      const metrics = await getBasicMetrics(ticker, env.FINNHUB_API_KEY);

      if (!metrics.pe_ratio && !metrics.pb_ratio && !metrics.market_cap_m) {
        stats.skipped++;
        continue;
      }

      // Merge with existing market data (preserve price)
      const existing = await env.DB.prepare(
        'SELECT * FROM market_data WHERE ticker = ?'
      ).bind(ticker).first();

      await env.DB.prepare(
        `INSERT OR REPLACE INTO market_data
         (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ticker,
        existing?.price ?? null,
        metrics.pe_ratio ?? existing?.pe_ratio ?? null,
        metrics.pb_ratio ?? existing?.pb_ratio ?? null,
        metrics.earnings_yield ?? existing?.earnings_yield ?? null,
        metrics.dividend_yield ?? existing?.dividend_yield ?? null,
        metrics.insider_ownership_pct ?? existing?.insider_ownership_pct ?? null,
        new Date().toISOString()
      ).run();

      // Store Tier 3 screening metrics (market_cap, gross_margin, revenue_growth)
      try {
        const updates = [];
        if (metrics.market_cap_m > 0) updates.push(`market_cap = ${Math.round(metrics.market_cap_m)}`);
        if (metrics.gross_margin != null) updates.push(`gross_margin_pct = ${metrics.gross_margin}`);
        if (metrics.revenue_growth_3y != null) updates.push(`revenue_growth_3y = ${metrics.revenue_growth_3y}`);
        if (updates.length > 0) {
          await env.DB.prepare(`UPDATE stocks SET ${updates.join(', ')} WHERE ticker = ?`)
            .bind(ticker).run();
        }
      } catch { /* columns may not exist yet */ }

      stats.updated++;
    } catch (err) {
      console.error(`Finnhub metrics error for ${ticker}:`, err.message);
      stats.errors++;
      if (err.message.includes('rate limit')) {
        stats.rateLimited = true;
        break;
      }
    }
  }

  return jsonResponse(stats);
}

// POST /api/backfill?limit=400&mode=both
// Bulk backfill: fetches fundamentals and/or metrics for ALL stocks missing them
// Processes up to `limit` stocks per call, respecting Finnhub 60 calls/min rate limit
// mode=fundamentals (default), mode=metrics, mode=both
export async function backfillRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const total = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
    ).first();
    const withFundamentals = await env.DB.prepare(
      "SELECT COUNT(DISTINCT ticker) as cnt FROM financials"
    ).first();
    const withRatios = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM market_data WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\' AND pe_ratio IS NOT NULL"
    ).first();
    const withSector = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\' AND sector IS NOT NULL"
    ).first();

    return jsonResponse({
      total_stocks: total?.cnt || 0,
      with_fundamentals: withFundamentals?.cnt || 0,
      with_ratios: withRatios?.cnt || 0,
      with_sector: withSector?.cnt || 0,
      needing_fundamentals: (total?.cnt || 0) - (withFundamentals?.cnt || 0),
      needing_ratios: (total?.cnt || 0) - (withRatios?.cnt || 0),
      needing_sector: (total?.cnt || 0) - (withSector?.cnt || 0),
    });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '400');
  const mode = url.searchParams.get('mode') || 'fundamentals';

  // EDGAR modes — no Finnhub API key required
  if (mode === 'cik') {
    const { ensureEdgarTables } = await import('../db/queries.js');
    const { refreshCikMap } = await import('../services/edgarXbrl.js');
    await ensureEdgarTables(env.DB);
    const count = await refreshCikMap(env.DB);
    return jsonResponse({ message: `CIK map refreshed: ${count} entries` });
  }

  if (mode === 'edgar') {
    const { ensureEdgarTables, upsertFinancials, upsertDataConfidence, updateMarketDataRatios } = await import('../db/queries.js');
    const { fetchCompanyFacts, parseEdgarToFinancials, computeDerivedRatios, getCik, delay } = await import('../services/edgarXbrl.js');
    await ensureEdgarTables(env.DB);

    const tickers = await env.DB.prepare(
      `SELECT s.ticker FROM stocks s
       LEFT JOIN data_confidence dc ON s.ticker = dc.ticker AND dc.data_source = 'edgar'
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND (dc.fetch_date IS NULL OR dc.fetch_date < datetime('now', '-90 days'))
       ORDER BY s.ticker
       LIMIT ?`
    ).bind(limit).all();

    const stats = { fetched: 0, ratios: 0, skipped: 0, errors: 0 };

    for (const row of (tickers.results || [])) {
      try {
        const cik = await getCik(env.DB, row.ticker);
        if (!cik) { stats.skipped++; continue; }

        await delay(200);
        const facts = await fetchCompanyFacts(cik);
        if (!facts) { stats.skipped++; continue; }

        const { financials, confidence } = parseEdgarToFinancials(row.ticker, facts);
        if (financials.length === 0) { stats.skipped++; continue; }

        for (const fin of financials) await upsertFinancials(env.DB, fin);
        for (const dc of confidence) await upsertDataConfidence(env.DB, dc);
        stats.fetched++;

        // Compute derived ratios
        const md = await env.DB.prepare('SELECT price FROM market_data WHERE ticker = ?').bind(row.ticker).first();
        if (md?.price && financials[0]) {
          const ratios = computeDerivedRatios(md.price, financials[0]);
          if (ratios) {
            await updateMarketDataRatios(env.DB, row.ticker, ratios, 'edgar_computed');
            stats.ratios++;
          }
        }
      } catch (err) {
        console.error(`EDGAR backfill error for ${row.ticker}:`, err.message);
        stats.errors++;
      }
    }

    return jsonResponse({ message: `EDGAR backfill complete`, stats });
  }

  if (!env.FINNHUB_API_KEY) {
    return errorResponse('FINNHUB_API_KEY not configured', 500);
  }

  const { getFinancialsReported, parseFinancialsReported, getBasicMetrics } = await import('../services/finnhub.js');
  const { upsertFinancials } = await import('../db/queries.js');

  const stats = { sectors: { updated: 0, skipped: 0, errors: 0 }, fundamentals: { fetched: 0, skipped: 0, errors: 0 }, metrics: { updated: 0, skipped: 0, errors: 0 } };

  // Phase 0: Fill sector data from Finnhub company profiles
  if (mode === 'sectors' || mode === 'both' || mode === 'all') {
    const { getCompanyProfile } = await import('../services/finnhub.js');
    const { upsertStock } = await import('../db/queries.js');

    const missingSectors = await env.DB.prepare(
      `SELECT ticker, company_name, market_cap FROM stocks
       WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND sector IS NULL
       ORDER BY ticker
       LIMIT ?`
    ).bind(limit).all();

    for (const row of (missingSectors.results || [])) {
      try {
        const profile = await getCompanyProfile(row.ticker, env.FINNHUB_API_KEY);
        if (!profile || !profile.sector) {
          stats.sectors.skipped++;
          continue;
        }

        await upsertStock(env.DB, {
          ticker: row.ticker,
          company_name: profile.company_name || row.company_name,
          sector: profile.sector,
          industry: profile.industry,
          market_cap: profile.market_cap || row.market_cap,
        });
        stats.sectors.updated++;
      } catch (err) {
        stats.sectors.errors++;
        if (err.message.includes('rate limit')) { stats.sectors.rateLimited = true; break; }
      }
    }
  }

  // Phase 1: Fill metrics (P/E, P/B) for stocks missing them
  if (mode === 'metrics' || mode === 'both') {
    const missingMetrics = await env.DB.prepare(
      `SELECT s.ticker FROM stocks s
       LEFT JOIN market_data md ON s.ticker = md.ticker
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND (md.pe_ratio IS NULL OR md.pb_ratio IS NULL)
       ORDER BY s.ticker
       LIMIT ?`
    ).bind(limit).all();

    for (const row of (missingMetrics.results || [])) {
      try {
        const metrics = await getBasicMetrics(row.ticker, env.FINNHUB_API_KEY);
        if (!metrics.pe_ratio && !metrics.pb_ratio) {
          stats.metrics.skipped++;
          continue;
        }

        const existing = await env.DB.prepare('SELECT * FROM market_data WHERE ticker = ?').bind(row.ticker).first();
        await env.DB.prepare(
          `INSERT OR REPLACE INTO market_data
           (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          row.ticker,
          existing?.price ?? null,
          metrics.pe_ratio ?? existing?.pe_ratio ?? null,
          metrics.pb_ratio ?? existing?.pb_ratio ?? null,
          metrics.earnings_yield ?? existing?.earnings_yield ?? null,
          metrics.dividend_yield ?? existing?.dividend_yield ?? null,
          metrics.insider_ownership_pct ?? existing?.insider_ownership_pct ?? null,
          new Date().toISOString()
        ).run();
        stats.metrics.updated++;
      } catch (err) {
        stats.metrics.errors++;
        if (err.message.includes('rate limit')) { stats.metrics.rateLimited = true; break; }
      }
    }
  }

  // Phase 2: Fill fundamentals for ALL stocks missing them
  if (mode === 'fundamentals' || mode === 'both') {
    const missingFundamentals = await env.DB.prepare(
      `SELECT s.ticker FROM stocks s
       WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND s.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
       ORDER BY s.ticker
       LIMIT ?`
    ).bind(limit).all();

    for (const row of (missingFundamentals.results || [])) {
      try {
        const reports = await getFinancialsReported(row.ticker, env.FINNHUB_API_KEY);
        const financials = parseFinancialsReported(row.ticker, reports);

        if (financials.length === 0) {
          stats.fundamentals.skipped++;
          continue;
        }

        for (const fin of financials) {
          await upsertFinancials(env.DB, fin);
        }

        stats.fundamentals.fetched++;
      } catch (err) {
        stats.fundamentals.errors++;
        if (err.message.includes('rate limit')) { stats.fundamentals.rateLimited = true; break; }
      }
    }
  }

  return jsonResponse(stats);
}

// POST /api/fill-fundamentals?limit=6
// Prioritized Alpha Vantage fetch: promising stocks first (low P/E + P/B)
export async function fillFundamentalsRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  // GET /api/fill-fundamentals?debug=AAPL — show raw Finnhub data for a ticker
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const debugTicker = url.searchParams.get('debug');
    if (debugTicker && env.FINNHUB_API_KEY) {
      const { getFinancialsReported, parseFinancialsReported } = await import('../services/finnhub.js');
      const reports = await getFinancialsReported(debugTicker, env.FINNHUB_API_KEY);
      const parsed = parseFinancialsReported(debugTicker, reports);
      // Show raw concepts from first report for debugging
      const sampleReport = reports[0]?.report || {};
      const concepts = {};
      for (const [section, items] of Object.entries(sampleReport)) {
        concepts[section] = (items || []).map(i => ({ concept: i.concept, label: i.label, value: i.value, unit: i.unit }));
      }
      return jsonResponse({ ticker: debugTicker, reportCount: reports.length, parsed, sampleConcepts: concepts });
    }

    // Show the priority queue
    const bondRow = await env.DB.prepare(
      "SELECT price FROM market_data WHERE ticker = '__AAA_BOND_YIELD'"
    ).first();
    const peCeiling = bondRow?.price ? getDynamicPECeiling(bondRow.price) : 15;

    const queue = await env.DB.prepare(
      `SELECT md.ticker, s.company_name, md.pe_ratio, md.pb_ratio,
              (md.pe_ratio * md.pb_ratio) as pe_x_pb
       FROM market_data md
       JOIN stocks s ON md.ticker = s.ticker
       WHERE md.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
         AND md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ?
         AND md.pb_ratio IS NOT NULL AND md.pb_ratio <= ?
         AND md.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
       ORDER BY (md.pe_ratio * md.pb_ratio) ASC
       LIMIT 20`
    ).bind(peCeiling, SCREEN_DEFAULTS.pb_max).all();

    return jsonResponse({
      priority_queue: queue.results || [],
      pe_ceiling: peCeiling.toFixed(1),
    });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  // POST /api/fill-fundamentals?limit=6
  // Directly fetch fundamentals from Alpha Vantage for promising stocks
  if (!env.FINNHUB_API_KEY) {
    return errorResponse('FINNHUB_API_KEY not configured', 500);
  }

  const { getFinancialsReported, parseFinancialsReported } = await import('../services/finnhub.js');
  const { upsertFinancials } = await import('../db/queries.js');
  const { getOrFetchBondYield } = await import('../services/fred.js');

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '10');

  let bondYield;
  try {
    bondYield = await getOrFetchBondYield(env.DB, env.FRED_API_KEY);
  } catch (err) {
    bondYield = { yield: 5.0, date: 'fallback' };
  }
  const peCeiling = getDynamicPECeiling(bondYield?.yield);

  // Priority queue: promising stocks without fundamentals
  const queue = await env.DB.prepare(
    `SELECT md.ticker FROM market_data md
     WHERE md.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
       AND md.pe_ratio IS NOT NULL AND md.pe_ratio > 0 AND md.pe_ratio <= ?
       AND md.pb_ratio IS NOT NULL AND md.pb_ratio <= ?
       AND md.ticker NOT IN (SELECT DISTINCT ticker FROM financials)
     ORDER BY (md.pe_ratio * md.pb_ratio) ASC
     LIMIT ?`
  ).bind(peCeiling, SCREEN_DEFAULTS.pb_max, limit).all();

  const tickers = (queue.results || []).map(r => r.ticker);
  const stats = { attempted: tickers.length, fetched: 0, errors: 0, details: [] };

  for (const ticker of tickers) {
    try {
      const reports = await getFinancialsReported(ticker, env.FINNHUB_API_KEY);
      const financials = parseFinancialsReported(ticker, reports);

      if (financials.length === 0) {
        stats.details.push({ ticker, status: 'skip', message: 'No data from Finnhub' });
        continue;
      }

      for (const fin of financials) {
        await upsertFinancials(env.DB, fin);
      }

      stats.fetched++;
      stats.details.push({ ticker, years: financials.length, status: 'ok' });
      console.log(`Fill-fundamentals: stored ${ticker} via Finnhub (${financials.length} years)`);
    } catch (err) {
      stats.errors++;
      stats.details.push({ ticker, status: 'error', message: err.message });
      console.error(`Fill-fundamentals error for ${ticker}:`, err.message);
      if (err.message.includes('rate limit')) {
        stats.rateLimited = true;
        break;
      }
    }
  }

  return jsonResponse(stats);
}
