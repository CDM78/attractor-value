// SEC Comment Letter Connector
// Extracts CORRESP (correspondence) filings from EDGAR.
// These are SEC staff review letters and company responses.

import { fetchWithRetry, ensureCikCache, getCikPadded, stripHtml, sleep } from './shared.js';
import warehouse from '../warehouse.js';

// ============================================================
// FILING DISCOVERY
// ============================================================

/**
 * Find correspondence filings for a company.
 * Filing types: CORRESP and UPLOAD
 */
export async function findCorrespondenceFilings(ticker, beforeDate, afterDate = null) {
  await ensureCikCache();
  const cik = getCikPadded(ticker);
  if (!cik) return [];

  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  let res;
  try {
    res = await fetchWithRetry(url);
  } catch { return []; }

  if (!res.ok) return [];
  const data = await res.json();
  const recent = data.filings?.recent;
  if (!recent) return [];

  const filings = [];
  for (let i = 0; i < (recent.form || []).length; i++) {
    const form = recent.form[i];
    if (form !== 'CORRESP' && form !== 'UPLOAD') continue;

    const filingDate = recent.filingDate?.[i];
    const accession = recent.accessionNumber?.[i];
    const primaryDoc = recent.primaryDocument?.[i];

    if (!filingDate || !accession) continue;
    if (filingDate >= beforeDate) continue;
    if (afterDate && filingDate < afterDate) continue;

    filings.push({
      form,
      filing_date: filingDate,
      accession,
      primary_doc: primaryDoc,
      cik: cik.replace(/^0+/, ''),
    });
  }

  return filings;
}

// ============================================================
// LETTER PARSING
// ============================================================

/**
 * Download and parse a comment letter filing.
 */
