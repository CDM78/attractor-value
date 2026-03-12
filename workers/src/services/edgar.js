// SEC EDGAR API — fetch 10-K filings and extract MD&A (Item 7)
// Free API, 10 requests/sec, requires User-Agent header
// Docs: https://efts.sec.gov/LATEST/search-index

const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_FULL_TEXT = 'https://efts.sec.gov/LATEST';
const USER_AGENT = 'AttractorValue/1.0 (charlesdmaddox@gmail.com)';

// Fetch the most recent 10-K filing URL for a ticker
export async function fetch10K(ticker) {
  // Step 1: Find the CIK (Central Index Key) for the ticker
  const cikRes = await fetch(
    `https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&search_text=&action=getcompany&output=atom`,
    { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/atom+xml' } }
  );

  if (!cikRes.ok) throw new Error(`EDGAR lookup failed: ${cikRes.status}`);
  const atomText = await cikRes.text();

  // Extract filing URL from Atom feed
  const linkMatch = atomText.match(/<link[^>]*href="(https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/[^"]*-index\.htm)"/);
  if (!linkMatch) {
    // Try EFTS full-text search as fallback
    return await fetch10KViaFullText(ticker);
  }

  const indexUrl = linkMatch[1];

  // Step 2: Get the filing index page to find the actual 10-K document
  const indexRes = await fetch(indexUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!indexRes.ok) throw new Error(`EDGAR index fetch failed: ${indexRes.status}`);
  const indexHtml = await indexRes.text();

  // Find the primary document (usually .htm with largest size)
  const docMatch = indexHtml.match(/href="([^"]*\.htm)"[^>]*>[^<]*10-K/i)
    || indexHtml.match(/href="(\/Archives\/edgar\/data\/[^"]*\.htm)"/);

  if (!docMatch) return null;

  let docUrl = docMatch[1];
  if (!docUrl.startsWith('http')) {
    docUrl = `https://www.sec.gov${docUrl}`;
  }

  return docUrl;
}

// Fallback: use EDGAR full-text search
async function fetch10KViaFullText(ticker) {
  const params = new URLSearchParams({
    q: `"${ticker}"`,
    dateRange: 'custom',
    startdt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    enddt: new Date().toISOString().split('T')[0],
    forms: '10-K',
  });

  const res = await fetch(`${EDGAR_FULL_TEXT}/search-index?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) return null;
  const data = await res.json();

  if (!data.hits?.hits?.length) return null;

  const filing = data.hits.hits[0];
  const accession = filing._source?.file_num || filing._id;
  if (!accession) return null;

  return `https://www.sec.gov/Archives/edgar/data/${accession}`;
}

// Extract MD&A (Item 7) from a 10-K HTML document
// Returns truncated text suitable for Claude analysis (~4000 words max)
export async function extractMDA(filingUrl) {
  if (!filingUrl) return null;

  const res = await fetch(filingUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!res.ok) return null;

  const html = await res.text();

  // Strip HTML tags for text extraction
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to find Item 7 (MD&A) section
  const mdaPatterns = [
    /Item\s*7[\.\s]*[-–—]?\s*Management['']?s?\s*Discussion/i,
    /MANAGEMENT['']?S?\s*DISCUSSION\s*AND\s*ANALYSIS/i,
    /Item\s*7[\.\s]/i,
  ];

  let mdaStart = -1;
  for (const pattern of mdaPatterns) {
    const match = text.search(pattern);
    if (match !== -1) {
      mdaStart = match;
      break;
    }
  }

  if (mdaStart === -1) {
    // If no MD&A found, return a chunk from the middle of the filing
    const midpoint = Math.floor(text.length * 0.3);
    return text.slice(midpoint, midpoint + 15000).trim() || null;
  }

  // Find the end of MD&A (typically Item 7A or Item 8)
  const afterMda = text.slice(mdaStart);
  const endPatterns = [
    /Item\s*7A[\.\s]/i,
    /Item\s*8[\.\s]/i,
    /QUANTITATIVE\s*AND\s*QUALITATIVE\s*DISCLOSURES/i,
    /FINANCIAL\s*STATEMENTS\s*AND\s*SUPPLEMENTARY/i,
  ];

  let mdaEnd = afterMda.length;
  for (const pattern of endPatterns) {
    const match = afterMda.search(pattern);
    if (match > 500) { // Must be at least 500 chars in to avoid false matches
      mdaEnd = match;
      break;
    }
  }

  let mdaText = afterMda.slice(0, mdaEnd).trim();

  // Truncate to ~4000 words (~20000 chars) to keep Claude costs down
  if (mdaText.length > 20000) {
    mdaText = mdaText.slice(0, 20000) + '\n\n[... MD&A section truncated for analysis ...]';
  }

  return mdaText || null;
}
