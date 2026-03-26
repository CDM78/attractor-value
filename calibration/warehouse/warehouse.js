// Data Warehouse — storage, retrieval, and indexing for calibration data.
// All data goes through this module. No direct file access from test scripts.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { createHash } from 'crypto';

const WAREHOUSE_ROOT = resolve(import.meta.dirname);
const COMPANIES_DIR = join(WAREHOUSE_ROOT, 'companies');
const MACRO_DIR = join(WAREHOUSE_ROOT, 'macro');
const INDEX_DIR = join(WAREHOUSE_ROOT, 'index');

// ============================================================
// INTERNAL HELPERS
// ============================================================

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJSON(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function sha256(content) {
  return 'sha256:' + createHash('sha256').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex');
}

// ============================================================
// DATA RECORD CREATION
// ============================================================

/**
 * Create a standard warehouse data record.
 * Every piece of data in the warehouse must go through this.
 */
export function createRecord({ company, data_type, source, source_url, publication_date, content, metadata = {}, fiscal_period = null }) {
  if (!company) throw new Error('Record requires company');
  if (!data_type) throw new Error('Record requires data_type');
  if (!source) throw new Error('Record requires source');
  if (!publication_date) throw new Error('Record requires publication_date — cannot store undated data');

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publication_date)) {
    throw new Error(`publication_date must be YYYY-MM-DD, got: ${publication_date}`);
  }

  return {
    company,
    data_type,
    source,
    source_url: source_url || null,
    publication_date,
    fiscal_period,
    acquired_date: new Date().toISOString().split('T')[0],
    content,
    content_hash: sha256(content),
    metadata,
  };
}

// ============================================================
// STORAGE — COMPANY DATA
// ============================================================

// Data type → subdirectory mapping
const DATA_TYPE_PATHS = {
  '10k_full': 'filings/10-K',
  '10k_risk_factors': 'filings/10-K',
  '10k_mda': 'filings/10-K',
  '10q_mda': 'filings/10-Q',
  '10q_financials': 'filings/10-Q',
  '8k': 'filings/8-K',
  'proxy': 'filings/DEF-14A',
  'form4': 'filings/Form-4',
  'earnings_transcript': 'transcripts/earnings',
  'investor_day_transcript': 'transcripts/investor-day',
  'patents': 'patents',
  'news': 'news',
  'sec_comment_letters': 'regulatory/sec-comment-letters',
  'court_cases': 'regulatory/court-cases',
  'agency_actions': 'regulatory/agency-actions',
  'reddit_mentions': 'alternative/reddit-mentions',
  'government_contracts': 'alternative/government-contracts',
  'import_export': 'alternative/import-export',
  'discovered': 'alternative/discovered',
  'short_interest': 'alternative/short-interest',
  'institutional_ownership': 'market/institutional-ownership',
};

function getStoragePath(company, data_type, publication_date, suffix = '') {
  const subdir = DATA_TYPE_PATHS[data_type] || `other/${data_type}`;
  const dir = join(COMPANIES_DIR, company, subdir);
  const filename = suffix ? `${publication_date}_${suffix}.json` : `${publication_date}.json`;
  return join(dir, filename);
}

/**
 * Store a data record in the warehouse.
 * Returns the file path where it was stored.
 */
export function storeRecord(record) {
  const suffix = record.fiscal_period || '';
  const path = getStoragePath(record.company, record.data_type, record.publication_date, suffix);
  ensureDir(dirname(path));
  writeJSON(path, record);

  // Update indexes
  updateTemporalIndex(record);
  updateAcquisitionLog(record);

  return path;
}

/**
 * Store multiple records efficiently (batch index update).
 */
export function storeRecordsBatch(records) {
  const paths = [];
  for (const record of records) {
    const suffix = record.fiscal_period || '';
    const path = getStoragePath(record.company, record.data_type, record.publication_date, suffix);
    ensureDir(dirname(path));
    writeJSON(path, record);
    paths.push(path);
  }
  // Batch index update
  rebuildIndexes();
  return paths;
}

// ============================================================
// STORAGE — MACRO DATA
// ============================================================

/**
 * Store macro economic data (FRED, FINRA, market).
 */
