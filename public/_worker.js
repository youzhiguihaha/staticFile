// 基于用户提供的稳定版本进行功能增强
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);

      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404 && !url.pathname.includes('.')) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }
      return asset;
    } catch (e) {
      return new Response(`System Error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

// 简单的 SHA-256 (用于 Token 加密)
async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization');
  const password = env.PASSWORD || "admin"; 
  const passwordHash = await sha256(password);

  // 1. 登录 (返回 Hash)
  if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      const body = await request.json();
      if (body.password === password) {
        return new Response(JSON.stringify({ success: true, token: passwordHash }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
  }

  // 验证 Token
  const token = authHeader ? authHeader.replace('Bearer ', '') : '';
  if (token !== passwordHash) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

  if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers: corsHeaders });

  try {
    // 2. 上传 (回归标准路径结构: "folder/file.ext")
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      // 路径保持原样，不做特殊字符替换，只去除非法字符
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-\u4e00-\u9fa5]/g, '_');
      // 确保 folder 以 / 结尾
      const prefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      const key = `${prefix}${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: file.name, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      
      return new Response(JSON.stringify({ success: true, key }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 3. 列表
    if (url.pathname === '/api/list') {
      let files = [];
      let listParams = { limit: 1000 };
      let listing;
      do {
          listing = await env.MY_BUCKET.list(listParams);
          for (const k of listing.keys) { files.push({ key: k.name, ...k.metadata }); }
          listParams.cursor = listing.cursor;
      } while (listing.list_complete === false);
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 4. 创建文件夹 (标准路径: "folder/")
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      const folderKey = path.endsWith('/') ? path : `${path}/`;
      const folderName = path.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    
    // 5. 递归移动
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        const safeTargetPath = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        
        if (sourceKey.endsWith('/') && safeTargetPath.startsWith(sourceKey)) return new Response('Error', { status: 400, headers: corsHeaders });

        const isFolder = sourceKey.endsWith('/');
        if (isFolder) {
            let listParams = { prefix: sourceKey };
            let listing; 
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    const suffix = oldKey.slice(sourceKey.length); 
                    const folderName = sourceKey.split('/').filter(Boolean).pop();
                    const newKey = `${safeTargetPath}${folderName}/${suffix}`;
                    if (oldKey === newKey) continue;
                    
                    const val = await env.MY_BUCKET.get(oldKey, { type: 'stream' });
                    if (val) {
                        await env.MY_BUCKET.put(newKey, val, { metadata: item.metadata });
                        await env.MY_BUCKET.delete(oldKey);
                    }
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
        } else {
            const fileName = sourceKey.split('/').pop();
            const newKey = safeTargetPath + fileName;
            const { value, metadata } = await env.MY_BUCKET.getWithMetadata(sourceKey, { type: 'stream' });
            if (value) {
                await env.MY_BUCKET.put(newKey, value, { metadata });
                await env.MY_BUCKET.delete(sourceKey);
            }
        }
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 6. 批量删除
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       let deleteCount = 0;
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         deleteCount++;
         // 如果是文件夹，删除其下所有内容
         const isFolder = targetKey.endsWith('/') || !targetKey.includes('.');
         if (isFolder) {
             const prefix = targetKey.endsWith('/') ? targetKey : `${targetKey}/`;
             let listParams = { prefix };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) { await env.MY_BUCKET.delete(subKey.name); deleteCount++; }
                listParams.cursor = listing.cursor;
             } while (listing.list_complete === false);
         }
       }
       return new Response(JSON.stringify({ success: true, count: deleteCount }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

// --- 文件直链 (集成 Base64 解码 + 你的稳定逻辑) ---
async function handleFile(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    
    // 1. Base64 解码逻辑 (保留以支持安全分享)
    let key;
    try {
        let base64Str = pathPart;
        const lastDot = pathPart.lastIndexOf('.');
        if (lastDot > 0 && pathPart.length - lastDot < 10) base64Str = pathPart.substring(0, lastDot);
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) {
        // 如果解码失败，回退到直接解码 (兼容旧链接)
        key = decodeURIComponent(pathPart);
    }

    // 2. 你的核心稳定逻辑 (几乎未动)
    const isCodeFile = /\.(js|json|txt|css|html|xml|md|lrc)$/i.test(key);
    const fetchType = isCodeFile ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) {
      return new Response('File Not Found', { status: 404, headers: corsHeaders });
    }
    
    const headers = new Headers(corsHeaders);
    
    // Content-Type
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
    
    // Content-Length (精确)
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    // 缓存 & 跨域
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');
    
    return new Response(value, { headers });

  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
