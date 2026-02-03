export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);

      const asset = await env.ASSETS.fetch(request);
      if (asset.status === 404 && !url.pathname.includes('.')) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }
      return asset;
    } catch (e) {
      return new Response(`System Error: ${e.message}`, { status: 500 });
    }
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
};

async function handleApi(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization');
  const password = env.PASSWORD || "admin"; 
  const isAuthorized = authHeader === `Bearer ${password}`;
  
  if (!env.MY_BUCKET) {
    return new Response(JSON.stringify({ error: 'KV未绑定 (MY_BUCKET missing)' }), { 
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  }

  try {
    if (url.pathname === '/api/login') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
      const body = await request.json();
      if (body.password === password) {
        return new Response(JSON.stringify({ success: true, token: password }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ success: false, error: '密码错误' }), { status: 401, headers: corsHeaders });
    }

    if (!isAuthorized) return new Response('Unauthorized', { status: 401, headers: corsHeaders });

    // --- 核心修复：递归移动 ---
    if (url.pathname === '/api/move') {
        const { sourceKey, targetPath } = await request.json();
        
        // 目标路径处理 (确保以 / 结尾，如果是根目录则为空)
        const safeTargetPath = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
        
        // 检查是否是文件夹 (以 / 结尾)
        const isFolder = sourceKey.endsWith('/');
        
        if (isFolder) {
            // 移动文件夹：列出所有前缀匹配的子项
            let listParams = { prefix: sourceKey };
            let listing;
            let movedCount = 0;
            
            do {
                listing = await env.MY_BUCKET.list(listParams);
                for (const item of listing.keys) {
                    const oldKey = item.name;
                    // 计算新 Key：把 sourceKey 前缀替换为 safeTargetPath + 文件夹名
                    // 例如：移动 "A/" 到 "B/"
                    // oldKey: "A/pic.jpg" -> relative: "pic.jpg" -> newKey: "B/A/pic.jpg"
                    
                    const folderName = sourceKey.split('/').filter(Boolean).pop(); // "A"
                    const relativePath = oldKey.slice(sourceKey.length); // "pic.jpg"
                    
                    // 新路径 = 目标目录 + 原文件夹名 + / + 相对路径
                    const newKey = `${safeTargetPath}${folderName}/${relativePath}`;
                    
                    if (oldKey === newKey) continue;

                    // 复制数据 (带 Metadata)
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
            // 移动单个文件
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
      
      return new Response(JSON.stringify({ success: true, key }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    if (url.pathname === '/api/create-folder') {
      const { path } = await request.json();
      if (!path) return new Response('Path required', { status: 400, headers: corsHeaders });
      const folderKey = path.endsWith('/') ? path : `${path}/`;
      await env.MY_BUCKET.put(folderKey, 'folder', {
        metadata: { name: path.split('/').filter(Boolean).pop(), type: 'folder', uploadedAt: Date.now() }
      });
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (url.pathname === '/api/list') {
      const list = await env.MY_BUCKET.list({ limit: 1000 }); // 简单列表，暂未分页
      const files = list.keys.map(k => ({ key: k.name, ...k.metadata }));
      files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      return new Response(JSON.stringify({ success: true, files }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/batch-delete') {
       const { keys } = await request.json();
       if (!Array.isArray(keys)) return new Response('Keys must be array', { status: 400, headers: corsHeaders });

       let deleteCount = 0;
       
       for (const targetKey of keys) {
         // 先删除本身
         await env.MY_BUCKET.delete(targetKey);
         deleteCount++;

         // 无论是不是文件夹，都尝试清理以此为前缀的子项 (确保文件夹内容被清空)
         // 注意：只匹配目录形式的前缀
         const prefix = targetKey.endsWith('/') ? targetKey : targetKey + '/';
         
         let listParams = { prefix: prefix };
         let listing;
         do {
            listing = await env.MY_BUCKET.list(listParams);
            if (listing.keys.length > 0) {
                for (const subKey of listing.keys) {
                    await env.MY_BUCKET.delete(subKey.name);
                    deleteCount++;
                }
            }
            listParams.cursor = listing.cursor;
         } while (listing.list_complete === false);
       }
       
       return new Response(JSON.stringify({ success: true, count: deleteCount }), {
         headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
  return new Response('Not Found', { status: 404, headers: corsHeaders });
}

async function handleFile(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const rawKey = new URL(request.url).pathname.replace('/file/', '');
    const key = decodeURIComponent(rawKey);

    const isCodeFile = /\.(js|json|txt|css|html|xml|md|csv)$/i.test(key);
    const fetchType = isCodeFile ? 'arrayBuffer' : 'stream';
    
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(key, { type: fetchType });
    
    if (!value) return new Response('File Not Found', { status: 404, headers: corsHeaders });
    
    const headers = new Headers(corsHeaders);
    
    if (metadata && metadata.type) {
      const type = metadata.type;
      if ((type.includes('text') || type.includes('json') || type.includes('javascript')) && !type.includes('charset')) {
           headers.set('Content-Type', `${type}; charset=utf-8`);
      } else {
           headers.set('Content-Type', type);
      }
    } else {
      headers.set('Content-Type', 'application/octet-stream');
    }
    
    if (fetchType === 'arrayBuffer') {
      headers.set('Content-Length', value.byteLength.toString());
    } else if (metadata && metadata.size) {
      headers.set('Content-Length', metadata.size.toString());
    }
    
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(value, { headers });
  } catch (e) {
    return new Response(`File Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
