// SEC Fail-to-Deliver Data Connector
// Downloads twice-monthly FTD CSV files from SEC, parses per-company series.
// Source: https://www.sec.gov/data/foiadocsfailsdatahtm
// Free, no authentication.

import { fetchWithRetry } from './shared.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import warehouse from '../warehouse.js';

const FTD_CACHE_DIR = resolve(import.meta.dirname, '../../warehouse/macro/ftd-cache');

/**
 * Generate FTD download URLs for a date range.
 * SEC publishes two files per month:
 *   - First half: cnsfails{YYYYMM}a.zip (days 1-15)
 *   - Second half: cnsfails{YYYYMM}b.zip (days 16-end)
 * Files are also available as .txt at known URLs.
 */
function generateFtdUrls(startDate, endDate) {
  const urls = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');

    // SEC URL patterns for FTD data
    // Newer format (2017+): https://www.sec.gov/files/data/fails-deliver-data/cnsfails202401a.zip
    // Pipe-delimited text inside the zip, or available as direct text
    const yymm = `${year}${month}`;
    urls.push({
      url: `https://www.sec.gov/files/data/fails-deliver-data/cnsfails${yymm}a.zip`,
      period: `${year}-${month}-first-half`,
      date: `${year}-${month}-15`,
    });
    urls.push({
      url: `https://www.sec.gov/files/data/fails-deliver-data/cnsfails${yymm}b.zip`,
      period: `${year}-${month}-second-half`,
      date: `${year}-${month}-${new Date(year, cursor.getMonth() + 1, 0).getDate()}`,
    });

    cursor = new Date(year, cursor.getMonth() + 1, 1);
  }

  return urls;
}

/**
 * Parse a FTD text/CSV file (pipe-delimited).
 * Format: SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE
 */
function parseFtdText(text) {
  const lines = text.split('\n');
  const records = [];

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length < 5) continue;

    const dateStr = parts[0].trim();
    const symbol = parts[2].trim();
    const quantity = parseInt(parts[3].trim(), 10);
    const price = parseFloat(parts[5]?.trim()) || null;

    if (!symbol || isNaN(quantity) || !dateStr) continue;
    if (!/^\d{8}$/.test(dateStr)) continue;

    // Convert YYYYMMDD to YYYY-MM-DD
    const date = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

    records.push({ date, symbol, quantity, price });
  }

  return records;
}

/**
 * Fetch and cache a single FTD file.
 */
async function fetchFtdFile(urlInfo) {
  mkdirSync(FTD_CACHE_DIR, { recursive: true });
  const cacheFile = resolve(FTD_CACHE_DIR, `${urlInfo.period}.json`);

  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, 'utf-8'));
  }

  let res;
  try {
    // Try the zip URL first — we'll need to handle zip or try text
    // For simplicity, try the direct text URL pattern
    const textUrl = urlInfo.url.replace('.zip', '.txt');
    res = await fetchWithRetry(textUrl, {}, { minIntervalMs: 500 });
  } catch {
    try {
      // Fallback to the zip URL
      res = await fetchWithRetry(urlInfo.url, {}, { minIntervalMs: 500 });
    } catch { return []; }
  }

  if (!res.ok) return [];

  const text = await res.text();
  const records = parseFtdText(text);

  // Cache parsed results
  writeFileSync(cacheFile, JSON.stringify(records));
  return records;
}

/**
 * Get FTD time series for a specific ticker.
 * Returns array of { date, quantity, price } sorted chronologically.
 */
export async function fetchFTDSeries(ticker, { startDate = '2018-01-01', endDate = '2026-01-01' } = {}) {
  const urls = generateFtdUrls(startDate, endDate);
  const allRecords = [];

  for (const urlInfo of urls) {
    try {
      const records = await fetchFtdFile(urlInfo);
      const matching = records.filter(r => r.symbol === ticker);
      allRecords.push(...matching);
    } catch { /* skip failed files */ }
  }

  // Aggregate by date (sum quantities across settlement dates within a period)
  const byDate = {};
  for (const r of allRecords) {
    if (!byDate[r.date]) {
      byDate[r.date] = { date: r.date, quantity: 0, price: r.price };
    }
    byDate[r.date].quantity += r.quantity;
    if (r.price && !byDate[r.date].price) byDate[r.date].price = r.price;
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch and store FTD data for a company.
 */
export async function fetchAndStoreFTD(ticker, { beforeDate = null, trailingYears = 3 } = {}) {
  const end = beforeDate || '2026-01-01';
  const startD = new Date(end);
  startD.setFullYear(startD.getFullYear() - trailingYears);

  const series = await fetchFTDSeries(ticker, {
    startDate: startD.toISOString().split('T')[0],
    endDate: end,
  });

  if (series.length === 0) return { dataPoints: 0 };

  // Aggregate to monthly for storage efficiency
  const byMonth = {};
  for (const r of series) {
    const month = r.date.slice(0, 7);
    if (!byMonth[month]) {
      byMonth[month] = { total_ftd_shares: 0, days_with_ftds: 0, max_daily_ftd: 0 };
    }
    byMonth[month].total_ftd_shares += r.quantity;
    byMonth[month].days_with_ftds++;
    byMonth[month].max_daily_ftd = Math.max(byMonth[month].max_daily_ftd, r.quantity);
  }

  const monthlySeries = Object.entries(byMonth).map(([month, data]) => ({
    date: `${month}-15`, // Mid-month as representative date
    ...data,
  })).sort((a, b) => a.date.localeCompare(b.date));

  const record = warehouse.createRecord({
    company: ticker,
    data_type: 'short_interest', // Store under same type, different source
    source: 'sec_ftd',
    source_url: 'https://www.sec.gov/data/foiadocsfailsdatahtm',
    publication_date: monthlySeries[monthlySeries.length - 1].date,
    content: {
      monthly_series: monthlySeries,
      daily_series: series.slice(-60), // Keep last 60 daily entries
      data_points: series.length,
      monthly_data_points: monthlySeries.length,
    },
    metadata: {
      data_points: series.length,
      monthly_data_points: monthlySeries.length,
      start_date: series[0].date,
      end_date: series[series.length - 1].date,
      is_ftd_data: true,
    },
  });

  warehouse.storeRecord(record);
  return { dataPoints: series.length, months: monthlySeries.length };
}

export default {
  fetchFTDSeries,
  fetchAndStoreFTD,
  generateFtdUrls,
};