async function downloadAndParseLetter(filing) {
  const accNoDash = filing.accession.replace(/-/g, '');
  const cik = filing.cik;
  let text = null;

  // Try primary document
  if (filing.primary_doc) {
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${filing.primary_doc}`;
    try {
      const res = await fetchWithRetry(url);
      if (res.ok) {
        const raw = await res.text();
        text = raw.includes('<') ? stripHtml(raw) : raw;
      }
    } catch {}
  }

  // Fallback: find document from index
  if (!text) {
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/index.json`;
    try {
      const res = await fetchWithRetry(indexUrl);
      if (res.ok) {
        const index = await res.json();
        const items = index.directory?.item || [];
        const doc = items.find(f => /\.htm/i.test(f.name)) || items.find(f => /\.txt/i.test(f.name));
        if (doc) {
          const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${doc.name}`;
          const docRes = await fetchWithRetry(docUrl);
          if (docRes.ok) {
            const raw = await docRes.text();
            text = raw.includes('<') ? stripHtml(raw) : raw;
          }
        }
      }
    } catch {}
  }

  if (!text || text.length < 100) return null;

  // Determine direction (SEC → company or company → SEC)
  const direction = classifyDirection(text);

  // Identify topics
  const topics = identifyTopics(text);

  // Find related filing reference
  const relatedFiling = findRelatedFiling(text);

  return {
    content: text,
    direction,
    topics,
    related_filing: relatedFiling,
    word_count: text.split(/\s+/).filter(w => w).length,
  };
}

/**
 * Determine if this is an SEC letter (questions) or company response.
 */
function classifyDirection(text) {
  const lower = text.toLowerCase();

  // SEC letter indicators
  const secIndicators = [
    /dear\s+(?:mr|ms|mrs|chief|sir|madam)/i,
    /division\s+of\s+(?:corporation|investment)\s+(?:finance|management)/i,
    /staff\s+of\s+the\s+(?:securities|commission)/i,
    /sec\.gov.*(?:staff|accountant|attorney)/i,
    /we\s+have\s+(?:reviewed|limited our review)/i,
    /please\s+(?:respond|provide|address|explain|revise|amend)/i,
    /comment\s+(?:letter|below)/i,
    /we\s+note\s+(?:that|your)/i,
  ];

  // Company response indicators
  const companyIndicators = [
    /in\s+response\s+to\s+(?:your|the\s+staff)/i,
    /we\s+(?:respectfully\s+)?(?:acknowledge|respond|address)/i,
    /(?:response|reply)\s+(?:to|letter)/i,
    /staff.s\s+comment/i,
    /comment\s+(?:no\.|number|#)\s*\d/i,
    /set\s+forth\s+below\s+(?:is|are)\s+(?:our|the\s+company)/i,
  ];

  let secScore = 0;
  for (const pat of secIndicators) {
    if (pat.test(text)) secScore++;
  }

  let companyScore = 0;
  for (const pat of companyIndicators) {
    if (pat.test(text)) companyScore++;
  }

  if (secScore > companyScore) return 'sec_to_company';
  if (companyScore > secScore) return 'company_to_sec';
  return 'unknown';
}

/**
 * Identify the topics raised in a comment letter.
 */
function identifyTopics(text) {
  const lower = text.toLowerCase();
  const topics = [];

  const topicPatterns = {
    revenue_recognition: /revenue\s+recognition|asc\s+606|revenue\s+from\s+contracts/i,
    segment_reporting: /segment\s+report|operating\s+segment|reportable\s+segment/i,
    goodwill_impairment: /goodwill\s+(?:impairment|test)|indefinite.lived\s+intangible/i,
    fair_value: /fair\s+value\s+(?:measurement|hierarchy|estimate)/i,
    risk_factors: /risk\s+factor|item\s+1a/i,
    internal_controls: /internal\s+control|material\s+weakness|significant\s+deficiency/i,
    debt_obligations: /debt\s+(?:obligation|covenant|classification)|long.term\s+(?:debt|borrowing)/i,
    lease_accounting: /lease\s+(?:accounting|obligation|liability)|asc\s+842|right.of.use/i,
    stock_compensation: /stock.based\s+compensation|share.based\s+(?:payment|compensation)|equity\s+award/i,
    income_tax: /income\s+tax|deferred\s+tax|tax\s+(?:benefit|provision|rate)/i,
    related_party: /related\s+party|affiliate\s+transaction/i,
    md_and_a: /management.s\s+discussion|md&a|item\s+7/i,
    cybersecurity: /cybersecurity|data\s+(?:breach|security)|cyber\s+(?:risk|threat|incident)/i,
    esg_climate: /climate|environmental|sustainability|esg|greenhouse\s+gas/i,
  };

  for (const [topic, pattern] of Object.entries(topicPatterns)) {
    if (pattern.test(text)) topics.push(topic);
  }

  return topics;
}

/**
 * Find references to related filings in the letter text.
 */
function findRelatedFiling(text) {
  // Look for "10-K for the fiscal year ended", "10-Q for the quarter ended", etc.
  const filingRef = text.match(/(?:10-K|10-Q|20-F|S-1|DEF 14A).*?(?:(?:fiscal|calendar)\s+)?(?:year|quarter|period)\s+ended\s+(\w+\s+\d+,?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (filingRef) return filingRef[0].trim().slice(0, 100);

  const formRef = text.match(/(?:Form\s+)?(?:10-K|10-Q|20-F)\s+(?:filed|dated)\s+(?:on\s+)?(\w+\s+\d+,?\s+\d{4})/i);
  if (formRef) return formRef[0].trim().slice(0, 100);

  return null;
}

// ============================================================
// HIGH-LEVEL API
// ============================================================

/**
 * Extract and store SEC comment letters for a company.
 * @param {string} ticker
 * @param {string} beforeDate - Entry date
 * @param {object} opts - { trailingYears }
 */
export async function extractCommentLetters(ticker, beforeDate, { trailingYears = 3 } = {}) {
  const after = new Date(beforeDate);
  after.setFullYear(after.getFullYear() - trailingYears);
  const afterDate = after.toISOString().split('T')[0];

  const filings = await findCorrespondenceFilings(ticker, beforeDate, afterDate);
  const results = [];

  // Track exchanges (group letters by approximate date)
  let exchangeSequence = 0;

  for (const filing of filings) {
    try {
      const parsed = await downloadAndParseLetter(filing);
      if (!parsed || !parsed.content || parsed.word_count < 50) {
        results.push({ filing_date: filing.filing_date, status: 'parse_failed' });
        continue;
      }

      exchangeSequence++;

      const record = warehouse.createRecord({
        company: ticker,
        data_type: 'sec_comment_letters',
        source: 'edgar_corresp',
        source_url: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession.replace(/-/g, '')}/${filing.primary_doc || ''}`,
        publication_date: filing.filing_date,
        content: parsed.content,
        metadata: {
          direction: parsed.direction,
          topics: parsed.topics,
          related_filing: parsed.related_filing,
          exchange_sequence: exchangeSequence,
          word_count: parsed.word_count,
          form_type: filing.form,
        },
      });

      warehouse.storeRecord(record);
      results.push({
        filing_date: filing.filing_date,
        direction: parsed.direction,
        topics: parsed.topics,
        word_count: parsed.word_count,
        status: 'stored',
      });
    } catch (err) {
      results.push({ filing_date: filing.filing_date, status: 'error', error: err.message });
    }
    await sleep(200);
  }

  return results;
}

export default {
  findCorrespondenceFilings,
  extractCommentLetters,
};
