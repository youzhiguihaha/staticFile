// MIME 类型映射表 (作为后备)
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
  const isAuthorized = authHeader === `Bearer ${password}`;
  
  if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

  try {
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response('Method 405', { status: 405, headers: corsHeaders });
      const body = await request.json();
      return body.password === password 
        ? new Response(JSON.stringify({ success: true, token: password }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        : new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    // --- 移动/重命名 (带防递归和分页) ---
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        const safeTargetPath = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        
        if (sourceKey.endsWith('/') && safeTargetPath.startsWith(sourceKey)) {
             return new Response('Cannot move folder into itself', { status: 400, headers: corsHeaders });
        }

        const isFolder = sourceKey.endsWith('/');
        if (isFolder) {
            let listParams = { prefix: sourceKey };
            let listing;
            let movedCount = 0;
            // 循环处理分页
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    const folderName = sourceKey.split('/').filter(Boolean).pop();
                    const relativePath = oldKey.slice(sourceKey.length);
                    const newKey = `${safeTargetPath}${folderName}/${relativePath}`;
                    
                    if (oldKey === newKey) continue;
                    
                    // 获取元数据和流
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
            // 单文件移动
            const fileName = sourceKey.split('/').pop();
            const newKey = safeTargetPath + fileName;
            if (sourceKey === newKey) return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

            const { value: stream, metadata } = await env.MY_BUCKET.getWithMetadata(sourceKey, { type: 'stream' });
            if (!stream) return new Response('File not found', { status: 404, headers: corsHeaders });
            
            await env.MY_BUCKET.put(newKey, stream, { metadata });
            await env.MY_BUCKET.delete(sourceKey);
            return new Response(JSON.stringify({ success: true, newKey }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
    }

    // --- 上传 ---
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-\u4e00-\u9fa5]/g, '_'); 
      let keyPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: file.name, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true, key }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 新建文件夹 ---
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      if (!path) return new Response('Path required', { status: 400, headers: corsHeaders });
      const folderKey = path.endsWith('/') ? path : `${path}/`;
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: path.split('/').filter(Boolean).pop(), type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 列表 (支持前缀查询优化) ---
    if (url.pathname === '/api/list') {
      // 简单实现：列出所有。如果文件数过万，这里需要改为分页 API 传给前端
      // 目前 Cloudflare 免费版限制每次 list 1000，这里做简单的循环获取所有
      let files = [];
      let listParams = { limit: 1000 };
      let listing;
      do {
          listing = await env.MY_BUCKET.list(listParams);
          for (const k of listing.keys) {
              files.push({ key: k.name, ...k.metadata });
          }
          listParams.cursor = listing.cursor;
      } while (listing.list_complete === false);

      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    
    // --- 批量删除 (带分页) ---
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       let deleteCount = 0;
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         deleteCount++;
         // 递归删除子项
         const prefix = targetKey.endsWith('/') ? targetKey : targetKey + '/';
         let listParams = { prefix: prefix };
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
       return new Response(JSON.stringify({ success: true, count: deleteCount }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

// --- 文件直链处理 (核心优化) ---
async function handleFile(request, env) {
  try {
    const rawKey = new URL(request.url).pathname.replace('/file/', '');
    const key = decodeURIComponent(rawKey);

    // 1. 判断是否为"代码/文本"类文件 (容易出现 ECONNRESET 的类型)
    // 扩展了列表，包含常见文本格式
    const isTextOrCode = /\.(js|json|txt|css|html|xml|md|csv|lrc|yml|yaml|ts|tsx|log|conf|ini)$/i.test(key);
    
    // 文本类强制用 arrayBuffer 读取到内存，二进制大文件用 stream
    const fetchType = isTextOrCode ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });
    
    const headers = new Headers(corsHeaders);
    
    // 2. 智能判定 Content-Type
    let contentType = metadata?.type;
    if (!contentType || contentType === 'application/octet-stream') {
        const ext = key.split('.').pop().toLowerCase();
        if (MIME_TYPES[ext]) contentType = MIME_TYPES[ext];
    }
    // 确保文本类型有 charset
    if (contentType && (contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript')) && !contentType.includes('charset')) {
        contentType += '; charset=utf-8';
    }
    headers.set('Content-Type', contentType || 'application/octet-stream');
    
    // 3. 设置 Content-Length (对客户端下载至关重要)
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Content-Disposition', 'inline'); // 默认在线预览
    
    return new Response(value, { headers });
  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
