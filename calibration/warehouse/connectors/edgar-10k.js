// EDGAR 10-K Section Extraction Connector
// Extracts Item 1A (Risk Factors) and Item 7 (MD&A) from 10-K filings.

import { fetchWithRetry, fetchEdgarSubmissions, ensureCikCache, getCikPadded, stripHtml, sha256, sleep } from './shared.js';
import warehouse from '../warehouse.js';

// ============================================================
// FILING DISCOVERY
// ============================================================

/**
 * Find 10-K filings for a company from EDGAR submissions.
 * Searches both recent and older filing pages.
 * @param {string} ticker
 * @param {string} beforeDate - Only filings before this date
 * @param {number} maxFilings - Max number of filings to return
 */
export async function find10KFilings(ticker, beforeDate, maxFilings = 5) {
  await ensureCikCache();
  const cik = getCikPadded(ticker);
  if (!cik) {
    console.log(`    No CIK for ${ticker}, skipping`);
    return [];
  }

  const rawFilings = await fetchEdgarSubmissions(cik, beforeDate, ['10-K', '10-K/A'], maxFilings);

  return rawFilings.map(f => ({
    ...f,
    fiscal_year: (f.report_date || f.filing_date).slice(0, 4),
  }));
}

// ============================================================
// SECTION EXTRACTION
// ============================================================

/**
 * Download and extract a section from a 10-K filing.
 * @param {object} filing - Filing metadata from find10KFilings
 * @param {string} section - 'item_1a' or 'item_7'
 */
