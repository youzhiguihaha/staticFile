import { Env, authorize, jsonResponse, errorResponse } from '../utils';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorize(request, env)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const list = await env.BUCKET.list();
    const files = list.objects.map((obj) => {
        // Construct the public URL
        // Assumes PUBLIC_DOMAIN is something like "https://files.example.com"
        // or just the domain if the user configured it that way.
        let url = '';
        if (env.PUBLIC_DOMAIN) {
            const domain = env.PUBLIC_DOMAIN.replace(/\/$/, '');
            url = `${domain}/${obj.key}`;
        } else {
            // Fallback if no domain configured (might not work for private buckets)
            url = `/${obj.key}`; 
        }

        return {
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded,
            url: url
        };
    });

    return jsonResponse({ files });
  } catch (err) {
    return errorResponse('Failed to list files: ' + (err as Error).message, 500);
  }
};
