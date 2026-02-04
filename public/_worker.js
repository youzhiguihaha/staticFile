// 内部存储分隔符 (用户不可见)
const SEP = '|';

const MIME_TYPES = {
  'html': 'text/html; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'md': 'text/markdown; charset=utf-8',
  'xml': 'application/xml; charset=utf-8',
  'csv': 'text/csv; charset=utf-8',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
  'mp3': 'audio/mpeg',
  'flac': 'audio/flac',
  'wav': 'audio/wav',
  'm4a': 'audio/mp4',
  'lrc': 'text/plain; charset=utf-8',
  'mp4': 'video/mp4'
};

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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Last-Modified, Content-Disposition',
};

async function handleApi(request, env) {
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
      
      // 1. 替换文件名中的非法字符 (包括分隔符 | )
      const safeFileName = file.name.replace(/[|]/g, '_'); 
      // 2. 文件夹路径转换 ( / -> | )
      let keyPrefix = folder ? folder.split('/').filter(Boolean).join(SEP) + SEP : '';
      
      const key = `${keyPrefix}${Date.now()}-${safeFileName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: safeFileName, type: file.type, size: file.size, uploadedAt: Date.now() }
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
        
        if (sourceKey.endsWith(SEP) && safeTargetPrefix.startsWith(sourceKey)) {
             return new Response('Cannot move folder into itself', { status: 400, headers: corsHeaders });
        }

        const isFolder = sourceKey.endsWith(SEP);
        if (isFolder) {
            let listParams = { prefix: sourceKey };
            let listing;
            let movedCount = 0;
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

// --- 文件直链核心逻辑 (Base64版) ---
async function handleFile(request, env) {
  try {
    // 1. 获取 Base64 字符串
    // URL 格式: /file/ZnVjay5qcGc=.jpg 或 /file/ZnVjay5qcGc=
    // 我们需要去掉开头的 /file/ 和结尾的 .ext (如果有)
    
    let pathPart = new URL(request.url).pathname.replace('/file/', '');
    
    // 尝试去除伪装的扩展名，找到最后一个 . 之后的部分，如果它看起来像扩展名 (长度<5)
    // 但 Base64 也可能包含符号，所以更安全的做法是：直接把整个字符串当作 Base64 尝试解码
    // 前端生成的格式是: /file/BASE64.ext
    
    let base64Str = pathPart;
    // 如果包含点，且点后面是扩展名，则去掉点和后缀
    const lastDotIndex = pathPart.lastIndexOf('.');
    if (lastDotIndex > 0) {
        base64Str = pathPart.substring(0, lastDotIndex);
    }
    
    // 解码 Base64 获取真实 Key
    let key;
    try {
        // atob 在 Worker 环境可用。注意：key 可能包含 UTF-8 字符，需要 escape/decodeURIComponent 处理
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) {
        // 如果解码失败，尝试直接作为 key 读取 (兼容旧链接)
        key = decodeURIComponent(pathPart);
    }

    const isTextOrCode = /\.(js|json|txt|css|html|xml|md|csv|lrc|yml|yaml|ts|tsx|log|conf|ini)$/i.test(key);
    
    // 2. 彻底解决 ECONNRESET：小文件和文本文件强制一次性读取 (arrayBuffer)
    // 其他大文件使用 stream
    const fetchType = isTextOrCode ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });
    
    const headers = new Headers(corsHeaders);
    
    // 3. 智能 Content-Type
    let contentType = metadata?.type;
    const ext = key.split('.').pop().toLowerCase();
    if (!contentType || contentType === 'application/octet-stream') {
        if (MIME_TYPES[ext]) contentType = MIME_TYPES[ext];
    }
    if (contentType && (contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript')) && !contentType.includes('charset')) {
        contentType += '; charset=utf-8';
    }
    headers.set('Content-Type', contentType || 'application/octet-stream');
    
    // 4. 精确 Content-Length
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    // 5. 关键：Content-Disposition
    // 告诉客户端这是什么文件，让它不要瞎猜
    const fileName = key.split(SEP).pop(); // 获取真实文件名
    // 使用 encodeURIComponent 编码文件名，防止中文乱码导致 Header 错误
    headers.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    
    headers.set('Cache-Control', 'public, max-age=86400');
    
    return new Response(value, { headers });
  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
