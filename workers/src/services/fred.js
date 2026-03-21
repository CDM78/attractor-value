// FRED API — Federal Reserve Economic Data
// Primary: AAA bond yield for Graham formula
// Expanded: credit spreads, yield curve, VIX, unemployment, GDP, oil
// for economic environment scoring and attractor analysis enrichment.

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

// All tracked FRED series
const SERIES = {
  AAA:               { name: 'Moody\'s AAA Corporate Bond Yield', unit: '%', freq: 'daily' },
  BAA:               { name: 'Moody\'s BAA Corporate Bond Yield', unit: '%', freq: 'daily' },
  DGS10:             { name: '10-Year Treasury Yield', unit: '%', freq: 'daily' },
  T10Y2Y:            { name: '10Y minus 2Y Treasury Spread', unit: '%', freq: 'daily' },
  UNRATE:            { name: 'Civilian Unemployment Rate', unit: '%', freq: 'monthly' },
  A191RL1Q225SBEA:   { name: 'Real GDP Growth (Q/Q Annualized)', unit: '%', freq: 'quarterly' },
  BAMLH0A0HYM2:     { name: 'ICE BofA High Yield OAS', unit: '%', freq: 'daily' },
  DCOILWTICO:        { name: 'WTI Crude Oil Price', unit: 'USD', freq: 'daily' },
  VIXCLS:            { name: 'CBOE Volatility Index (VIX)', unit: 'index', freq: 'daily' },
};

// Historical medians for stress detection (approximations from long-run data)
const HISTORICAL = {
  credit_spread_median: 1.0,    // BAA - AAA long-run median ~1.0%
  hy_oas_median: 4.0,           // HY OAS long-run median ~4.0%
  hy_oas_90th: 6.5,             // HY OAS 90th percentile
};

/**
 * Fetch the most recent observation for a FRED series.
 * Returns { value, date } or null if unavailable.
 */
export async function fetchSeries(seriesId, apiKey, options = {}) {
  const url = new URL(FRED_BASE);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', String(options.limit || 5));
  if (options.startDate) url.searchParams.set('observation_start', options.startDate);
  if (options.endDate) url.searchParams.set('observation_end', options.endDate);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FRED API error for ${seriesId}: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (!data.observations || data.observations.length === 0) return null;

  // Return all valid observations if multiple requested, else just the latest
  const valid = [];
  for (const obs of data.observations) {
    const value = parseFloat(obs.value);
    if (!isNaN(value)) valid.push({ value, date: obs.date });
  }

  return valid.length > 0 ? (options.limit > 1 ? valid : valid[0]) : null;
}

// Convenience: fetch AAA yield (used by Graham formula)
export async function fetchAAABondYield(apiKey) {
  const result = await fetchSeries('AAA', apiKey);
  if (!result) throw new Error('No valid AAA bond yield from FRED');
  return { yield: result.value, date: result.date };
}

// Convenience: credit spread (BAA - AAA)
export async function getCreditSpread(apiKey) {
  const [aaa, baa] = await Promise.all([
    fetchSeries('AAA', apiKey),
    fetchSeries('BAA', apiKey),
  ]);
  if (!aaa || !baa) return null;
  return {
    spread: Math.round((baa.value - aaa.value) * 100) / 100,
    aaa: aaa.value,
    baa: baa.value,
    date: baa.date,
  };
}

// Convenience: yield curve slope
export async function getYieldCurveSlope(apiKey) {
  return fetchSeries('T10Y2Y', apiKey);
}

// Convenience: VIX
export async function getVIX(apiKey) {
  return fetchSeries('VIXCLS', apiKey);
}

/**
 * Derived signal helpers
 */
export function isYieldCurveInverted(t10y2y) {
  return t10y2y != null && t10y2y < 0;
}

export function isCreditStressed(hyOAS) {
  return hyOAS != null && hyOAS > HISTORICAL.hy_oas_90th;
}

/**
 * Determine economic environment classification.
 * NORMAL → CAUTIOUS → STRESSED based on multiple indicators.
 */
