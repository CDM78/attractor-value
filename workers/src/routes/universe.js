// Universe management routes — build and monitor the small cap screening universe

import { buildSmallCapUniverse, getUniverseCounts, computeSectorPBFromFrames } from '../services/edgarFrames.js';

export async function universeRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);

  // GET /api/universe/status — counts by cap tier, build progress
  if (request.method === 'GET' && path === '/api/universe/status') {
    try {
      const counts = await getUniverseCounts(env.DB);
      return jsonResponse(counts);
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // POST /api/universe/build — trigger or continue universe build
  if (request.method === 'POST' && path === '/api/universe/build') {
    const step = url.searchParams.get('step') || null;
    const wait = url.searchParams.get('wait') !== 'false';

    try {
      if (wait) {
        const result = await buildSmallCapUniverse(env.DB, env, step);
        return jsonResponse(result);
      } else {
        ctx.waitUntil(buildSmallCapUniverse(env.DB, env, step));
        return jsonResponse({ status: 'started', step: step || 'auto' });
      }
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // POST /api/universe/reset — reset build progress (for debugging)
  if (request.method === 'POST' && path === '/api/universe/reset') {
    await env.DB.prepare("DELETE FROM universe_candidates").run();
    await env.DB.prepare(
      "DELETE FROM system_config WHERE key IN ('universe_build_step', 'universe_build_date', 'universe_build_period')"
    ).run();
    return jsonResponse({ status: 'reset' });
  }

  // POST /api/universe/sector-pb — compute sector P/B from Frames API
  if (request.method === 'POST' && path === '/api/universe/sector-pb') {
    try {
      const result = await computeSectorPBFromFrames(env.DB);
      return jsonResponse(result);
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  // GET /api/universe/sector-pb — get cached sector P/B thresholds
  if (request.method === 'GET' && path === '/api/universe/sector-pb') {
    try {
      const rows = await env.DB.prepare(
        `SELECT sector, p33_pb, p50_pb, sample_size, computed_date
         FROM sector_pb_distribution
         WHERE computed_date = (SELECT MAX(computed_date) FROM sector_pb_distribution)
         ORDER BY sector`
      ).all();
      return jsonResponse({ sectors: rows.results || [] });
    } catch (err) {
      return errorResponse(err.message);
    }
  }

  return errorResponse('Not found', 404);
}
