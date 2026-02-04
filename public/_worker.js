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
};

// 简单的 SHA-256
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
          return new Response(JSON.stringify({ success: true, token: passwordHash }), { 
              headers: { 'Content-Type': 'application/json', ...corsHeaders } 
          });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    const token = authHeader ? authHeader.replace('Bearer ', '') : '';
    if (token !== passwordHash) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV未绑定' }), { status: 500 });

    // --- 双 KV 上传 ---
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400 });
      
      const safeName = file.name.replace(/[\/|]/g, '_'); 
      const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      
      // 1. 生成内容 ID (file:UUID)
      const fileId = `file:${uuidv4()}`;
      
      // 2. 生成路径 Key (path:folder/filename)
      const pathKey = `path:${pathPrefix}${safeName}`; // 注意不加时间戳了，直接用路径，或者你需要防重名可加
      // 如果为了防重名，还是加上时间戳比较稳
      const uniquePathKey = `path:${pathPrefix}${Date.now()}-${safeName}`;

      // 3. 存文件内容 (大文件用 stream，小文件无所谓)
      await env.MY_BUCKET.put(fileId, file.stream(), {
          // 这里存 metadata 主要是为了直链下载时方便读取类型
          metadata: { type: file.type, size: file.size, name: safeName }
      });

      // 4. 存路径映射 (只存 JSON 引用)
      const meta = {
          fileId: fileId,
          name: safeName,
          type: file.type,
          size: file.size,
          uploadedAt: Date.now()
      };
      await env.MY_BUCKET.put(uniquePathKey, JSON.stringify(meta), { metadata: meta });

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 新建文件夹 (只存一个占位符路径 key)
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); // "A/B/"
      const folderKey = `path:${path}`; // 确保以 / 结尾
      const folderName = path.split('/').filter(Boolean).pop();
      // 存一个空对象作为标记
      await env.MY_BUCKET.put(folderKey, JSON.stringify({ isFolder: true }), {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 列表 (只扫描 path: 开头的 key)
    if (url.pathname === '/api/list') {
      let files = [];
      let listParams = { prefix: 'path:', limit: 1000 };
      let listing;
      do {
          listing = await env.MY_BUCKET.list(listParams);
          for (const k of listing.keys) {
              // 去掉 'path:' 前缀返回给前端
              const realPath = k.name.slice(5); 
              files.push({ 
                  key: realPath, // 前端看到的 key (路径)
                  ...k.metadata, // 包含 fileId
                  // 如果 metadata 里没有 fileId (比如文件夹)，需要处理
                  fileId: k.metadata?.isFolder ? null : (k.metadata?.fileId || null)
              });
          }
          listParams.cursor = listing.cursor;
      } while (listing.list_complete === false);
      
      // 如果 metadata 丢失 (旧数据)，尝试从 value 补充 (性能较差，暂不实现，假设 metadata 健在)
      
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    
    // 移动 (只操作 path key，不动 file key)
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json(); // sourceKey: "A/b.jpg" (无path:前缀)
        const safeTargetPrefix = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        
        // 补全前缀
        const fullSourceKey = `path:${sourceKey}`;
        
        if (fullSourceKey.endsWith('/') && `path:${safeTargetPrefix}`.startsWith(fullSourceKey)) return new Response('Error', { status: 400 });

        const isFolder = fullSourceKey.endsWith('/');
        if (isFolder) {
            let listParams = { prefix: fullSourceKey };
            let listing; 
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name; // "path:A/b.jpg"
                    const suffix = oldKey.slice(fullSourceKey.length); 
                    const folderName = sourceKey.split('/').filter(Boolean).pop();
                    const newKey = `path:${safeTargetPrefix}${folderName}/${suffix}`;
                    
                    if (oldKey === newKey) continue;
                    // 读取 Value (包含 fileId 的 JSON)
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

    // 批量删除 (删 path 同时删 file)
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json(); // keys: ["A/b.jpg"]
       for (const uiKey of keys) {
         const targetKey = `path:${uiKey}`;
         
         // 1. 如果是文件，先读出 fileId 并删除内容
         if (!targetKey.endsWith('/')) {
             const metaStr = await env.MY_BUCKET.get(targetKey);
             try {
                 const meta = JSON.parse(metaStr);
                 if (meta && meta.fileId) {
                     await env.MY_BUCKET.delete(meta.fileId); // 删除物理文件
                 }
             } catch(e) {} // 忽略错误
             await env.MY_BUCKET.delete(targetKey); // 删除路径记录
         }
         
         // 2. 如果是文件夹，递归删除
         if (targetKey.endsWith('/')) {
             await env.MY_BUCKET.delete(targetKey); // 删除文件夹本身记录
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) {
                    // 读取子文件 fileId
                    const subMetaStr = await env.MY_BUCKET.get(subKey.name);
                    try {
                        const subMeta = JSON.parse(subMetaStr);
                        if (subMeta && subMeta.fileId) await env.MY_BUCKET.delete(subMeta.fileId);
                    } catch(e) {}
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

// --- 直链下载 (只认 file:ID) ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    // URL 格式: /file/file:UUID.js
    // 我们只需要 file:UUID 部分
    let pathPart = url.pathname.replace('/file/', '');
    
    // 去掉可能的伪后缀 (.js, .mp3)
    // 简单粗暴：file: 开头，直到遇到第一个非 ID 字符或者 . 
    // 其实 fileId 是固定的，我们直接找 file: 到 . 之前的部分
    let fileId = decodeURIComponent(pathPart);
    const lastDot = fileId.lastIndexOf('.');
    if (lastDot > 0) fileId = fileId.substring(0, lastDot);

    // 安全检查：必须是 file: 开头
    if (!fileId.startsWith('file:')) return new Response('Invalid File ID', { status: 400, headers: corsHeaders });

    // 1. 直接读取内容 (使用你验证过的稳定逻辑)
    // 判定文件类型
    const ext = pathPart.split('.').pop().toLowerCase();
    const isCode = ['js', 'json', 'txt', 'css', 'html', 'lrc'].includes(ext);
    const fetchType = isCode ? 'arrayBuffer' : 'stream';

    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    headers.set('Access-Control-Allow-Origin', '*'); 
    
    // Content-Type
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', metadata?.type || 'application/octet-stream');

    // Length
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata?.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Connection', 'keep-alive');

    return new Response(value, { headers });

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
