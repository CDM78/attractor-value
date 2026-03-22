import { screenRoutes } from './routes/screen.js';
import { valuateRoutes } from './routes/valuate.js';
import { analyzeRoutes } from './routes/analyze.js';
import { watchlistRoutes } from './routes/watchlist.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { alertsRoutes } from './routes/alerts.js';
import { refreshRoutes } from './routes/refresh.js';
import { fillMetricsRoutes, fillFundamentalsRoutes, backfillRoutes } from './routes/fillMetrics.js';
import { transactionsRoutes } from './routes/transactions.js';
import { reportRoutes } from './routes/report.js';
import { quoteRoutes } from './routes/quote.js';
import { priceCheckRoutes } from './routes/priceCheck.js';
import { universeRoutes } from './routes/universe.js';
import { dailyRefresh, finnhubRefresh, edgarRefresh } from './cron/dailyRefresh.js';
import { alertsCheck } from './cron/alertsCheck.js';
import { dailyAttractorCheck } from './cron/attractorCheck.js';
import { fetchBulkQuotes } from './services/yahooFinance.js';

// Auto-detect population vs maintenance mode
async function determineMode(db) {
  // Check for manual override first
  const override = await db.prepare(
    "SELECT value FROM system_config WHERE key = 'cron_mode'"
  ).first();
  if (override?.value === 'maintenance') return 'maintenance';
  if (override?.value === 'population') {
    // Check if population is actually complete
    const total = await db.prepare(
      "SELECT COUNT(*) as cnt FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
    ).first();
    const withFundamentals = await db.prepare(
      "SELECT COUNT(DISTINCT ticker) as cnt FROM financials"
    ).first();
    const withScreening = await db.prepare(
      "SELECT COUNT(DISTINCT ticker) as cnt FROM screen_results WHERE sector_pb_threshold IS NOT NULL"
    ).first();

    const totalCount = total?.cnt || 0;
    const threshold = totalCount * 0.10;
    const missingFundamentals = totalCount - (withFundamentals?.cnt || 0);
    const missingScreening = totalCount - (withScreening?.cnt || 0);

    if (missingFundamentals <= threshold && missingScreening <= threshold) {
      // Auto-transition to maintenance
      console.log(`Population complete. ${withFundamentals?.cnt} fundamentals, ${withScreening?.cnt} screened of ${totalCount}. Switching to maintenance.`);
      await db.prepare(
        "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('cron_mode', 'maintenance', datetime('now'))"
      ).run();
      return 'maintenance';
    }
  }
  return 'population';
}

// Lightweight intraday price check for watchlist + portfolio stocks only
async function watchlistPriceCheck(env) {
  const watchlistRows = await env.DB.prepare(
    `SELECT w.ticker, w.target_buy_price FROM watchlist w
     UNION
     SELECT DISTINCT h.ticker, NULL FROM holdings h`
  ).all();

  const tickers = (watchlistRows.results || []).map(r => r.ticker);
  if (tickers.length === 0) return;

  const quotes = await fetchBulkQuotes(tickers, 5, 1000);

  for (const q of quotes) {
    // Update price in market_data
    await env.DB.prepare(
      "UPDATE market_data SET price = ?, fetched_at = ? WHERE ticker = ?"
    ).bind(q.price, new Date().toISOString(), q.ticker).run();

    // Check against buy-below price
    const val = await env.DB.prepare(
      "SELECT buy_below_price, adjusted_intrinsic_value FROM valuations WHERE ticker = ?"
    ).bind(q.ticker).first();

    if (val?.buy_below_price && q.price <= val.buy_below_price) {
      // Fire buy opportunity alert (dedup within 24h handled by alertsCheck)
      const existing = await env.DB.prepare(
        "SELECT id FROM alerts WHERE ticker = ? AND alert_type = 'buy_opportunity' AND dismissed = 0 AND created_at > datetime('now', '-24 hours')"
      ).bind(q.ticker).first();
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO alerts (alert_type, ticker, message, created_at) VALUES (?, ?, ?, ?)"
        ).bind(
          'buy_opportunity', q.ticker,
          `${q.ticker} is now at $${q.price.toFixed(2)}, below buy-below of $${val.buy_below_price.toFixed(2)}`,
          new Date().toISOString()
        ).run();
      }
    }
  }
  console.log(`Watchlist price check: ${quotes.length} prices updated`);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

