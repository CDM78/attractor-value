// EDGAR 10-Q Section Extraction Connector
// Extracts Item 2 (MD&A) from 10-Q filings.

import { fetchWithRetry, fetchEdgarSubmissions, ensureCikCache, getCikPadded, stripHtml, sha256, sleep } from './shared.js';
import warehouse from '../warehouse.js';

// ============================================================
// FILING DISCOVERY
// ============================================================

/**
 * Find 10-Q filings for a company from EDGAR submissions.
 * Searches both recent and older filing pages.
 */
export async function find10QFilings(ticker, beforeDate, maxFilings = 8) {
  await ensureCikCache();
  const cik = getCikPadded(ticker);
  if (!cik) return [];

  const rawFilings = await fetchEdgarSubmissions(cik, beforeDate, ['10-Q', '10-Q/A'], maxFilings);

  return rawFilings.map(f => {
    const reportDate = f.report_date || f.filing_date;
    const reportMonth = parseInt(reportDate.slice(5, 7), 10);
    const reportYear = reportDate.slice(0, 4);
    const quarter = Math.ceil(reportMonth / 3);

    return {
      ...f,
      fiscal_quarter: `Q${quarter}`,
      fiscal_year: reportYear,
      fiscal_period: `Q${quarter}-${reportYear}`,
    };
  });
}

// ============================================================
// SECTION EXTRACTION
// ============================================================

/**
 * Extract Item 2 (MD&A) from a 10-Q filing.
 */
