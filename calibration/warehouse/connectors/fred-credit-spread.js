// FRED Credit Spread Time Series Connector
// Extracts daily BAA-AAA credit spread from the existing economic-context.json
// as a queryable time series for CSD and Ornstein-Uhlenbeck computation.
//
// The data is already in the warehouse (macro/fred/economic-context.json).
// This connector exposes it as a proper time series with date filtering
// and also supports fetching fresh data from FRED directly.

import { fetchWithRetry } from './shared.js';
import warehouse from '../warehouse.js';

const FRED_API_BASE = 'https://api.stlouisfed.org/series/observations';

// Series IDs for credit spread components
const SERIES = {
  BAA: 'BAA',     // Moody's Baa Corporate Bond Yield
  AAA: 'AAA',     // Moody's Aaa Corporate Bond Yield
  BAAFFM: 'BAAFFM', // Baa - Fed Funds (alternative spread)
};

// ============================================================
// FROM EXISTING WAREHOUSE DATA
// ============================================================

/**
 * Extract credit spread time series from the existing economic-context.json.
 * Returns array of { date, credit_spread, baa_yield, aaa_yield } sorted chronologically.
 *
 * @param {string} [beforeDate] - Only include data points before this date
 * @param {string} [afterDate] - Only include data points after this date
 */
export function extractCreditSpreadSeries(beforeDate = null, afterDate = null) {
  const econData = warehouse.loadMacroData('fred', 'economic-context');
  if (!econData) return [];

  const series = [];

  for (const [date, snapshot] of Object.entries(econData)) {
    if (beforeDate && date > beforeDate) continue;
    if (afterDate && date < afterDate) continue;
    if (snapshot.credit_spread == null) continue;

    series.push({
      date,
      credit_spread: snapshot.credit_spread,
      baa_yield: snapshot.baa_yield || null,
      aaa_yield: snapshot.aaa_yield || null,
      vix: snapshot.vix || null,
      regime: snapshot.regime || null,
    });
  }

  series.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}

/**
 * Get credit spread series for a specific case's entry date.
 * Returns the trailing N years of credit spread data before entry.
 *
 * @param {string} entryDate - Case entry date (YYYY-MM-DD)
 * @param {number} trailingYears - How many years to look back (default: 3)
 */
export function getCreditSpreadForCase(entryDate, trailingYears = 3) {
  const startD = new Date(entryDate);
  startD.setFullYear(startD.getFullYear() - trailingYears);
  const afterDate = startD.toISOString().split('T')[0];

  return extractCreditSpreadSeries(entryDate, afterDate);
}

// ============================================================
// FRESH DATA FROM FRED API
// ============================================================

/**
 * Fetch credit spread component series directly from FRED.
 * Requires FRED_API_KEY environment variable.
 *
 * @param {string} seriesId - FRED series ID (e.g., 'BAA', 'AAA')
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} apiKey - FRED API key
 */
async function fetchFredSeries(seriesId, startDate, endDate, apiKey) {
  const url = `${FRED_API_BASE}?series_id=${seriesId}&observation_start=${startDate}&observation_end=${endDate}&api_key=${apiKey}&file_type=json`;

  const res = await fetchWithRetry(url, {}, { minIntervalMs: 200 });
  if (!res.ok) {
    throw new Error(`FRED API error for ${seriesId}: ${res.status}`);
  }

  const data = await res.json();
  if (!data.observations) return [];

  return data.observations
    .filter(o => o.value !== '.')
    .map(o => ({
      date: o.date,
      value: parseFloat(o.value),
    }));
}

/**
 * Fetch and compute BAA-AAA credit spread time series from FRED.
 * Returns daily observations with computed spread.
 *
 * @param {Object} options
 * @param {string} options.startDate - Start date
 * @param {string} options.endDate - End date
 * @param {string} options.apiKey - FRED API key
 */
export async function fetchCreditSpreadFromFred({ startDate = '2005-01-01', endDate = '2026-01-01', apiKey }) {
  if (!apiKey) throw new Error('FRED API key required — set FRED_API_KEY');

  const [baa, aaa] = await Promise.all([
    fetchFredSeries('BAA', startDate, endDate, apiKey),
    fetchFredSeries('AAA', startDate, endDate, apiKey),
  ]);

  // Index AAA by date for matching
  const aaaByDate = {};
  for (const obs of aaa) {
    aaaByDate[obs.date] = obs.value;
  }

  // Compute spread for each BAA observation
  const series = [];
  for (const obs of baa) {
    const aaaYield = aaaByDate[obs.date];
    if (aaaYield == null) continue;

    series.push({
      date: obs.date,
      credit_spread: +(obs.value - aaaYield).toFixed(4),
      baa_yield: obs.value,
      aaa_yield: aaaYield,
    });
  }

  return series;
}

/**
 * Fetch fresh credit spread data from FRED and store in warehouse.
 * Merges with existing economic-context.json.
 */
export async function fetchAndStoreCreditSpread({ startDate = '2005-01-01', endDate = '2026-01-01', apiKey }) {
  const series = await fetchCreditSpreadFromFred({ startDate, endDate, apiKey });
  if (series.length === 0) return { dataPoints: 0 };

  // Store as dedicated time series in macro/fred/
  warehouse.storeMacroData('fred', 'credit-spread-series', {
    source: 'fred_api',
    series_ids: ['BAA', 'AAA'],
    date_range: { start: series[0].date, end: series[series.length - 1].date },
    data_points: series.length,
    series,
  });

  return { dataPoints: series.length };
}

export default {
  extractCreditSpreadSeries,
  getCreditSpreadForCase,
  fetchCreditSpreadFromFred,
  fetchAndStoreCreditSpread,
};
