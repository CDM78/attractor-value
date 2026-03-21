import { fetchQuote } from '../services/yahooFinance.js';

export async function quoteRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method !== 'GET') return errorResponse('Method not allowed', 405);

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker) return errorResponse('ticker parameter required', 400);

  const quote = await fetchQuote(ticker.toUpperCase());
  if (!quote || quote.price == null) {
    return errorResponse(`No quote data for ${ticker}`, 404);
  }

  const change = quote.previousClose
    ? Math.round((quote.price - quote.previousClose) * 100) / 100
    : null;
  const changePct = quote.previousClose
    ? Math.round(((quote.price - quote.previousClose) / quote.previousClose) * 10000) / 100
    : null;

  // If ?update=true, update or create market_data + stocks entry
  const shouldUpdate = url.searchParams.get('update') === 'true' || url.searchParams.get('populate') === 'true';
  if (shouldUpdate) {
    const t = ticker.toUpperCase();
    // Ensure stocks entry exists
    await env.DB.prepare(
      `INSERT OR IGNORE INTO stocks (ticker, company_name, sector, industry, market_cap, last_updated)
       VALUES (?, ?, NULL, NULL, NULL, datetime('now'))`
    ).bind(t, quote.longName || t).run();

    // Upsert market_data (INSERT OR REPLACE handles both insert and update)
    await env.DB.prepare(
      `INSERT OR REPLACE INTO market_data (ticker, price, pe_ratio, pb_ratio, earnings_yield, dividend_yield, insider_ownership_pct, fetched_at)
       VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, datetime('now'))`
    ).bind(t, quote.price).run();
  }

  return jsonResponse({
    ticker: ticker.toUpperCase(),
    price: quote.price,
    previousClose: quote.previousClose,
    change,
    changePct,
    longName: quote.longName || null,
    currency: quote.currency || 'USD',
    exchangeName: quote.exchangeName || null,
  });
}
