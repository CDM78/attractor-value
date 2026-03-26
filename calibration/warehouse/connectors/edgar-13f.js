// SEC EDGAR 13F Institutional Ownership Connector
// Pulls quarterly institutional ownership data from SEC EDGAR 13F-HR filings.
//
// Approach: Use the EDGAR company-concept API to get shares outstanding,
// then use the EDGAR full-text search to find 13F filers holding a company.
// Alternative: Use the SEC's mutual fund holdings or third-party aggregation.
//
// For calibration purposes, we use a pragmatic approach:
// - Pull 13F-HR filing indexes for major institutional holders
// - Parse the information tables (XML) to extract position sizes
// - Aggregate by company per quarter to get institutional ownership metrics
//
// SEC rate limit: 10 requests/second with User-Agent identifying the caller.

import { fetchWithRetry, ensureCikCache, getCikForTicker, getCikNumeric } from './shared.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import warehouse from '../warehouse.js';

const EDGAR_BASE = 'https://efts.sec.gov/LATEST';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const CACHE_DIR = resolve(import.meta.dirname, '../../warehouse/macro/13f-cache');

// ============================================================
// FILING DISCOVERY
// ============================================================

/**
 * Search EDGAR full-text search for 13F filings mentioning a specific company.
 * Uses the EFTS (EDGAR Full-Text Search) API.
 *
 * @param {string} ticker - Company ticker to search for
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 */
async function search13FFilings(ticker, startDate, endDate) {
  // Use EDGAR EFTS to find 13F-HR filings mentioning this ticker
  const query = encodeURIComponent(`"${ticker}"`);
  const url = `${EDGAR_BASE}/search-index?q=${query}&dateRange=custom&startdt=${startDate}&enddt=${endDate}&forms=13F-HR&from=0&size=40`;

  let res;
  try {
    res = await fetchWithRetry(url, {}, { minIntervalMs: 110 });
  } catch { return []; }

  if (!res.ok) return [];
  const data = await res.json();

  if (!data.hits?.hits) return [];

  return data.hits.hits.map(h => ({
    accession: h._source?.file_num || h._id,
    filer_name: h._source?.display_names?.[0] || 'Unknown',
    filed_date: h._source?.file_date,
    form_type: h._source?.form_type,
  }));
}

// ============================================================
// 13F INFORMATION TABLE PARSING
// ============================================================

/**
 * Fetch and parse a 13F information table for a specific filing.
 * The info table lists all equity positions held by the filer.
 *
 * @param {number} filerCik - CIK of the 13F filer
 * @param {string} accession - Accession number
 * @param {string} targetTicker - Ticker we're looking for
 */