export async function extractSection(filing, section = 'item_1a') {
  const accNoDash = filing.accession.replace(/-/g, '');
  const cik = filing.cik;

  // Try primary document first
  let htmlContent = null;
  if (filing.primary_doc) {
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${filing.primary_doc}`;
    try {
      const res = await fetchWithRetry(url);
      if (res.ok) {
        htmlContent = await res.text();
      }
    } catch {}
  }

  // Fallback: fetch filing index and find the main document
  if (!htmlContent) {
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/index.json`;
    try {
      const res = await fetchWithRetry(indexUrl);
      if (res.ok) {
        const index = await res.json();
        const items = index.directory?.item || [];
        const mainDoc = items.find(f =>
          /\.htm/i.test(f.name) && !/R\d+\.htm/i.test(f.name) && f.size > 100000
        ) || items.find(f => /\.htm/i.test(f.name));

        if (mainDoc) {
          const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${mainDoc.name}`;
          const docRes = await fetchWithRetry(docUrl);
          if (docRes.ok) {
            htmlContent = await docRes.text();
          }
        }
      }
    } catch {}
  }

  if (!htmlContent) return null;

  // Extract the requested section
  const extracted = section === 'item_1a'
    ? extractItem1A(htmlContent)
    : extractItem7(htmlContent);

  return extracted;
}

/**
 * Extract Item 1A (Risk Factors) from 10-K HTML.
 */
function extractItem1A(html) {
  // Method 1: Structured parsing with anchor/heading detection
  const structured = extractSectionByHeadings(html, {
    startPatterns: [
      /item\s*1a[\.\s\u2014\u2013\-]*\s*risk\s+factors/i,
      /item\s*1a\b/i,
      /ITEM\s*1A[\.\s\u2014\u2013\-]*\s*RISK\s+FACTORS/,
      />\s*Risk\s+Factors\s*</i,
    ],
    endPatterns: [
      /item\s*1b[\.\s\u2014\u2013\-]*\s*unresolved\s+staff\s+comments/i,
      /item\s*1b\b/i,
      /item\s*2[\.\s\u2014\u2013\-]*\s*properties/i,
      /ITEM\s*1B/,
      /ITEM\s*2[\.\s]/,
    ],
  });

  if (structured && structured.wordCount > 500) {
    return { ...structured, extraction_method: 'structured_parsing' };
  }

  // Method 2: Regex on stripped text
  const text = stripHtml(html);
  const regexResult = extractSectionByRegex(text, {
    startPatterns: [
      /ITEM\s+1A[\.\s\u2014\u2013\-]+RISK\s+FACTORS/i,
      /Item\s+1A[\.\s\u2014\u2013\-]+Risk\s+Factors/i,
      /RISK\s+FACTORS\s*\n/i,
    ],
    endPatterns: [
      /ITEM\s+1B[\.\s\u2014\u2013\-]+UNRESOLVED\s+STAFF\s+COMMENTS/i,
      /Item\s+1B[\.\s\u2014\u2013\-]+Unresolved\s+Staff\s+Comments/i,
      /ITEM\s+2[\.\s\u2014\u2013\-]+PROPERTIES/i,
      /Item\s+2[\.\s\u2014\u2013\-]+Properties/i,
    ],
  });

  if (regexResult && regexResult.wordCount > 500) {
    return { ...regexResult, extraction_method: 'regex_fallback' };
  }

  // If structured partial result is better than regex, use it
  if (structured && (!regexResult || structured.wordCount > regexResult.wordCount)) {
    return { ...structured, extraction_method: 'structured_parsing' };
  }
  if (regexResult) {
    return { ...regexResult, extraction_method: 'regex_fallback' };
  }

  return null;
}

/**
 * Extract Item 7 (MD&A) from 10-K HTML.
 */
function extractItem7(html) {
  const structured = extractSectionByHeadings(html, {
    startPatterns: [
      /item\s*7[\.\s\u2014\u2013\-]*\s*management.s\s+discussion\s+and\s+analysis/i,
      /item\s*7\b(?!\s*a)/i,
      /management.s\s+discussion\s+and\s+analysis/i,
      /ITEM\s*7[\.\s\u2014\u2013\-]*\s*MANAGEMENT/,
    ],
    endPatterns: [
      /item\s*7a[\.\s\u2014\u2013\-]*\s*quantitative\s+and\s+qualitative/i,
      /item\s*7a\b/i,
      /item\s*8[\.\s\u2014\u2013\-]*\s*financial\s+statements/i,
      /ITEM\s*7A/,
      /ITEM\s*8[\.\s]/,
    ],
  });

  if (structured && structured.wordCount > 500) {
    return { ...structured, extraction_method: 'structured_parsing' };
  }

  const text = stripHtml(html);
  const regexResult = extractSectionByRegex(text, {
    startPatterns: [
      /ITEM\s+7[\.\s\u2014\u2013\-]+MANAGEMENT.S\s+DISCUSSION/i,
      /Item\s+7[\.\s\u2014\u2013\-]+Management.s\s+Discussion/i,
      /MANAGEMENT.S\s+DISCUSSION\s+AND\s+ANALYSIS/i,
    ],
    endPatterns: [
      /ITEM\s+7A[\.\s\u2014\u2013\-]+QUANTITATIVE/i,
      /Item\s+7A[\.\s\u2014\u2013\-]+Quantitative/i,
      /ITEM\s+8[\.\s\u2014\u2013\-]+FINANCIAL\s+STATEMENTS/i,
      /Item\s+8[\.\s\u2014\u2013\-]+Financial\s+Statements/i,
    ],
  });

  if (regexResult && regexResult.wordCount > 500) {
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

// ============================================================
// PARSING ENGINES
// ============================================================

/**
 * Extract a section from HTML by finding heading elements.
 * Searches h1-h4, bold, and span-based headings.
 */
function extractSectionByHeadings(html, { startPatterns, endPatterns }) {
  // Find all potential section headers with their positions
  const headerRegex = /<(?:h[1-6]|b|strong|p|div|span|td|font)[^>]*>([\s\S]*?)<\/(?:h[1-6]|b|strong|p|div|span|td|font)>/gi;
  let match;
  const headers = [];

  while ((match = headerRegex.exec(html)) !== null) {
    const innerText = stripHtml(match[1]).trim();
    if (innerText.length < 200) { // Headers shouldn't be too long
      headers.push({
        text: innerText,
        fullMatch: match[0],
        position: match.index,
        endPosition: match.index + match[0].length,
      });
    }
  }

  // Find the section start
  let startPos = -1;
  let startHeader = null;
  for (const header of headers) {
    for (const pattern of startPatterns) {
      if (pattern.test(header.text)) {
        // Use the LAST occurrence in case of TOC duplicates
        // (TOC entries come before the actual section)
        if (startPos === -1 || header.position > startPos) {
          // But only update if we're likely past the TOC
          // Heuristic: if the content between this and the prior match > 5000 chars, it's the real one
          if (startPos === -1 || (header.position - startPos) > 5000) {
            startPos = header.endPosition;
            startHeader = header;
          }
        }
        break;
      }
    }
  }

  if (startPos === -1) return null;

  // Find the section end
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

  // If no end found, take a reasonable chunk
  if (endPos === -1) {
    endPos = Math.min(startPos + 500000, html.length); // Max ~500KB
  }

  const sectionHtml = html.slice(startPos, endPos);
  const text = stripHtml(sectionHtml);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    content: text,
    wordCount,
  };
}

/**
 * Extract a section from plain text using regex patterns.
 */
function extractSectionByRegex(text, { startPatterns, endPatterns }) {
  let startIdx = -1;

  // Find the LAST match for start (skip TOC entries)
  for (const pattern of startPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > startIdx) {
        // Only update if substantial content gap (skip TOC)
        if (startIdx === -1 || (m.index - startIdx) > 2000) {
          startIdx = m.index + m[0].length;
        }
      }
    }
    if (startIdx !== -1) break;
  }

  if (startIdx === -1) return null;

  // Find end
  let endIdx = -1;
  for (const pattern of endPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    const m = regex.exec(text.slice(startIdx));
    if (m) {
      const pos = startIdx + m.index;
      if (endIdx === -1 || pos < endIdx) {
        endIdx = pos;
      }
    }
  }

  if (endIdx === -1) {
    endIdx = Math.min(startIdx + 200000, text.length);
  }

  const content = text.slice(startIdx, endIdx).trim();
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  return { content, wordCount };
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Extract and store 10-K Item 1A (Risk Factors) for a company.
 * @param {string} ticker
 * @param {string} beforeDate - Entry date (temporal integrity cutoff)
 * @param {object} opts - { maxFilings }
 * @returns {Array} Array of stored records
 */
export async function extract10KItem1A(ticker, beforeDate, { maxFilings = 3 } = {}) {
  const filings = await find10KFilings(ticker, beforeDate, maxFilings);
  const results = [];

  for (const filing of filings) {
    try {
      const extracted = await extractSection(filing, 'item_1a');
      if (!extracted || !extracted.content || extracted.wordCount < 100) {
        results.push({ filing_date: filing.filing_date, fiscal_year: filing.fiscal_year, status: 'extraction_failed' });
        continue;
      }

      const record = warehouse.createRecord({
        company: ticker,
        data_type: '10k_risk_factors',
        source: 'edgar_10k',
        source_url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession.replace(/-/g, '')}/${filing.primary_doc || ''}`,
        publication_date: filing.filing_date,
        fiscal_period: `FY${filing.fiscal_year}`,
        content: extracted.content,
        metadata: {
          section: 'item_1a',
          filing_accession: filing.accession,
          fiscal_year: filing.fiscal_year,
          report_date: filing.report_date,
          word_count: extracted.wordCount,
          extraction_method: extracted.extraction_method,
        },
      });

      warehouse.storeRecord(record);
      results.push({
        filing_date: filing.filing_date,
        fiscal_year: filing.fiscal_year,
        word_count: extracted.wordCount,
        method: extracted.extraction_method,
        status: 'stored',
      });
    } catch (err) {
      results.push({ filing_date: filing.filing_date, fiscal_year: filing.fiscal_year, status: 'error', error: err.message });
    }
    await sleep(200);
  }

  return results;
}

