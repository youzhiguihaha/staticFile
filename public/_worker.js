const SEP = '|';

// 严格的 MIME 类型表
const MIME_TYPES = {
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'html': 'text/html; charset=utf-8',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'mp3': 'audio/mpeg',
  'lrc': 'text/plain; charset=utf-8'
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

// --- API 逻辑 (保持功能不变) ---
async function handleApi(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const password = env.PASSWORD || "admin"; 
    
    // 1. 登录
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = await request.json();
      if (body.password === password) {
          // 这里简单返回 hash 模拟加密，实际部署可配合前端 subtle crypto
          return new Response(JSON.stringify({ success: true, token: password }), { 
              headers: { 'Content-Type': 'application/json', ...corsHeaders } 
          });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    if (authHeader !== `Bearer ${password}`) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV Error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    // 2. 上传
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400 });
      
      const safeName = file.name.replace(/[|]/g, '_'); 
      const keyPrefix = folder ? folder.split('/').filter(Boolean).join(SEP) + SEP : '';
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: safeName, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 3. 新建文件夹
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      const folderKey = path.split('/').filter(Boolean).join(SEP) + SEP;
      const folderName = path.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', { metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() } });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 4. 列表
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
    
    // 5. 移动
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        const safeTargetPrefix = targetPath ? targetPath.split('/').filter(Boolean).join(SEP) + SEP : '';
        if (sourceKey.endsWith(SEP) && safeTargetPrefix.startsWith(sourceKey)) return new Response('Error', { status: 400 });

        const isFolder = sourceKey.endsWith(SEP);
        const prefix = isFolder ? sourceKey : null;
        
        if (isFolder) {
            let listParams = { prefix };
            let listing; 
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    const suffix = oldKey.slice(sourceKey.length); 
                    const folderName = sourceKey.split(SEP).filter(Boolean).pop();
                    const newKey = `${safeTargetPrefix}${folderName}${SEP}${suffix}`;
                    if (oldKey === newKey) continue;
                    const val = await env.MY_BUCKET.get(oldKey, { type: 'stream' });
                    // 注意：这里用 get 获取流，因为是内部操作，不影响外部下载
                    // 但为了保留 metadata，我们需要 getWithMetadata (如果 KV 支持)
                    // 简化处理：我们这里重新 put，metadata 可能丢失，需要重新获取。
                    // 实际上 KV list 已经返回了 metadata，我们可以直接用 item.metadata
                    await env.MY_BUCKET.put(newKey, val, { metadata: item.metadata });
                    await env.MY_BUCKET.delete(oldKey);
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
        } else {
            const fileName = sourceKey.split(SEP).pop();
            const newKey = safeTargetPrefix + fileName;
            const { value, metadata } = await env.MY_BUCKET.getWithMetadata(sourceKey, { type: 'stream' });
            await env.MY_BUCKET.put(newKey, value, { metadata });
            await env.MY_BUCKET.delete(sourceKey);
        }
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 6. 批量删除
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         if (targetKey.endsWith(SEP)) {
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) await env.MY_BUCKET.delete(subKey.name);
                listParams.cursor = listing.cursor;
             } while (listing.list_complete === false);
         }
       }
       return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders });
}

// --- 终极重构：静态文件缓冲模式 ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    let key;
    try {
        let base64Str = pathPart;
        const lastDot = pathPart.lastIndexOf('.');
        if (lastDot > 0 && pathPart.length - lastDot < 10) base64Str = pathPart.substring(0, lastDot);
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) { key = decodeURIComponent(pathPart); }

    const ext = key.split('.').pop().toLowerCase();
    
    // 判断是否为 "敏感文件" (容易 ECONNRESET 的类型)
    const isSensitive = ['js', 'json', 'txt', 'css', 'lrc', 'xml'].includes(ext);

    // 【核心变更】
    // 1. 对于敏感文件，使用 'arrayBuffer' 读取整个文件到内存。
    // 2. 对于大文件(音视频)，仍然使用流，但添加更严格的头部。
    
    const fetchType = isSensitive ? 'arrayBuffer' : 'stream';
    const object = await env.MY_BUCKET.get(key, { type: fetchType });

    if (!object) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    headers.set('Access-Control-Allow-Origin', '*'); 
    
    // Content-Type
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', 'application/octet-stream');

    // 针对脚本文件的特殊处理
    if (isSensitive) {
        // 计算精确大小
        const size = object.byteLength;
        headers.set('Content-Length', size.toString());
        
        // 禁用压缩和分块，强制作为普通数据包发送
        headers.set('Content-Encoding', 'identity');
        headers.set('Transfer-Encoding', 'identity'); // 明确禁止 chunked
        
        // 缓存控制：禁止转换
        headers.set('Cache-Control', 'no-transform, public, max-age=86400');
        
        // 关闭连接，防止客户端复用连接导致状态不一致
        headers.set('Connection', 'close');
        
        return new Response(object, { headers });
    } 
    else {
        // 大文件/流媒体处理
        headers.set('Connection', 'keep-alive');
        headers.set('Cache-Control', 'public, max-age=86400');
        return new Response(object, { headers });
    }

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