async function parse13FInfoTable(filerCik, accession, targetTicker) {
  // Normalize accession for URL (remove dashes)
  const accNoDash = accession.replace(/-/g, '');

  // Try to find the info table document
  const indexUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filerCik}&type=13F-HR&dateb=&owner=include&count=1&search_text=&action=getcompany`;

  // Direct approach: fetch the filing index to find the infotable XML
  const filingIndexUrl = `${EDGAR_ARCHIVES}/${filerCik}/${accNoDash}/index.json`;
  let res;
  try {
    res = await fetchWithRetry(filingIndexUrl, {}, { minIntervalMs: 110 });
  } catch { return null; }

  if (!res.ok) return null;
  const index = await res.json();

  // Find the info table file (usually named *infotable*.xml or *.txt)
  const items = index.directory?.item || [];
  const infoTableFile = items.find(f =>
    /infotable/i.test(f.name) && /\.(xml|txt)$/i.test(f.name)
  ) || items.find(f =>
    /13f/i.test(f.name) && /table/i.test(f.name)
  );

  if (!infoTableFile) return null;

  const tableUrl = `${EDGAR_ARCHIVES}/${filerCik}/${accNoDash}/${infoTableFile.name}`;
  let tableRes;
  try {
    tableRes = await fetchWithRetry(tableUrl, {
      headers: { 'Accept': 'text/xml, text/plain, */*' },
    }, { minIntervalMs: 110 });
  } catch { return null; }

  if (!tableRes.ok) return null;
  const tableText = await tableRes.text();

  // Parse XML info table for the target ticker
  return extractPositionFromInfoTable(tableText, targetTicker);
}

/**
 * Extract position data for a specific ticker from a 13F info table.
 * Handles both XML and text/CSV format info tables.
 */
function extractPositionFromInfoTable(tableText, targetTicker) {
  const upperTicker = targetTicker.toUpperCase();

  // Try XML format first (most common for recent filings)
  if (tableText.includes('<infoTable') || tableText.includes('<informationTable')) {
    return extractFromXmlInfoTable(tableText, upperTicker);
  }

  // Fallback: try text/tab-delimited format
  return extractFromTextInfoTable(tableText, upperTicker);
}

/**
 * Extract from XML-formatted 13F info table.
 */
function extractFromXmlInfoTable(xml, ticker) {
  // Match all infoTable entries
  const entryPattern = /<infoTable[^>]*>([\s\S]*?)<\/infoTable>/gi;
  let match;
  const positions = [];

  while ((match = entryPattern.exec(xml)) !== null) {
    const entry = match[1];

    // Check if this entry is for our ticker (by CUSIP name or issuer name)
    // The ticker sometimes appears in <titleOfClass> or we match by issuer name
    const nameMatch = entry.match(/<nameOfIssuer[^>]*>([^<]*)<\/nameOfIssuer>/i);
    const cusipMatch = entry.match(/<cusip[^>]*>([^<]*)<\/cusip>/i);
    const titleMatch = entry.match(/<titleOfClass[^>]*>([^<]*)<\/titleOfClass>/i);
    const sharesMatch = entry.match(/<sshPrnamt[^>]*>([^<]*)<\/sshPrnamt>/i) ||
                        entry.match(/<shrsOrPrnAmt>[\s\S]*?<sshPrnamt>([^<]*)<\/sshPrnamt>/i);
    const valueMatch = entry.match(/<value[^>]*>([^<]*)<\/value>/i);

    // We can't reliably match by ticker in XML — we match by issuer name
    // For calibration, we'll collect all entries and filter later
    if (nameMatch && sharesMatch) {
      positions.push({
        issuer: nameMatch[1].trim(),
        cusip: cusipMatch?.[1]?.trim() || null,
        title: titleMatch?.[1]?.trim() || null,
        shares: parseInt(sharesMatch[1].replace(/,/g, ''), 10) || 0,
        value_thousands: parseInt(valueMatch?.[1]?.replace(/,/g, ''), 10) || 0,
      });
    }
  }

  // If no structured matches, try a simpler regex for the whole document
  if (positions.length === 0) {
    const simplePattern = /<ns1:infoTable>([\s\S]*?)<\/ns1:infoTable>/gi;
    while ((match = simplePattern.exec(xml)) !== null) {
      const entry = match[1];
      const nameMatch = entry.match(/<ns1:nameOfIssuer>([^<]*)<\/ns1:nameOfIssuer>/i);
      const sharesMatch = entry.match(/<ns1:sshPrnamt>([^<]*)<\/ns1:sshPrnamt>/i);
      const valueMatch = entry.match(/<ns1:value>([^<]*)<\/ns1:value>/i);

      if (nameMatch && sharesMatch) {
        positions.push({
          issuer: nameMatch[1].trim(),
          shares: parseInt(sharesMatch[1].replace(/,/g, ''), 10) || 0,
          value_thousands: parseInt(valueMatch?.[1]?.replace(/,/g, ''), 10) || 0,
        });
      }
    }
  }

  return positions;
}

/**
 * Extract from text/tab-delimited 13F info table.
 */
function extractFromTextInfoTable(text, ticker) {
  const positions = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const upperLine = line.toUpperCase();
    // Look for lines containing our ticker or company name
    // Format varies but typically: NAME OF ISSUER | TITLE | CUSIP | VALUE | SHARES | ...
    const parts = line.split(/\t|\|/);
    if (parts.length >= 4) {
      const shares = parseInt(parts[4]?.replace(/,/g, ''), 10);
      const value = parseInt(parts[3]?.replace(/,/g, ''), 10);
      if (!isNaN(shares) && shares > 0) {
        positions.push({
          issuer: parts[0]?.trim() || '',
          title: parts[1]?.trim() || '',
          cusip: parts[2]?.trim() || '',
          value_thousands: value || 0,
          shares,
        });
      }
    }
  }

  return positions;
}

// ============================================================
// AGGREGATED OWNERSHIP COMPUTATION
// ============================================================

/**
 * Use EDGAR company submissions to get 13F filings that include a company.
 * More reliable approach: query the company's own filing history for
 * institutional ownership, or use the SEC's XBRL API for shares outstanding
 * and cross-reference with 13F aggregate data.
 *
 * Pragmatic approach for calibration:
 * Use SEC's company-concept API to get shares outstanding,
 * then estimate institutional ownership from known 13F data.
 */

/**
 * Get shares outstanding for a company from EDGAR.
 *
 * @param {string} ticker
 * @returns {Array} [{ date, shares_outstanding }]
 */
async function getSharesOutstanding(ticker) {
  await ensureCikCache();
  const cik = getCikNumeric(ticker);
  if (!cik) return [];

  // Try EntityCommonStockSharesOutstanding or CommonStockSharesOutstanding
  const concepts = [
    'EntityCommonStockSharesOutstanding',
    'CommonStockSharesOutstanding',
    'WeightedAverageNumberOfShareOutstandingBasicAndDiluted',
    'WeightedAverageNumberOfDilutedSharesOutstanding',
  ];

  for (const concept of concepts) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, '0')}/us-gaap/${concept}.json`;
    let res;
    try {
      res = await fetchWithRetry(url, {}, { minIntervalMs: 110 });
    } catch { continue; }

    if (!res.ok) continue;
    const data = await res.json();

    // Extract from units (shares)
    const units = data.units?.shares || data.units?.['USD/shares'] || [];
    if (units.length === 0) continue;

    return units
      .filter(u => u.val > 0 && u.end)
      .map(u => ({
        date: u.end,
        shares_outstanding: u.val,
        form: u.form,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return [];
}

/**
 * Fetch institutional ownership summary using SEC EDGAR's ownership API.
 * This uses the company's filing submissions to find Schedule 13D/G and
 * Form 13F cross-references.
 *
 * Pragmatic alternative: parse the company's own proxy statements (DEF 14A)
 * which typically list major institutional holders.
 *
 * For calibration speed, we use a simplified model:
 * Fetch the company's EDGAR submissions, look for SC 13D, SC 13G filings
 * (which are filed BY institutional holders ABOUT this company).
 */
async function fetchInstitutionalFilings(ticker, startDate, endDate) {
  await ensureCikCache();
  const cik = getCikNumeric(ticker);
  if (!cik) return [];

  // Fetch company submissions to find 13D/G filings (filed about this company)
  const paddedCik = String(cik).padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  let res;
  try {
    res = await fetchWithRetry(url, {}, { minIntervalMs: 110 });
  } catch { return []; }

  if (!res.ok) return [];
  const data = await res.json();

  const filings = [];
  const recent = data.filings?.recent;
  if (!recent) return [];

  for (let i = 0; i < (recent.form || []).length; i++) {
    const form = recent.form[i];
    const date = recent.filingDate?.[i];
    const accession = recent.accessionNumber?.[i];

    if (!date || !accession) continue;
    if (date < startDate || date > endDate) continue;

    // SC 13D/G = institutional ownership declarations about this company
    // These are filed BY the company itself as exhibits, or separately
    if (/^SC 13[DG]/i.test(form) || /^13F/i.test(form)) {
      filings.push({
        form,
        date,
        accession,
        filer: data.name || ticker,
      });
    }
  }

  return filings;
}

/**
 * Build quarterly institutional ownership time series for a company.
 * Uses SC 13D/G filings and shares outstanding to estimate ownership dynamics.
 *
 * For each quarter, computes:
 * - institutional_filings: count of SC 13D/G filings in that quarter
 * - cumulative_13dg: running count of active 13D/G filers
 * - shares_outstanding: from EDGAR XBRL
 * - filing_momentum: change in filing count vs prior quarter
 *
 * @param {string} ticker
 * @param {string} endDate - Cutoff date (entry_date)
 * @param {number} trailingYears - How many years to look back
 */
export async function fetchInstitutionalOwnershipSeries(ticker, endDate, trailingYears = 3) {
  const endD = new Date(endDate);
  const startD = new Date(endD);
  startD.setFullYear(startD.getFullYear() - trailingYears);
  const startDate = startD.toISOString().split('T')[0];

  // Fetch institutional filings and shares outstanding in parallel
  const [instFilings, sharesData] = await Promise.all([
    fetchInstitutionalFilings(ticker, startDate, endDate),
    getSharesOutstanding(ticker),
  ]);

  // Bin filings by quarter
  const quarterBins = {};

  for (const filing of instFilings) {
    const d = new Date(filing.date);
    const q = `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (!quarterBins[q]) {
      quarterBins[q] = { filings: [], count: 0 };
    }
    quarterBins[q].filings.push(filing);
    quarterBins[q].count++;
  }

  // Build quarterly time series
  const quarters = [];
  let cursor = new Date(startD);
  while (cursor <= endD) {
    const q = `${cursor.getFullYear()}-Q${Math.floor(cursor.getMonth() / 3) + 1}`;
    const qEnd = new Date(cursor.getFullYear(), (Math.floor(cursor.getMonth() / 3) + 1) * 3, 0);
    const dateStr = qEnd.toISOString().split('T')[0];

    // Find closest shares outstanding
    const closestShares = sharesData
      .filter(s => s.date <= dateStr)
      .pop();

    const bin = quarterBins[q] || { count: 0, filings: [] };

    quarters.push({
      quarter: q,
      date: dateStr,
      institutional_filings: bin.count,
      filing_types: bin.filings.map(f => f.form),
      shares_outstanding: closestShares?.shares_outstanding || null,
    });

    // Advance to next quarter
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 3, 1);
  }

  // Compute dynamics
  for (let i = 1; i < quarters.length; i++) {
    const prev = quarters[i - 1];
    const curr = quarters[i];

    // Filing momentum: change in institutional filing activity
    curr.filing_momentum = curr.institutional_filings - prev.institutional_filings;

    // Shares outstanding change (indicates dilution or buybacks)
    if (prev.shares_outstanding && curr.shares_outstanding) {
      curr.shares_change_pct = (curr.shares_outstanding - prev.shares_outstanding) / prev.shares_outstanding;
    } else {
      curr.shares_change_pct = null;
    }
  }

  // Cumulative 13D/G filer count (running total)
  let cumulative = 0;
  for (const q of quarters) {
    cumulative += q.institutional_filings;
    q.cumulative_filings = cumulative;
  }

  return quarters;
}

/**
 * Fetch and store institutional ownership series for a company.
 */
export async function fetchAndStoreInstitutionalOwnership(ticker, { beforeDate = null, trailingYears = 3 } = {}) {
  const entryDate = beforeDate || '2026-01-01';
  const series = await fetchInstitutionalOwnershipSeries(ticker, entryDate, trailingYears);

  if (series.length === 0) return { dataPoints: 0 };

  const record = warehouse.createRecord({
    company: ticker,
    data_type: 'institutional_ownership',
    source: 'edgar_13dg',
    source_url: 'https://data.sec.gov/submissions/',
    publication_date: series[series.length - 1].date,
    content: {
      series,
      data_points: series.length,
      date_range: { start: series[0].date, end: series[series.length - 1].date },
      total_filings: series.reduce((s, q) => s + q.institutional_filings, 0),
    },
    metadata: {
      data_points: series.length,
      start_date: series[0].date,
      end_date: series[series.length - 1].date,
      is_time_series: true,
    },
  });

  warehouse.storeRecord(record);
  return { dataPoints: series.length, path: record.company };
}

export default {
  fetchInstitutionalOwnershipSeries,
  fetchAndStoreInstitutionalOwnership,
  getSharesOutstanding,
};
