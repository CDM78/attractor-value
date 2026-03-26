// Financial Modeling Prep — Earnings Transcripts Connector
// API: https://financialmodelingprep.com/api/v3/earning_call_transcript/{ticker}

import { readJSON, writeJSON, sleep } from './shared.js';
import { resolve, join } from 'path';
import warehouse from '../warehouse.js';

const CALIBRATION_ROOT = resolve(import.meta.dirname, '../..');
const CONFIG_PATH = join(CALIBRATION_ROOT, 'config', 'connectors.json');
const USAGE_PATH = join(CALIBRATION_ROOT, 'config', 'fmp-usage.json');

// ============================================================
// API KEY AND RATE LIMITING
// ============================================================

let _apiKey = null;
let _callCount = 0;
let _callDate = null;

/**
 * Get the FMP API key from config or environment.
 */
function getApiKey() {
  if (_apiKey) return _apiKey;

  // Check config file
  const config = readJSON(CONFIG_PATH);
  if (config?.financial_modeling_prep?.api_key) {
    _apiKey = config.financial_modeling_prep.api_key;
    return _apiKey;
  }

  // Check environment variable
  if (process.env.FMP_API_KEY) {
    _apiKey = process.env.FMP_API_KEY;
    return _apiKey;
  }

  return null;
}

/**
 * Check if we can make another API call (250/day limit on free tier).
 */
function canMakeCall() {
  const today = new Date().toISOString().split('T')[0];

  // Reset counter on new day
  if (_callDate !== today) {
    // Load persisted usage
    const usage = readJSON(USAGE_PATH);
    if (usage && usage.date === today) {
      _callCount = usage.count;
    } else {
      _callCount = 0;
    }
    _callDate = today;
  }

  return _callCount < 240; // Leave 10 call buffer
}

function recordCall() {
  _callCount++;
  const today = new Date().toISOString().split('T')[0];
  writeJSON(USAGE_PATH, { date: today, count: _callCount });
}

// ============================================================
// API CALLS
// ============================================================

/**
 * Fetch an earnings transcript from FMP.
 * @param {string} ticker
 * @param {number} quarter - 1-4
 * @param {number} year
 */
async function fetchTranscript(ticker, quarter, year) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!canMakeCall()) {
    console.warn('  FMP daily limit approaching, stopping calls');
    return null;
  }

  const url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${ticker}?quarter=${quarter}&year=${year}&apikey=${apiKey}`;

  try {
    const res = await fetch(url);
    recordCall();

    if (!res.ok) return null;
    const data = await res.json();

    // FMP returns array; take first result
    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch all available transcripts for a ticker up to a given date.
 */
async function fetchAllTranscripts(ticker, beforeDate) {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  if (!canMakeCall()) return [];

  // Try the batch endpoint first
  const url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${ticker}?apikey=${apiKey}`;

  try {
    const res = await fetch(url);
    recordCall();

    if (!res.ok) return [];
    const data = await res.json();

    if (!Array.isArray(data)) return [];

    // Filter to before entry date
    return data.filter(t => {
      const date = t.date?.split(' ')[0];
      return date && date < beforeDate;
    });
  } catch {
    return [];
  }
}

// ============================================================
// TRANSCRIPT PARSING
// ============================================================

/**
 * Parse FMP transcript into structured format.
 */
