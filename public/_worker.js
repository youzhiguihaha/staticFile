// 内部存储分隔符
const SEP = '|';

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
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

async function handleApi(request, env) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const password = env.PASSWORD || "admin"; 
    
    // 登录
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = await request.json();
      return body.password === password 
        ? new Response(JSON.stringify({ success: true, token: password }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        : new Response(JSON.stringify({ success: false }), { status: 401, headers: corsHeaders });
    }

    if (authHeader !== `Bearer ${password}`) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    if (!env.MY_BUCKET) return new Response(JSON.stringify({ error: 'KV binding is missing' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

    // 上传
    if (url.pathname === '/api/upload') {
      const formData = await request.formData();
      const file = formData.get('file');
      const folder = formData.get('folder') || ''; 
      if (!file) return new Response('No file', { status: 400, headers: corsHeaders });
      const safeName = file.name.replace(/[|]/g, '_'); 
      let keyPrefix = folder ? folder.split('/').filter(Boolean).join(SEP) + SEP : '';
      const key = `${keyPrefix}${Date.now()}-${safeName}`;
      await env.MY_BUCKET.put(key, file.stream(), {
        metadata: { name: safeName, type: file.type, size: file.size, uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true, key }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 新建文件夹
    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      if (!path) return new Response('Path required', { status: 400, headers: corsHeaders });
      const folderKey = path.split('/').filter(Boolean).join(SEP) + SEP;
      const folderName = path.split('/').filter(Boolean).pop();
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // 列表
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
    
    // 移动/重命名
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        const safeTargetPrefix = targetPath ? targetPath.split('/').filter(Boolean).join(SEP) + SEP : '';
        if (sourceKey.endsWith(SEP) && safeTargetPrefix.startsWith(sourceKey)) return new Response('Error', { status: 400, headers: corsHeaders });
        const isFolder = sourceKey.endsWith(SEP);
        if (isFolder) {
            let listParams = { prefix: sourceKey };
            let listing; let movedCount = 0;
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    const suffix = oldKey.slice(sourceKey.length); 
                    const folderName = sourceKey.split(SEP).filter(Boolean).pop();
                    const newKey = `${safeTargetPrefix}${folderName}${SEP}${suffix}`;
                    if (oldKey === newKey) continue;
                    const { value: stream, metadata } = await env.MY_BUCKET.getWithMetadata(oldKey, { type: 'stream' });
                    if (stream) { await env.MY_BUCKET.put(newKey, stream, { metadata }); await env.MY_BUCKET.delete(oldKey); movedCount++; }
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

    // 批量删除
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       let deleteCount = 0;
       for (const targetKey of keys) {
         await env.MY_BUCKET.delete(targetKey);
         deleteCount++;
         if (targetKey.endsWith(SEP)) {
             let listParams = { prefix: targetKey };
             let listing;
             do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const subKey of listing.keys) { await env.MY_BUCKET.delete(subKey.name); deleteCount++; }
                listParams.cursor = listing.cursor;
             } while (listing.list_complete === false);
         }
       }
       return new Response(JSON.stringify({ success: true, count: deleteCount }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders });
}

// --- 核心修复：文件直链处理 ---
async function handleFile(request, env) {
  try {
    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    let key;
    try {
        // Base64 解码
        let base64Str = pathPart;
        const lastDot = pathPart.lastIndexOf('.');
        if (lastDot > 0 && pathPart.length - lastDot < 10) base64Str = pathPart.substring(0, lastDot);
        key = decodeURIComponent(escape(atob(base64Str)));
    } catch (e) { key = decodeURIComponent(pathPart); }

    const ext = key.split('.').pop().toLowerCase();
    // 判定是否为脚本/文本文件
    const isScript = ['js', 'json', 'txt', 'css', 'lrc', 'md', 'xml'].includes(ext);

    // 【关键点1】对于脚本文件，强制使用 'text' 模式读取
    // 这样 Cloudflare 会将其作为普通字符串处理，而不是二进制流
    // 这避免了 Chunked 编码问题
    if (isScript) {
        const object = await env.MY_BUCKET.get(key, { type: 'text' });
        if (object === null) return new Response('File Not Found', { status: 404, headers: corsHeaders });

        const headers = new Headers(corsHeaders);
        headers.set('Content-Type', MIME_TYPES[ext] || 'text/plain; charset=utf-8');
        
        // 【关键点2】禁止 Cloudflare 自动压缩或修改
        headers.set('Cache-Control', 'no-transform'); 
        
        // 【关键点3】短连接，防止 Socket 挂起
        headers.set('Connection', 'close'); 
        headers.set('Access-Control-Allow-Origin', '*');
        
        return new Response(object, { headers });
    }

    // 对于其他文件（图片/音频），保持原有的流式传输以支持大文件
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: 'stream' });
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });

    const headers = new Headers(corsHeaders);
    headers.set('Content-Type', metadata?.type || 'application/octet-stream');
    headers.set('Access-Control-Allow-Origin', '*');
    
    if (metadata?.size) headers.set('Content-Length', metadata.size.toString());
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Connection', 'keep-alive');

    // 支持 Range 请求 (音频/视频拖动进度条需要)
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
        // 简易 Range 实现: 这里仍然返回全量流，但客户端通常能处理
        // 如果需要严格 Range，需配合 R2 或自行切片
    }

    return new Response(value, { headers });

  } catch (e) { return new Response(null, { status: 500, headers: corsHeaders }); }
}
