// Temporal Integrity Engine
// The ONLY sanctioned way to retrieve data for case evaluation.
// Enforces publication_date <= entry_date at the infrastructure level.
// No individual test script can bypass this.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import warehouse from './warehouse.js';

const CALIBRATION_ROOT = resolve(import.meta.dirname, '..');
const AUDIT_DIR = join(CALIBRATION_ROOT, 'tests', 'audit');
const CASES_DIR = join(CALIBRATION_ROOT, 'cases');

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

// ============================================================
// CASE LOADING
// ============================================================

let _universeCache = null;

function loadUniverse() {
  if (_universeCache) return _universeCache;
  const path = join(CASES_DIR, 'universe.json');
  _universeCache = readJSON(path);
  return _universeCache;
}

export function clearCache() {
  _universeCache = null;
}

export function loadCase(caseId) {
  const universe = loadUniverse();
  if (!universe) throw new Error('Universe not loaded — run case import first');
  const c = universe.cases ? universe.cases[caseId] : universe[caseId];
  if (!c) throw new Error(`Case ${caseId} not found in universe`);
  return c;
}

// ============================================================
// AUDIT TRAIL
// ============================================================

class AuditTrail {
  constructor(testId) {
    this.testId = testId;
    this.accesses = [];
    this.violations = [];
    this.warnings = [];
    this.started = new Date().toISOString();
  }

  recordAccess({ caseId, entryDate, dataTypesRequested, latestDataDate, gapDays }) {
    this.accesses.push({
      caseId,
      entryDate,
      dataTypesRequested,
      latestDataDate,
      gapDays,
      timestamp: new Date().toISOString(),
    });
  }

  recordViolation({ caseId, entryDate, dataType, offendingDate }) {
    this.violations.push({
      caseId,
      entryDate,
      dataType,
      offendingDate,
      timestamp: new Date().toISOString(),
    });
  }

  recordWarning(message) {
    this.warnings.push({ message, timestamp: new Date().toISOString() });
  }

  isClean() {
    return this.violations.length === 0;
  }

  getReport() {
    let latestDataUsed = null;
    let latestGap = null;
    for (const a of this.accesses) {
      if (a.latestDataDate && (!latestDataUsed || a.latestDataDate > latestDataUsed)) {
        latestDataUsed = a.latestDataDate;
        latestGap = a.gapDays;
      }
    }

    return {
      testId: this.testId,
      started: this.started,
      completed: new Date().toISOString(),
      casesEvaluated: new Set(this.accesses.map(a => a.caseId)).size,
      dataAccesses: this.accesses.length,
      violations: this.violations.length,
      warnings: this.warnings.length,
      latestDataPointUsed: latestDataUsed,
      latestGapDays: latestGap,
      allDataStrictlyPreEntry: this.violations.length === 0,
      contaminated: this.violations.length > 0,
    };
  }

  save() {
    ensureDir(AUDIT_DIR);
    const path = join(AUDIT_DIR, `${this.testId}.json`);
    writeJSON(path, {
      report: this.getReport(),
      accesses: this.accesses,
      violations: this.violations,
      warnings: this.warnings,
    });
    return path;
  }

  printReport() {
    const r = this.getReport();
    console.log('\nTEMPORAL AUDIT REPORT');
    console.log('=====================');
    console.log(`Test: ${r.testId}`);
    console.log(`Cases evaluated: ${r.casesEvaluated}`);
    console.log(`Data accesses: ${r.dataAccesses}`);
    console.log(`Violations: ${r.violations}`);
    console.log(`Warnings: ${r.warnings}`);
    if (r.latestDataPointUsed) {
      console.log(`Latest data point used: ${r.latestDataPointUsed} (gap: ${r.latestGapDays} days)`);
    }
    console.log(`All data strictly pre-entry: ${r.allDataStrictlyPreEntry ? 'YES' : 'NO ❌'}`);
    if (r.contaminated) {
      console.log('⚠️  TEST RESULTS ARE CONTAMINATED — future data was accessed');
    }
    console.log('');
  }
}

// ============================================================
// CORE API — The ONLY way to get data for evaluation
// ============================================================

// Active audit trails keyed by testId
const activeAudits = new Map();

/**
 * Start an audit trail for a test.
 * Must be called before getDataForCase.
 */
export function startAudit(testId) {
  const audit = new AuditTrail(testId);
  activeAudits.set(testId, audit);
  return audit;
}

/**
 * End an audit trail and save the report.
 */
export function endAudit(testId) {
  const audit = activeAudits.get(testId);
  if (!audit) throw new Error(`No active audit for test ${testId}`);
  audit.save();
  audit.printReport();
  activeAudits.delete(testId);
  return audit.getReport();
}

function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function maxDate(results) {
  let max = null;
  for (const records of Object.values(results)) {
    if (!Array.isArray(records)) continue;
    for (const r of records) {
      if (r.publication_date && (!max || r.publication_date > max)) {
        max = r.publication_date;
      }
    }
  }
  return max;
}

