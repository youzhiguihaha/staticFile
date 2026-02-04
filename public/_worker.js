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
  'css': 'text/css; charset=utf-8',
  'html': 'text/html; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
  'mp3': 'audio/mpeg', 'lrc': 'text/plain; charset=utf-8'
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
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV Error' }), { status: 500 });

    // --- 上传 (核心双 KV 逻辑) ---
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400 });
      
      const safeName = file.name.replace(/[\/|]/g, '_'); 
      const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
      
      // 1. 物理内容 Key: file:<UUID>
      const fileId = `file:${uuidv4()}`;
      
      // 2. 逻辑路径 Key: path:folder/filename
      // 为了排序，不加时间戳了，直接用路径 (覆盖旧文件)
      const pathKey = `path:${pathPrefix}${safeName}`;

      // 存内容
      await env.MY_BUCKET.put(fileId, file.stream(), {
          metadata: { type: file.type, size: file.size, name: safeName }
      });

      // 存路径映射
      const meta = {
          fileId: fileId, // 关联物理文件
          name: safeName,
          type: file.type,
          size: file.size,
          uploadedAt: Date.now()
      };
      // 注意：这里把 meta 同时也写进 value，方便读取
      await env.MY_BUCKET.put(pathKey, JSON.stringify(meta), { metadata: meta });

      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 新建文件夹 (单 KV) ---
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); // path: "A/B/"
      // 直接存 path:A/B/，Value 空
      const folderKey = `path:${path}`;
      const folderName = path.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // --- 列表 ---
    if (url.pathname === '/api/list') {
      let files = [];
      let listParams = { prefix: 'path:', limit: 1000 }; // 只扫描逻辑路径
      let listing;
      do {
          listing = await env.MY_BUCKET.list(listParams);
          for (const k of listing.keys) {
              const realPath = k.name.slice(5); // 去掉 path:
              files.push({ 
                  key: realPath,
                  ...k.metadata,
                  // 如果是文件，元数据里应该有 fileId
                  fileId: k.metadata?.fileId
              });
          }
          listParams.cursor = listing.cursor;
      } while (listing.list_complete === false);
      
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    
    // --- 移动 (只改 path，不动 file) ---
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json(); // sourceKey: "A/b.jpg"
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
                    
                    // 读取原 path 的 Value (元数据)
                    const val = await env.MY_BUCKET.get(oldKey);
                    if (val) { // val 可能是 'folder' 或 JSON
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

    // --- 批量删除 (联动删除) ---
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json(); // keys: ["A/b.jpg"]
       for (const uiKey of keys) {
         const targetKey = `path:${uiKey}`;
         
         // 1. 如果是文件，先读 fileId 并删除物理文件
         if (!targetKey.endsWith('/')) {
             const metaStr = await env.MY_BUCKET.get(targetKey);
             try {
                 const meta = JSON.parse(metaStr);
                 if (meta && meta.fileId) {
                     await env.MY_BUCKET.delete(meta.fileId); 
                 }
             } catch(e) {} 
             await env.MY_BUCKET.delete(targetKey); 
         }
         
         // 2. 如果是文件夹，递归删除
         if (targetKey.endsWith('/')) {
             await env.MY_BUCKET.delete(targetKey);
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) {
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
    // 格式: /file/file:UUID.js
    let pathPart = url.pathname.replace('/file/', '');
    let fileId = decodeURIComponent(pathPart);
    
    // 去掉可能的后缀
    const lastDot = fileId.lastIndexOf('.');
    if (lastDot > 0) fileId = fileId.substring(0, lastDot);

    // 安全检查
    if (!fileId.startsWith('file:')) return new Response('Invalid File ID', { status: 400 });

    const ext = pathPart.split('.').pop().toLowerCase();
    const isScript = ['js', 'json', 'txt', 'css'].includes(ext);
    
    // 使用 arrayBuffer 读取 (Buffer-First 策略)
    // 这是你之前验证过可行的方案
    const fetchType = isScript ? 'arrayBuffer' : 'stream';

    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: fetchType });
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    headers.set('Access-Control-Allow-Origin', '*'); 
    
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', metadata?.type || 'application/octet-stream');

    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
      // 脚本强制短连接 + 禁止缓存变换
      headers.set('Connection', 'close');
      headers.set('Cache-Control', 'no-transform');
    } else {
        if (metadata?.size) headers.set('Content-Length', metadata.size.toString());
        headers.set('Connection', 'keep-alive');
        headers.set('Cache-Control', 'public, max-age=86400');
    }

    return new Response(value, { headers });

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
