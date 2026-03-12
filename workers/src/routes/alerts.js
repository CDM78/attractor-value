export async function alertsRoutes(request, env, ctx, { path, jsonResponse, errorResponse }) {
  if (request.method === 'GET') {
    const alerts = await env.DB.prepare(
      'SELECT * FROM alerts WHERE dismissed = 0 ORDER BY created_at DESC'
    ).all();
    return jsonResponse(alerts.results || []);
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    const { id } = body;
    if (!id) return errorResponse('alert id required', 400);

    await env.DB.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ?').bind(id).run();
    return jsonResponse({ message: 'Alert dismissed' });
  }

  return errorResponse('Method not allowed', 405);
}