export function storeMacroData(category, subcategory, data) {
  const path = join(MACRO_DIR, category, `${subcategory}.json`);
  writeJSON(path, data);
  return path;
}

export function loadMacroData(category, subcategory) {
  const path = join(MACRO_DIR, category, `${subcategory}.json`);
  return readJSON(path);
}

// ============================================================
// COMPANY METADATA
// ============================================================

/**
 * Store or update company metadata (CIK, GICS, SIC, key dates).
 */
export function storeCompanyMeta(ticker, meta) {
  const path = join(COMPANIES_DIR, ticker, 'meta.json');
  const existing = readJSON(path) || {};
  writeJSON(path, { ...existing, ...meta, ticker, updated: new Date().toISOString() });
}

export function loadCompanyMeta(ticker) {
  return readJSON(join(COMPANIES_DIR, ticker, 'meta.json'));
}

// ============================================================
// QUERYING
// ============================================================

/**
 * Query all records for a company of a given data type,
 * optionally filtered by date range.
 *
 * This is the RAW query — does NOT enforce temporal integrity.
 * Use the Temporal Integrity Engine's getDataForCase() instead.
 */
export function queryCompanyData(ticker, data_type, { before = null, after = null } = {}) {
  const subdir = DATA_TYPE_PATHS[data_type] || `other/${data_type}`;
  const dir = join(COMPANIES_DIR, ticker, subdir);

  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const results = [];

  for (const file of files) {
    const record = readJSON(join(dir, file));
    if (!record || !record.publication_date) continue;

    if (before && record.publication_date > before) continue;
    if (after && record.publication_date < after) continue;

    results.push(record);
  }

  // Sort by publication date ascending
  results.sort((a, b) => a.publication_date.localeCompare(b.publication_date));
  return results;
}

/**
 * Query ALL data types for a company before a given date.
 * Returns { data_type: [records] }.
 */
export function queryAllCompanyData(ticker, { before = null } = {}) {
  const companyDir = join(COMPANIES_DIR, ticker);
  if (!existsSync(companyDir)) return {};

  const results = {};
  for (const [dataType] of Object.entries(DATA_TYPE_PATHS)) {
    const records = queryCompanyData(ticker, dataType, { before });
    if (records.length > 0) {
      results[dataType] = records;
    }
  }
  return results;
}

/**
 * Query macro data before a given date.
 */
export function queryMacroData(category, subcategory, { before = null } = {}) {
  const data = loadMacroData(category, subcategory);
  if (!data) return null;

  // If data is an object keyed by date
  if (!Array.isArray(data) && typeof data === 'object') {
    if (!before) return data;
    const filtered = {};
    for (const [date, value] of Object.entries(data)) {
      if (date <= before) filtered[date] = value;
    }
    return filtered;
  }

  // If data is an array of records with date/publication_date field
  if (Array.isArray(data)) {
    if (!before) return data;
    return data.filter(r => {
      const d = r.publication_date || r.date;
      return d && d <= before;
    });
  }

  return data;
}

/**
 * Raw unfiltered query — for debugging ONLY.
 * Logs a WARNING and marks any test using it as CONTAMINATED.
 */
export function rawQuery(ticker, data_type) {
  console.warn(`⚠️  RAW QUERY on ${ticker}/${data_type} — results may contain future data. Any test using this is CONTAMINATED.`);
  return queryCompanyData(ticker, data_type);
}

// ============================================================
// INDEXING
// ============================================================

/**
 * Update the temporal index with a new record.
 */
function updateTemporalIndex(record) {
  const indexPath = join(INDEX_DIR, 'temporal-index.json');
  const index = readJSON(indexPath) || {};

  const key = `${record.company}|${record.data_type}`;
  if (!index[key]) {
    index[key] = { company: record.company, data_type: record.data_type, dates: [] };
  }
  if (!index[key].dates.includes(record.publication_date)) {
    index[key].dates.push(record.publication_date);
    index[key].dates.sort();
  }

  writeJSON(indexPath, index);
}

/**
 * Update the acquisition log.
 */
