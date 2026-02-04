// 生成 12 位纯字母数字 ID
function shortId() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  const randomValues = crypto.getRandomValues(new Uint8Array(12));
  for (let i = 0; i < 12; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

const MIME_TYPES = {
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'html': 'text/html; charset=utf-8',
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

const BASE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // 1. 全局 CORS 预检 (解决手机端预检失败)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: BASE_CORS });
    }

    try {
      const url = new URL(request.url);
      
      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);
      
      return env.ASSETS.fetch(request);
    } catch (e) {
      // 捕获所有运行时错误，返回 500
      return new Response(e.message, { status: 500, headers: BASE_CORS });
    }
  }
}

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

    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });
      const body = await request.json();
      if (body.password === password) {
          return new Response(JSON.stringify({ success: true, token: passwordHash }), { 
              headers: { 'Content-Type': 'application/json', ...BASE_CORS } 
          });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: BASE_CORS });
    }

    const token = authHeader ? authHeader.replace('Bearer ', '') : '';
    if (token !== passwordHash) return new Response('Unauthorized', { status: 401, headers: BASE_CORS });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500, headers: BASE_CORS });

    // 上传
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400, headers: BASE_CORS });
      
      const safeName = file.name.replace(/[\/|]/g, '_'); 
      const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      
      const fileId = shortId(); // 短ID
      const pathKey = `path:${pathPrefix}${safeName}`;

      // 存物理文件 (Metadata 中必须包含 size)
      await env.MY_BUCKET.put(fileId, file.stream(), {
          metadata: { type: file.type, size: file.size, name: safeName }
      });

      // 存逻辑路径
      const meta = { fileId, name: safeName, type: file.type, size: file.size, uploadedAt: Date.now() };
      await env.MY_BUCKET.put(pathKey, JSON.stringify(meta), { metadata: meta });

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...BASE_CORS } });
    }

    // 新建文件夹
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); 
      const safePath = path.endsWith('/') ? path : `${path}/`;
      const folderKey = `path:${safePath}`;
      const folderName = safePath.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...BASE_CORS } });
    }

    // 列表
    if (url.pathname === '/api/list') {
      let files = [];
      let listParams = { prefix: 'path:', limit: 1000 };
      let listing;
      do {
          listing = await env.MY_BUCKET.list(listParams);
          for (const k of listing.keys) {
              const realPath = k.name.slice(5); 
              const isFolder = k.metadata?.type === 'folder' || realPath.endsWith('/');
              files.push({ 
                  key: realPath,
                  ...k.metadata,
                  fileId: isFolder ? null : (k.metadata?.fileId || null),
                  type: isFolder ? 'folder' : (k.metadata?.type || 'unknown')
              });
          }
          listParams.cursor = listing.cursor;
      } while (listing.list_complete === false);
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...BASE_CORS } });
    }
    
    // 移动
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json(); 
        const safeTargetPrefix = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        const fullSourceKey = `path:${sourceKey}`;
        if (fullSourceKey.endsWith('/') && `path:${safeTargetPrefix}`.startsWith(fullSourceKey)) return new Response('Error', { status: 400, headers: BASE_CORS });
        const isFolder = fullSourceKey.endsWith('/');
        if (isFolder) {
            let listParams = { prefix: fullSourceKey };
            let listing; 
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name; 
                    const suffix = oldKey.slice(fullSourceKey.length); 
                    const folderName = sourceKey.split('/').filter(Boolean).pop();
                    const newKey = `path:${safeTargetPrefix}${folderName}/${suffix}`;
                    if (oldKey === newKey) continue;
                    const val = await env.MY_BUCKET.get(oldKey);
                    if (val) { await env.MY_BUCKET.put(newKey, val, { metadata: item.metadata }); await env.MY_BUCKET.delete(oldKey); }
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
        } else {
            const fileName = sourceKey.split('/').pop();
            const newKey = `path:${safeTargetPrefix}${fileName}`;
            const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fullSourceKey);
            if (value) { await env.MY_BUCKET.put(newKey, value, { metadata }); await env.MY_BUCKET.delete(fullSourceKey); }
        }
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...BASE_CORS } });
    }

    // 批量删除
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json(); 
       for (const uiKey of keys) {
         const targetKey = `path:${uiKey}`;
         if (!targetKey.endsWith('/')) {
             const metaStr = await env.MY_BUCKET.get(targetKey);
             try {
                 const meta = JSON.parse(metaStr);
                 if (meta && meta.fileId) await env.MY_BUCKET.delete(meta.fileId); 
             } catch(e) {} 
             await env.MY_BUCKET.delete(targetKey); 
         }
         if (targetKey.endsWith('/')) {
             await env.MY_BUCKET.delete(targetKey);
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) {
                    if (!subKey.name.endsWith('/')) {
                        const subMetaStr = await env.MY_BUCKET.get(subKey.name);
                        try {
                            const subMeta = JSON.parse(subMetaStr);
                            if (subMeta && subMeta.fileId) await env.MY_BUCKET.delete(subMeta.fileId);
                        } catch(e) {}
                    }
                    await env.MY_BUCKET.delete(subKey.name);
                }
                listParams.cursor = listing.cursor;
             } while (listing.list_complete === false);
         }
       }
       return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...BASE_CORS } });
    }
    return new Response('Not Found', { status: 404, headers: BASE_CORS });
}

// --- 核心修复：文件下载 ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    let pathPart = url.pathname.replace('/file/', '');
    let fileId = decodeURIComponent(pathPart);
    
    // 去掉后缀
    const lastDot = fileId.lastIndexOf('.');
    if (lastDot > 0) fileId = fileId.substring(0, lastDot);

    if (fileId.length < 5) return new Response('Invalid ID', { status: 400, headers: BASE_CORS });

    const ext = pathPart.split('.').pop().toLowerCase();
    
    // 3. 回归 stream 模式 (避免内存溢出导致 Worker 崩溃)
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: 'stream' });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: BASE_CORS });

    const headers = new Headers(BASE_CORS);
    
    // Content-Type
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', metadata?.type || 'application/octet-stream');

    // 4. 关键：手动设置 Content-Length (解决洛雪音乐不认分块传输的问题)
    // 之前用 stream 没有 size，现在我们利用 Metadata 里的 size
    if (metadata && metadata.size) {
        headers.set('Content-Length', metadata.size.toString());
    }

    // 缓存
    headers.set('Cache-Control', 'public, max-age=86400');
    
    // 5. 允许 Cloudflare 自动管理 Connection 和 Encoding
    // 不要手动设置 Connection: close，也不要禁止压缩，让 CDN 自动优化
    // 只要 Content-Length 存在，Node.js 客户端通常就能正常工作

    return new Response(value, { headers });

  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: BASE_CORS });
  }
}