function parseTranscript(fmpTranscript) {
  const text = fmpTranscript.content || '';
  const date = fmpTranscript.date?.split(' ')[0] || null;
  const quarter = fmpTranscript.quarter;
  const year = fmpTranscript.year;

  // Split into prepared remarks and Q&A
  let preparedRemarks = text;
  let qaSection = '';
  let hasQA = false;

  const qaPatterns = [
    /(?:^|\n)\s*(?:Q[\-\s]*&[\-\s]*A|Question[\-\s]+and[\-\s]+Answer)/im,
    /(?:^|\n)\s*Operator\s*:?\s*(?:.*question|.*open\s+(?:the\s+)?(?:line|floor))/im,
  ];

  for (const pattern of qaPatterns) {
    const match = pattern.exec(text);
    if (match) {
      preparedRemarks = text.slice(0, match.index).trim();
      qaSection = text.slice(match.index).trim();
      hasQA = true;
      break;
    }
  }

  // Extract speakers
  const speakerMatches = text.match(/^([A-Z][a-zA-Z\s,\.]{2,40}):\s/gm) || [];
  const speakers = [...new Set(
    speakerMatches
      .map(m => m.replace(/:\s*$/, '').trim())
      .filter(n => n.length > 2 && !/^(?:operator|moderator)/i.test(n))
  )].slice(0, 20);

  return {
    prepared_remarks: preparedRemarks,
    qa_section: qaSection,
    full_text: text,
    has_qa_section: hasQA,
    speakers,
    date,
    quarter,
    year,
    word_count_prepared: preparedRemarks.split(/\s+/).filter(w => w).length,
    word_count_qa: qaSection.split(/\s+/).filter(w => w).length,
    word_count_total: text.split(/\s+/).filter(w => w).length,
  };
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Check if FMP connector is available.
 */
export function isAvailable() {
  return getApiKey() !== null;
}

/**
 * Get remaining API calls for today.
 */
export function remainingCalls() {
  canMakeCall(); // Initialize counter
  return Math.max(0, 240 - _callCount);
}

/**
 * Extract and store FMP earnings transcripts for a company.
 * Skips transcripts already in warehouse from EDGAR.
 * @param {string} ticker
 * @param {string} beforeDate
 */
export async function extractFMPTranscripts(ticker, beforeDate) {
  if (!isAvailable()) {
    return { status: 'no_api_key', message: 'FMP API key not configured' };
  }

  // Check existing EDGAR transcripts to avoid duplicates
  const existingTranscripts = warehouse.queryCompanyData(ticker, 'earnings_transcript', { before: beforeDate });
  const existingPeriods = new Set(existingTranscripts.map(r => r.fiscal_period));

  const transcripts = await fetchAllTranscripts(ticker, beforeDate);
  if (transcripts.length === 0) {
    return { status: 'no_data', transcripts_found: 0 };
  }

  const results = [];

  for (const fmpT of transcripts) {
    try {
      const parsed = parseTranscript(fmpT);
      if (!parsed.full_text || parsed.word_count_total < 100) continue;

      // Determine fiscal period
      const fiscalPeriod = `Q${parsed.quarter}-${parsed.year}`;

      // Skip if we already have this quarter from EDGAR
      if (existingPeriods.has(fiscalPeriod)) {
        results.push({ period: fiscalPeriod, status: 'skipped_duplicate' });
        continue;
      }

      const record = warehouse.createRecord({
        company: ticker,
        data_type: 'earnings_transcript',
        source: 'fmp_api',
        source_url: `https://financialmodelingprep.com/api/v3/earning_call_transcript/${ticker}`,
        publication_date: parsed.date || beforeDate,
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
          word_count_total: parsed.word_count_total,
          fmp_symbol: fmpT.symbol,
        },
      });

      warehouse.storeRecord(record);
      results.push({
        period: fiscalPeriod,
        date: parsed.date,
        word_count: parsed.word_count_total,
        has_qa: parsed.has_qa_section,
        status: 'stored',
      });
    } catch (err) {
      results.push({ status: 'error', error: err.message });
    }

    await sleep(500); // Be polite with rate limiting
  }

  return {
    status: 'ok',
    transcripts_found: transcripts.length,
    stored: results.filter(r => r.status === 'stored').length,
    skipped_duplicate: results.filter(r => r.status === 'skipped_duplicate').length,
    details: results,
    remaining_calls: remainingCalls(),
  };
}

export default {
  isAvailable,
  remainingCalls,
  extractFMPTranscripts,
};
