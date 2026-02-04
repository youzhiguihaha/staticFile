// 内部存储分隔符
const SEP = '|';

// 强制 MIME 类型表
const MIME_TYPES = {
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  // ... 其他类型保持默认检测
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      
      // 全局 CORS 处理
      if (request.method === 'OPTIONS') {
          return new Response(null, { headers: corsHeaders });
      }

      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);
      
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500, headers: corsHeaders });
    }
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

async function handleApi(request, env) {
    // API 逻辑保持不变，只需确保 list/upload 等操作使用了 SEP 分隔符
    // 为节省篇幅，请保留你之前文件中的 handleApi 内容
    // 重点是下面的 handleFile
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const password = env.PASSWORD || "admin"; 
    
    // Login
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
      const body = await request.json();
      return body.password === password 
        ? new Response(JSON.stringify({ success: true, token: password }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        : new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    if (authHeader !== `Bearer ${password}`) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    // Upload
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      const safeName = file.name.replace(/[|]/g, '_'); 
      let keyPrefix = folder ? folder.split('/').filter(Boolean).join(SEP) + SEP : '';
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: safeName, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true, key }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // Create Folder
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      if (!path) return new Response('Path required', { status: 400, headers: corsHeaders });
      const folderKey = path.split('/').filter(Boolean).join(SEP) + SEP;
      const folderName = path.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // List
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
    
    // Move
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        const safeTargetPrefix = targetPath ? targetPath.split('/').filter(Boolean).join(SEP) + SEP : '';
        if (sourceKey.endsWith(SEP) && safeTargetPrefix.startsWith(sourceKey)) return new Response('Error', { status: 400, headers: corsHeaders });
        const isFolder = sourceKey.endsWith(SEP);
        if (isFolder) {
            let listParams = { prefix: sourceKey };
            let listing; let movedCount = 0;
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    const suffix = oldKey.slice(sourceKey.length); 
                    const folderName = sourceKey.split(SEP).filter(Boolean).pop();
                    const newKey = `${safeTargetPrefix}${folderName}${SEP}${suffix}`;
                    if (oldKey === newKey) continue;
                    const { value: stream, metadata } = await env.MY_BUCKET.getWithMetadata(oldKey, { type: 'stream' });
                    if (stream) { await env.MY_BUCKET.put(newKey, stream, { metadata }); await env.MY_BUCKET.delete(oldKey); movedCount++; }
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
            return new Response(JSON.stringify({ success: true, count: movedCount }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } else {
            const fileName = sourceKey.split(SEP).pop();
            const newKey = safeTargetPrefix + fileName;
            if (sourceKey === newKey) return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            const { value: stream, metadata } = await env.MY_BUCKET.getWithMetadata(sourceKey, { type: 'stream' });
            if (!stream) return new Response('File not found', { status: 404, headers: corsHeaders });
            await env.MY_BUCKET.put(newKey, stream, { metadata });
            await env.MY_BUCKET.delete(sourceKey);
            return new Response(JSON.stringify({ success: true, newKey }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
    }

    // Batch Delete
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       let deleteCount = 0;
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         deleteCount++;
         if (targetKey.endsWith(SEP)) {
             let listParams = { prefix: targetKey };
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
    return new Response('Not Found', { status: 404, headers: corsHeaders });
}

async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    
    // Base64 解码逻辑
    let key;
    try {
        let base64Str = pathPart;
        // 智能去除伪后缀：找到最后一个点，且点之后看起来像扩展名（长度<10）
        const lastDot = pathPart.lastIndexOf('.');
        if (lastDot > 0 && pathPart.length - lastDot < 10) {
             base64Str = pathPart.substring(0, lastDot);
        }
        // 处理 URL 编码的 Base64 字符
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) {
        // 如果 Base64 解码失败，尝试直接作为 key 读取
        key = decodeURIComponent(pathPart);
    }

    // 关键修复：检测是否为脚本/文本文件
    const ext = key.split('.').pop().toLowerCase();
    const isScript = ['js', 'json', 'css', 'txt', 'md'].includes(ext);

    // 对于脚本文件，强制使用 arrayBuffer (内存模式)
    // 这是解决 ECONNRESET 的关键，因为 Stream 模式在某些客户端下不稳定
    const fetchType = isScript ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });
    
    const headers = new Headers(corsHeaders);
    
    // 强制设置正确的 Content-Type
    if (MIME_TYPES[ext]) {
        headers.set('Content-Type', MIME_TYPES[ext]);
    } else {
        headers.set('Content-Type', metadata?.type || 'application/octet-stream');
    }
    
    // 强制设置精确的 Content-Length
    let size = 0;
    if (fetchType === 'arrayBuffer') {
        size = value.byteLength;
    } else if (metadata && metadata.size) {
        size = metadata.size;
    }
    if (size > 0) headers.set('Content-Length', size.toString());

    // 缓存控制
    headers.set('Cache-Control', 'public, max-age=86400');
    // 防止自动 gzip 导致长度不匹配
    headers.set('Content-Encoding', 'identity');

    return new Response(value, { headers });

  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
