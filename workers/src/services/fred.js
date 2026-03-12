// FRED API - Federal Reserve Economic Data
// Used for AAA corporate bond yield in Graham formula

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const AAA_SERIES_ID = 'AAA';  // Moody's Aaa Corporate Bond Yield

export async function fetchAAABondYield(apiKey) {
  const url = new URL(FRED_BASE);
  url.searchParams.set('series_id', AAA_SERIES_ID);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '5');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FRED API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (!data.observations || data.observations.length === 0) {
    throw new Error('No bond yield observations returned from FRED');
  }

  // Find the most recent non-empty observation
  for (const obs of data.observations) {
    const value = parseFloat(obs.value);
    if (!isNaN(value)) {
      return {
        yield: value,
        date: obs.date,
      };
    }
  }

  throw new Error('No valid bond yield value found in FRED response');
}

// Cache bond yield in D1 (updates daily)
export async function getOrFetchBondYield(db, apiKey) {
  // Check cache first
  const cached = await db.prepare(
    "SELECT * FROM market_data WHERE ticker = '__AAA_BOND_YIELD' AND fetched_at > datetime('now', '-24 hours')"
  ).first();

  if (cached) {
    return { yield: cached.price, date: cached.fetched_at };
  }

  // Fetch fresh
  const result = await fetchAAABondYield(apiKey);

  // Store in market_data using a special ticker key
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
