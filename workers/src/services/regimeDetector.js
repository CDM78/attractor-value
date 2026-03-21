// Regime Transition Detection Service
// Daily: scans Finnhub general news via Claude to identify structural regime shifts.
// Confirmation: FRED structural breaks OR 3+ consecutive weekly AI flags + sector ETF movement.

const REGIME_DETECTION_PROMPT = `You are monitoring for structural regime transitions — major policy changes,
geopolitical events, or technology breakthroughs that create lasting shifts
in economic sectors.

Review these headlines. For each potential regime transition identified:
1. Name and description
2. Catalyst type: policy | geopolitical | technology | commodity
3. Affected sectors (array)
4. Keywords for tracking this regime (array)
5. Adjacent possible score (1-5): are the components already in place?
6. Reversibility: low | medium | high
7. Estimated affected market size ($B)

Only flag STRUCTURAL shifts, not temporary news cycles. A Fed rate decision
is not a regime. The CHIPS Act is a regime. One bad earnings report is not
a regime. A war disrupting 10M barrels/day of oil is a regime.

If no regime transitions are identified, respond with empty array.
Respond in JSON only: { "regimes": [...] }`;

/**
 * Scan recent news for regime transitions using Claude.
 * @param {object} env - Worker env with FINNHUB_API_KEY, ANTHROPIC_API_KEY
 * @param {object} db - D1 database
 */
export async function scanForRegimes(env, db) {
  // Pull general news from Finnhub (last 24 hours)
  const newsUrl = `https://finnhub.io/api/v1/news?category=general&token=${env.FINNHUB_API_KEY}`;
  const newsRes = await fetch(newsUrl);
  if (!newsRes.ok) {
    console.error('Finnhub news fetch failed:', newsRes.status);
    return { scanned: false, error: 'Finnhub news fetch failed' };
  }

  const newsItems = await newsRes.json();
  if (!newsItems || newsItems.length === 0) {
    return { scanned: true, regimes_found: 0 };
  }

  // Take top 50 headlines (most recent)
  const headlines = newsItems
    .slice(0, 50)
    .map(n => n.headline)
    .filter(h => h && h.length > 10)
    .join('\n');

  if (!headlines) {
    return { scanned: true, regimes_found: 0 };
  }

  // Ask Claude to identify regime transitions
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: REGIME_DETECTION_PROMPT,
      messages: [{
        role: 'user',
        content: `Headlines from the last 24 hours:\n${headlines}`,
      }],
    }),
  });

  if (!claudeRes.ok) {
    console.error('Claude regime detection failed:', claudeRes.status);
    return { scanned: false, error: 'Claude API failed' };
  }

  const claudeData = await claudeRes.json();
  const responseText = claudeData.content?.[0]?.text || '{"regimes": []}';

  let parsed;
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { regimes: [] };
  } catch (e) {
    console.error('Failed to parse regime detection response:', e.message);
    return { scanned: true, regimes_found: 0, parse_error: true };
  }

  const regimes = parsed.regimes || [];
  if (regimes.length === 0) {
    return { scanned: true, regimes_found: 0 };
  }

  // Store or update each regime candidate
  const { upsertRegime } = await import('../db/queries.js');
  let newCount = 0;
  let updatedCount = 0;

  for (const regime of regimes) {
    // Check if a similar regime already exists (by name similarity)
    const existing = await db.prepare(
      "SELECT * FROM regime_registry WHERE name = ? OR name LIKE ?"
    ).bind(regime.name, `%${regime.name?.split(' ')[0]}%`).first();

    if (existing) {
      // Increment AI flag count for confirmation tracking
      await db.prepare(
        "UPDATE regime_registry SET ai_flag_count = ai_flag_count + 1, last_assessed = datetime('now') WHERE id = ?"
      ).bind(existing.id).run();

      // Auto-confirm if flagged 3+ times
      if (existing.ai_flag_count >= 2 && existing.status === 'pending') {
        await db.prepare(
          "UPDATE regime_registry SET status = 'active', confirmed_by = 'repeated_ai' WHERE id = ?"
        ).bind(existing.id).run();
      }
      updatedCount++;
    } else {
      // Map catalyst type
      const catalystType = ['commodity_break', 'policy', 'technology', 'geopolitical']
        .find(t => t.includes(regime.catalyst_type?.toLowerCase())) || 'policy';

      await upsertRegime(db, {
        name: regime.name || 'Unknown regime',
        catalyst_type: catalystType,
        start_date: new Date().toISOString().split('T')[0],
        affected_sectors: regime.affected_sectors || [],
        regime_keywords: regime.keywords || [],
        estimated_market_size_b: regime.estimated_affected_market_size || null,
        adjacent_possible_score: regime.adjacent_possible_score || null,
        status: 'pending',
      });
      newCount++;
    }
  }

  return {
    scanned: true,
    regimes_found: regimes.length,
    new_candidates: newCount,
    updated_existing: updatedCount,
  };
}

/**
 * Get the full environment status including crisis and regime data.
 * This is the unified /api/environment response.
 */
export async function getEnvironmentStatus(db, env) {
  const { getOrFetchEconomicSnapshot, detectCrisis } = await import('./fred.js');
  const { getActiveRegimes } = await import('../db/queries.js');

  // Get economic snapshot
  const snapshot = await getOrFetchEconomicSnapshot(db, env.FRED_API_KEY);

  // Get S&P 500 data for crisis detection
  let sp500Data = { sp500_current: 0, sp500_52w_high: 0 };
  try {
    const spyRow = await db.prepare(
      "SELECT price FROM market_data WHERE ticker = 'SPY' OR ticker = '__SPY'"
    ).first();
    if (spyRow?.price) {
      sp500Data.sp500_current = spyRow.price;
      // Approximate 52w high (we don't track this directly yet, so use current as placeholder)
      sp500Data.sp500_52w_high = spyRow.price; // Will need Yahoo 52w high in future
    }
  } catch { /* no SPY data yet */ }

  // Crisis detection
  const crisis = detectCrisis(snapshot, sp500Data);

  // Active regimes
  const regimes = await getActiveRegimes(db);

  // Pending regimes (for display)
  const pendingResult = await db.prepare(
    "SELECT * FROM regime_registry WHERE status = 'pending' ORDER BY ai_flag_count DESC LIMIT 5"
  ).all();
  const pendingRegimes = pendingResult.results || [];

  return {
    environment: snapshot.environment,
    snapshot,
    crisis,
    regimes: {
      active: regimes.map(r => ({
        ...r,
        affected_sectors: safeJsonParse(r.affected_sectors, []),
        regime_keywords: safeJsonParse(r.regime_keywords, []),
      })),
      pending: pendingRegimes.map(r => ({
        ...r,
        affected_sectors: safeJsonParse(r.affected_sectors, []),
        regime_keywords: safeJsonParse(r.regime_keywords, []),
      })),
      active_count: regimes.length,
    },
  };
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
