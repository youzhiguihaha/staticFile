// 生成 UUID
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

    // 登录
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

    // --- 上传 (文件使用双KV) ---
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400 });
      
      const safeName = file.name.replace(/[\/|]/g, '_'); 
      const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      
      // 1. 生成物理内容ID
      const fileId = `file:${uuidv4()}`;
      // 2. 生成逻辑路径Key (不加时间戳前缀，直接覆盖，符合文件系统直觉)
      const pathKey = `path:${pathPrefix}${safeName}`;

      // 存物理内容
      await env.MY_BUCKET.put(fileId, file.stream(), {
          metadata: { type: file.type, size: file.size, name: safeName }
      });

      // 存路径映射
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

    // --- 新建文件夹 (简单路径标记) ---
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); // path: "A/B/"
      // 确保以 / 结尾
      const safePath = path.endsWith('/') ? path : `${path}/`;
      const folderKey = `path:${safePath}`;
      const folderName = safePath.split('/').filter(Boolean).pop();
      
      // 存一个标记
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 列表 (修复：正确识别文件夹) ---
    if (url.pathname === '/api/list') {
      let files = [];
      let listParams = { prefix: 'path:', limit: 1000 };
      let listing;
      do {
          listing = await env.MY_BUCKET.list(listParams);
          for (const k of listing.keys) {
              const realPath = k.name.slice(5); // 去掉 path:
              // 判定是否为文件夹: metadata标记 或 路径以/结尾
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
    
    // --- 移动 (只改 path) ---
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
                    // 移动时保留 metadata (fileId 在里面)
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

    // --- 批量删除 (联动删物理文件) ---
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json(); 
       for (const uiKey of keys) {
         const targetKey = `path:${uiKey}`;
         
         // 1. 删除文件
         if (!targetKey.endsWith('/')) {
             const metaStr = await env.MY_BUCKET.get(targetKey);
             try {
                 const meta = JSON.parse(metaStr);
                 if (meta && meta.fileId) await env.MY_BUCKET.delete(meta.fileId); 
             } catch(e) {} 
             await env.MY_BUCKET.delete(targetKey); 
         }
         
         // 2. 递归删除文件夹
         if (targetKey.endsWith('/')) {
             await env.MY_BUCKET.delete(targetKey);
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) {
                    // 如果子项是文件，也要删 fileId
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

// --- 直链下载 (核心: 读物理ID，Buffer模式) ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    // URL格式: /file/file:UUID.js
    let pathPart = url.pathname.replace('/file/', '');
    let fileId = decodeURIComponent(pathPart);
    
    // 去掉可能的伪后缀
    const lastDot = fileId.lastIndexOf('.');
    if (lastDot > 0) fileId = fileId.substring(0, lastDot);

    // 安全校验
    if (!fileId.startsWith('file:')) return new Response('Invalid File ID', { status: 400 });

    const ext = pathPart.split('.').pop().toLowerCase();
    const isScript = ['js', 'json', 'txt', 'css', 'lrc', 'xml', 'md'].includes(ext);
    
    // 脚本强制内存读取 (Anti-ECONNRESET)
    const fetchType = isScript ? 'arrayBuffer' : 'stream';

    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: fetchType });
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    headers.set('Access-Control-Allow-Origin', '*'); 
    
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', metadata?.type || 'application/octet-stream');

    if (fetchType === 'arrayBuffer') {
      // 内存模式：精确长度 + 关闭连接 + 禁止变换
      headers.set('Content-Length', value.byteLength.toString());
      headers.set('Connection', 'close');
      headers.set('Cache-Control', 'no-transform, no-cache');
    } else {
        // 流模式：常规处理
        if (metadata?.size) headers.set('Content-Length', metadata.size.toString());
        headers.set('Connection', 'keep-alive');
        headers.set('Cache-Control', 'public, max-age=86400');
    }

    return new Response(value, { headers });

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
