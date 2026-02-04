// _worker.js

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
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  lrc: 'text/plain; charset=utf-8',
  mp4: 'video/mp4',
};

// 更稳的 CORS：显式列出常用头，支持 HEAD
const BASE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Max-Age': '86400',
  // 让前端/客户端能读取这些响应头（可选但建议）
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition',
};

export default {
  async fetch(request, env) {
    // 1) 全局 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: BASE_CORS });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);

      // Pages 静态资源
      return env.ASSETS.fetch(request);
    } catch (e) {
      // 捕获所有运行时错误，返回 500
      return new Response(e?.message || 'Internal Error', { status: 500, headers: BASE_CORS });
    }
  },
};

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('Authorization');
  const password = env.PASSWORD || 'admin';
  const passwordHash = await sha256(password);

  // login
  if (url.pathname === '/api/login') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });
    const body = await request.json();
    if (body.password === password) {
      return new Response(JSON.stringify({ success: true, token: passwordHash }), {
        headers: { 'Content-Type': 'application/json', ...BASE_CORS },
      });
    }
    return new Response(JSON.stringify({ success: false }), { status: 401, headers: BASE_CORS });
  }

  // auth
  const token = authHeader ? authHeader.replace('Bearer ', '') : '';
  if (token !== passwordHash) return new Response('Unauthorized', { status: 401, headers: BASE_CORS });

  if (!env.MY_BUCKET) {
    return new Response(JSON.stringify({ error: 'KV未绑定' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...BASE_CORS },
    });
  }

  // upload
  if (url.pathname === '/api/upload') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const formData = await request.formData();
    const file = formData.get('file');
    const folder = formData.get('folder') || '';
    if (!file) return new Response('No file', { status: 400, headers: BASE_CORS });

    const safeName = file.name.replace(/[\/|]/g, '_');
    const pathPrefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';

    const parts = safeName.split('.');
    const ext = parts.length > 1 ? `.${parts.pop()}` : '';
    const fileId = `${shortId()}${ext}`;

    const pathKey = `path:${pathPrefix}${safeName}`;

    // 先存文件本体（KV 单值限制 25MiB，超过会失败）
    await env.MY_BUCKET.put(fileId, file.stream(), {
      metadata: { type: file.type, size: file.size, name: safeName, uploadedAt: Date.now() },
    });

    // 再存索引（路径 -> meta）
    const meta = {
      fileId,
      name: safeName,
      type: file.type,
      size: file.size,
      uploadedAt: Date.now(),
    };
    await env.MY_BUCKET.put(pathKey, JSON.stringify(meta), { metadata: meta });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...BASE_CORS },
    });
  }

  // create folder
  if (url.pathname === '/api/create-folder') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const { path } = await request.json();
    const safePath = path.endsWith('/') ? path : `${path}/`;
    const folderKey = `path:${safePath}`;
    const folderName = safePath.split('/').filter(Boolean).pop();

    await env.MY_BUCKET.put(folderKey, 'folder', {
      metadata: { name: folderName, type: 'folder', uploadedAt: Date.now() },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...BASE_CORS },
    });
  }

  // list
  if (url.pathname === '/api/list') {
    let files = [];
    let listParams = { prefix: 'path:', limit: 1000 };
    let listing;

    do {
      listing = await env.MY_BUCKET.list(listParams);
      for (const k of listing.keys) {
        const realPath = k.name.slice(5); // remove "path:"
        const isFolder = k.metadata?.type === 'folder' || realPath.endsWith('/');
        files.push({
          key: realPath,
          ...k.metadata,
          fileId: isFolder ? null : (k.metadata?.fileId || null),
          type: isFolder ? 'folder' : (k.metadata?.type || 'unknown'),
        });
      }
      listParams.cursor = listing.cursor;
    } while (listing.list_complete === false);

    files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    return new Response(JSON.stringify({ success: true, files }), {
      headers: { 'Content-Type': 'application/json', ...BASE_CORS },
    });
  }

  // move
  if (url.pathname === '/api/move') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const { sourceKey, targetPath } = await request.json();
    const safeTargetPrefix = targetPath ? (targetPath.endsWith('/') ? targetPath : `${targetPath}/`) : '';
    const fullSourceKey = `path:${sourceKey}`;

    // 防止把文件夹移动到自己子目录
    if (fullSourceKey.endsWith('/') && `path:${safeTargetPrefix}`.startsWith(fullSourceKey)) {
      return new Response('Error', { status: 400, headers: BASE_CORS });
    }

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

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...BASE_CORS },
    });
  }

  // batch-delete
  if (url.pathname === '/api/batch-delete') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const { keys } = await request.json();

    for (const uiKey of keys) {
      const targetKey = `path:${uiKey}`;

      // 删除文件
      if (!targetKey.endsWith('/')) {
        const metaStr = await env.MY_BUCKET.get(targetKey);
        try {
          const meta = JSON.parse(metaStr);
          if (meta && meta.fileId) await env.MY_BUCKET.delete(meta.fileId);
        } catch (e) {
          // ignore
        }
        await env.MY_BUCKET.delete(targetKey);
      }

      // 删除文件夹（含子项）
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
              } catch (e) {
                // ignore
              }
            }
            await env.MY_BUCKET.delete(subKey.name);
          }
          listParams.cursor = listing.cursor;
        } while (listing.list_complete === false);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...BASE_CORS },
    });
  }

  return new Response('Not Found', { status: 404, headers: BASE_CORS });
}

async function handleFile(request, env) {
  try {
    // 只允许 GET/HEAD（OPTIONS 在最外层已处理）
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: BASE_CORS });
    }

    const url = new URL(request.url);
    const pathPart = url.pathname.replace('/file/', '');
    const fileId = decodeURIComponent(pathPart || '');

    if (!fileId || fileId.length < 5) {
      return new Response('Invalid ID', { status: 400, headers: BASE_CORS });
    }

    if (!env.MY_BUCKET) {
      return new Response('KV not bound', { status: 500, headers: BASE_CORS });
    }

    const ext = (fileId.split('.').pop() || '').toLowerCase();

    /**
     * 关键修复点：
     * - 不用 KV stream 直接回传（容易在某些环境触发 ECONNRESET）
     * - 改为 arrayBuffer
     * - 不手动写 Content-Length（避免被压缩/分块后长度不一致导致连接重置）
     */
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(fileId, { type: 'arrayBuffer' });
    if (!value) return new Response('File Not Found', { status: 404, headers: BASE_CORS });

    const headers = new Headers(BASE_CORS);

    // Content-Type：优先扩展名映射，其次走 metadata.type
    headers.set('Content-Type', MIME_TYPES[ext] || metadata?.type || 'application/octet-stream');

    // 缓存
    headers.set('Cache-Control', 'public, max-age=86400');

    // 可选：让下载更友好（不影响洛雪）
    // headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(metadata?.name || fileId)}"`);

    if (request.method === 'HEAD') {
      return new Response(null, { headers });
    }

    return new Response(value, { headers });
  } catch (e) {
    return new Response(`File Error: ${e?.message || 'Unknown'}`, { status: 500, headers: BASE_CORS });
  }
}