/**
 * Extract and store 10-K Item 7 (MD&A) for a company.
 */
export async function extract10KItem7(ticker, beforeDate, { maxFilings = 2 } = {}) {
  const filings = await find10KFilings(ticker, beforeDate, maxFilings);
  const results = [];

  for (const filing of filings) {
    try {
      const extracted = await extractSection(filing, 'item_7');
      if (!extracted || !extracted.content || extracted.wordCount < 100) {
        results.push({ filing_date: filing.filing_date, fiscal_year: filing.fiscal_year, status: 'extraction_failed' });
        continue;
      }

      const record = warehouse.createRecord({
        company: ticker,
        data_type: '10k_mda',
        source: 'edgar_10k',
        source_url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession.replace(/-/g, '')}/${filing.primary_doc || ''}`,
        publication_date: filing.filing_date,
        fiscal_period: `FY${filing.fiscal_year}`,
        content: extracted.content,
        metadata: {
          section: 'item_7',
          filing_accession: filing.accession,
          fiscal_year: filing.fiscal_year,
          report_date: filing.report_date,
          word_count: extracted.wordCount,
          extraction_method: extracted.extraction_method,
        },
      });

      warehouse.storeRecord(record);
      results.push({
        filing_date: filing.filing_date,
        fiscal_year: filing.fiscal_year,
        word_count: extracted.wordCount,
        method: extracted.extraction_method,
        status: 'stored',
      });
    } catch (err) {
      results.push({ filing_date: filing.filing_date, fiscal_year: filing.fiscal_year, status: 'error', error: err.message });
    }
    await sleep(200);
  }

  return results;
}

export default {
  find10KFilings,
  extractSection,
  extract10KItem1A,
  extract10KItem7,
};
