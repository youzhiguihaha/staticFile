const SEP = '|'; // 内部物理分隔符

// 严格 MIME 映射
const MIME_TYPES = {
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'html': 'text/html; charset=utf-8',
  'txt': 'text/plain; charset=utf-8',
  'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
  'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
  'mp3': 'audio/mpeg', 'mp4': 'video/mp4', 'lrc': 'text/plain; charset=utf-8'
};

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
      const url = new URL(request.url);
      
      // 路由分发
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

// --- API 业务逻辑 ---
async function handleApi(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const password = env.PASSWORD || "admin"; 
    
    // 登录验证
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = await request.json();
      // 返回密码哈希作为 Token (简化版)
      if (body.password === password) {
          return new Response(JSON.stringify({ success: true, token: password }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
      return new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    if (authHeader !== `Bearer ${password}`) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV Error' }), { status: 500 });

    // 文件上传
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; // "A/B/"
      if (!file) return new Response('No file', { status: 400 });
      
      // 路径标准化: "A/B/" -> "A|B|"
      const keyPrefix = folder ? folder.split('/').filter(Boolean).join(SEP) + SEP : '';
      const safeName = file.name.replace(/[|]/g, '_');
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: safeName, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 创建文件夹
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json(); // "A/B/"
      const folderKey = path.split('/').filter(Boolean).join(SEP) + SEP;
      const folderName = path.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', { metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() } });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 文件列表
    if (url.pathname === '/api/list') {
      const list = await env.MY_BUCKET.list({ limit: 1000 });
      const files = list.keys.map(k => ({ key: k.name, ...k.metadata }));
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    
    // 递归移动/重命名
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json(); // sourceKey: "A|", targetPath: "B/"
        const safeTargetPrefix = targetPath ? targetPath.split('/').filter(Boolean).join(SEP) + SEP : '';
        
        if (sourceKey.endsWith(SEP) && safeTargetPrefix.startsWith(sourceKey)) return new Response('Error', { status: 400 });

        const isFolder = sourceKey.endsWith(SEP);
        let movedCount = 0;

        if (isFolder) {
            let listParams = { prefix: sourceKey };
            let listing; 
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    const suffix = oldKey.slice(sourceKey.length); 
                    const folderName = sourceKey.split(SEP).filter(Boolean).pop();
                    const newKey = `${safeTargetPrefix}${folderName}${SEP}${suffix}`;
                    if (oldKey === newKey) continue;
                    
                    // 复制并删除 (KV 没有 rename)
                    const val = await env.MY_BUCKET.get(oldKey, { type: 'stream' });
                    if (val) {
                        await env.MY_BUCKET.put(newKey, val, { metadata: item.metadata });
                        await env.MY_BUCKET.delete(oldKey);
                        movedCount++;
                    }
                }
                listParams.cursor = listing.cursor;
            } while (listing.list_complete === false);
        } else {
            const fileName = sourceKey.split(SEP).pop();
            const newKey = safeTargetPrefix + fileName;
            const { value, metadata } = await env.MY_BUCKET.getWithMetadata(sourceKey, { type: 'stream' });
            if (value) {
                await env.MY_BUCKET.put(newKey, value, { metadata });
                await env.MY_BUCKET.delete(sourceKey);
            }
        }
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 批量删除
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         // 如果是文件夹，删除其下所有内容
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

// --- 文件下载 (Anti-ECONNRESET Core) ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    
    // Base64 解码
    let key;
    try {
        let base64Str = pathPart;
        const lastDot = pathPart.lastIndexOf('.');
        if (lastDot > 0 && pathPart.length - lastDot < 10) base64Str = pathPart.substring(0, lastDot);
        // 使用 decodeURIComponent(escape(atob())) 处理 UTF-8 字符
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) { return new Response('Bad Link', { status: 400 }); }

    const ext = key.split('.').pop().toLowerCase();
    
    // 判定是否为"敏感"文件 (脚本/文本)
    // 这些文件在 Node.js 客户端中最容易因为 Chunked Encoding 报错
    const isSensitive = ['js', 'json', 'txt', 'css', 'lrc', 'xml', 'md'].includes(ext);

    // 【策略】
    // 敏感文件 -> arrayBuffer (一次性内存读取，生成固定长度响应)
    // 大文件 -> stream (流式传输，支持 Range)
    const fetchType = isSensitive ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    headers.set('Access-Control-Allow-Origin', '*'); 
    
    // 1. Content-Type
    if (MIME_TYPES[ext]) headers.set('Content-Type', MIME_TYPES[ext]);
    else headers.set('Content-Type', metadata?.type || 'application/octet-stream');

    // 2. Content-Length & Optimization
    if (isSensitive) {
        // [关键] 内存模式：长度绝对精确
        headers.set('Content-Length', value.byteLength.toString());
        // [关键] 禁止压缩/转换，防止 Cloudflare 修改长度
        headers.set('Content-Encoding', 'identity');
        headers.set('Cache-Control', 'no-transform, public, max-age=86400');
        // [关键] 短连接，避免 Socket 挂起
        headers.set('Connection', 'close'); 
        
        return new Response(value, { headers });
    } else {
        // 流模式：尽可能提供长度
        if (metadata?.size) headers.set('Content-Length', metadata.size.toString());
        headers.set('Connection', 'keep-alive');
        headers.set('Cache-Control', 'public, max-age=86400');
        return new Response(value, { headers });
    }

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