const routeMap = {
  '/api/screen': screenRoutes,
  '/api/valuate': valuateRoutes,
  '/api/analyze': analyzeRoutes,
  '/api/watchlist': watchlistRoutes,
  '/api/portfolio': portfolioRoutes,
  '/api/alerts': alertsRoutes,
  '/api/refresh': refreshRoutes,
  '/api/fill-metrics': fillMetricsRoutes,
  '/api/fill-fundamentals': fillFundamentalsRoutes,
  '/api/backfill': backfillRoutes,
  '/api/transactions': transactionsRoutes,
  '/api/report': reportRoutes,
  '/api/quote': quoteRoutes,
  '/api/price-check': priceCheckRoutes,
  '/api/universe': universeRoutes,
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/api/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Economic snapshot (legacy)
    if (path === '/api/economic-snapshot') {
      try {
        const { getOrFetchEconomicSnapshot } = await import('./services/fred.js');
        const snapshot = await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
        return jsonResponse(snapshot);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Full environment status (crisis + regimes + economic snapshot)
    if (path === '/api/environment') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { getEnvironmentStatus } = await import('./services/regimeDetector.js');
        const status = await getEnvironmentStatus(env.DB, env);
        return jsonResponse(status);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Get all current signals (BUY, NOT_YET) with position sizing
    if (path === '/api/signals') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { getCurrentSignals } = await import('./services/signalEngine.js');
        const { sizeAllBuySignals } = await import('./services/positionSizer.js');

        // Size all BUY signals
        const positions = await sizeAllBuySignals(env.DB);
        const signals = await getCurrentSignals(env.DB);

        return jsonResponse({ ...signals, positions });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Refresh all candidate signals
    if (path === '/api/signals/refresh' && request.method === 'POST') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { refreshAllSignals } = await import('./services/signalEngine.js');
        const result = await refreshAllSignals(env.DB, env);
        return jsonResponse(result);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Position sizing for a specific ticker
    if (path === '/api/position-size') {
      try {
        const { computePositionSize } = await import('./services/positionSizer.js');
        const ticker = url.searchParams.get('ticker');
        if (!ticker) return errorResponse('ticker parameter required', 400);

        const candidate = await env.DB.prepare(
          "SELECT * FROM candidates WHERE ticker = ? AND signal = 'BUY' AND status = 'active' ORDER BY discovered_date DESC LIMIT 1"
        ).bind(ticker.toUpperCase()).first();

        if (!candidate) return errorResponse(`No active BUY signal for ${ticker}`, 404);

        const price = await env.DB.prepare(
          'SELECT price FROM market_data WHERE ticker = ?'
        ).bind(ticker.toUpperCase()).first();

        const position = await computePositionSize(env.DB, {
          ticker: candidate.ticker,
          discovery_tier: candidate.discovery_tier,
          current_price: price?.price,
          signal_confidence: candidate.signal_confidence,
        });

        return jsonResponse(position);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Deep analysis (Opus) for a specific candidate
    if (path.match(/^\/api\/candidates\/\d+\/deep-analyze$/) && request.method === 'POST') {
      try {
        const candidateId = parseInt(path.split('/')[3]);
        const candidate = await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(candidateId).first();
        if (!candidate) return errorResponse(`Candidate ${candidateId} not found`, 404);

        const previousSignal = candidate.signal;
        const { getPortfolioConfig } = await import('./db/queries.js');
        const config = await getPortfolioConfig(env.DB);
        const deepModel = config.deep_analysis_model || 'claude-opus-4-20250514';

        const { runCandidateAnalysis } = await import('./services/analysisRunner.js');
        const analysisResult = await runCandidateAnalysis(env, candidateId, { model: deepModel });

        // Recompute signal with updated attractor score
        const { computeSignal } = await import('./services/signalEngine.js');
        const updatedCandidate = await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(candidateId).first();
        const signalResult = await computeSignal(env.DB, updatedCandidate, env);

        // Log signal change
        const { logSignalChange } = await import('./db/queries.js');
        await logSignalChange(env.DB, candidateId, candidate.ticker,
          { signal: previousSignal, attractor_score: candidate.attractor_score, analysis_model: candidate.analysis_model },
          { signal: signalResult.signal, attractor_score: analysisResult.attractor_score, analysis_model: deepModel },
          `Opus deep analysis${previousSignal !== signalResult.signal ? ` (signal changed: ${previousSignal} → ${signalResult.signal})` : ''}`
        );

        // Update candidate with new signal + valuation data
        await env.DB.prepare(`
          UPDATE candidates SET
            signal = ?, signal_confidence = ?, signal_reason = ?,
            intrinsic_value = ?, buy_below_price = ?, margin_of_safety = ?,
            valuation_method = ?, valuation_date = datetime('now')
          WHERE id = ?
        `).bind(
          signalResult.signal, signalResult.confidence, signalResult.reason,
          signalResult.valuation?.intrinsic_value ?? null,
          signalResult.valuation?.buy_below_price ?? null,
          signalResult.valuation?.margin_of_safety ?? null,
          signalResult.valuation?.valuation_method ?? null,
          candidateId
        ).run();

        return jsonResponse({
          candidate_id: candidateId,
          ticker: candidate.ticker,
          previous_signal: previousSignal,
          new_signal: signalResult.signal,
          signal_changed: previousSignal !== signalResult.signal,
          attractor_score: analysisResult.attractor_score,
          model: deepModel,
          signal_confidence: signalResult.confidence,
          signal_reason: signalResult.reason,
        });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Bulk analysis — run attractor analysis on pending candidates
    if (path === '/api/admin/bulk-analyze' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const tier = body.tier || 'all';
        const concurrency = Math.min(parseInt(body.concurrency || '5'), 10);
        const { getPortfolioConfig } = await import('./db/queries.js');
        const config = await getPortfolioConfig(env.DB);
        const analysisModel = body.model || config.default_analysis_model || 'claude-sonnet-4-20250514';

        // Get pending candidates
        let query = `SELECT * FROM candidates WHERE prescreen_pass = 1
          AND (attractor_analysis_date IS NULL OR attractor_analysis_date < datetime('now', '-90 days'))
          AND status = 'active'`;
        if (tier !== 'all') query += ` AND discovery_tier = '${tier}'`;
        query += ' ORDER BY discovered_date DESC';

        const pending = await env.DB.prepare(query).all();
        const total = (pending.results || []).length;
        const results = { analyzed: 0, passed: 0, buy: 0, not_yet: 0, pass: 0, errors: 0, total };

        // Reset progress
        await env.DB.prepare(
          "INSERT OR REPLACE INTO portfolio_config (key, value, updated_at) VALUES ('bulk_analysis_progress', ?, datetime('now'))"
        ).bind(JSON.stringify(results)).run();

        // Process in batches (non-blocking via waitUntil)
        ctx.waitUntil((async () => {
          const { runCandidateAnalysis } = await import('./services/analysisRunner.js');
          const { computeSignal } = await import('./services/signalEngine.js');
          const candidates = pending.results || [];

          for (let i = 0; i < candidates.length; i += concurrency) {
            const batch = candidates.slice(i, i + concurrency);
            const promises = batch.map(async (c) => {
              try {
                const prevSignal = c.signal;
                const prevScore = c.attractor_score;
                await runCandidateAnalysis(env, c.id, { model: analysisModel });
                const updated = await env.DB.prepare('SELECT * FROM candidates WHERE id = ?').bind(c.id).first();
                const sig = await computeSignal(env.DB, updated, env);
                await env.DB.prepare(`UPDATE candidates SET signal = ?, signal_confidence = ?, signal_reason = ?,
                  intrinsic_value = ?, buy_below_price = ?, margin_of_safety = ?, valuation_method = ?, valuation_date = datetime('now')
                  WHERE id = ?`)
                  .bind(sig.signal, sig.confidence, sig.reason,
                    sig.valuation?.intrinsic_value ?? null, sig.valuation?.buy_below_price ?? null,
                    sig.valuation?.margin_of_safety ?? null, sig.valuation?.valuation_method ?? null, c.id).run();

                // Log signal change
                if (prevSignal !== sig.signal) {
                  try {
                    const { logSignalChange } = await import('./db/queries.js');
                    await logSignalChange(env.DB, c.id, c.ticker,
                      { signal: prevSignal, attractor_score: prevScore, analysis_model: c.analysis_model },
                      { signal: sig.signal, attractor_score: updated.attractor_score, analysis_model: analysisModel },
                      `bulk analysis (${analysisModel.includes('opus') ? 'Opus' : 'Sonnet'})`
                    );
                  } catch { /* ignore */ }
                }

                results.analyzed++;
                const score = updated.attractor_score;
                if (score >= 2.5) results.passed++;
                if (sig.signal === 'BUY') results.buy++;
                else if (sig.signal === 'NOT_YET') results.not_yet++;
                else results.pass++;
              } catch (err) {
                results.errors++;
                console.error(`Bulk analysis error for ${c.ticker}:`, err.message);
                if (err.message?.includes('429')) {
                  await new Promise(r => setTimeout(r, 30000));
                }
              }
            });
            await Promise.all(promises);
            await new Promise(r => setTimeout(r, 2000)); // pause between batches

            // Update progress
            await env.DB.prepare(
              "INSERT OR REPLACE INTO portfolio_config (key, value, updated_at) VALUES ('bulk_analysis_progress', ?, datetime('now'))"
            ).bind(JSON.stringify(results)).run();
          }

          // Mark complete
          results.complete = true;
          await env.DB.prepare(
            "INSERT OR REPLACE INTO portfolio_config (key, value, updated_at) VALUES ('bulk_analysis_progress', ?, datetime('now'))"
          ).bind(JSON.stringify(results)).run();
          console.log(`Bulk analysis complete: ${results.analyzed}/${total}, ${results.buy} BUY, ${results.errors} errors`);
        })());

        return jsonResponse({ message: 'Bulk analysis started', total, model: analysisModel, concurrency });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Bulk analysis progress polling
    if (path === '/api/admin/bulk-analyze/progress') {
      try {
        const row = await env.DB.prepare(
          "SELECT value FROM portfolio_config WHERE key = 'bulk_analysis_progress'"
        ).first();
        return jsonResponse(row?.value ? JSON.parse(row.value) : null);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Admin: fetch and add US stock list from Finnhub
    if (path === '/api/admin/fetch-stock-list' && request.method === 'POST') {
      try {
        if (!env.FINNHUB_API_KEY) return errorResponse('FINNHUB_API_KEY not configured', 500);

        const listRes = await fetch(
          `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${env.FINNHUB_API_KEY}`
        );
        if (!listRes.ok) return errorResponse(`Finnhub error: ${listRes.status}`, 500);
        const allSymbols = await listRes.json();

        const commonStock = allSymbols.filter(s =>
          s.type === 'Common Stock' &&
          s.symbol &&
          !s.symbol.includes('.') &&
          s.symbol.length <= 5 &&
          /^[A-Z]+$/.test(s.symbol)
        );

        const existing = await env.DB.prepare(
          "SELECT ticker FROM stocks WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'"
        ).all();
        const existingSet = new Set((existing.results || []).map(r => r.ticker));

        const newTickers = [];
        const now = new Date().toISOString();
        const batchStmts = [];

        for (const s of commonStock) {
          if (existingSet.has(s.symbol)) continue;
          newTickers.push(s.symbol);
          batchStmts.push(
            env.DB.prepare(
              `INSERT OR IGNORE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
               VALUES (?, ?, NULL, NULL, NULL, ?)`
            ).bind(s.symbol, s.description || s.symbol, now)
          );
          batchStmts.push(
            env.DB.prepare(
              `INSERT OR IGNORE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
               VALUES (?, 0, NULL, NULL, NULL, NULL, NULL, ?)`
            ).bind(s.symbol, now)
          );
        }

        // Batch insert in groups of 100
        for (let i = 0; i < batchStmts.length; i += 100) {
          await env.DB.batch(batchStmts.slice(i, i + 100));
        }

        return jsonResponse({
          total_from_finnhub: allSymbols.length,
          filtered: commonStock.length,
          already_existed: existingSet.size,
          new_tickers_added: newTickers.length,
          new_tickers: newTickers.slice(0, 50),
        });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Admin: fix candidate data
    if (path === '/api/admin/fix-data' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));

        // Fix analysis_model: reset all to Sonnet (automated default)
        if (body.fix === 'analysis_model') {
          const result = await env.DB.prepare(
            "UPDATE candidates SET analysis_model = 'claude-sonnet-4-20250514' WHERE analysis_model = 'claude-opus-4-20250514'"
          ).run();
          return jsonResponse({ fixed: result.meta?.changes || 0, field: 'analysis_model' });
        }

        // Debug: check a specific candidate's attractor_analysis rows
        if (body.fix === 'debug_scores') {
          const ticker = body.ticker || 'POWL';
          const rows = await env.DB.prepare(
            `SELECT id, ticker, attractor_stability_score, adjusted_attractor_score, analysis_date, candidate_id
             FROM attractor_analysis WHERE ticker = ? ORDER BY id DESC LIMIT 5`
          ).bind(ticker).all();
          const candidate = await env.DB.prepare(
            "SELECT id, attractor_score FROM candidates WHERE ticker = ? AND status = 'active'"
          ).bind(ticker).first();
          return jsonResponse({ ticker, candidate, analysis_rows: rows.results });
        }

        // Fix scores: sync from attractor_analysis table (latest entry with adjusted score)
        if (body.fix === 'scores') {
          // Get all candidates with analysis
          const candidates = await env.DB.prepare(
            "SELECT c.id, c.ticker, c.attractor_score FROM candidates c WHERE c.status = 'active'"
          ).all();
          let fixed = 0;
          for (const c of (candidates.results || [])) {
            const latest = await env.DB.prepare(
              `SELECT adjusted_attractor_score, attractor_stability_score
               FROM attractor_analysis WHERE ticker = ?
               AND adjusted_attractor_score IS NOT NULL
               ORDER BY id DESC LIMIT 1`
            ).bind(c.ticker).first();
            if (latest) {
              const correctScore = latest.adjusted_attractor_score;
              if (correctScore != null && correctScore !== c.attractor_score) {
                await env.DB.prepare(
                  'UPDATE candidates SET attractor_score = ? WHERE id = ?'
                ).bind(correctScore, c.id).run();
                fixed++;
              }
            }
          }
          return jsonResponse({ fixed, field: 'attractor_score' });
        }

        return errorResponse('Unknown fix type. Use: analysis_model, scores', 400);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Admin: clear candidates
    if (path === '/api/admin/clear-candidates' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const source = body.source; // e.g., 'graham_screener_seed'
        let result;
        if (source) {
          result = await env.DB.prepare(
            "DELETE FROM candidates WHERE prescreen_data LIKE ?"
          ).bind(`%${source}%`).run();
        } else {
          result = await env.DB.prepare("DELETE FROM candidates").run();
        }
        return jsonResponse({ deleted: result.meta?.changes || 0, source: source || 'all' });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Sell trigger check
    if (path === '/api/sell-check') {
      try {
        const { checkAllSellTriggers } = await import('./services/sellEngine.js');
        const result = await checkAllSellTriggers(env.DB, env);
        return jsonResponse(result);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Capital deposit/withdrawal
    if (path === '/api/portfolio/capital' && request.method === 'POST') {
      try {
        const { ensureMultiTierTables, getPortfolioConfig, setPortfolioConfig } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const body = await request.json();
        const action = body.action; // 'deposit' or 'withdraw'
        const amount = parseFloat(body.amount);
        if (!action || !amount || amount <= 0) return errorResponse('action and positive amount required', 400);

        const config = await getPortfolioConfig(env.DB);
        const currentCapital = parseFloat(config.total_capital) || 0;
        const newCapital = action === 'deposit' ? currentCapital + amount : Math.max(0, currentCapital - amount);

        await setPortfolioConfig(env.DB, 'total_capital', String(newCapital));

        // Log transaction
        await env.DB.prepare(
          `INSERT INTO transactions (ticker, action, shares, price_per_share, total_amount, transaction_date, reason)
           VALUES ('__CAPITAL', ?, 0, 0, ?, datetime('now'), ?)`
        ).bind(action, amount, `Capital ${action}: $${amount.toFixed(0)}`).run();

        // Re-run signals (budget changes may affect position sizing)
        const { refreshAllSignals } = await import('./services/signalEngine.js');
        const refresh = await refreshAllSignals(env.DB, env);

        return jsonResponse({
          action,
          amount,
          previous_capital: currentCapital,
          new_capital: newCapital,
          signals_updated: refresh.updated,
          signals: refresh.signals,
        });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Portfolio config get/set
    if (path === '/api/portfolio/config') {
      const { ensureMultiTierTables, getPortfolioConfig, setPortfolioConfig } = await import('./db/queries.js');
      await ensureMultiTierTables(env.DB);

      if (request.method === 'GET') {
        const config = await getPortfolioConfig(env.DB);
        return jsonResponse(config);
      }
      if (request.method === 'POST') {
        const body = await request.json();
        for (const [key, value] of Object.entries(body)) {
          await setPortfolioConfig(env.DB, key, value);
        }
        const config = await getPortfolioConfig(env.DB);
        return jsonResponse({ updated: true, config });
      }
    }

    // Signal history for a ticker
    if (path === '/api/signal-history') {
      try {
        const ticker = url.searchParams.get('ticker');
        const { ensureMultiTierTables, getSignalHistory, getRecentSignalChanges } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        if (ticker) {
          const history = await getSignalHistory(env.DB, ticker.toUpperCase());
          return jsonResponse({ ticker: ticker.toUpperCase(), history });
        } else {
          const recent = await getRecentSignalChanges(env.DB, 20);
          return jsonResponse({ recent });
        }
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Universal stock search
    if (path === '/api/search') {
      try {
        const q = (url.searchParams.get('q') || '').toUpperCase().trim();
        if (!q || q.length < 1) return jsonResponse({ results: [] });

        // Search stocks by ticker or company name
        const stocks = await env.DB.prepare(`
          SELECT s.ticker, s.company_name, s.sector, s.industry, s.market_cap,
            md.price, md.pe_ratio, md.pb_ratio
          FROM stocks s
          LEFT JOIN market_data md ON s.ticker = md.ticker
          WHERE s.ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
            AND (s.ticker LIKE ? OR UPPER(s.company_name) LIKE ?)
          ORDER BY CASE WHEN s.ticker = ? THEN 0 WHEN s.ticker LIKE ? THEN 1 ELSE 2 END
          LIMIT 20
        `).bind(`%${q}%`, `%${q}%`, q, `${q}%`).all();

        const results = [];
        for (const s of (stocks.results || [])) {
          // Check if this stock is a candidate
          const candidate = await env.DB.prepare(
            "SELECT id, discovery_tier, signal, signal_confidence, signal_reason, attractor_score, analysis_model, intrinsic_value, buy_below_price, attractor_analysis_date FROM candidates WHERE ticker = ? AND status = 'active' ORDER BY discovered_date DESC LIMIT 1"
          ).bind(s.ticker).first();

          // Check attractor analysis
          const attractor = await env.DB.prepare(
            'SELECT attractor_stability_score, adjusted_attractor_score, analysis_date, network_regime FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC, id DESC LIMIT 1'
          ).bind(s.ticker).first();

          results.push({
            ticker: s.ticker,
            company_name: s.company_name,
            sector: s.sector,
            industry: s.industry,
            market_cap: s.market_cap,
            price: s.price,
            pe_ratio: s.pe_ratio,
            candidate: candidate || null,
            attractor: attractor || null,
            evaluated: !!(candidate || attractor),
          });
        }

        return jsonResponse({ query: q, results, count: results.length });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Seed a regime manually
    if (path === '/api/admin/seed-regime' && request.method === 'POST') {
      try {
        const { ensureMultiTierTables, upsertRegime } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const body = await request.json();
        await upsertRegime(env.DB, body);
        return jsonResponse({ success: true, regime: body.name });
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Manual regime scan trigger
    if (path === '/api/regime-scan' && request.method === 'POST') {
      try {
        const { ensureMultiTierTables } = await import('./db/queries.js');
        await ensureMultiTierTables(env.DB);
        const { scanForRegimes } = await import('./services/regimeDetector.js');
        const result = await scanForRegimes(env, env.DB);
        return jsonResponse(result);
      } catch (err) {
        return errorResponse(err.message);
      }
    }

    // Admin: mode switch
    if (path === '/api/admin/mode') {
      if (request.method === 'GET') {
        const mode = await determineMode(env.DB);
        return jsonResponse({ mode });
      }
      if (request.method === 'POST') {
        const body = await request.json();
        if (!['population', 'maintenance'].includes(body.mode)) {
          return errorResponse('mode must be "population" or "maintenance"', 400);
        }
        await env.DB.prepare(
          "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('cron_mode', ?, datetime('now'))"
        ).bind(body.mode).run();
        return jsonResponse({ mode: body.mode, message: `Switched to ${body.mode} mode` });
      }
    }

    // Route matching
    for (const [prefix, handler] of Object.entries(routeMap)) {
      if (path.startsWith(prefix)) {
        try {
          return await handler(request, env, ctx, { path, jsonResponse, errorResponse });
        } catch (err) {
          console.error(`Error in ${prefix}:`, err);
          return errorResponse(err.message);
        }
      }
    }

    return errorResponse('Not found', 404);
  },

  async scheduled(event, env, ctx) {
    // Ensure small cap tables exist (runs once, no-ops after)
    try {
      const { ensureSmallCapTables } = await import('./db/queries.js');
      await ensureSmallCapTables(env.DB);
    } catch (err) {
      console.error('ensureSmallCapTables error:', err.message);
    }

    // Ensure multi-tier pipeline tables exist
    try {
      const { ensureMultiTierTables } = await import('./db/queries.js');
      await ensureMultiTierTables(env.DB);
    } catch (err) {
      console.error('ensureMultiTierTables error:', err.message);
    }

    const mode = await determineMode(env.DB);
    const scheduledTime = new Date(event.scheduledTime);
    const minute = scheduledTime.getUTCMinutes();
    const utcHour = scheduledTime.getUTCHours();
    const dayOfWeek = scheduledTime.getUTCDay(); // 0=Sun, 6=Sat

    if (mode === 'population') {
      // Aggressive schedule: every minute, alternating
      if (minute % 3 === 0) {
        ctx.waitUntil(dailyRefresh(env).then(() => alertsCheck(env)));
      } else if (minute % 3 === 1) {
        ctx.waitUntil(edgarRefresh(env));
      } else {
        ctx.waitUntil(finnhubRefresh(env));
      }
      return;
    }

    // Maintenance mode — ET is UTC-4 (EDT) or UTC-5 (EST)
    // Using UTC-4 (EDT, March-November)
    const etHour = (utcHour - 4 + 24) % 24;
    const isMarketDay = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isMarketHours = etHour >= 10 && etHour < 16; // 10 AM to 4 PM ET (conservative)
    const isSaturday = dayOfWeek === 6;

    // ============================================
    // Daily post-market pipeline (market days only)
    // ============================================

    if (isMarketDay && etHour === 16 && minute === 30) {
      // 4:30 PM ET — full price refresh
      ctx.waitUntil(dailyRefresh(env));
    }

    if (isMarketDay && etHour === 16 && minute === 45) {
      // 4:45 PM ET — FRED economic environment update
      ctx.waitUntil((async () => {
        try {
          const { getOrFetchEconomicSnapshot } = await import('./services/fred.js');
          await getOrFetchEconomicSnapshot(env.DB, env.FRED_API_KEY);
          console.log('Economic snapshot updated');
        } catch (err) {
          console.error('Economic snapshot error:', err.message);
        }
      })());
    }

    if (isMarketDay && etHour === 16 && minute === 50) {
      // 4:50 PM ET — Crisis detection check (activates Tier 2 if needed)
      ctx.waitUntil((async () => {
        try {
          const { getEnvironmentStatus } = await import('./services/regimeDetector.js');
          const status = await getEnvironmentStatus(env.DB, env);
          if (status.crisis.crisis_active) {
            console.log(`CRISIS DETECTED: severity=${status.crisis.severity}, S&P decline=${status.crisis.sp500_decline}`);

            // Snapshot pre-crisis prices on transition (only once per crisis)
            const wasCrisis = await env.DB.prepare(
              "SELECT value FROM system_config WHERE key = 'crisis_active'"
            ).first();
            if (!wasCrisis || wasCrisis.value !== 'true') {
              const { snapshotPreCrisisPrices } = await import('./services/fred.js');
              const snapped = await snapshotPreCrisisPrices(env.DB);
              console.log(`Pre-crisis snapshot: ${snapped} stocks`);
              await env.DB.prepare(
                "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('crisis_active', 'true', datetime('now'))"
              ).run();
            }

            // Auto-run Tier 2 pre-screen during active crisis
            const { tier2PreScreen, storeTier2Candidates } = await import('./services/tier2Screen.js');
            const results = await tier2PreScreen(env.DB, status.crisis, { limit: 200 });
            if (results.candidates.length > 0) {
              await storeTier2Candidates(env.DB, results.candidates);
              console.log(`Tier 2: ${results.candidates.length} crisis candidates stored`);
            }
          } else {
            // Clear crisis flag when crisis ends
            await env.DB.prepare(
              "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('crisis_active', 'false', datetime('now'))"
            ).run();
          }
        } catch (err) {
          console.error('Crisis detection error:', err.message);
        }
      })());
    }

    if (isMarketDay && etHour === 16 && minute === 55) {
      // 4:55 PM ET — Regime detection (AI news scan)
      ctx.waitUntil((async () => {
        try {
          const { scanForRegimes } = await import('./services/regimeDetector.js');
          const result = await scanForRegimes(env, env.DB);
          if (result.regimes_found > 0) {
            console.log(`Regime scan: ${result.regimes_found} found, ${result.new_candidates} new`);
          }
        } catch (err) {
          console.error('Regime detection error:', err.message);
        }
      })());
    }

    if (isMarketDay && etHour === 17 && minute === 0) {
      // 5:00 PM ET — EDGAR fundamentals refresh + Layer 1 screening
      ctx.waitUntil(edgarRefresh(env).then(() => dailyRefresh(env)));
    }

    if (isMarketDay && etHour === 17 && minute === 5) {
      // 5:05 PM ET — Tier 4 beneficiary screen (if active regimes exist)
      ctx.waitUntil((async () => {
        try {
          const { getActiveRegimes } = await import('./db/queries.js');
          const regimes = await getActiveRegimes(env.DB);
          if (regimes.length > 0) {
            const { tier4BeneficiaryScreen, storeTier4Candidates } = await import('./services/tier4Screen.js');
            for (const regime of regimes) {
              const results = await tier4BeneficiaryScreen(env.DB, regime, { limit: 100 });
              if (results.candidates.length > 0) {
                for (const c of results.candidates) c.regime_id = regime.id;
                await storeTier4Candidates(env.DB, results.candidates);
                console.log(`Tier 4 (${regime.name}): ${results.candidates.length} beneficiaries stored`);
              }
            }
          }
        } catch (err) {
          console.error('Tier 4 screening error:', err.message);
        }
      })());
    }

    if (isMarketDay && etHour === 17 && minute === 10) {
      // 5:10 PM ET — Signal update for all candidates
      ctx.waitUntil((async () => {
        try {
          const { refreshAllSignals } = await import('./services/signalEngine.js');
          const result = await refreshAllSignals(env.DB, env);
          console.log(`Signals refreshed: ${result.updated} candidates, BUY=${result.signals.BUY}, NOT_YET=${result.signals.NOT_YET}`);
        } catch (err) {
          console.error('Signal refresh error:', err.message);
        }
      })());
    }

    if (isMarketDay && etHour === 17 && minute === 15) {
      // 5:15 PM ET — Sell trigger check + attractor analysis + portfolio alerts
      ctx.waitUntil((async () => {
        try {
          const { checkAllSellTriggers } = await import('./services/sellEngine.js');
          const sellResult = await checkAllSellTriggers(env.DB, env);
          if (sellResult.total_triggers > 0) {
            console.log(`Sell triggers: ${sellResult.sell_signals.length} SELL, ${sellResult.trim_signals.length} TRIM`);
          }
        } catch (err) {
          console.error('Sell trigger check error:', err.message);
        }
        // Also run attractor check and alerts
        await dailyAttractorCheck(env);
        await alertsCheck(env);
      })());
    }

    if (isMarketDay && etHour === 17 && minute === 20) {
      // 5:20 PM ET — Insider transaction refresh
      ctx.waitUntil(finnhubRefresh(env));
    }

    // Intraday watchlist price check (every 15 min during market hours)
    if (isMarketDay && isMarketHours && minute % 15 === 0) {
      ctx.waitUntil(watchlistPriceCheck(env));
    }

    // Earnings season override: extra morning screen in Jan, Apr, Jul, Oct
    const month = scheduledTime.getUTCMonth(); // 0-indexed
    const isEarningsSeason = [0, 3, 6, 9].includes(month); // Jan, Apr, Jul, Oct
    if (isEarningsSeason && isMarketDay && etHour === 9 && minute === 30) {
      // 9:30 AM ET — catch pre-market earnings releases
      ctx.waitUntil(dailyRefresh(env));
    }

    // Monthly universe rebuild (1st of month, 2 AM ET = 6 AM UTC)
    const dayOfMonth = scheduledTime.getUTCDate();
    if (dayOfMonth === 1 && utcHour === 6 && minute === 0) {
      const { buildSmallCapUniverse } = await import('./services/edgarFrames.js');
      ctx.waitUntil(
        // Reset and restart the build process
        env.DB.prepare("DELETE FROM system_config WHERE key = 'universe_build_step'").run()
          .then(() => buildSmallCapUniverse(env.DB, env))
      );
    }

    // Continue universe build if in progress (every 5 min on Saturdays)
    if (isSaturday && minute % 5 === 0) {
      const buildStep = await env.DB.prepare(
        "SELECT value FROM system_config WHERE key = 'universe_build_step'"
      ).first();
      if (buildStep?.value && buildStep.value !== 'complete') {
        const { buildSmallCapUniverse } = await import('./services/edgarFrames.js');
        ctx.waitUntil(buildSmallCapUniverse(env.DB, env));
      }
    }

    // ============================================
    // Weekly Saturday refresh
    // ============================================

    if (isSaturday && utcHour === 4 && minute === 0) {
      // Saturday 12:00 AM ET — Finnhub fallback
      ctx.waitUntil(finnhubRefresh(env));
    }
    if (isSaturday && utcHour === 5 && minute === 0) {
      // Saturday 1:00 AM ET — EDGAR fundamentals catch-up
      ctx.waitUntil(edgarRefresh(env));
    }
    if (isSaturday && utcHour === 6 && minute === 0) {
      // Saturday 2:00 AM ET — Full data refresh
      ctx.waitUntil(dailyRefresh(env));
    }
    if (isSaturday && utcHour === 8 && minute === 0) {
      // Saturday 4:00 AM ET — Regime re-assessment (all active regimes)
      ctx.waitUntil((async () => {
        try {
          const { getActiveRegimes } = await import('./db/queries.js');
          const regimes = await getActiveRegimes(env.DB);
          for (const regime of regimes) {
            // Re-scan news to see if regime is maturing or invalidated
            console.log(`Weekly regime re-assessment: ${regime.name} (status: ${regime.status})`);
          }
        } catch (err) {
          console.error('Weekly regime re-assessment error:', err.message);
        }
      })());
    }

    // ============================================
    // Monthly 1st Saturday — Tier 3 pre-screen
    // ============================================

    if (isSaturday && dayOfMonth <= 7 && dayOfMonth >= 1 && utcHour === 10 && minute === 0) {
      // 1st Saturday 6:00 AM ET — Tier 3 quantitative pre-screen (full universe)
      ctx.waitUntil((async () => {
        try {
          const { ensureMultiTierTables } = await import('./db/queries.js');
          await ensureMultiTierTables(env.DB);
          const { tier3PreScreen, storeTier3Candidates } = await import('./services/tier3Screen.js');
          let offset = 0;
          let totalPasses = 0;
          let hasMore = true;
          while (hasMore) {
            const results = await tier3PreScreen(env.DB, { limit: 100, offset });
            if (results.candidates.length > 0) {
              await storeTier3Candidates(env.DB, results.candidates);
              totalPasses += results.candidates.length;
            }
            hasMore = results.has_more;
            offset += 100;
          }
          console.log(`Monthly Tier 3 pre-screen complete: ${totalPasses} candidates`);
        } catch (err) {
          console.error('Monthly Tier 3 pre-screen error:', err.message);
        }
      })());
    }

    if (isSaturday && dayOfMonth <= 7 && dayOfMonth >= 1 && utcHour === 11 && minute === 0) {
      // 1st Saturday 7:00 AM ET — DKS evaluation for new Tier 3 passes
      ctx.waitUntil((async () => {
        try {
          const { getCandidatesByTier } = await import('./db/queries.js');
          const candidates = await getCandidatesByTier(env.DB, 'tier3');
          const needsEval = candidates.filter(c => c.dks_score == null);
          if (needsEval.length > 0) {
            const { evaluateDKS, storeDKSResults } = await import('./services/dksEvaluator.js');
            let evaluated = 0;
            for (const c of needsEval.slice(0, 10)) { // Limit per run (API cost)
              try {
                const dks = await evaluateDKS(c.ticker, env, env.DB);
                await storeDKSResults(env.DB, c.ticker, dks);
                evaluated++;
              } catch (err) {
                console.error(`DKS eval failed for ${c.ticker}:`, err.message);
              }
            }
            console.log(`Monthly DKS evaluation: ${evaluated}/${needsEval.length} evaluated`);
          }
        } catch (err) {
          console.error('Monthly DKS evaluation error:', err.message);
        }
      })());
    }

    if (isSaturday && dayOfMonth <= 7 && dayOfMonth >= 1 && utcHour === 13 && minute === 0) {
      // 1st Saturday 9:00 AM ET — Attractor analysis refresh for portfolio + candidates
      ctx.waitUntil((async () => {
        try {
          // Refresh attractor for held positions (quarterly minimum)
          await dailyAttractorCheck(env);
          // Also refresh for candidates with stale attractor scores
          const stale = await env.DB.prepare(`
            SELECT * FROM candidates
            WHERE status = 'active'
              AND dks_score >= 3.0
              AND (attractor_score IS NULL OR attractor_analysis_date < datetime('now', '-90 days'))
            LIMIT 5
          `).all();
          if (stale.results?.length > 0) {
            const { runCandidateAnalysis } = await import('./services/analysisRunner.js');
            for (const c of stale.results) {
              try {
                await runCandidateAnalysis(env, c.id);
                console.log(`Attractor refresh for candidate ${c.ticker}`);
              } catch (err) {
                console.error(`Attractor refresh failed for ${c.ticker}:`, err.message);
              }
            }
          }
        } catch (err) {
          console.error('Monthly attractor refresh error:', err.message);
        }
      })());
    }
  },
};
