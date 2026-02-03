import { Env, authorize, jsonResponse, errorResponse } from '../utils';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorize(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!key) {
    return errorResponse('Missing key parameter');
  }

  try {
    await env.BUCKET.delete(key);
    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse('Failed to delete: ' + (err as Error).message, 500);
  }
};
