// public/_worker.js

// 1. MIME 类型映射
const MIME = {
  js: 'application/javascript', json: 'application/json', html: 'text/html', css: 'text/css',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', mp3: 'audio/mpeg', pdf: 'application/pdf', zip: 'application/zip',
  txt: 'text/plain', csv: 'text/csv', svg: 'image/svg+xml'
};

// 2. 常量定义
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400'
};
const ROOT = 'root';
const PREFIX_DIR = 'dir:';
const PREFIX_BIN = 'bin:';
const MAX_FILE_SIZE = 24 * 1024 * 1024; // 24MB (留1MB缓冲)

// 内存缓存 (Worker 实例级)
const _memCache = new Map();

// 3. 工具函数
const now = () => Date.now();
const uuid = () => crypto.randomUUID().replace(/-/g, '');
const utf8 = (s) => new TextEncoder().encode(s);
const b64 = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const keyDir = (id) => `${PREFIX_DIR}${id}`;
const keyBin = (id) => `${PREFIX_BIN}${id}`;

// 4. 鉴权逻辑
async function sign(env, data) {
  const k = await crypto.subtle.importKey('raw', utf8(env.TOKEN_SECRET || 'secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', k, utf8(data))));
}

async function verifyAuth(req, env) {
  try {
    const h = req.headers.get('Authorization') || '';
    const t = h.split(' ')[1] || '';
    const [p, s] = t.split('.');
    if (await sign(env, p) !== s) return false;
    const d = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    return d.exp > now();
  } catch { return false; }
}

// 5. 目录操作 (带缓存)
async function getDir(env, id) {
  const c = _memCache.get(id);
  if (c && now() - c.t < 5000) return c.d; // 5秒内存缓存
  const d = await env.MY_BUCKET.get(keyDir(id), { type: 'json' });
  if (d) _memCache.set(id, { t: now(), d });
  return d;
}

async function putDir(env, dir) {
  dir.updatedAt = now();
  await env.MY_BUCKET.put(keyDir(dir.id), JSON.stringify(dir));
  _memCache.set(dir.id, { t: now(), d: dir });
}

// 6. 主逻辑
export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    
    try {
      const url = new URL(req.url);

      // --- 文件下载 (CDN 缓存优化) ---
      if (url.pathname.startsWith('/file/')) {
        const id = url.pathname.slice(6);
        const cache = caches.default;
        let res = await cache.match(req);
        if (res) return res;

        const { value, metadata } = await env.MY_BUCKET.getWithMetadata(keyBin(id), { type: 'stream' });
        if (!value) return new Response('Not Found', { status: 404, headers: CORS });

        const h = new Headers(CORS);
        h.set('Content-Type', metadata?.type || 'application/octet-stream');
        h.set('Content-Disposition', `inline; filename="${metadata?.name || 'file'}"`);
        // 关键：告诉 Cloudflare CDN 缓存一年，之后读取不消耗 KV 额度
        h.set('Cache-Control', 'public, max-age=31536000, immutable');
        h.set('Cloudflare-CDN-Cache-Control', 'max-age=31536000');

        res = new Response(value, { headers: h });
        ctx.waitUntil(cache.put(req, res.clone()));
        return res;
      }

      // --- API 接口 ---
      if (url.pathname.startsWith('/api/')) {
        // 登录
        if (url.pathname === '/api/login') {
          const { password } = await req.json().catch(()=>({}));
          if (password !== (env.PASSWORD || '')) return new Response('Unauthorized', { status: 401, headers: CORS });
          
          const exp = now() + 43200000; // 12h
          const payload = b64(utf8(JSON.stringify({ exp })));
          const sig = await sign(env, payload);
          return new Response(JSON.stringify({ token: `${payload}.${sig}` }), { headers: CORS });
        }

        // 鉴权拦截
        if (!await verifyAuth(req, env)) return new Response('Unauthorized', { status: 401, headers: CORS });

        // 确保根目录
        if (!await getDir(env, ROOT)) {
          await putDir(env, { id: ROOT, parentId: null, folders: {}, files: {} });
        }

        // 列出文件
        if (url.pathname === '/api/list') {
          const fid = url.searchParams.get('fid') || ROOT;
          const d = await getDir(env, fid);
          return new Response(JSON.stringify(d || {}), { headers: CORS });
        }

        // 上传文件 (批量优化)
        if (url.pathname === '/api/upload') {
          const fd = await req.formData();
          const folderId = fd.get('folderId') || ROOT;
          const dir = await getDir(env, folderId);
          if (!dir) return new Response('Dir Not Found', { status: 404, headers: CORS });

          let dirty = false;
          for (const f of fd.getAll('file')) {
            if (f.size > MAX_FILE_SIZE) continue;
            const fid = uuid();
            const safeName = f.name.replace(/[\/]/g, '_'); // 简单清洗
            await env.MY_BUCKET.put(keyBin(fid), f.stream(), { metadata: { type: f.type, name: safeName } });
            dir.files[safeName] = { id: fid, size: f.size, type: f.type, t: now() };
            dirty = true;
          }
          if (dirty) await putDir(env, dir); // 批量只写一次 KV
          return new Response('OK', { headers: CORS });
        }

        // 新建文件夹
        if (url.pathname === '/api/mkdir') {
          const { parentId, name } = await req.json();
          const p = await getDir(env, parentId);
          if (p.folders[name]) return new Response('Exists', { headers: CORS });
          
          const id = uuid();
          await putDir(env, { id, parentId, name, folders: {}, files: {} });
          p.folders[name] = id;
          await putDir(env, p);
          return new Response('OK', { headers: CORS });
        }

        // 移动/删除 (简化实现，保障核心功能)
        // 实际使用建议增加删除 KV 二进制文件的逻辑
        if (url.pathname === '/api/action') {
           // ...保留接口扩展位...
           return new Response('OK', { headers: CORS }); 
        }
      }

      return new Response('Not Found', { status: 404, headers: CORS });
    } catch (e) {
      return new Response(e.message, { status: 500, headers: CORS });
    }
  }
};