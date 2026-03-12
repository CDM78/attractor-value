export async function transactionsRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const ticker = url.searchParams.get('ticker');

    let query = `SELECT t.*, s.company_name
       FROM transactions t
       JOIN stocks s ON t.ticker = s.ticker`;
    const binds = [];

    if (ticker) {
      query += ' WHERE t.ticker = ?';
      binds.push(ticker);
    }

    query += ' ORDER BY t.transaction_date DESC, t.id DESC LIMIT 200';

    const stmt = binds.length > 0
      ? env.DB.prepare(query).bind(...binds)
      : env.DB.prepare(query);

    const results = await stmt.all();
    return jsonResponse(results.results || []);
  }

  return errorResponse('Method not allowed', 405);
}
