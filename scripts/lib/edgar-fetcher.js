// EDGAR companyfacts fetch with local filesystem cache and rate limiting.
// Caches raw JSON responses in data/edgar-cache/ for offline re-runs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve(import.meta.dirname, '../../data');
const CACHE_DIR = resolve(DATA_DIR, 'edgar-cache');
const CIK_CACHE = resolve(DATA_DIR, 'cik-cache.json');
const USER_AGENT = 'AV-Framework charles@bolinandtroy.com';

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 110; // ~9 req/sec, safely under 10/sec limit

async function rateLimitedFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  return res;
}

// Load or fetch CIK mapping: ticker → padded 10-digit CIK
let cikMap = null;

export async function ensureCikCache() {
  if (cikMap) return cikMap;

  if (existsSync(CIK_CACHE)) {
    cikMap = JSON.parse(readFileSync(CIK_CACHE, 'utf-8'));
    return cikMap;
  }

  console.log('Fetching CIK mapping from SEC...');
  const res = await rateLimitedFetch('https://www.sec.gov/files/company_tickers.json');
  if (!res.ok) throw new Error(`CIK fetch failed: ${res.status}`);

  const raw = await res.json();
  // raw is { "0": { cik_str, ticker, title }, "1": { ... }, ... }
  cikMap = {};
  for (const entry of Object.values(raw)) {
    const ticker = entry.ticker?.toUpperCase();
    const cik = String(entry.cik_str).padStart(10, '0');
    if (ticker) cikMap[ticker] = { cik, name: entry.title };
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CIK_CACHE, JSON.stringify(cikMap, null, 2));
  console.log(`  Cached ${Object.keys(cikMap).length} CIK mappings`);
  return cikMap;
}

export function getCikForTicker(ticker) {
  if (!cikMap) throw new Error('Call ensureCikCache() first');
  const entry = cikMap[ticker.toUpperCase()];
  return entry?.cik || null;
}

// Fetch companyfacts for a CIK, with filesystem caching
export async function fetchCompanyFacts(cik, { refresh = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = resolve(CACHE_DIR, `${cik}.json`);

  if (!refresh && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const res = await rateLimitedFetch(url);

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EDGAR fetch for CIK ${cik}: ${res.status}`);

  const data = await res.json();
  writeFileSync(cachePath, JSON.stringify(data));
  return data;
}

// Check if we have cached data for a CIK
export function hasCachedFacts(cik) {
  return existsSync(resolve(CACHE_DIR, `${cik}.json`));
}

// Fetch companyfacts for a ticker (convenience wrapper)
export async function fetchFactsForTicker(ticker, opts = {}) {
  const cik = getCikForTicker(ticker);
  if (!cik) return { ticker, cik: null, facts: null, error: 'No CIK mapping' };

  try {
    const facts = await fetchCompanyFacts(cik, opts);
    return { ticker, cik, facts, error: facts ? null : 'Not found on EDGAR' };
  } catch (e) {
    return { ticker, cik, facts: null, error: e.message };
  }
}