export async function extractItem2(filing) {
  const accNoDash = filing.accession.replace(/-/g, '');
  const cik = filing.cik;

  let htmlContent = null;

  // Try primary document
  if (filing.primary_doc) {
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${filing.primary_doc}`;
    try {
      const res = await fetchWithRetry(url);
      if (res.ok) htmlContent = await res.text();
    } catch {}
  }

  // Fallback: find main document from index
  if (!htmlContent) {
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/index.json`;
    try {
      const res = await fetchWithRetry(indexUrl);
      if (res.ok) {
        const index = await res.json();
        const items = index.directory?.item || [];
        const mainDoc = items.find(f =>
          /\.htm/i.test(f.name) && !/R\d+\.htm/i.test(f.name) && f.size > 50000
        ) || items.find(f => /\.htm/i.test(f.name));

        if (mainDoc) {
          const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${mainDoc.name}`;
          const docRes = await fetchWithRetry(docUrl);
          if (docRes.ok) htmlContent = await docRes.text();
        }
      }
    } catch {}
  }

  if (!htmlContent) return null;

  // Extract Item 2 MD&A from 10-Q
  return extractMDASection(htmlContent);
}

/**
 * Extract the MD&A section (Item 2) from 10-Q HTML.
 * 10-Q Item 2 is similar structure to 10-K Item 7.
 */
function extractMDASection(html) {
  // Method 1: Structured HTML parsing
  const structured = extractByHeadings(html, {
    startPatterns: [
      /item\s*2[\.\s\u2014\u2013\-]*\s*management.s\s+discussion/i,
      /item\s*2\b(?!\s*\d)/i,
      /management.s\s+discussion\s+and\s+analysis/i,
    ],
    endPatterns: [
      /item\s*3[\.\s\u2014\u2013\-]*\s*quantitative/i,
      /item\s*3\b/i,
      /item\s*4[\.\s\u2014\u2013\-]*\s*controls/i,
      /ITEM\s*3/,
    ],
  });

  if (structured && structured.wordCount > 300) {
    return { ...structured, extraction_method: 'structured_parsing' };
  }

  // Method 2: Regex on text
  const text = stripHtml(html);
  const regexResult = extractByRegex(text, {
    startPatterns: [
      /ITEM\s+2[\.\s\u2014\u2013\-]+MANAGEMENT.S\s+DISCUSSION/i,
      /Item\s+2[\.\s\u2014\u2013\-]+Management.s\s+Discussion/i,
    ],
    endPatterns: [
      /ITEM\s+3[\.\s\u2014\u2013\-]+QUANTITATIVE/i,
      /Item\s+3[\.\s\u2014\u2013\-]+Quantitative/i,
      /ITEM\s+4[\.\s\u2014\u2013\-]+CONTROLS/i,
    ],
  });

  if (regexResult && regexResult.wordCount > 300) {
    return { ...regexResult, extraction_method: 'regex_fallback' };
  }

  if (structured && (!regexResult || structured.wordCount > regexResult.wordCount)) {
    return { ...structured, extraction_method: 'structured_parsing' };
  }
  if (regexResult) {
    return { ...regexResult, extraction_method: 'regex_fallback' };
  }

  return null;
}

function extractByHeadings(html, { startPatterns, endPatterns }) {
  const headerRegex = /<(?:h[1-6]|b|strong|p|div|span|td|font)[^>]*>([\s\S]*?)<\/(?:h[1-6]|b|strong|p|div|span|td|font)>/gi;
  let match;
  const headers = [];

  while ((match = headerRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (text.length < 200) {
      headers.push({ text, position: match.index, endPosition: match.index + match[0].length });
    }
  }

  let startPos = -1;
  for (const header of headers) {
    for (const pattern of startPatterns) {
      if (pattern.test(header.text)) {
        if (startPos === -1 || (header.position - startPos) > 3000) {
          startPos = header.endPosition;
        }
        break;
      }
    }
  }
  if (startPos === -1) return null;

  let endPos = -1;
  for (const header of headers) {
    if (header.position <= startPos) continue;
    for (const pattern of endPatterns) {
      if (pattern.test(header.text)) {
        endPos = header.position;
        break;
      }
    }
    if (endPos !== -1) break;
  }

  if (endPos === -1) endPos = Math.min(startPos + 300000, html.length);

  const content = stripHtml(html.slice(startPos, endPos));
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  return { content, wordCount };
}

function extractByRegex(text, { startPatterns, endPatterns }) {
  let startIdx = -1;
  for (const pattern of startPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (startIdx === -1 || (m.index - startIdx) > 1500) {
        startIdx = m.index + m[0].length;
      }
    }
    if (startIdx !== -1) break;
  }
  if (startIdx === -1) return null;

  let endIdx = -1;
  for (const pattern of endPatterns) {
    const m = pattern.exec(text.slice(startIdx));
    if (m) {
      const pos = startIdx + m.index;
      if (endIdx === -1 || pos < endIdx) endIdx = pos;
    }
  }
  if (endIdx === -1) endIdx = Math.min(startIdx + 150000, text.length);

  const content = text.slice(startIdx, endIdx).trim();
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  return { content, wordCount };
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Extract and store 10-Q Item 2 (MD&A) for a company.
 * @param {string} ticker
 * @param {string} beforeDate
 * @param {object} opts - { maxQuarters }
 */
export async function extract10QItem2(ticker, beforeDate, { maxQuarters = 4 } = {}) {
  const filings = await find10QFilings(ticker, beforeDate, maxQuarters);
  const results = [];

  for (const filing of filings) {
    try {
      const extracted = await extractItem2(filing);
      if (!extracted || !extracted.content || extracted.wordCount < 100) {
        results.push({ filing_date: filing.filing_date, period: filing.fiscal_period, status: 'extraction_failed' });
        continue;
      }

      const record = warehouse.createRecord({
        company: ticker,
        data_type: '10q_mda',
        source: 'edgar_10q',
        source_url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession.replace(/-/g, '')}/${filing.primary_doc || ''}`,
        publication_date: filing.filing_date,
        fiscal_period: filing.fiscal_period,
        content: extracted.content,
        metadata: {
          section: 'item_2',
          filing_accession: filing.accession,
          fiscal_year: filing.fiscal_year,
          fiscal_quarter: filing.fiscal_quarter,
          report_date: filing.report_date,
          word_count: extracted.wordCount,
          extraction_method: extracted.extraction_method,
        },
      });

      warehouse.storeRecord(record);
      results.push({
        filing_date: filing.filing_date,
        period: filing.fiscal_period,
        word_count: extracted.wordCount,
        method: extracted.extraction_method,
        status: 'stored',
      });
    } catch (err) {
      results.push({ filing_date: filing.filing_date, period: filing.fiscal_period, status: 'error', error: err.message });
    }
    await sleep(200);
  }

  return results;
}

export default {
  find10QFilings,
  extractItem2,
  extract10QItem2,
};