export function classifyEnvironment(snapshot) {
  if (!snapshot) return 'UNKNOWN';

  let stressPoints = 0;

  // Credit spread: > 2.0 = severe (+2), > 1.5 = elevated (+1)
  if (snapshot.credit_spread != null) {
    if (snapshot.credit_spread > 2.0) stressPoints += 2;
    else if (snapshot.credit_spread > 1.5) stressPoints += 1;
  }

  // Yield curve: inverted (<0) = severe (+2), flat (0-0.5) = warning (+1)
  if (snapshot.yield_curve != null) {
    if (snapshot.yield_curve < 0) stressPoints += 2;
    else if (snapshot.yield_curve < 0.5) stressPoints += 1;
  }

  // High yield OAS: > 6.0 = severe (+2), > 5.0 = elevated (+1)
  if (snapshot.hy_oas != null) {
    if (snapshot.hy_oas > 6.0) stressPoints += 2;
    else if (snapshot.hy_oas > 5.0) stressPoints += 1;
  }

  // VIX: > 30 = severe (+2), > 25 = elevated (+1)
  if (snapshot.vix != null) {
    if (snapshot.vix > 30) stressPoints += 2;
    else if (snapshot.vix > 25) stressPoints += 1;
  }

  // Unemployment: > 6.0 = stressed (+1)
  if (snapshot.unemployment != null && snapshot.unemployment > 6.0) stressPoints += 1;

  if (stressPoints >= 5) return 'STRESSED';
  if (stressPoints >= 2) return 'CAUTIOUS';
  return 'NORMAL';
}

/**
 * Fetch all economic indicators and compute derived signals.
 * Returns a full economic snapshot for reports and attractor analysis.
 */
export async function getEconomicSnapshot(apiKey) {
  // Fetch all series in parallel
  const [aaa, baa, dgs10, t10y2y, unrate, gdp, hyOAS, oil, vix] = await Promise.allSettled([
    fetchSeries('AAA', apiKey),
    fetchSeries('BAA', apiKey),
    fetchSeries('DGS10', apiKey),
    fetchSeries('T10Y2Y', apiKey),
    fetchSeries('UNRATE', apiKey),
    fetchSeries('A191RL1Q225SBEA', apiKey),
    fetchSeries('BAMLH0A0HYM2', apiKey),
    fetchSeries('DCOILWTICO', apiKey),
    fetchSeries('VIXCLS', apiKey),
  ]);

  const val = (r) => r.status === 'fulfilled' && r.value ? r.value.value : null;
  const dt = (r) => r.status === 'fulfilled' && r.value ? r.value.date : null;

  const aaaVal = val(aaa);
  const baaVal = val(baa);

  const snapshot = {
    aaa_yield: aaaVal,
    aaa_date: dt(aaa),
    baa_yield: baaVal,
    credit_spread: (aaaVal != null && baaVal != null) ? Math.round((baaVal - aaaVal) * 100) / 100 : null,
    treasury_10y: val(dgs10),
    yield_curve: val(t10y2y),
    yield_curve_inverted: val(t10y2y) != null ? val(t10y2y) < 0 : null,
    unemployment: val(unrate),
    gdp_growth: val(gdp),
    hy_oas: val(hyOAS),
    oil_price: val(oil),
    vix: val(vix),
    fetched_at: new Date().toISOString(),
  };

  snapshot.environment = classifyEnvironment(snapshot);
  return snapshot;
}

/**
 * Get or fetch economic snapshot with D1 caching (24-hour TTL).
 * Stores as a JSON blob in the market_data table under a special ticker key.
 */
