// FINRA Full Short Interest Time Series Connector
// Fetches ALL bi-monthly FINRA reports for trailing 2-3 years before entry.
// Stores as time series for nonlinear dynamics computation.
// Data available from March 2018 onwards.

import { fetchWithRetry } from './shared.js';
import warehouse from '../warehouse.js';

const FINRA_API = 'https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest';

/**
 * Generate all FINRA settlement dates in a date range.
 * FINRA reports on the 15th and last business day of each month.
 */
function generateSettlementDates(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();

    // Mid-month: 15th
    const mid = new Date(year, month, 15);
    if (mid >= start && mid <= end) {
      dates.push(mid.toISOString().split('T')[0]);
    }

    // End of month: last calendar day (FINRA adjusts for weekends internally)
    const lastDay = new Date(year, month + 1, 0);
    if (lastDay >= start && lastDay <= end) {
      dates.push(lastDay.toISOString().split('T')[0]);
    }

    // Next month
    cursor = new Date(year, month + 1, 1);
  }

  return dates;
}

/**
 * Fetch a single short interest report for a ticker on a specific settlement date.
 */
async function fetchSingleReport(ticker, settlementDate) {
  const body = JSON.stringify({
    compareFilters: [
      { fieldName: 'symbolCode', fieldValue: ticker, compareType: 'EQUAL' },
      { fieldName: 'settlementDate', fieldValue: settlementDate, compareType: 'EQUAL' },
    ],
    limit: 1,
  });

  let res;
  try {
    res = await fetchWithRetry(FINRA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, { minIntervalMs: 150 });
  } catch { return null; }

  if (!res.ok) return null;

  let data;
  try {
    const text = await res.text();
    if (!text || text.trim() === '') return null;
    data = JSON.parse(text);
  } catch { return null; }

  if (!Array.isArray(data) || data.length === 0) return null;

  const d = data[0];
  return {
    date: settlementDate,
    short_position: d.currentShortPositionQuantity,
    prev_short_position: d.previousShortPositionQuantity,
    avg_daily_volume: d.averageDailyVolumeQuantity,
    days_to_cover: d.daysToCoverQuantity,
    change_pct: d.changePercent,
    market_class: d.marketClassCode,
  };
}

/**
 * Fetch all short interest reports for a ticker in a date range using range filter.
 * Much more efficient than individual date queries — single API call.
 */
async function fetchBulkReports(ticker, startDate, endDate) {
  const body = JSON.stringify({
    compareFilters: [
      { fieldName: 'symbolCode', fieldValue: ticker, compareType: 'EQUAL' },
    ],
    dateRangeFilters: [
      { fieldName: 'settlementDate', startDate, endDate },
    ],
    limit: 200,
  });

  let res;
  try {
    res = await fetchWithRetry(FINRA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body,
    }, { minIntervalMs: 150 });
  } catch { return []; }

  if (!res.ok) return [];

  let data;
  try {
    const text = await res.text();
    if (!text || text.trim() === '') return [];
    data = JSON.parse(text);
  } catch { return []; }

  if (!Array.isArray(data)) return [];

  return data.map(d => ({
    date: d.settlementDate,
    short_position: d.currentShortPositionQuantity,
    prev_short_position: d.previousShortPositionQuantity,
    avg_daily_volume: d.averageDailyVolumeQuantity,
    days_to_cover: d.daysToCoverQuantity,
    change_pct: d.changePercent,
    market_class: d.marketClassCode,
  })).filter(r => r.short_position != null);
}

/**
 * Fetch the full short interest time series for a ticker.
 * Returns array of { date, short_position, ... } sorted chronologically.
 *
 * @param {string} ticker
 * @param {string} endDate - Last date to include (typically entry_date)
 * @param {number} trailingYears - How many years to look back (default: 3)
 */
export async function fetchSITimeSeries(ticker, endDate, trailingYears = 3) {
  const endD = new Date(endDate);
  const startD = new Date(endD);
  startD.setFullYear(startD.getFullYear() - trailingYears);

  // FINRA data starts March 2018
  const minDate = '2018-03-15';
  const startDate = startD.toISOString().split('T')[0] < minDate ? minDate : startD.toISOString().split('T')[0];

  // Use bulk range query (single API call) instead of per-date queries
  const series = await fetchBulkReports(ticker, startDate, endDate);

  // Sort chronologically
  series.sort((a, b) => a.date.localeCompare(b.date));
  return series;
}

/**
 * Fetch and store full SI time series for a company.
 * Stores as a single warehouse record with the full series as content.
 */
export async function fetchAndStoreSISeries(ticker, { beforeDate = null, trailingYears = 3 } = {}) {
  const entryDate = beforeDate || '2026-01-01';
  const series = await fetchSITimeSeries(ticker, entryDate, trailingYears);

  if (series.length === 0) return { dataPoints: 0 };

  // Store as a single record
  const record = warehouse.createRecord({
    company: ticker,
    data_type: 'short_interest',
    source: 'finra_time_series',
    source_url: FINRA_API,
    publication_date: series[series.length - 1].date, // Most recent data point
    content: {
      series,
      data_points: series.length,
      date_range: { start: series[0].date, end: series[series.length - 1].date },
      latest_short_position: series[series.length - 1].short_position,
      latest_days_to_cover: series[series.length - 1].days_to_cover,
    },
    metadata: {
      data_points: series.length,
      start_date: series[0].date,
      end_date: series[series.length - 1].date,
      is_time_series: true,
    },
  });

  // Store with a suffix to distinguish from single snapshots
  const path = warehouse.storeRecord(record);
  return { dataPoints: series.length, path };
}

export default {
  fetchSITimeSeries,
  fetchAndStoreSISeries,
  generateSettlementDates,
};
