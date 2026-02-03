export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // API 路由
      if (url.pathname.startsWith('/api/')) {
        return handleApi(request, env);
      }

      // 文件直链路由 /file/:key
      if (url.pathname.startsWith('/file/')) {
        return handleFile(request, env);
      }

      // 默认：服务前端静态资源
      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404 && !url.pathname.includes('.')) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }
      return asset;
    } catch (e) {
      return new Response(`System Error: ${e.message}`, { status: 500 });
    }
  }
}

// 通用 CORS 头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  'Cache-Control': 'no-store', // 只有文件下载才缓存，API 不缓存
};

async function handleApi(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization');
  const password = env.PASSWORD || "admin"; 
  const isAuthorized = authHeader === `Bearer ${password}`;
  
  if (!env.MY_BUCKET) {
    return new Response(JSON.stringify({ error: 'KV未绑定 (MY_BUCKET missing)' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  }

  try {
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      const body = await request.json();
      if (body.password === password) {
        return new Response(JSON.stringify({ success: true, token: password }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ success: false, error: '密码错误' }), { status: 401, headers: corsHeaders });
    }

    if (url.pathname === '/api/upload') {
      if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `${Date.now()}-${safeName}`;
      
      // 同时写入 metadata
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: file.name, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      
      return new Response(JSON.stringify({ success: true, key }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (url.pathname === '/api/list') {
      if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      const list = await env.MY_BUCKET.list();
      const files = list.keys.map(k => ({ key: k.name, ...k.metadata }));
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/delete') {
       if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
       const key = new URLSearchParams(url.search).get('key');
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
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const key = new URL(request.url).pathname.replace('/file/', '');
    
    // 优先尝试以 arrayBuffer 方式读取（解决小文件流中断问题）
    // 但为了不消耗过多内存，我们还是先用 metadata 判断一下大小？
    // Cloudflare KV getWithMetadata 如果不指定 type 默认是 text，这不好。
    // 我们直接请求 arrayBuffer， Cloudflare Worker 内存通常有 128MB，
    // 对于脚本文件（通常 < 5MB）是完全安全的。
    // 如果是大文件，我们 catch 错误或者由用户自行承担（通常图床存小文件多）。
    
    // 策略优化：
    // 检测文件名后缀，如果是 .js, .json, .txt, .css, .html 这种文本类代码，
    // 强制使用 ArrayBuffer 模式，确保完整性。
    // 其他（图片、视频）使用 stream 模式。
    
    const isCodeFile = /\.(js|json|txt|css|html|xml)$/i.test(key);
    const fetchType = isCodeFile ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) {
      return new Response('File Not Found', { status: 404, headers: corsHeaders });
    }
    
    const headers = new Headers(corsHeaders);
    
    // Content-Type
    if (metadata && metadata.type) {
      headers.set('Content-Type', metadata.type);
    } else {
      // 补救措施：如果没有 metadata，根据后缀猜
      if (key.endsWith('.js')) headers.set('Content-Type', 'application/javascript; charset=utf-8');
      else if (key.endsWith('.json')) headers.set('Content-Type', 'application/json; charset=utf-8');
      else headers.set('Content-Type', 'application/octet-stream');
    }
    
    // Content-Length
    // 如果是 arrayBuffer，我们可以直接知道长度
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    headers.set('Cache-Control', 'public, max-age=86400');
    
    return new Response(value, { headers });

  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