export async function getOrFetchEconomicSnapshot(db, apiKey) {
  // Check cache
  const cached = await db.prepare(
    "SELECT pe_ratio FROM market_data WHERE ticker = '__ECON_SNAPSHOT' AND fetched_at > datetime('now', '-24 hours')"
  ).first();

  if (cached?.pe_ratio) {
    try {
      // pe_ratio field stores a pointer; actual data is in a separate row
      // But for simplicity, re-fetch from individual cached series
    } catch { /* fall through to fresh fetch */ }
  }

  // Check for individually cached series first
  const cachedAAA = await db.prepare(
    "SELECT price, fetched_at FROM market_data WHERE ticker = '__AAA_BOND_YIELD' AND fetched_at > datetime('now', '-24 hours')"
  ).first();

  // If AAA is fresh, try to build snapshot from cache
  if (cachedAAA) {
    const rows = await db.prepare(
      "SELECT ticker, price, fetched_at FROM market_data WHERE ticker LIKE '__FRED_%' AND fetched_at > datetime('now', '-24 hours')"
    ).all();
    const cache = {};
    for (const r of (rows.results || [])) {
      cache[r.ticker] = r.price;
    }

    // If we have all key indicators cached, use them
    if (cache['__FRED_BAA'] != null && cache['__FRED_T10Y2Y'] != null && cache['__FRED_VIXCLS'] != null) {
      const snapshot = {
        aaa_yield: cachedAAA.price,
        aaa_date: cachedAAA.fetched_at?.split('T')[0],
        baa_yield: cache['__FRED_BAA'],
        credit_spread: Math.round((cache['__FRED_BAA'] - cachedAAA.price) * 100) / 100,
        treasury_10y: cache['__FRED_DGS10'] ?? null,
        yield_curve: cache['__FRED_T10Y2Y'],
        yield_curve_inverted: cache['__FRED_T10Y2Y'] < 0,
        unemployment: cache['__FRED_UNRATE'] ?? null,
        gdp_growth: cache['__FRED_GDP'] ?? null,
        hy_oas: cache['__FRED_HYOAS'] ?? null,
        oil_price: cache['__FRED_OIL'] ?? null,
        vix: cache['__FRED_VIXCLS'],
        fetched_at: cachedAAA.fetched_at,
        environment: null,
      };
      snapshot.environment = classifyEnvironment(snapshot);
      return snapshot;
    }
  }

  // Fetch fresh
  const snapshot = await getEconomicSnapshot(apiKey);

  // Cache individual series in market_data
  const now = new Date().toISOString();
  const cacheEntries = [
    ['__AAA_BOND_YIELD', snapshot.aaa_yield],
    ['__FRED_BAA', snapshot.baa_yield],
    ['__FRED_DGS10', snapshot.treasury_10y],
    ['__FRED_T10Y2Y', snapshot.yield_curve],
    ['__FRED_UNRATE', snapshot.unemployment],
    ['__FRED_GDP', snapshot.gdp_growth],
    ['__FRED_HYOAS', snapshot.hy_oas],
    ['__FRED_OIL', snapshot.oil_price],
    ['__FRED_VIXCLS', snapshot.vix],
  ];

  const stmts = [];
  for (const [ticker, value] of cacheEntries) {
    if (value == null) continue;
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
         VALUES (?, ?, 'macro', 'economic', 0, ?)`
      ).bind(ticker, SERIES[ticker.replace('__FRED_', '')] ? ticker : 'Economic Indicator', now)
    );
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, ?)`
      ).bind(ticker, value, now)
    );
  }

  // Batch in groups of 100
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }

  return snapshot;
}

/**
 * Cache-aware AAA bond yield fetch.
 * Preserves backwards compatibility with existing code.
 */
export async function getOrFetchBondYield(db, apiKey) {
  const cached = await db.prepare(
    "SELECT * FROM market_data WHERE ticker = '__AAA_BOND_YIELD' AND fetched_at > datetime('now', '-24 hours')"
  ).first();

  if (cached) {
    return { yield: cached.price, date: cached.fetched_at };
  }

  const result = await fetchAAABondYield(apiKey);

  await db.prepare(
    `INSERT OR REPLACE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
     VALUES ('__AAA_BOND_YIELD', 'AAA Corporate Bond Yield', 'macro', 'bonds', 0, ?)`
  ).bind(new Date().toISOString()).run();

  await db.prepare(
    `INSERT OR REPLACE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
     VALUES ('__AAA_BOND_YIELD', ?, NULL, NULL, NULL, NULL, NULL, ?)`
  ).bind(result.yield, new Date().toISOString()).run();

  return result;
}

/**
 * Format economic snapshot for display in reports.
 */
