// SEC EDGAR full-text search API
// Free, 10 requests/sec with User-Agent header

const EDGAR_BASE = 'https://efts.sec.gov/LATEST/search-index';

export async function fetch10K(ticker) {
  // TODO: Implement 10-K filing fetch
  return null;
}

export async function extractMDA(filingHtml) {
  // TODO: Extract Management Discussion & Analysis (Item 7)
  return null;
}
