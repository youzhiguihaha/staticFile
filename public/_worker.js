export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);

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
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } 
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

    if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    // 移动文件 (复制后删除旧的)
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        
        // 1. 获取源文件
        const sourceObj = await env.MY_BUCKET.get(sourceKey, { type: 'stream' });
        if (!sourceObj) return new Response('Source not found', { status: 404, headers: corsHeaders });

        // 2. 构造新 Key
        const fileName = sourceKey.split('/').pop();
        // 确保 targetPath 以 / 结尾（如果是根目录则为空）
        const validTargetPath = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        const newKey = validTargetPath + fileName;

        if (sourceKey === newKey) return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        // 3. 写入新位置 (保留元数据)
        // 注意：KV 的 list() 返回的 metadata 需要重新获取或传递，这里简单起见我们假设 metadata 在 copy 时能获取
        // 但 KV get() 不返回 metadata，除非使用 getWithMetadata。
        // 为了完整保留 metadata，我们重新读一次带 metadata
        const { value: stream, metadata } = await env.MY_BUCKET.getWithMetadata(sourceKey, { type: 'stream' });
        
        await env.MY_BUCKET.put(newKey, stream, { metadata });

        // 4. 删除旧文件
        await env.MY_BUCKET.delete(sourceKey);

        return new Response(JSON.stringify({ success: true, newKey }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-\u4e00-\u9fa5]/g, '_'); 
      let keyPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      // 移除时间戳前缀，方便移动和重命名，或者保留但移动时要小心处理
      // 为了逻辑简单，这里我们稍微简化 Key 的生成，只加时间戳前缀如果文件名冲突
      // 但为了保持兼容，继续使用时间戳-文件名
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: file.name, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      
      return new Response(JSON.stringify({ success: true, key }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      if (!path) return new Response('Path required', { status: 400, headers: corsHeaders });
      const folderKey = path.endsWith('/') ? path : `${path}/`;
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: path.split('/').filter(Boolean).pop(), type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (url.pathname === '/api/list') {
      const list = await env.MY_BUCKET.list({ limit: 1000 });
      const files = list.keys.map(k => ({ key: k.name, ...k.metadata }));
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       if (!Array.isArray(keys)) return new Response('Keys must be array', { status: 400, headers: corsHeaders });
       let deleteCount = 0;
       for (const targetKey of keys) {
         if (targetKey.endsWith('/')) {
            let listParams = { prefix: targetKey };
            let listing;
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const key of listing.keys) {
                    await env.MY_BUCKET.delete(key.name);
                    deleteCount++;
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
         } else {
            await env.MY_BUCKET.delete(targetKey);
            deleteCount++;
         }
       }
       return new Response(JSON.stringify({ success: true, count: deleteCount }), {
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
    const rawKey = new URL(request.url).pathname.replace('/file/', '');
    const key = decodeURIComponent(rawKey);

    const isCodeFile = /\.(js|json|txt|css|html|xml|md|csv)$/i.test(key);
    const fetchType = isCodeFile ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });
    
    const headers = new Headers(corsHeaders);
    
    if (metadata && metadata.type) {
      const type = metadata.type;
      if ((type.includes('text') || type.includes('json') || type.includes('javascript')) && !type.includes('charset')) {
           headers.set('Content-Type', `${type}; charset=utf-8`);
      } else {
           headers.set('Content-Type', type);
      }
    } else {
      headers.set('Content-Type', 'application/octet-stream');
    }
    
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
