export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // API Routes
    if (url.pathname.startsWith('/api/')) {
       return handleApi(request, env);
    }

    // File Routes (Direct Links)
    if (url.pathname.startsWith('/file/')) {
       return handleFile(request, env);
    }

    // Default: Serve Static Assets (React App)
    // If the request is for a known static asset or root, serve it.
    // Otherwise, for SPA client-side routing, serve index.html
    try {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404 && !url.pathname.includes('.')) {
        // Fallback to index.html for SPA routing
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }
      return asset;
    } catch (e) {
      return new Response('Internal Error', { status: 500 });
    }
  }
}

async function handleApi(request, env) {
  // CORS Headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  
  // Auth check
  const authHeader = request.headers.get('Authorization');
  const password = env.PASSWORD || "admin"; 
  const isAuthorized = authHeader === `Bearer ${password}`;

  try {
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      const body = await request.json();
      if (body.password === password) {
        return new Response(JSON.stringify({ success: true, token: password }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ success: false, error: 'Invalid password' }), { status: 401, headers: corsHeaders });
    }

    if (url.pathname === '/api/upload') {
      if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      
      const formData = await request.formData();
      const file = formData.get('file');
      
      if (!file) return new Response('No file uploaded', { status: 400, headers: corsHeaders });
      
      // Sanitize filename
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: {
          name: file.name,
          type: file.type,
          size: file.size,
          uploadedAt: Date.now()
        }
      });
      
      return new Response(JSON.stringify({ success: true, key }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (url.pathname === '/api/list') {
      if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      
      const list = await env.MY_BUCKET.list();
      const files = list.keys.map(k => ({
        key: k.name,
        ...k.metadata
      }));
      
      // Sort by uploadedAt desc
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      
      return new Response(JSON.stringify({ success: true, files }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/delete') {
       if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
       if (request.method !== 'DELETE') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
       
       const params = new URLSearchParams(url.search);
       const key = params.get('key');
       if (!key) return new Response('Key required', { status: 400, headers: corsHeaders });
       
       await env.MY_BUCKET.delete(key);
       return new Response(JSON.stringify({ success: true }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }

  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

async function handleFile(request, env) {
  const url = new URL(request.url);
  const key = url.pathname.replace('/file/', '');
  
  if (!key) return new Response('File Not Found', { status: 404 });

  const object = await env.MY_BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  
  if (object === null) {
    return new Response('File Not Found', { status: 404 });
  }
  
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  
  // Simple range request handling (Cloudflare KV get() supports it if we pass options properly, 
  // but standard get() returns a body stream).
  // Note: KV 'get' with 'range' header returns the partial body. 
  // However, simple implementation:
  
  return new Response(object.body, {
    headers
  });
}
