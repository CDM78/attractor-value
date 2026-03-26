// Shared utilities for all connectors.
// Rate-limited fetch, CIK cache, and common helpers.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { createHash } from 'crypto';

const CALIBRATION_ROOT = resolve(import.meta.dirname, '../..');
const CONFIG_PATH = join(CALIBRATION_ROOT, 'config', 'connectors.json');
const CIK_CACHE_PATH = join(CALIBRATION_ROOT, 'warehouse', 'macro', 'cik-cache.json');

// ============================================================
// CONFIGURATION
// ============================================================

let _config = null;

export function getConfig() {
  if (!_config) {
    _config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
  return _config;
}

export function getEdgarHeaders() {
  const config = getConfig();
  return {
    'User-Agent': config.edgar.user_agent,
    'Accept-Encoding': 'gzip, deflate',
    'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
  };
}

// ============================================================
// RATE-LIMITED FETCH
// ============================================================

let _lastFetchTime = 0;

/**
 * Fetch with rate limiting and retry logic.
 * @param {string} url
 * @param {object} opts - fetch options
 * @param {object} rateOpts - { minIntervalMs, maxRetries, retryDelayMs }
 */
export async function fetchWithRetry(url, opts = {}, { minIntervalMs = 110, maxRetries = 3, retryDelayMs = 1000 } = {}) {
  // Enforce rate limit
  const now = Date.now();
  const elapsed = now - _lastFetchTime;
  if (elapsed < minIntervalMs) {
    await sleep(minIntervalMs - elapsed);
  }

  // Merge default headers
  const headers = {
    ...getEdgarHeaders(),
    ...(opts.headers || {}),
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      _lastFetchTime = Date.now();
      const response = await fetch(url, { ...opts, headers });

      // Rate limited by SEC
      if (response.status === 429) {
        const wait = retryDelayMs * Math.pow(2, attempt);
        console.warn(`  Rate limited (429) on ${url}, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const wait = retryDelayMs * Math.pow(2, attempt);
        await sleep(wait);
      }
    }
  }
  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

/**
 * Fetch with a specific rate limit (requests per second).
 */
export async function fetchRateLimited(url, opts = {}, rps = 5) {
  const minInterval = Math.ceil(1000 / rps);
  return fetchWithRetry(url, opts, { minIntervalMs: minInterval });
}

// ============================================================
// CIK CACHE
// ============================================================

let _cikCache = null;

/**
 * Load or build the CIK cache (ticker → CIK mapping).
 * Uses SEC's company_tickers.json endpoint.
 */
export async function ensureCikCache() {
  if (_cikCache) return _cikCache;

  // Try to load from disk first
  if (existsSync(CIK_CACHE_PATH)) {
    try {
      _cikCache = JSON.parse(readFileSync(CIK_CACHE_PATH, 'utf-8'));
      if (Object.keys(_cikCache).length > 100) return _cikCache;
    } catch {}
  }

  // Fetch fresh from SEC
  console.log('  Fetching CIK cache from SEC...');
  try {
    const res = await fetchWithRetry('https://www.sec.gov/files/company_tickers.json');
    if (res.ok) {
      const data = await res.json();
      _cikCache = {};
      for (const entry of Object.values(data)) {
        const ticker = entry.ticker?.toUpperCase();
        if (ticker) {
          _cikCache[ticker] = {
            cik: entry.cik_str,
            name: entry.title,
          };
        }
      }

      // Also build from universe cases
      try {
        const universePath = join(CALIBRATION_ROOT, 'cases', 'universe.json');
        if (existsSync(universePath)) {
          const universe = JSON.parse(readFileSync(universePath, 'utf-8'));
          for (const c of Object.values(universe.cases || {})) {
            if (c.ticker && c.cik && !_cikCache[c.ticker]) {
              _cikCache[c.ticker] = {
                cik: c.cik.replace(/^0+/, ''),
                name: c.company_name,
              };
            }
          }
        }
      } catch {}

      // Save cache
      const dir = dirname(CIK_CACHE_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(CIK_CACHE_PATH, JSON.stringify(_cikCache, null, 2));
      console.log(`  CIK cache: ${Object.keys(_cikCache).length} tickers`);
    }
  } catch (err) {
    console.warn('  Failed to fetch CIK cache from SEC:', err.message);
    // Fallback: build from universe only
    _cikCache = {};
    try {
      const universePath = join(CALIBRATION_ROOT, 'cases', 'universe.json');
      if (existsSync(universePath)) {
        const universe = JSON.parse(readFileSync(universePath, 'utf-8'));
        for (const c of Object.values(universe.cases || {})) {
          if (c.ticker && c.cik) {
            _cikCache[c.ticker] = {
              cik: c.cik.replace(/^0+/, ''),
              name: c.company_name,
            };
          }
        }
      }
    } catch {}
  }

  return _cikCache;
}

/**
 * Get CIK for a ticker.
 */
export function getCikForTicker(ticker) {
  if (!_cikCache) throw new Error('CIK cache not loaded — call ensureCikCache() first');
  const entry = _cikCache[ticker.toUpperCase()];
  return entry?.cik || null;
}

/**
 * Get CIK as a numeric string (no leading zeros).
 */
export function getCikNumeric(ticker) {
  const cik = getCikForTicker(ticker);
  return cik ? String(parseInt(cik, 10)) : null;
}

/**
 * Get CIK zero-padded to 10 digits.
 */
export function getCikPadded(ticker) {
  const cik = getCikNumeric(ticker);
  return cik ? cik.padStart(10, '0') : null;
}

/**
 * Get company name for a ticker from CIK cache.
 */
export function getCompanyName(ticker) {
  if (!_cikCache) return null;
  const entry = _cikCache[ticker.toUpperCase()];
  return entry?.name || null;
}

// ============================================================
// EDGAR SUBMISSIONS (with older filing pages)
// ============================================================

/**
 * Fetch all EDGAR submissions for a company, including older filing pages.
 * The SEC splits filings: recent filings in data.filings.recent,
 * older filings in separate JSON files listed in data.filings.files.
 *
 * @param {string} cikPadded - 10-digit zero-padded CIK
 * @param {string} beforeDate - Only return filings before this date
 * @param {string[]} formTypes - Filing types to include (e.g., ['10-K', '10-K/A'])
 * @param {number} maxFilings - Max results
 */
export async function fetchEdgarSubmissions(cikPadded, beforeDate, formTypes, maxFilings = 10) {
  const url = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;
  let res;
  try {
    res = await fetchWithRetry(url);
  } catch { return []; }
  if (!res.ok) return [];

  const data = await res.json();
  const cik = cikPadded.replace(/^0+/, '');

  // Collect filings from recent
  const filings = [];
  const recent = data.filings?.recent;
  if (recent) {
    extractFilings(recent, filings, formTypes, beforeDate, cik);
  }

  // If we have enough, return early
  if (filings.length >= maxFilings) return filings.slice(0, maxFilings);

  // Fetch older filing pages if needed
  const olderFiles = data.filings?.files || [];
  for (const file of olderFiles) {
    if (filings.length >= maxFilings) break;

    try {
      const olderUrl = `https://data.sec.gov/submissions/${file.name}`;
      const olderRes = await fetchWithRetry(olderUrl);
      if (!olderRes.ok) continue;
      const olderData = await olderRes.json();
      extractFilings(olderData, filings, formTypes, beforeDate, cik);
    } catch {}
  }

  return filings.slice(0, maxFilings);
}

function extractFilings(submissionData, filings, formTypes, beforeDate, cik) {
  const forms = submissionData.form || [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!formTypes.includes(form)) continue;

    const filingDate = submissionData.filingDate?.[i];
    const accession = submissionData.accessionNumber?.[i];
    const primaryDoc = submissionData.primaryDocument?.[i];
    const reportDate = submissionData.reportDate?.[i] || filingDate;
    const description = submissionData.primaryDocDescription?.[i] || '';

    if (!filingDate || !accession || filingDate >= beforeDate) continue;

    filings.push({
      form,
      filing_date: filingDate,
      accession,
      primary_doc: primaryDoc,
      report_date: reportDate,
      description,
      cik,
    });
  }
}

// ============================================================
// HTML PARSING HELPERS
// ============================================================

/**
 * Strip HTML tags, decode entities, normalize whitespace.
 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    // Remove style and script blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Replace common block elements with newlines
    .replace(/<\/?(?:div|p|br|h[1-6]|li|tr|td|th|table|blockquote|pre|hr)[^>]*>/gi, '\n')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#\d+;/g, ' ')
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * SHA-256 hash of content string.
 */
export function sha256(content) {
  return 'sha256:' + createHash('sha256').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex');
}

// ============================================================
// HELPERS
// ============================================================

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function writeJSON(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export default {
  fetchWithRetry,
  fetchRateLimited,
  fetchEdgarSubmissions,
  ensureCikCache,
  getCikForTicker,
  getCikNumeric,
  getCikPadded,
  getCompanyName,
  getConfig,
  getEdgarHeaders,
  stripHtml,
  sha256,
  sleep,
  ensureDir,
  readJSON,
  writeJSON,
  progressBar,
};

export function progressBar(current, total, label = '') {
  const pct = ((current / total) * 100).toFixed(0);
  const bar = '█'.repeat(Math.floor(current / total * 30)) + '░'.repeat(30 - Math.floor(current / total * 30));
  process.stdout.write(`\r  [${bar}] ${pct}% (${current}/${total}) ${label}    `);
  if (current === total) console.log('');
}
