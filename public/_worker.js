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
    
    // 关键修复：
    // 检测是否为代码/文本文件 (js, json, txt, css等)
    // 如果是，强制使用 'arrayBuffer' 模式一次性读取到内存
    // 这能确保 Content-Length 100% 准确，解决电脑版软件的 ECONNRESET 问题
    const isCodeFile = /\.(js|json|txt|css|html|xml|md)$/i.test(key);
    const fetchType = isCodeFile ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) {
      return new Response('File Not Found', { status: 404, headers: corsHeaders });
    }
    
    const headers = new Headers(corsHeaders);
    
    // 1. 设置 Content-Type (带 UTF-8)
    if (metadata && metadata.type) {
      if (metadata.type.includes('text') || metadata.type.includes('json') || metadata.type.includes('javascript')) {
        if (!metadata.type.includes('charset')) {
           headers.set('Content-Type', `${metadata.type}; charset=utf-8`);
        } else {
           headers.set('Content-Type', metadata.type);
        }
      } else {
        headers.set('Content-Type', metadata.type);
      }
    } else {
      if (key.endsWith('.js')) headers.set('Content-Type', 'application/javascript; charset=utf-8');
      else if (key.endsWith('.json')) headers.set('Content-Type', 'application/json; charset=utf-8');
      else headers.set('Content-Type', 'application/octet-stream');
    }
    
    // 2. 设置 Content-Length (绝对精确)
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    // 3. 缓存设置
    headers.set('Cache-Control', 'public, max-age=86400');
    
    return new Response(value, { headers });

  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
