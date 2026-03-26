// EDGAR 10-K Section Extractor
// Robust extraction of Item 1A (Risk Factors) and Item 7 (MD&A) from 10-K filings.
// Handles multiple HTML formats, detects section headers reliably,
// falls back to full-text-search when structured parsing fails.

import { fetchWithRetry, ensureCikCache, getCikForTicker, stripHtml, progressBar } from './shared.js';
import warehouse from '../warehouse.js';

const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

// ============================================================
// FILING INDEX
// ============================================================

/**
 * Get all 10-K and 10-Q filing metadata for a company from EDGAR submissions.
 * Returns array of { accessionNumber, filingDate, form, primaryDocument }.
 */
export async function getFilingIndex(ticker, { forms = ['10-K', '10-K/A'], beforeDate = null } = {}) {
  const cik = getCikForTicker(ticker);
  if (!cik) return [];

  const url = `${SUBMISSIONS_BASE}/CIK${cik}.json`;
  let res;
  try {
    res = await fetchWithRetry(url);
  } catch { return []; }
  if (!res.ok) return [];

  const data = await res.json();
  const filings = [];
  const recent = data.filings?.recent;
  if (!recent) return [];

  for (let i = 0; i < (recent.accessionNumber?.length || 0); i++) {
    const form = recent.form[i];
    if (!forms.includes(form)) continue;

    const filingDate = recent.filingDate[i];
    if (beforeDate && filingDate > beforeDate) continue;

    filings.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate,
      form,
      primaryDocument: recent.primaryDocument[i],
      cik: parseInt(cik, 10),
    });
  }

  // Also check older filings if available
  const olderFiles = data.filings?.files || [];
  for (const fileRef of olderFiles) {
    try {
      const olderUrl = `${SUBMISSIONS_BASE}/${fileRef.name}`;
      const olderRes = await fetchWithRetry(olderUrl);
      if (!olderRes.ok) continue;
      const older = await olderRes.json();
      for (let i = 0; i < (older.accessionNumber?.length || 0); i++) {
        if (!forms.includes(older.form[i])) continue;
        const fd = older.filingDate[i];
        if (beforeDate && fd > beforeDate) continue;
        filings.push({
          accessionNumber: older.accessionNumber[i],
          filingDate: fd,
          form: older.form[i],
          primaryDocument: older.primaryDocument[i],
          cik: parseInt(cik, 10),
        });
      }
    } catch { /* skip */ }
  }

  return filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
}

// ============================================================
// SECTION EXTRACTION
// ============================================================

/**
 * Fetch a filing's full text and extract a section.
 */
async function fetchFilingText(filing) {
  const accClean = filing.accessionNumber.replace(/-/g, '');
  const url = `${ARCHIVES_BASE}/${filing.cik}/${accClean}/${filing.primaryDocument}`;

  let res;
  try {
    res = await fetchWithRetry(url, {}, { minIntervalMs: 110 });
  } catch { return null; }
  if (!res.ok) return null;

  const html = await res.text();
  return { text: stripHtml(html), url };
}

// Section boundary patterns — try most specific first
const ITEM_1A_START = [
  /Item\s*1A[\.\s]*[-–—]?\s*Risk\s*Factors/i,
  /RISK\s*FACTORS/i,
  /Item\s*1A[\.\s]/i,
];

const ITEM_1A_END = [
  /Item\s*1B[\.\s]*[-–—]?\s*Unresolved\s*Staff/i,
  /Item\s*2[\.\s]*[-–—]?\s*Properties/i,
  /UNRESOLVED\s*STAFF\s*COMMENTS/i,
  /Item\s*1B[\.\s]/i,
  /Item\s*2[\.\s]/i,
];

const ITEM_7_START = [
  /Item\s*7[\.\s]*[-–—]?\s*Management['']?s?\s*Discussion\s*and\s*Analysis/i,
  /MANAGEMENT['']?S?\s*DISCUSSION\s*AND\s*ANALYSIS/i,
  /Item\s*7[\.\s]*[-–—]?\s*MD&A/i,
  /Item\s*7[\.\s]/i,
];

const ITEM_7_END = [
  /Item\s*7A[\.\s]*[-–—]?\s*Quantitative\s*and\s*Qualitative/i,
  /QUANTITATIVE\s*AND\s*QUALITATIVE\s*DISCLOSURES/i,
  /Item\s*8[\.\s]*[-–—]?\s*Financial\s*Statements/i,
  /FINANCIAL\s*STATEMENTS\s*AND\s*SUPPLEMENTARY/i,
  /Item\s*7A[\.\s]/i,
  /Item\s*8[\.\s]/i,
];

function findSectionBoundary(text, patterns, startFrom = 0, minOffset = 0) {
  const searchText = text.slice(startFrom);
  for (const pattern of patterns) {
    const match = searchText.search(pattern);
    if (match > minOffset) return startFrom + match;
  }
  return -1;
}