/**
 * Get data for a case — THE primary API.
 * Enforces temporal integrity: no data after entry_date.
 *
 * @param {string} caseId - Case ID from universe
 * @param {string[]} dataTypes - Array of data types to retrieve
 * @param {string} [testId] - Test ID for audit trail (required for formal tests)
 * @returns {Object} { data_type: [records] }
 */
export function getDataForCase(caseId, dataTypes, testId = null) {
  const caseRecord = loadCase(caseId);
  const entryDate = caseRecord.entry_date;
  const ticker = caseRecord.ticker;

  if (!entryDate) throw new Error(`Case ${caseId} has no entry_date`);
  if (!ticker) throw new Error(`Case ${caseId} has no ticker`);

  const results = {};
  for (const type of dataTypes) {
    const records = warehouse.queryCompanyData(ticker, type, { before: entryDate });

    // Double-check temporal integrity (defense in depth)
    const clean = [];
    for (const r of records) {
      if (r.publication_date > entryDate) {
        // VIOLATION — this should never happen if queryCompanyData works correctly
        const audit = testId ? activeAudits.get(testId) : null;
        if (audit) {
          audit.recordViolation({
            caseId, entryDate, dataType: type, offendingDate: r.publication_date,
          });
        }
        console.error(`❌ TEMPORAL VIOLATION: ${ticker}/${type} date ${r.publication_date} > entry ${entryDate}`);
        continue;
      }
      clean.push(r);
    }
    results[type] = clean;
  }

  // Log for audit trail
  const audit = testId ? activeAudits.get(testId) : null;
  if (audit) {
    const latest = maxDate(results);
    audit.recordAccess({
      caseId,
      entryDate,
      dataTypesRequested: dataTypes,
      latestDataDate: latest,
      gapDays: latest ? daysBetween(latest, entryDate) : null,
    });
  }

  return results;
}

/**
 * Get data for a sell checkpoint (monitoring a held position).
 * Same temporal enforcement but uses checkpointDate instead of entry_date.
 */
export function getDataForSellCheckpoint(caseId, checkpointDate, dataTypes, testId = null) {
  const caseRecord = loadCase(caseId);

  if (checkpointDate <= caseRecord.entry_date) {
    throw new Error(`Checkpoint ${checkpointDate} must be after entry ${caseRecord.entry_date}`);
  }

  const ticker = caseRecord.ticker;
  const results = {};

  for (const type of dataTypes) {
    const records = warehouse.queryCompanyData(ticker, type, { before: checkpointDate });
    // Same defense-in-depth filtering
    results[type] = records.filter(r => r.publication_date <= checkpointDate);
  }

  const audit = testId ? activeAudits.get(testId) : null;
  if (audit) {
    const latest = maxDate(results);
    audit.recordAccess({
      caseId,
      entryDate: checkpointDate,
      dataTypesRequested: dataTypes,
      latestDataDate: latest,
      gapDays: latest ? daysBetween(latest, checkpointDate) : null,
    });
  }

  return results;
}

/**
 * Get macro data for a case (FRED, FINRA, market).
 * Enforced to entry_date.
 */
export function getMacroDataForCase(caseId, categories, testId = null) {
  const caseRecord = loadCase(caseId);
  const entryDate = caseRecord.entry_date;

  const results = {};
  for (const cat of categories) {
    results[cat] = warehouse.queryMacroData(cat.split('/')[0], cat.split('/')[1] || 'all', { before: entryDate });
  }

  return results;
}

// ============================================================
// CONVENIENCE — Get everything available for a case
// ============================================================

/**
 * Get all available data for a case, respecting temporal integrity.
 * Returns { company_data: { type: [records] }, macro_data: { ... }, coverage: { ... } }
 */
export function getFullCasePackage(caseId, testId = null) {
  const caseRecord = loadCase(caseId);
  const ticker = caseRecord.ticker;
  const entryDate = caseRecord.entry_date;

  // Get all company data
  const allData = warehouse.queryAllCompanyData(ticker, { before: entryDate });

  // Defense-in-depth: filter each
  const companyData = {};
  for (const [type, records] of Object.entries(allData)) {
    companyData[type] = records.filter(r => r.publication_date <= entryDate);
  }

  // Build coverage summary
  const coverage = {};
  for (const [type, records] of Object.entries(companyData)) {
    coverage[type] = {
      count: records.length,
      earliest: records[0]?.publication_date,
      latest: records[records.length - 1]?.publication_date,
    };
  }

  // Get macro data
  const fredData = warehouse.queryMacroData('fred', 'economic-context', { before: entryDate });
  const finraData = warehouse.queryMacroData('finra', 'short-interest', { before: entryDate });

  return {
    case: caseRecord,
    company_data: companyData,
    macro: { fred: fredData, finra: finraData },
    coverage,
  };
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  loadCase,
  clearCache,
  startAudit,
  endAudit,
  getDataForCase,
  getDataForSellCheckpoint,
  getMacroDataForCase,
  getFullCasePackage,
};
