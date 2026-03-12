export async function valuateRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');

  if (!ticker) return errorResponse('ticker parameter required', 400);

  if (request.method === 'GET') {
    const valuation = await env.DB.prepare(
      'SELECT * FROM valuations WHERE ticker = ?'
    ).bind(ticker).first();

    if (!valuation) return errorResponse('No valuation found', 404);
    return jsonResponse(valuation);
  }

  return errorResponse('Method not allowed', 405);
}
