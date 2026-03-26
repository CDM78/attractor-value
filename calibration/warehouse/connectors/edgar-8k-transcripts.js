// EDGAR 8-K Earnings Transcript Extraction Connector
// Extracts earnings call transcripts from 8-K exhibit filings (EX-99.x).

import { fetchWithRetry, fetchEdgarSubmissions, ensureCikCache, getCikPadded, stripHtml, sha256, sleep } from './shared.js';
import warehouse from '../warehouse.js';

// ============================================================
// FILING DISCOVERY
// ============================================================

/**
 * Find 8-K filings for a company that may contain earnings transcripts.
 * Searches both recent and older filing pages.
 */
export async function find8KFilings(ticker, beforeDate, maxFilings = 20) {
  await ensureCikCache();
  const cik = getCikPadded(ticker);
  if (!cik) return [];

  // Get more 8-K filings than needed since we'll filter by description
  const rawFilings = await fetchEdgarSubmissions(cik, beforeDate, ['8-K', '8-K/A'], maxFilings * 3);

  // Filter for earnings-related filings
  const filtered = [];
  for (const f of rawFilings) {
    const descLower = (f.description || '').toLowerCase();
    const isEarningsRelated =
      descLower.includes('earnings') ||
      descLower.includes('results') ||
      descLower.includes('quarter') ||
      descLower.includes('conference call') ||
      descLower.includes('press release') ||
      descLower.includes('financial results') ||
      descLower.includes('transcript') ||
      f.description === '';

    if (!isEarningsRelated) continue;
    filtered.push(f);
    if (filtered.length >= maxFilings) break;
  }

  return filtered;
}

// ============================================================
// EXHIBIT EXTRACTION
// ============================================================

/**
 * Fetch 8-K filing index and find EX-99 exhibits.
 */
async function findExhibits(filing) {
  const accNoDash = filing.accession.replace(/-/g, '');
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${accNoDash}/index.json`;

  let res;
  try {
    res = await fetchWithRetry(indexUrl);
  } catch { return []; }

  if (!res.ok) return [];
  const index = await res.json();
  const items = index.directory?.item || [];

  // Find EX-99.x exhibits
  return items
    .filter(f => /ex-?99/i.test(f.name) || /exhibit.*99/i.test(f.name))
    .map(f => ({
      name: f.name,
      size: parseInt(f.size, 10) || 0,
      url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${accNoDash}/${f.name}`,
    }));
}

/**
 * Determine if exhibit text is a transcript (vs press release or slides).
 */
function classifyExhibit(text) {
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Transcript indicators
  const hasQA = /q[\-\s]*&[\-\s]*a|question[\-\s]+and[\-\s]+answer|questions?\s+and\s+answers?/i.test(text);
  const hasSpeakerColons = (text.match(/^[A-Z][a-zA-Z\s,\.]+:\s/gm) || []).length;
  const hasOperator = /operator|moderator/i.test(text);
  const hasConference = /conference\s+call|earnings\s+call|investor\s+call/i.test(text);
  const hasRemarks = /prepared\s+remarks|opening\s+remarks|presentation/i.test(text);

  // Press release indicators
  const hasPressRelease = /press\s+release|news\s+release|for\s+immediate\s+release/i.test(text);
  const hasFinancialTable = (text.match(/\$[\d,]+\s*(?:million|billion)?/g) || []).length > 10;

  // Score it
  let transcriptScore = 0;
  if (hasQA) transcriptScore += 3;
  if (hasSpeakerColons > 5) transcriptScore += 2;
  if (hasOperator) transcriptScore += 2;
  if (hasConference) transcriptScore += 1;
  if (hasRemarks) transcriptScore += 1;
  if (wordCount > 3000) transcriptScore += 1;

  let pressReleaseScore = 0;
  if (hasPressRelease) pressReleaseScore += 3;
  if (hasFinancialTable && !hasQA) pressReleaseScore += 2;
  if (wordCount < 2000) pressReleaseScore += 1;

  if (transcriptScore > pressReleaseScore && transcriptScore >= 3) {
    return 'transcript';
  } else if (pressReleaseScore > transcriptScore) {
    return 'press_release';
  }
  return 'unknown';
}

/**
 * Parse a transcript into prepared remarks and Q&A sections.
 */
