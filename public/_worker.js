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
  'lrc': 'text/plain; charset=utf-8',
  'mp4': 'video/mp4'
};

// 安全分隔符 (替代斜杠)
const SEP = '|';

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
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Last-Modified',
};

async function handleApi(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const password = env.PASSWORD || "admin"; 
    
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response('Method 405', { status: 405, headers: corsHeaders });
      const body = await request.json();
      return body.password === password 
        ? new Response(JSON.stringify({ success: true, token: password }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        : new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    if (authHeader !== `Bearer ${password}`) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    // --- 上传 ---
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      // folder 传过来是 "photos/2023/" 格式，需要转为 "photos|2023|"
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-\u4e00-\u9fa5]/g, '_'); 
      // 转换路径分隔符
      let keyPrefix = folder ? folder.split('/').filter(Boolean).join(SEP) + SEP : '';
      
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: file.name, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true, key }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 新建文件夹 ---
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); // path: "photos/new/"
      if (!path) return new Response('Path required', { status: 400, headers: corsHeaders });
      
      // 转换为内部格式: "photos|new|"
      const folderKey = path.split('/').filter(Boolean).join(SEP) + SEP;
      const folderName = path.split('/').filter(Boolean).pop();
      
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 列表 (返回给前端时需要把 | 转回 / 吗？不需要，前端统一处理显示) ---
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
    
    // --- 移动/重命名 ---
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json(); // sourceKey: "a|b.jpg", targetPath: "new/path/"
        
        // 目标路径转内部格式: "new|path|"
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
                    // 计算新 Key
                    // sourceKey: "A|"
                    // oldKey: "A|pic.jpg"
                    // suffix: "pic.jpg"
                    const suffix = oldKey.slice(sourceKey.length); 
                    const folderName = sourceKey.split(SEP).filter(Boolean).pop(); // "A"
                    
                    // newKey: safeTargetPrefix + "A" + "|" + suffix
                    // 即 "B|A|pic.jpg"
                    const newKey = `${safeTargetPrefix}${folderName}${SEP}${suffix}`;
                    
                    if (oldKey === newKey) continue;
                    
                    const { value: stream, metadata } = await env.MY_BUCKET.getWithMetadata(oldKey, { type: 'stream' });
                    if (stream) {
                         await env.MY_BUCKET.put(newKey, stream, { metadata });
                         await env.MY_BUCKET.delete(oldKey);
                         movedCount++;
                    }
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

    // --- 批量删除 ---
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       let deleteCount = 0;
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         deleteCount++;
         // 递归删除: 如果是文件夹 "A|"，删除所有以 "A|" 开头的
         // 如果是文件 "A|b.jpg"，前缀就是它自己，list 不会多删
         // 但为了保险，如果是文件，我们不进行 list 删除
         if (targetKey.endsWith(SEP)) {
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) {
                    await env.MY_BUCKET.delete(subKey.name);
                    deleteCount++;
                }
                listParams.cursor = listing.cursor;
             } while (listing.list_complete === false);
         }
       }
       return new Response(JSON.stringify({ success: true, count: deleteCount }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
}

// --- 文件直链 ---
async function handleFile(request, env) {
  try {
    const rawKey = new URL(request.url).pathname.replace('/file/', '');
    // 这里 key 已经是 "A|B|c.jpg" 格式，浏览器不会把它当路径解析
    const key = decodeURIComponent(rawKey);

    const isTextOrCode = /\.(js|json|txt|css|html|xml|md|csv|lrc|yml|yaml|ts|tsx|log|conf|ini)$/i.test(key);
    const fetchType = isTextOrCode ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });
    
    const headers = new Headers(corsHeaders);
    
    let contentType = metadata?.type;
    if (!contentType || contentType === 'application/octet-stream') {
        const ext = key.split('.').pop().toLowerCase();
        if (MIME_TYPES[ext]) contentType = MIME_TYPES[ext];
    }
    if (contentType && (contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript')) && !contentType.includes('charset')) {
        contentType += '; charset=utf-8';
    }
    headers.set('Content-Type', contentType || 'application/octet-stream');
    
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Content-Disposition', 'inline'); 
    
    return new Response(value, { headers });
  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
