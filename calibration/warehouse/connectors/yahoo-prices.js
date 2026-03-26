// Yahoo Finance Daily Price Connector
// Pulls adjusted daily close prices for calibration checkpoint computation.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { sleep } from './shared.js';

const WAREHOUSE_ROOT = resolve(import.meta.dirname, '..');
const COMPANIES_DIR = join(WAREHOUSE_ROOT, 'companies');
const MACRO_DIR = join(WAREHOUSE_ROOT, 'macro');

// ============================================================
// YAHOO FINANCE FETCHER
// ============================================================

/**
 * Fetch daily prices from Yahoo Finance chart API.
 * @param {string} symbol - Ticker or ^GSPC
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Array} [{date, close, adjClose, volume}]
 */
async function fetchYahooPrices(symbol, startDate, endDate) {
  const period1 = Math.floor(new Date(startDate).getTime() / 1000);
  const period2 = Math.floor(new Date(endDate).getTime() / 1000) + 86400;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    return [];
  }

  if (!res.ok) return [];

  let data;
  try {
    data = await res.json();
  } catch { return []; }

  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0] || {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose || quotes.close || [];

  const prices = [];
  for (let i = 0; i < timestamps.length; i++) {
    const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    const close = quotes.close?.[i];
    const adj = adjClose[i] || close;
    const vol = quotes.volume?.[i];

    if (close != null && !isNaN(close)) {
      prices.push({ date, close: Math.round(close * 100) / 100, adjClose: Math.round(adj * 100) / 100, volume: vol || 0 });
    }
  }

  return prices;
}

// ============================================================
// CACHING
// ============================================================

function getPricePath(ticker) {
  return join(COMPANIES_DIR, ticker, 'market', 'daily-prices.json');
}

function getSP500Path() {
  return join(MACRO_DIR, 'market', 'sp500-daily.json');
}

function loadCachedPrices(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch { return null; }
}

function savePrices(path, data) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Get daily prices for a company, using cache or fetching from Yahoo.
 * @param {string} ticker
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Array} price records
 */
export async function getCompanyPrices(ticker, startDate, endDate) {
  const path = getPricePath(ticker);
  const cached = loadCachedPrices(path);

  if (cached && cached.prices && cached.prices.length > 0) {
    const cachedStart = cached.prices[0].date;
    const cachedEnd = cached.prices[cached.prices.length - 1].date;
    // Use cache if it covers the needed range
    if (cachedStart <= startDate && cachedEnd >= endDate) {
      return cached.prices.filter(p => p.date >= startDate && p.date <= endDate);
    }
  }

  // Fetch fresh
  await sleep(1100); // Rate limit: 1 req/sec
  const prices = await fetchYahooPrices(ticker, startDate, endDate);

  if (prices.length > 0) {
    // Merge with cache if exists
    let allPrices = prices;
    if (cached?.prices) {
      const dateSet = new Set(prices.map(p => p.date));
      const extra = cached.prices.filter(p => !dateSet.has(p.date));
      allPrices = [...extra, ...prices].sort((a, b) => a.date.localeCompare(b.date));
    }
    savePrices(path, { ticker, updated: new Date().toISOString(), prices: allPrices });
  }

  return prices;
}

/**
 * Get S&P 500 daily levels, cached.
 */
export async function getSP500Prices(startDate, endDate) {
  const path = getSP500Path();
  const cached = loadCachedPrices(path);

  if (cached && cached.prices && cached.prices.length > 0) {
    const cachedStart = cached.prices[0].date;
    const cachedEnd = cached.prices[cached.prices.length - 1].date;
    if (cachedStart <= startDate && cachedEnd >= endDate) {
      return cached.prices.filter(p => p.date >= startDate && p.date <= endDate);
    }
  }

  await sleep(1100);
  const prices = await fetchYahooPrices('^GSPC', startDate, endDate);

  if (prices.length > 0) {
    let allPrices = prices;
    if (cached?.prices) {
      const dateSet = new Set(prices.map(p => p.date));
      const extra = cached.prices.filter(p => !dateSet.has(p.date));
      allPrices = [...extra, ...prices].sort((a, b) => a.date.localeCompare(b.date));
    }
    savePrices(path, { symbol: '^GSPC', updated: new Date().toISOString(), prices: allPrices });
  }

  return prices;
}

/**
 * Find the adjusted close price on or before a given date.
 */
export function getPriceOnDate(prices, targetDate) {
  if (!prices || prices.length === 0) return null;
  // Binary search for closest date <= targetDate
  let lo = 0, hi = prices.length - 1;
  if (prices[0].date > targetDate) return null;
  if (prices[hi].date <= targetDate) return prices[hi];

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (prices[mid].date <= targetDate) lo = mid;
    else hi = mid - 1;
  }
  return prices[lo];
}

export default {
  getCompanyPrices,
  getSP500Prices,
  getPriceOnDate,
  fetchYahooPrices,
};