function parseTranscript(text) {
  const result = {
    prepared_remarks: '',
    qa_section: '',
    full_text: text,
    has_qa_section: false,
    speakers: [],
    word_count_prepared: 0,
    word_count_qa: 0,
  };

  // Find Q&A section boundary
  const qaPatterns = [
    /(?:^|\n)\s*(?:Q[\-\s]*&[\-\s]*A|Question[\-\s]+and[\-\s]+Answer|Questions?\s+and\s+Answers?)\s*(?:\n|$)/im,
    /(?:^|\n)\s*(?:Operator|Moderator)\s*[:\n]\s*(?:.*(?:first|next)\s+question|.*open\s+(?:the\s+)?(?:line|floor|call)\s+(?:for|to)\s+questions)/im,
    /(?:^|\n)\s*We\s+will\s+now\s+(?:begin|open|take)\s+(?:the\s+)?(?:question|Q&A)/im,
  ];

  let qaStart = -1;
  for (const pattern of qaPatterns) {
    const match = pattern.exec(text);
    if (match) {
      qaStart = match.index;
      break;
    }
  }

  if (qaStart !== -1) {
    result.prepared_remarks = text.slice(0, qaStart).trim();
    result.qa_section = text.slice(qaStart).trim();
    result.has_qa_section = true;
    result.word_count_prepared = result.prepared_remarks.split(/\s+/).filter(w => w).length;
    result.word_count_qa = result.qa_section.split(/\s+/).filter(w => w).length;
  } else {
    result.prepared_remarks = text;
    result.word_count_prepared = text.split(/\s+/).filter(w => w).length;
  }

  // Extract speaker names (Name: pattern)
  const speakerMatches = text.match(/^([A-Z][a-zA-Z\s,\.]{2,40}):\s/gm) || [];
  const speakers = new Set();
  for (const m of speakerMatches) {
    const name = m.replace(/:\s*$/, '').trim();
    if (name.length > 2 && name.length < 50 && !/^(?:operator|moderator|answer|question)/i.test(name)) {
      speakers.add(name);
    }
  }
  result.speakers = [...speakers].slice(0, 20);

  return result;
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Extract and store earnings transcripts from 8-K exhibits.
 * @param {string} ticker
 * @param {string} beforeDate
 * @param {object} opts
 * @returns {Array} Results for each filing
 */
export async function extract8KTranscripts(ticker, beforeDate, { maxFilings = 20 } = {}) {
  const filings = await find8KFilings(ticker, beforeDate, maxFilings);
  const results = [];
  const storedDates = new Set(); // Avoid duplicates by date

  for (const filing of filings) {
    try {
      const exhibits = await findExhibits(filing);
      if (exhibits.length === 0) continue;

      for (const exhibit of exhibits) {
        // Skip very small or very large exhibits
        if (exhibit.size < 5000 || exhibit.size > 5000000) continue;

        let res;
        try {
          res = await fetchWithRetry(exhibit.url);
        } catch { continue; }

        if (!res.ok) continue;
        const rawText = await res.text();
        const text = stripHtml(rawText);

        // Classify the exhibit
        const classification = classifyExhibit(text);
        if (classification !== 'transcript') continue;

        // Deduplicate by filing date
        if (storedDates.has(filing.filing_date)) continue;

        // Parse the transcript
        const parsed = parseTranscript(text);

        // Determine fiscal period from filing date
        const filingMonth = parseInt(filing.filing_date.slice(5, 7), 10);
        const filingYear = filing.filing_date.slice(0, 4);
        const quarter = Math.ceil(filingMonth / 3);
        // Earnings calls typically report the PRIOR quarter
        const reportQuarter = quarter === 1 ? 4 : quarter - 1;
        const reportYear = quarter === 1 ? String(parseInt(filingYear) - 1) : filingYear;
        const fiscalPeriod = `Q${reportQuarter}-${reportYear}`;

        const record = warehouse.createRecord({
          company: ticker,
          data_type: 'earnings_transcript',
          source: 'edgar_8k_exhibit',
          source_url: exhibit.url,
          publication_date: filing.filing_date,
          fiscal_period: fiscalPeriod,
          content: {
            prepared_remarks: parsed.prepared_remarks,
            qa_section: parsed.qa_section,
            full_text: parsed.full_text,
          },
          metadata: {
            has_qa_section: parsed.has_qa_section,
            speakers: parsed.speakers,
            word_count_prepared: parsed.word_count_prepared,
            word_count_qa: parsed.word_count_qa,
            word_count_total: parsed.full_text.split(/\s+/).filter(w => w).length,
            exhibit_type: exhibit.name,
            filing_accession: filing.accession,
            filing_description: filing.description,
          },
        });

        warehouse.storeRecord(record);
        storedDates.add(filing.filing_date);

        results.push({
          filing_date: filing.filing_date,
          fiscal_period: fiscalPeriod,
          exhibit: exhibit.name,
          word_count: parsed.word_count_prepared + parsed.word_count_qa,
          has_qa: parsed.has_qa_section,
          speakers: parsed.speakers.length,
          status: 'stored',
        });

        break; // One transcript per 8-K filing
      }
    } catch (err) {
      results.push({ filing_date: filing.filing_date, status: 'error', error: err.message });
    }
    await sleep(200);
  }

  return results;
}

export default {
  find8KFilings,
  extract8KTranscripts,
};
