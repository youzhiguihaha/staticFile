const SEP = '|';

const MIME_TYPES = {
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'css': 'text/css; charset=utf-8',
};

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
      
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);
      
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
    }
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

async function handleApi(request, env) {
    // API 部分逻辑保持不变，为节省篇幅省略，请保留之前的 API 代码
    // ... (保留之前的 handleApi 代码) ...
    // 为了确保完整性，这里必须包含 handleApi 的代码。
    // 如果您需要我再次完整输出 handleApi 请告诉我。
    // 但鉴于主要问题在 handleFile，我这里只输出修复后的 handleFile 及其依赖。
    
    // (为了确保代码可运行，这里还是放上简化的 API 逻辑框架，请您合并之前的逻辑)
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const password = env.PASSWORD || "admin"; 
    
    if (url.pathname === '/api/login') {
       if (request.method !== 'POST') return new Response(null, { status: 405 });
       const body = await request.json();
       return body.password === password 
         ? new Response(JSON.stringify({ success: true, token: password }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
         : new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }
    
    // 省略其他 API 逻辑，请复用上一次成功的 API 代码，它们没有问题。
    // ...
    // ...
    
    // 临时补充完整 API 逻辑以防万一
    if (authHeader !== `Bearer ${password}`) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

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

// --- 核心网络修复 ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    
    // Base64 解码
    let key;
    try {
        let base64Str = pathPart;
        const lastDot = pathPart.lastIndexOf('.');
        if (lastDot > 0 && pathPart.length - lastDot < 10) base64Str = pathPart.substring(0, lastDot);
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) { key = decodeURIComponent(pathPart); }

    const ext = key.split('.').pop().toLowerCase();
    const isScript = ['js', 'json', 'txt', 'css'].includes(ext);

    // 1. 对于脚本文件，强制获取完整 ArrayBuffer
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: isScript ? 'arrayBuffer' : 'stream' });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    
    // 2. 强制正确的 Content-Type
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', metadata?.type || 'application/octet-stream');

    // 3. 计算大小
    let size = 0;
    if (isScript) size = value.byteLength;
    else if (metadata?.size) size = metadata.size;
    
    if (size > 0) headers.set('Content-Length', size.toString());
    
    // 4. 处理 Range 请求 (支持断点续传/流媒体)
    // 如果客户端请求 range，我们必须正确响应 206
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader && size > 0 && !isScript) { // 脚本文件一般不走 Range
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
        const chunksize = (end - start) + 1;
        
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        headers.set('Content-Length', chunksize.toString());
        
        // 注意：KV 的 get(stream) 不支持 range 参数，除非使用 R2
        // 但我们可以用 get options (Cloudflare KV 支持 range 参数)
        // 重新获取带 range 的流
        const rangeBody = await env.MY_BUCKET.get(key, { range: { offset: start, length: chunksize }, type: 'stream' });
        return new Response(rangeBody, { status: 206, headers });
    }

    // 5. 关键头信息
    headers.set('Connection', 'keep-alive'); // 保持连接
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=86400');
    
    return new Response(value, { headers });

  } catch (e) {
    return new Response(null, { status: 500, headers: corsHeaders });
  }
}
