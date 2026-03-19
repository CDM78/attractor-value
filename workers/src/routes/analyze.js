import { runSingleAnalysis } from '../services/analysisRunner.js';

export async function analyzeRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);

  // Batch endpoints: /api/analyze/batch
  if (path === '/api/analyze/batch') {
    return handleBatch(request, env, ctx, { jsonResponse, errorResponse });
  }

  // Single-ticker endpoints: /api/analyze?ticker=X
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return errorResponse('ticker parameter required', 400);

  // GET: retrieve most recent analysis
  if (request.method === 'GET') {
    const analysis = await env.DB.prepare(
      'SELECT * FROM attractor_analysis WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
    ).bind(ticker).first();

    if (!analysis) return errorResponse('No analysis found', 404);

    const cr = await env.DB.prepare(
      'SELECT * FROM concentration_risk WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
    ).bind(ticker).first();

    const insiderSig = await env.DB.prepare(
      'SELECT * FROM insider_signals WHERE ticker = ?'
    ).bind(ticker).first();

    const insiderTxns = await env.DB.prepare(
      `SELECT * FROM insider_transactions WHERE ticker = ? AND filing_date >= date('now', '-180 days')
       ORDER BY filing_date DESC LIMIT 50`
    ).bind(ticker).all();

    const stockInfo = await env.DB.prepare(
      'SELECT sector, industry FROM stocks WHERE ticker = ?'
    ).bind(ticker).first();

    const secularDisruption = await env.DB.prepare(
      'SELECT * FROM secular_disruption WHERE ticker = ? ORDER BY analysis_date DESC LIMIT 1'
    ).bind(ticker).first();

    return jsonResponse({
      analysis,
      concentration_risk: cr || null,
      insider_signal: insiderSig || null,
      insider_transactions: insiderTxns?.results || [],
      stock_info: stockInfo || null,
      secular_disruption: secularDisruption || null,
    });
  }

  // POST: trigger new analysis via Claude API
  if (request.method === 'POST') {
    const result = await runSingleAnalysis(env, ticker);
    return jsonResponse(result);
  }

  return errorResponse('Method not allowed', 405);
}

// Batch analysis: POST to start, GET to poll progress
async function handleBatch(request, env, ctx, { jsonResponse, errorResponse }) {
  if (request.method === 'POST') {
    const body = await request.json();
    const tickers = body.tickers;

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return errorResponse('tickers array required', 400);
    }
    if (tickers.length > 10) {
      return errorResponse('Maximum 10 tickers per batch', 400);
    }

    // Validate all tickers exist
    const placeholders = tickers.map(() => '?').join(',');
    const existing = await env.DB.prepare(
      `SELECT ticker FROM stocks WHERE ticker IN (${placeholders})`
    ).bind(...tickers).all();
    const existingSet = new Set((existing.results || []).map(r => r.ticker));
    const missing = tickers.filter(t => !existingSet.has(t));
    if (missing.length > 0) {
      return errorResponse(`Tickers not in database: ${missing.join(', ')}`, 400);
    }

    // Ensure analysis_jobs table exists
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tickers TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        total INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        current_ticker TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      )
    `).run();

    // Create job record
    const jobResult = await env.DB.prepare(
      `INSERT INTO analysis_jobs (tickers, status, total) VALUES (?, 'running', ?)`
    ).bind(JSON.stringify(tickers), tickers.length).run();
    const jobId = jobResult.meta?.last_row_id;

    // Process in background using ctx.waitUntil
    ctx.waitUntil(processBatchAnalysis(env, jobId, tickers));

    return jsonResponse({
      jobId,
      total: tickers.length,
      estimatedCost: `~$${(tickers.length * 0.03).toFixed(2)}`,
      message: `Batch analysis started for ${tickers.length} stocks`,
    });
  }

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    if (!jobId) return errorResponse('jobId parameter required', 400);

    // Clean up stale jobs (running > 10 min)
    await env.DB.prepare(
      `UPDATE analysis_jobs SET status = 'error', error_message = 'Timed out'
       WHERE status = 'running' AND created_at < datetime('now', '-10 minutes')`
    ).run();

    const job = await env.DB.prepare(
      'SELECT * FROM analysis_jobs WHERE id = ?'
    ).bind(jobId).first();

    if (!job) return errorResponse('Job not found', 404);

    return jsonResponse({
      jobId: job.id,
      status: job.status,
      total: job.total,
      completed: job.completed,
      currentTicker: job.current_ticker,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      completedAt: job.completed_at,
    });
  }

  return errorResponse('Method not allowed', 405);
}

async function processBatchAnalysis(env, jobId, tickers) {
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      // Update current ticker
      await env.DB.prepare(
        `UPDATE analysis_jobs SET current_ticker = ? WHERE id = ?`
      ).bind(ticker, jobId).run();

      await runSingleAnalysis(env, ticker);

      // Update progress
      await env.DB.prepare(
        `UPDATE analysis_jobs SET completed = ? WHERE id = ?`
      ).bind(i + 1, jobId).run();

      console.log(`Batch ${jobId}: completed ${ticker} (${i + 1}/${tickers.length})`);
    } catch (err) {
      console.error(`Batch ${jobId}: failed on ${ticker}:`, err.message);
      // Continue with remaining tickers, mark this one as a partial error
      await env.DB.prepare(
        `UPDATE analysis_jobs SET completed = ?,
         error_message = COALESCE(error_message || '; ', '') || ? WHERE id = ?`
      ).bind(i + 1, `${ticker}: ${err.message}`, jobId).run();
    }
  }

  // Mark job complete
  await env.DB.prepare(
    `UPDATE analysis_jobs SET status = 'complete', current_ticker = NULL,
     completed_at = datetime('now') WHERE id = ?`
  ).bind(jobId).run();

  console.log(`Batch ${jobId}: all ${tickers.length} tickers processed`);
}