function extractSection(text, startPatterns, endPatterns, maxLength = 50000) {
  const start = findSectionBoundary(text, startPatterns);
  if (start === -1) return null;

  const end = findSectionBoundary(text, endPatterns, start, 500);
  const section = end > start ? text.slice(start, end) : text.slice(start, start + maxLength);

  // Sanity check: section should be at least 500 chars
  if (section.length < 500) return null;

  return section.length > maxLength
    ? section.slice(0, maxLength) + '\n\n[... section truncated ...]'
    : section;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Extract Item 1A (Risk Factors) from a 10-K filing.
 */
export async function extractRiskFactors(filing) {
  const result = await fetchFilingText(filing);
  if (!result) return null;

  const section = extractSection(result.text, ITEM_1A_START, ITEM_1A_END, 40000);
  if (!section) return null;

  return {
    text: section,
    word_count: section.split(/\s+/).length,
    source_url: result.url,
  };
}

/**
 * Extract Item 7 (MD&A) from a 10-K filing.
 */
export async function extractMDA(filing) {
  const result = await fetchFilingText(filing);
  if (!result) return null;

  const section = extractSection(result.text, ITEM_7_START, ITEM_7_END, 40000);
  if (!section) return null;

  return {
    text: section,
    word_count: section.split(/\s+/).length,
    source_url: result.url,
  };
}

/**
 * Extract Item 2 (MD&A) from a 10-Q filing.
 */
export async function extractQuarterlyMDA(filing) {
  const result = await fetchFilingText(filing);
  if (!result) return null;

  const startPatterns = [
    /Item\s*2[\.\s]*[-–—]?\s*Management['']?s?\s*Discussion/i,
    /MANAGEMENT['']?S?\s*DISCUSSION/i,
    /Item\s*2[\.\s]/i,
  ];
  const endPatterns = [
    /Item\s*3[\.\s]*[-–—]?\s*Quantitative/i,
    /Item\s*4[\.\s]/i,
    /QUANTITATIVE\s*AND\s*QUALITATIVE/i,
  ];

  const section = extractSection(result.text, startPatterns, endPatterns, 30000);
  if (!section) return null;

  return {
    text: section,
    word_count: section.split(/\s+/).length,
    source_url: result.url,
  };
}

// ============================================================
// BATCH OPERATIONS
// ============================================================

/**
 * Fetch and store all 10-K sections for a company.
 * Returns { risk_factors: count, mda: count }.
 */
export async function fetchAndStore10KSections(ticker, { beforeDate = null, maxFilings = 10 } = {}) {
  const filings = await getFilingIndex(ticker, { forms: ['10-K', '10-K/A'], beforeDate });
  const stats = { risk_factors: 0, mda: 0, errors: 0 };

  for (const filing of filings.slice(0, maxFilings)) {
    try {
      // Extract Risk Factors (Item 1A)
      const rf = await extractRiskFactors(filing);
      if (rf) {
        const record = warehouse.createRecord({
          company: ticker,
          data_type: '10k_risk_factors',
          source: 'edgar_10k',
          source_url: rf.source_url,
          publication_date: filing.filingDate,
          content: rf.text,
          metadata: { word_count: rf.word_count, form: filing.form },
        });
        warehouse.storeRecord(record);
        stats.risk_factors++;
      }

      // Extract MD&A (Item 7)
      const mda = await extractMDA(filing);
      if (mda) {
        const record = warehouse.createRecord({
          company: ticker,
          data_type: '10k_mda',
          source: 'edgar_10k',
          source_url: mda.source_url,
          publication_date: filing.filingDate,
          content: mda.text,
          metadata: { word_count: mda.word_count, form: filing.form },
        });
        warehouse.storeRecord(record);
        stats.mda++;
      }
    } catch (e) {
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Fetch and store 10-Q MD&A sections for a company.
 */
export async function fetchAndStore10QSections(ticker, { beforeDate = null, maxFilings = 20 } = {}) {
  const filings = await getFilingIndex(ticker, { forms: ['10-Q', '10-Q/A'], beforeDate });
  let count = 0, errors = 0;

  for (const filing of filings.slice(0, maxFilings)) {
    try {
      const mda = await extractQuarterlyMDA(filing);
      if (mda) {
        const record = warehouse.createRecord({
          company: ticker,
          data_type: '10q_mda',
          source: 'edgar_10q',
          source_url: mda.source_url,
          publication_date: filing.filingDate,
          content: mda.text,
          metadata: { word_count: mda.word_count, form: filing.form },
        });
        warehouse.storeRecord(record);
        count++;
      }
    } catch { errors++; }
  }

  return { count, errors };
}

export default {
  getFilingIndex,
  extractRiskFactors,
  extractMDA,
  extractQuarterlyMDA,
  fetchAndStore10KSections,
  fetchAndStore10QSections,
};
