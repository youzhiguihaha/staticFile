// 生成 12 位纯字母数字 ID (无符号，超短)
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
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
  'mp3': 'audio/mpeg', 'lrc': 'text/plain; charset=utf-8'
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    // 强制全局 CORS，优先处理
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
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
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = await request.json();
      if (body.password === password) {
          return new Response(JSON.stringify({ success: true, token: passwordHash }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    const token = authHeader ? authHeader.replace('Bearer ', '') : '';
    if (token !== passwordHash) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500 });

    // --- 上传 (使用短ID) ---
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400 });
      
      const safeName = file.name.replace(/[\/|]/g, '_'); 
      const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      
      // 使用短 ID
      const fileId = shortId(); 
      const pathKey = `path:${pathPrefix}${safeName}`;

      await env.MY_BUCKET.put(fileId, file.stream(), {
          metadata: { type: file.type, size: file.size, name: safeName }
      });

      const meta = {
          fileId: fileId,
          name: safeName,
          type: file.type,
          size: file.size,
          uploadedAt: Date.now()
      };
      await env.MY_BUCKET.put(pathKey, JSON.stringify(meta), { metadata: meta });

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // ... (create-folder, list, move, batch-delete 逻辑保持之前的版本完全不变，直接复用即可) ...
    // 为了防止你复制出错，我这里还是把它们列出来
    
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); 
      const safePath = path.endsWith('/') ? path : `${path}/`;
      const folderKey = `path:${safePath}`;
      const folderName = safePath.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', { metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() } });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

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
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json(); 
        const safeTargetPrefix = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        const fullSourceKey = `path:${sourceKey}`;
        if (fullSourceKey.endsWith('/') && `path:${safeTargetPrefix}`.startsWith(fullSourceKey)) return new Response('Error', { status: 400 });
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
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

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
       return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders });
}

// --- 适配短 ID 的下载逻辑 ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    // URL格式: /file/a1b2c3d4e5f6.js
    let pathPart = url.pathname.replace('/file/', '');
    let fileId = decodeURIComponent(pathPart);
    
    // 去掉后缀
    const lastDot = fileId.lastIndexOf('.');
    if (lastDot > 0) fileId = fileId.substring(0, lastDot);

    // 格式检查 (12位 ID)
    if (fileId.length !== 12) return new Response('Invalid ID', { status: 400 });

    const ext = pathPart.split('.').pop().toLowerCase();
    const isScript = ['js', 'json', 'txt', 'css'].includes(ext);

    // 1. 读取模式：脚本用 Text，其他用 Stream
    // 注意：用 Text 读取是为了计算精确字节数，这是 Node.js 客户端不报错的关键
    if (isScript) {
        const textVal = await env.MY_BUCKET.get(fileId, { type: 'text' });
        if (textVal === null) return new Response('File Not Found', { status: 404, headers: corsHeaders });
        
        const encoder = new TextEncoder();
        const bytes = encoder.encode(textVal);
        
        const headers = new Headers(corsHeaders);
        headers.set('Content-Type', MIME_TYPES[ext] || 'text/plain; charset=utf-8');
        headers.set('Content-Length', bytes.length.toString());
        
        // 关键：不设 Connection: close，也不设 Keep-Alive，让 Cloudflare 自动处理
        // 关键：禁用压缩
        headers.set('Content-Encoding', 'identity');
        headers.set('Cache-Control', 'no-transform, public, max-age=86400');
        
        return new Response(bytes, { headers });
    } else {
        const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: 'stream' });
        if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

        const headers = new Headers(corsHeaders);
        if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
        else headers.set('Content-Type', metadata?.type || 'application/octet-stream');
        
        if (metadata?.size) headers.set('Content-Length', metadata.size.toString());
        headers.set('Cache-Control', 'public, max-age=86400');
        
        return new Response(value, { headers });
    }

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