export function formatEconomicEnvironmentSection(snapshot) {
  if (!snapshot) return '';

  const lines = [];
  lines.push('---');
  lines.push('## Economic Environment');
  lines.push('');
  lines.push('| Indicator | Value | Signal |');
  lines.push('|-----------|-------|--------|');

  const fmt = (v, suffix = '') => v != null ? v.toFixed(2) + suffix : 'N/A';
  const fmtPct = (v) => fmt(v, '%');

  lines.push(`| AAA Corporate Yield | ${fmtPct(snapshot.aaa_yield)} | — |`);
  lines.push(`| BAA Corporate Yield | ${fmtPct(snapshot.baa_yield)} | — |`);

  const spreadSignal = snapshot.credit_spread != null
    ? (snapshot.credit_spread > HISTORICAL.credit_spread_median * 1.5 ? 'Elevated' : 'Normal')
    : '—';
  lines.push(`| Credit Spread (BAA-AAA) | ${fmtPct(snapshot.credit_spread)} | ${spreadSignal} |`);

  lines.push(`| 10Y Treasury | ${fmtPct(snapshot.treasury_10y)} | — |`);

  const ycSignal = snapshot.yield_curve != null
    ? (snapshot.yield_curve < 0 ? 'INVERTED' : snapshot.yield_curve < 0.25 ? 'Flat' : 'Positive')
    : '—';
  lines.push(`| Yield Curve (10Y-2Y) | ${snapshot.yield_curve != null ? (snapshot.yield_curve >= 0 ? '+' : '') + snapshot.yield_curve.toFixed(2) + '%' : 'N/A'} | ${ycSignal} |`);

  const vixSignal = snapshot.vix != null
    ? (snapshot.vix > 30 ? 'Elevated' : snapshot.vix > 20 ? 'Moderate' : 'Normal')
    : '—';
  lines.push(`| VIX | ${snapshot.vix != null ? snapshot.vix.toFixed(1) : 'N/A'} | ${vixSignal} |`);

  const hySignal = snapshot.hy_oas != null
    ? (snapshot.hy_oas > HISTORICAL.hy_oas_90th ? 'STRESSED' : snapshot.hy_oas > HISTORICAL.hy_oas_median ? 'Elevated' : 'Normal')
    : '—';
  lines.push(`| High Yield OAS | ${fmtPct(snapshot.hy_oas)} | ${hySignal} |`);

  lines.push(`| Unemployment | ${snapshot.unemployment != null ? snapshot.unemployment.toFixed(1) + '%' : 'N/A'} | ${snapshot.unemployment != null ? (snapshot.unemployment > 5 ? 'Elevated' : 'Stable') : '—'} |`);
  lines.push(`| GDP Growth (Q/Q Ann.) | ${snapshot.gdp_growth != null ? snapshot.gdp_growth.toFixed(1) + '%' : 'N/A'} | ${snapshot.gdp_growth != null ? (snapshot.gdp_growth < 0 ? 'Contraction' : snapshot.gdp_growth < 1 ? 'Weak' : 'Moderate') : '—'} |`);
  lines.push(`| WTI Crude | ${snapshot.oil_price != null ? '$' + snapshot.oil_price.toFixed(2) : 'N/A'} | — |`);
  lines.push(`| **Environment** | **${snapshot.environment}** | |`);
  lines.push('');

  if (snapshot.environment === 'STRESSED') {
    lines.push('> **STRESSED ENVIRONMENT:** Yield curve inverted AND/OR credit spreads at historical extremes AND/OR VIX elevated. Margins of safety automatically increased by 5 percentage points. Value traps are most dangerous in stressed environments — require higher discounts before buying.');
    lines.push('');
  } else if (snapshot.environment === 'CAUTIOUS') {
    lines.push('> **CAUTIOUS ENVIRONMENT:** One or more stress indicators present. Exercise additional scrutiny on cyclical stocks and companies with high leverage.');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format economic snapshot for attractor analysis prompt enrichment.
 */
export function formatEconomicContextForPrompt(snapshot) {
  if (!snapshot) return '';

  const lines = ['CURRENT ECONOMIC ENVIRONMENT:'];
  if (snapshot.aaa_yield != null) lines.push(`AAA Corporate Yield: ${snapshot.aaa_yield.toFixed(2)}%`);
  if (snapshot.credit_spread != null) lines.push(`Credit Spread (BAA-AAA): ${snapshot.credit_spread.toFixed(2)}%`);
  if (snapshot.yield_curve != null) lines.push(`Yield Curve (10Y-2Y): ${snapshot.yield_curve >= 0 ? '+' : ''}${snapshot.yield_curve.toFixed(2)}% ${snapshot.yield_curve < 0 ? '(INVERTED)' : ''}`);
  if (snapshot.vix != null) lines.push(`VIX: ${snapshot.vix.toFixed(1)}`);
  if (snapshot.hy_oas != null) lines.push(`High Yield OAS: ${snapshot.hy_oas.toFixed(2)}%`);
  if (snapshot.unemployment != null) lines.push(`Unemployment: ${snapshot.unemployment.toFixed(1)}%`);
  if (snapshot.gdp_growth != null) lines.push(`GDP Growth (Q/Q Ann.): ${snapshot.gdp_growth.toFixed(1)}%`);
  if (snapshot.oil_price != null) lines.push(`WTI Crude: $${snapshot.oil_price.toFixed(2)}`);
  lines.push(`Environment Classification: ${snapshot.environment}`);
  lines.push('');
  lines.push('Consider how macroeconomic conditions affect this company\'s attractor stability. A company that appears stable in expansion may be vulnerable in contraction. Cyclical businesses and highly leveraged companies face disproportionate risk in stressed environments.');
  return lines.join('\n');
}

/**
 * Detect crisis conditions for Tier 2 activation.
 * Uses S&P 500 decline, VIX, and credit spread widening.
 * @param {object} snapshot - Economic snapshot from getEconomicSnapshot
 * @param {object} marketData - { sp500_current, sp500_52w_high } from Yahoo
 */
export function detectCrisis(snapshot, marketData = {}) {
  const sp500Decline = marketData.sp500_52w_high > 0
    ? (marketData.sp500_current - marketData.sp500_52w_high) / marketData.sp500_52w_high
    : 0;

  const vixSustained = snapshot?.vix != null && snapshot.vix > 30;

  // Credit spread widening (compare to historical median)
  const spreadElevated = snapshot?.credit_spread != null &&
    snapshot.credit_spread > HISTORICAL.credit_spread_median * 2.0;

  const severeSignals = [
    sp500Decline <= -0.15,
    vixSustained,
    spreadElevated,
  ].filter(Boolean).length;

  const crisisActive = severeSignals >= 2 || sp500Decline <= -0.20;

  let severity = 'none';
  if (sp500Decline <= -0.30) severity = 'severe';
  else if (sp500Decline <= -0.20) severity = 'moderate';
  else if (crisisActive) severity = 'mild';

  // Dynamic stock decline threshold for Tier 2 pre-screen
  const stockDeclineThreshold = severity === 'severe' ? -0.15
    : severity === 'moderate' ? -0.18
    : -0.20;

  return {
    crisis_active: crisisActive,
    severity,
    sp500_decline: Math.round(sp500Decline * 1000) / 1000,
    sp500_current: marketData.sp500_current,
    sp500_52w_high: marketData.sp500_52w_high,
    vix: snapshot?.vix,
    credit_spread: snapshot?.credit_spread,
    severe_signal_count: severeSignals,
    stock_decline_threshold: stockDeclineThreshold,
  };
}

/**
 * Snapshot pre-crisis prices for all stocks when crisis transitions from inactive to active.
 * Only runs once per crisis activation — not on every daily check.
 * @param {object} db - D1 database
 */
export async function snapshotPreCrisisPrices(db) {
  const now = new Date().toISOString();
  // Copy current price into pre_crisis_price for all stocks that have market data
  const result = await db.prepare(`
    UPDATE stocks SET
      pre_crisis_price = (SELECT price FROM market_data WHERE market_data.ticker = stocks.ticker),
      pre_crisis_date = ?
    WHERE ticker NOT LIKE '\\_\\_%' ESCAPE '\\'
      AND EXISTS (SELECT 1 FROM market_data WHERE market_data.ticker = stocks.ticker AND price IS NOT NULL)
  `).bind(now).run();

  console.log(`Pre-crisis price snapshot: ${result.meta?.changes || 0} stocks snapshotted at ${now}`);
  return result.meta?.changes || 0;
}

// Re-export constants for use by other modules
export { HISTORICAL };
