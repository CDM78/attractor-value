// Yahoo Finance unofficial API adapter
// Designed with adapter pattern so we can swap to a paid API later

const BASE_URL = 'https://query1.finance.yahoo.com';

export async function fetchQuote(ticker) {
  // TODO: Implement
  return null;
}

export async function fetchBulkQuotes(tickers) {
  // TODO: Implement bulk screening data fetch
  return [];
}

export async function fetchFinancials(ticker) {
  // TODO: Implement balance sheet + income statement fetch
  return null;
}