function updateAcquisitionLog(record) {
  const logPath = join(INDEX_DIR, 'acquisition-log.json');
  const log = readJSON(logPath) || [];

  log.push({
    company: record.company,
    data_type: record.data_type,
    publication_date: record.publication_date,
    source: record.source,
    acquired_date: record.acquired_date,
    content_hash: record.content_hash,
  });

  // Keep log manageable — only write last 10000 entries to main log
  if (log.length > 10000) {
    const archivePath = join(INDEX_DIR, `acquisition-log-archive-${Date.now()}.json`);
    writeJSON(archivePath, log.slice(0, log.length - 10000));
    writeJSON(logPath, log.slice(-10000));
  } else {
    writeJSON(logPath, log);
  }
}

/**
 * Rebuild all indexes from warehouse contents.
 * Use after batch imports.
 */
export function rebuildIndexes() {
  const temporalIndex = {};
  const coverageMatrix = {};
  const acquisitionLog = [];

  if (!existsSync(COMPANIES_DIR)) {
    writeJSON(join(INDEX_DIR, 'temporal-index.json'), temporalIndex);
    writeJSON(join(INDEX_DIR, 'coverage-matrix.json'), coverageMatrix);
    return;
  }

  const tickers = readdirSync(COMPANIES_DIR).filter(f => {
    try { return statSync(join(COMPANIES_DIR, f)).isDirectory(); } catch { return false; }
  });

  for (const ticker of tickers) {
    coverageMatrix[ticker] = {};

    for (const [dataType, subdir] of Object.entries(DATA_TYPE_PATHS)) {
      const dir = join(COMPANIES_DIR, ticker, subdir);
      if (!existsSync(dir)) continue;

      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      if (files.length === 0) continue;

      const dates = [];
      for (const file of files) {
        const record = readJSON(join(dir, file));
        if (record && record.publication_date) {
          dates.push(record.publication_date);
          acquisitionLog.push({
            company: ticker,
            data_type: dataType,
            publication_date: record.publication_date,
            source: record.source,
            acquired_date: record.acquired_date,
            content_hash: record.content_hash,
          });
        }
      }

      if (dates.length > 0) {
        dates.sort();
        const key = `${ticker}|${dataType}`;
        temporalIndex[key] = { company: ticker, data_type: dataType, dates };
        coverageMatrix[ticker][dataType] = {
          count: dates.length,
          earliest: dates[0],
          latest: dates[dates.length - 1],
        };
      }
    }
  }

  writeJSON(join(INDEX_DIR, 'temporal-index.json'), temporalIndex);
  writeJSON(join(INDEX_DIR, 'coverage-matrix.json'), coverageMatrix);
  writeJSON(join(INDEX_DIR, 'acquisition-log.json'), acquisitionLog);

  return { companies: tickers.length, dataPoints: acquisitionLog.length };
}

// ============================================================
// COVERAGE QUERIES
// ============================================================

/**
 * Get the coverage matrix — which companies have which data types.
 */
export function getCoverageMatrix() {
  return readJSON(join(INDEX_DIR, 'coverage-matrix.json')) || {};
}

/**
 * Get coverage summary for a single company.
 */
export function getCompanyCoverage(ticker) {
  const matrix = getCoverageMatrix();
  return matrix[ticker] || {};
}

/**
 * Get all companies that have a given data type.
 */
export function getCompaniesByDataType(dataType) {
  const matrix = getCoverageMatrix();
  const results = [];
  for (const [ticker, coverage] of Object.entries(matrix)) {
    if (coverage[dataType]) {
      results.push({ ticker, ...coverage[dataType] });
    }
  }
  return results;
}

/**
 * List all companies in the warehouse.
 */
export function listCompanies() {
  if (!existsSync(COMPANIES_DIR)) return [];
  return readdirSync(COMPANIES_DIR).filter(f => {
    try { return statSync(join(COMPANIES_DIR, f)).isDirectory(); } catch { return false; }
  });
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  createRecord,
  storeRecord,
  storeRecordsBatch,
  storeMacroData,
  loadMacroData,
  storeCompanyMeta,
  loadCompanyMeta,
  queryCompanyData,
  queryAllCompanyData,
  queryMacroData,
  rawQuery,
  rebuildIndexes,
  getCoverageMatrix,
  getCompanyCoverage,
  getCompaniesByDataType,
  listCompanies,
  WAREHOUSE_ROOT,
  COMPANIES_DIR,
  MACRO_DIR,
  INDEX_DIR,
};
