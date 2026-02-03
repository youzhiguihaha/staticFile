import { Env, authorize, jsonResponse, errorResponse } from '../utils';

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorize(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  // Get filename from header or use a timestamp
  let filename = request.headers.get('X-Custom-Filename');
  if (!filename) {
    filename = `file_${Date.now()}`;
  } else {
    filename = decodeURIComponent(filename);
  }

  // Ensure unique filenames if desired, or overwrite. R2 overwrites by default.
  // We will just write directly.

  try {
    const object = await env.BUCKET.put(filename, request.body);
    return jsonResponse({ 
        success: true, 
        key: object.key 
    });
  } catch (err) {
    return errorResponse('Failed to upload: ' + (err as Error).message, 500);
  }
};
