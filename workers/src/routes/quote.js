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

  // If ?update=true and ticker exists in our universe, update market_data.price
  const shouldUpdate = url.searchParams.get('update') === 'true';
  if (shouldUpdate) {
    const exists = await env.DB.prepare(
      'SELECT 1 FROM stocks WHERE ticker = ?'
    ).bind(ticker.toUpperCase()).first();

    if (exists) {
      await env.DB.prepare(
        `UPDATE market_data SET price = ?, fetched_at = datetime('now')
         WHERE ticker = ?`
      ).bind(quote.price, ticker.toUpperCase()).run();
    }
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
