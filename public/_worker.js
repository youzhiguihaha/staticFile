// 生成纯净 UUID
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
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
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
};

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

    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400 });
      
      const safeName = file.name.replace(/[\/|]/g, '_'); 
      const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      
      const fileId = uuidv4(); 
      const pathKey = `path:${pathPrefix}${safeName}`;

      await env.MY_BUCKET.put(fileId, file.stream(), {
          metadata: { type: file.type, size: file.size, name: safeName }
      });

      const meta = { fileId, name: safeName, type: file.type, size: file.size, uploadedAt: Date.now() };
      await env.MY_BUCKET.put(pathKey, JSON.stringify(meta), { metadata: meta });

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); 
      const safePath = path.endsWith('/') ? path : `${path}/`;
      const folderKey = `path:${safePath}`;
      const folderName = safePath.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
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
                    if (val) {
                        await env.MY_BUCKET.put(newKey, val, { metadata: item.metadata });
                        await env.MY_BUCKET.delete(oldKey);
                    }
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
        } else {
            const fileName = sourceKey.split('/').pop();
            const newKey = `path:${safeTargetPrefix}${fileName}`;
            const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fullSourceKey);
            if (value) {
                await env.MY_BUCKET.put(newKey, value, { metadata });
                await env.MY_BUCKET.delete(fullSourceKey);
            }
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

// --- 终极 Anti-ECONNRESET 修复 ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    // URL格式: /file/UUID.js
    let pathPart = url.pathname.replace('/file/', '');
    let fileId = decodeURIComponent(pathPart);
    
    // 去掉可能的伪后缀
    const lastDot = fileId.lastIndexOf('.');
    if (lastDot > 0) fileId = fileId.substring(0, lastDot);

    if (fileId.length < 10) return new Response('Invalid ID', { status: 400 });

    const ext = pathPart.split('.').pop().toLowerCase();
    
    // 强制把这些容易报错的文件当做 "文本" 读取
    const isTextMode = ['js', 'json', 'txt', 'css', 'lrc', 'md', 'xml', 'html'].includes(ext);

    if (isTextMode) {
        // 1. 以文本方式读取 (KV 不会返回流，而是返回完整字符串)
        const textValue = await env.MY_BUCKET.get(fileId, { type: 'text' });
        
        if (textValue === null) return new Response('File Not Found', { status: 404, headers: corsHeaders });

        // 2. 转换回 Bytes 计算精确长度 (处理 UTF-8 多字节字符)
        const encoder = new TextEncoder();
        const bytes = encoder.encode(textValue);

        const headers = new Headers(corsHeaders);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Content-Type', MIME_TYPES[ext] || 'text/plain; charset=utf-8');
        headers.set('Content-Length', bytes.length.toString());
        
        // 3. 彻底禁用缓存和压缩
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        headers.set('Pragma', 'no-cache');
        headers.set('Content-Encoding', 'identity'); // 告诉 Cloudflare 不要压缩
        headers.set('Connection', 'close'); // 发送完立即断开

        // 4. 返回字节流
        return new Response(bytes, { headers });
    } else {
        // 二进制大文件 (图片/音频) 依然用流，否则内存不够
        const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: 'stream' });
        if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

        const headers = new Headers(corsHeaders);
        headers.set('Access-Control-Allow-Origin', '*'); 
        headers.set('Content-Type', metadata?.type || 'application/octet-stream');
        
        if (metadata?.size) headers.set('Content-Length', metadata.size.toString());
        headers.set('Cache-Control', 'public, max-age=86400');
        headers.set('Connection', 'keep-alive');

        return new Response(value, { headers });
    }

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
