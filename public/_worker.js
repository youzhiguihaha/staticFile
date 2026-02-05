// public/_worker.js
// Cloudflare Workers (module) + KV based file explorer backend
// 注意：本实现不使用 KV 的 lists/list 操作；仅 get/put/delete/getWithMetadata。
// 并且尽量减少 KV 读写；/file 使用 edge cache；删除时 purge edge cache（方案C）。

// ======= MIME / CORS =======
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

const BASE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition, ETag',
};

// ======= KV Key conventions =======
const ROOT_ID = 'root';
const DIR_PREFIX = 'dir:'; // dir:<folderId>
const BIN_PREFIX = 'bin:'; // bin:<fileId>

// ======= Auth config =======
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

// Workers WebCrypto PBKDF2 iterations 上限 100000
const DEFAULT_PBKDF2_ITER = 100000;
const MAX_PBKDF2_ITER = 100000;
const MIN_PBKDF2_ITER = 10000;

// KV value 最大 25MiB（保守一点：24MiB）
const MAX_FILE_BYTES = 24 * 1024 * 1024;

// /file 资源不可变：一年缓存（适合随机 fileId 永不复用模型）
const FILE_CACHE_SECONDS = 31536000; // 1 year

// ======= in-memory caches (reduce KV reads) =======
let _rootEnsured = false;
const DIR_CACHE_TTL_MS = 5000;
const _dirCache = new Map(); // folderId -> { ts, dir }

// ======= Utils =======
function now() {
  return Date.now();
}

function shortId(len = 12) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  const rv = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) result += chars[rv[i] % chars.length];
  return result;
}

function dirKey(folderId) {
  return `${DIR_PREFIX}${folderId}`;
}
function binKey(fileId) {
  return `${BIN_PREFIX}${fileId}`;
}

function cleanName(name) {
  return (name || '').replace(/[\/\\|]/g, '').trim();
}

function utf8Encode(str) {
  return new TextEncoder().encode(str);
}
function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

function base64urlEncodeBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecodeToBytes(b64url) {
  const b64 =
    b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const h = (hex || '').trim().toLowerCase();
  if (!h || h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function getIterations(env) {
  const raw = parseInt((env.PBKDF2_ITERATIONS || '').toString(), 10);
  const v = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PBKDF2_ITER;
  return Math.min(Math.max(v, MIN_PBKDF2_ITER), MAX_PBKDF2_ITER);
}

// ======= Crypto: PBKDF2 + HMAC =======
let _hmacKeyPromise = null;

async function getHmacKey(env) {
  const secret = (env.TOKEN_SECRET || '').trim();
  if (!secret) throw new Error('TOKEN_SECRET missing');

  if (!_hmacKeyPromise) {
    _hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      utf8Encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }
  return _hmacKeyPromise;
}

async function hmacSign(env, messageBytes) {
  const key = await getHmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, messageBytes);
  return new Uint8Array(sig);
}

async function pbkdf2Hex(password, saltBytes, iterations, lengthBytes = 32) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8Encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    keyMaterial,
    lengthBytes * 8
  );
  return bytesToHex(new Uint8Array(bits));
}

async function verifyPassword(env, passwordInput) {
  passwordInput = (passwordInput || '').trim();

  const hashHex = (env.PASSWORD_HASH_HEX || '').trim().toLowerCase();
  const saltHex = (env.PASSWORD_SALT_HEX || '').trim().toLowerCase();

  if (hashHex && saltHex) {
    const salt = hexToBytes(saltHex);
    if (!salt) return false;
    const iterations = getIterations(env);
    const derived = await pbkdf2Hex(passwordInput, salt, iterations, 32);
    return constantTimeEqualHex(derived, hashHex);
  }

  const plain = (env.PASSWORD_PLAIN || env.PASSWORD || '').toString();
  return passwordInput === plain;
}

async function issueToken(env) {
  const payload = { iat: now(), exp: now() + TOKEN_TTL_MS };
  const payloadB64 = base64urlEncodeBytes(utf8Encode(JSON.stringify(payload)));
  const sigB64 = base64urlEncodeBytes(await hmacSign(env, utf8Encode(payloadB64)));
  return `${payloadB64}.${sigB64}`;
}

async function verifyToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;

  let payload;
  try {
    payload = JSON.parse(utf8Decode(base64urlDecodeToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (!payload?.exp || now() > payload.exp) return null;

  const expected = await hmacSign(env, utf8Encode(payloadB64));
  const given = base64urlDecodeToBytes(sigB64);
  if (given.length !== expected.length) return null;

  let r = 0;
  for (let i = 0; i < given.length; i++) r |= given[i] ^ expected[i];
  if (r !== 0) return null;

  return payload;
}

async function requireAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return await verifyToken(env, token);
}

// ======= Directory model =======
function newDir(id, name, parentId) {
  const t = now();
  return {
    v: 1,
    id,
    name: name || '',
    parentId: parentId ?? null,
    createdAt: t,
    updatedAt: t,
    folders: {},
    files: {},
  };
}

async function ensureRoot(env) {
  if (_rootEnsured) return;

  const root = await env.MY_BUCKET.get(dirKey(ROOT_ID), { type: 'json' });
  if (!root) {
    const r = newDir(ROOT_ID, '', null);
    await env.MY_BUCKET.put(dirKey(ROOT_ID), JSON.stringify(r));
    _dirCache.set(ROOT_ID, { ts: now(), dir: r });
  } else {
    _dirCache.set(ROOT_ID, { ts: now(), dir: root });
  }
  _rootEnsured = true;
}

async function getDir(env, folderId) {
  const cached = _dirCache.get(folderId);
  if (cached && now() - cached.ts < DIR_CACHE_TTL_MS) return cached.dir;

  const dir = await env.MY_BUCKET.get(dirKey(folderId), { type: 'json' });
  if (dir) _dirCache.set(folderId, { ts: now(), dir });
  return dir;
}

async function putDir(env, dirObj) {
  dirObj.updatedAt = now();
  await env.MY_BUCKET.put(dirKey(dirObj.id), JSON.stringify(dirObj));
  _dirCache.set(dirObj.id, { ts: now(), dir: dirObj });
}

async function deleteDir(env, folderId) {
  await env.MY_BUCKET.delete(dirKey(folderId));
  _dirCache.delete(folderId);
}

function ensureUniqueName(mapObj, desiredName) {
  if (!mapObj[desiredName]) return desiredName;

  const dot = desiredName.lastIndexOf('.');
  const hasExt = dot > 0 && dot < desiredName.length - 1;
  const base = hasExt ? desiredName.slice(0, dot) : desiredName;
  const ext = hasExt ? desiredName.slice(dot) : '';

  let i = 1;
  while (true) {
    const cand = `${base}(${i})${ext}`;
    if (!mapObj[cand]) return cand;
    i++;
  }
}

async function isDescendant(env, maybeChildId, maybeAncestorId, limit = 64) {
  let cur = maybeChildId;
  for (let i = 0; i < limit; i++) {
    if (!cur) return false;
    if (cur === maybeAncestorId) return true;
    const d = await getDir(env, cur);
    cur = d?.parentId || null;
  }
  return false;
}

// ======= fileId：UUID(128-bit) =======
function makeFileId(extWithDot) {
  const base = crypto.randomUUID().replace(/-/g, '');
  return `${base}${extWithDot || ''}`;
}

// ======= Router =======
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: BASE_CORS });

    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env, ctx);

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(e?.message || 'Internal Error', { status: 500, headers: BASE_CORS });
    }
  },
};

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);

  // ===== login =====
  if (url.pathname === '/api/login') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    try {
      const body = await request.json().catch(() => ({}));
      const ok = await verifyPassword(env, body?.password || '');
      if (!ok) {
        return new Response(JSON.stringify({ success: false, reason: 'bad_password' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
        });
      }
      const token = await issueToken(env);
      return new Response(JSON.stringify({ success: true, token, expiresInMs: TOKEN_TTL_MS }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, reason: 'server_error', error: String(e?.message || e) }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
        }
      );
    }
  }

  // ===== auth required =====
  const auth = await requireAuth(request, env);
  if (!auth) return new Response('Unauthorized', { status: 401, headers: BASE_CORS });
  if (!env.MY_BUCKET)
    return new Response(JSON.stringify({ error: 'KV未绑定' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });

  await ensureRoot(env);

  // ===== crumbs =====
  if (url.pathname === '/api/crumbs') {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: BASE_CORS });

    const folderId = (url.searchParams.get('fid') || ROOT_ID).trim() || ROOT_ID;

    if (folderId === ROOT_ID) {
      return new Response(
        JSON.stringify({ success: true, crumbs: [{ folderId: ROOT_ID, name: '根目录', path: '' }] }),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...BASE_CORS,
          },
        }
      );
    }

    const chain = [];
    let cur = folderId;

    for (let i = 0; i < 64; i++) {
      const d = await getDir(env, cur);
      if (!d) {
        return new Response(JSON.stringify({ success: false, error: 'Folder not found' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...BASE_CORS,
          },
        });
      }
      chain.push({ folderId: d.id, name: d.id === ROOT_ID ? '根目录' : d.name || '' });
      cur = d.parentId || '';
      if (!cur) break;
    }

    chain.reverse();

    let p = '';
    const crumbs = chain.map((c, idx) => {
      if (idx === 0) return { ...c, path: '' };
      p += `${c.name}/`;
      return { ...c, path: p };
    });

    return new Response(JSON.stringify({ success: true, crumbs }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...BASE_CORS,
      },
    });
  }

  // ===== list =====
  if (url.pathname === '/api/list') {
    const folderId = (url.searchParams.get('fid') || ROOT_ID).trim() || ROOT_ID;
    const path = (url.searchParams.get('path') || '').trim();

    const dir = await getDir(env, folderId);
    if (!dir) return new Response('Folder not found', { status: 404, headers: BASE_CORS });

    const folders = Object.entries(dir.folders || {}).map(([name, id]) => ({
      key: `${path}${name}/`,
      name,
      type: 'folder',
      size: 0,
      uploadedAt: dir.updatedAt || 0,
      folderId: id,
      fileId: null,
    }));

    const files = Object.entries(dir.files || {}).map(([name, meta]) => ({
      key: `${path}${name}`,
      name,
      type: meta.type || 'application/octet-stream',
      size: meta.size || 0,
      uploadedAt: meta.uploadedAt || 0,
      fileId: meta.fileId,
    }));

    folders.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));

    return new Response(
      JSON.stringify({
        success: true,
        folderId: dir.id,
        parentId: dir.parentId,
        path,
        updatedAt: dir.updatedAt || 0,
        folders,
        files,
      }),
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache',
          'Expires': '0',
          ...BASE_CORS,
        },
      }
    );
  }

  // ===== rename file =====
  if (url.pathname === '/api/rename-file') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const body = await request.json().catch(() => null);
    const folderId = (body?.folderId || '').trim() || ROOT_ID;
    const oldName = cleanName(body?.oldName || '');
    let newName = cleanName(body?.newName || '');

    if (!oldName || !newName) return new Response('Invalid name', { status: 400, headers: BASE_CORS });

    if (oldName === newName) {
      return new Response(JSON.stringify({ success: true, noop: true, newName }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
      });
    }

    const dir = await getDir(env, folderId);
    if (!dir) return new Response('Folder not found', { status: 404, headers: BASE_CORS });

    dir.files = dir.files || {};
    const meta = dir.files[oldName];
    if (!meta) return new Response('File not found', { status: 404, headers: BASE_CORS });

    newName = ensureUniqueName(dir.files, newName);

    delete dir.files[oldName];
    dir.files[newName] = meta;

    await putDir(env, dir);

    return new Response(JSON.stringify({ success: true, newName }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });
  }

  // ===== rename folder =====
  if (url.pathname === '/api/rename-folder') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const body = await request.json().catch(() => null);
    const parentId = (body?.parentId || '').trim() || ROOT_ID;
    const folderId = (body?.folderId || '').trim();
    const oldName = cleanName(body?.oldName || '');
    let newName = cleanName(body?.newName || '');

    if (!folderId || !oldName || !newName) return new Response('Invalid name', { status: 400, headers: BASE_CORS });

    if (oldName === newName) {
      return new Response(JSON.stringify({ success: true, noop: true, newName }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
      });
    }

    const parent = await getDir(env, parentId);
    if (!parent) return new Response('Parent not found', { status: 404, headers: BASE_CORS });

    parent.folders = parent.folders || {};
    if (parent.folders[oldName] !== folderId) return new Response('Folder mapping not found', { status: 404, headers: BASE_CORS });

    newName = ensureUniqueName(parent.folders, newName);

    delete parent.folders[oldName];
    parent.folders[newName] = folderId;

    const child = await getDir(env, folderId);
    if (child) {
      child.name = newName;
      child.parentId = parentId;
      await putDir(env, child);
    }

    await putDir(env, parent);

    return new Response(JSON.stringify({ success: true, newName }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });
  }

  // ===== create folder =====
  if (url.pathname === '/api/create-folder') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const body = await request.json().catch(() => null);
    const parentId = (body?.parentId || ROOT_ID).trim() || ROOT_ID;
    let name = cleanName(body?.name || '');
    if (!name) return new Response('Invalid name', { status: 400, headers: BASE_CORS });

    const parent = await getDir(env, parentId);
    if (!parent) return new Response('Parent not found', { status: 404, headers: BASE_CORS });

    parent.folders = parent.folders || {};
    if (parent.folders[name]) {
      return new Response(JSON.stringify({ success: true, folderId: parent.folders[name], existed: true, name }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
      });
    }

    name = ensureUniqueName(parent.folders, name);
    const folderId = shortId(12);
    const child = newDir(folderId, name, parentId);

    await putDir(env, child);
    parent.folders[name] = folderId;
    await putDir(env, parent);

    return new Response(JSON.stringify({ success: true, folderId, existed: false, name }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });
  }

  // ===== upload =====
  if (url.pathname === '/api/upload') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const formData = await request.formData();
    const folderId = (formData.get('folderId') || ROOT_ID).toString().trim() || ROOT_ID;
    const files = formData.getAll('file').filter((f) => f && typeof f === 'object');
    if (!files.length) return new Response('No file', { status: 400, headers: BASE_CORS });

    const dir = await getDir(env, folderId);
    if (!dir) return new Response('Folder not found', { status: 404, headers: BASE_CORS });

    dir.files = dir.files || {};
    if (files.length > 200) return new Response('Too many files in one request', { status: 413, headers: BASE_CORS });

    let changed = false;
    const uploaded = [];

    for (const f of files) {
      const file = f; // File
      if (file.size > MAX_FILE_BYTES) return new Response('File too large', { status: 413, headers: BASE_CORS });

      let name = cleanName(file.name);
      if (!name) continue;

      name = ensureUniqueName(dir.files, name);
      const ext = (() => {
        const i = name.lastIndexOf('.');
        return i > 0 ? name.slice(i) : '';
      })();

      const fileId = makeFileId(ext);

      await env.MY_BUCKET.put(binKey(fileId), file.stream(), {
        metadata: { type: file.type || '', size: file.size || 0, name },
      });

      const meta = {
        fileId,
        type:
          file.type ||
          MIME_TYPES[(ext.slice(1) || '').toLowerCase()] ||
          'application/octet-stream',
        size: file.size || 0,
        uploadedAt: now(),
      };

      dir.files[name] = meta;
      uploaded.push({ name, ...meta });
      changed = true;
    }

    if (changed) await putDir(env, dir);

    return new Response(JSON.stringify({ success: true, uploaded }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });
  }

  // ===== move =====
  if (url.pathname === '/api/move') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const body = await request.json().catch(() => null);
    const targetFolderId = (body?.targetFolderId || ROOT_ID).trim() || ROOT_ID;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return new Response('No items', { status: 400, headers: BASE_CORS });

    const targetDir = await getDir(env, targetFolderId);
    if (!targetDir) return new Response('Target not found', { status: 404, headers: BASE_CORS });
    targetDir.folders = targetDir.folders || {};
    targetDir.files = targetDir.files || {};

    const group = new Map();
    for (const it of items) {
      const fromId = (it?.fromFolderId || '').trim();
      if (!fromId) continue;
      if (fromId === targetFolderId) continue;
      if (!group.has(fromId)) group.set(fromId, { files: [], folders: [] });
      if (it.kind === 'file') group.get(fromId).files.push(it);
      if (it.kind === 'folder') group.get(fromId).folders.push(it);
    }
    if (group.size === 0) {
      return new Response(JSON.stringify({ success: true, noop: true, targetAdded: { files: [], folders: [] } }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
      });
    }

    for (const g of group.values()) {
      for (const fd of g.folders) {
        const folderId = (fd.folderId || '').trim();
        if (!folderId) continue;
        if (folderId === targetFolderId) return new Response('Invalid move', { status: 400, headers: BASE_CORS });
        if (await isDescendant(env, targetFolderId, folderId)) return new Response('Invalid move', { status: 400, headers: BASE_CORS });
      }
    }

    const sourceDirs = new Map();
    const dirty = new Map();
    for (const fromId of group.keys()) {
      const d = await getDir(env, fromId);
      if (!d) return new Response('Source not found', { status: 404, headers: BASE_CORS });
      d.folders = d.folders || {};
      d.files = d.files || {};
      sourceDirs.set(fromId, d);
      dirty.set(fromId, false);
    }

    let targetDirty = false;
    const targetAddedFiles = [];
    const targetAddedFolders = [];

    for (const [fromId, g] of group.entries()) {
      const src = sourceDirs.get(fromId);

      for (const f of g.files) {
        let name = cleanName(f?.name || '');
        if (!name) continue;
        const meta = src.files[name];
        if (!meta) continue;

        const newName = ensureUniqueName(targetDir.files, name);
        targetDir.files[newName] = meta;
        delete src.files[name];
        dirty.set(fromId, true);
        targetDirty = true;

        targetAddedFiles.push({
          name: newName,
          fileId: meta.fileId,
          type: meta.type || 'application/octet-stream',
          size: meta.size || 0,
          uploadedAt: meta.uploadedAt || 0,
        });
      }

      for (const fd of g.folders) {
        let name = cleanName(fd?.name || '');
        const folderId = (fd?.folderId || '').trim();
        if (!name || !folderId) continue;
        if (src.folders[name] !== folderId) continue;

        const newName = ensureUniqueName(targetDir.folders, name);
        targetDir.folders[newName] = folderId;
        delete src.folders[name];
        dirty.set(fromId, true);
        targetDirty = true;

        const moved = await getDir(env, folderId);
        if (moved) {
          moved.parentId = targetFolderId;
          moved.name = newName;
          await putDir(env, moved);
        }

        targetAddedFolders.push({ name: newName, folderId });
      }
    }

    for (const [id, d] of sourceDirs.entries()) {
      if (dirty.get(id)) await putDir(env, d);
    }
    if (targetDirty) await putDir(env, targetDir);

    return new Response(JSON.stringify({ success: true, targetAdded: { files: targetAddedFiles, folders: targetAddedFolders } }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });
  }

  // ===== batch-delete =====
  if (url.pathname === '/api/batch-delete') {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: BASE_CORS });

    const body = await request.json().catch(() => null);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return new Response('No items', { status: 400, headers: BASE_CORS });

    const MAX_BIN_DELETES = 900;

    const group = new Map();
    for (const it of items) {
      const fromId = (it?.fromFolderId || '').trim();
      if (!fromId) continue;
      if (!group.has(fromId)) group.set(fromId, { files: [], folders: [] });
      if (it.kind === 'file') group.get(fromId).files.push(it);
      if (it.kind === 'folder') group.get(fromId).folders.push(it);
    }

    const sourceDirs = new Map();
    const dirty = new Map();
    for (const fromId of group.keys()) {
      const d = await getDir(env, fromId);
      if (!d) return new Response('Source not found', { status: 404, headers: BASE_CORS });
      d.folders = d.folders || {};
      d.files = d.files || {};
      sourceDirs.set(fromId, d);
      dirty.set(fromId, false);
    }

    const binToDelete = [];
    const fileIdsToPurgeCache = [];
    const dirToDeleteFolderIds = [];

    async function collectFolderRecursive(folderId) {
      const d = await getDir(env, folderId);
      if (!d) return;

      for (const meta of Object.values(d.files || {})) {
        if (meta?.fileId) {
          binToDelete.push(binKey(meta.fileId));
          fileIdsToPurgeCache.push(meta.fileId);
          if (binToDelete.length > MAX_BIN_DELETES) throw new Error('TOO_MANY_DELETES');
        }
      }

      for (const childId of Object.values(d.folders || {})) {
        await collectFolderRecursive(childId);
      }

      dirToDeleteFolderIds.push(folderId);
    }

    for (const [fromId, g] of group.entries()) {
      const src = sourceDirs.get(fromId);

      for (const f of g.files) {
        const name = cleanName(f?.name || '');
        const fileId = (f?.fileId || '').trim();
        if (!name || !fileId) continue;

        if (src.files[name]?.fileId === fileId) {
          delete src.files[name];
          dirty.set(fromId, true);
          binToDelete.push(binKey(fileId));
          fileIdsToPurgeCache.push(fileId);
          if (binToDelete.length > MAX_BIN_DELETES) {
            return new Response('Too many deletes. Please delete in smaller batches.', { status: 413, headers: BASE_CORS });
          }
        }
      }

      for (const fd of g.folders) {
        const name = cleanName(fd?.name || '');
        const folderId = (fd?.folderId || '').trim();
        if (!name || !folderId) continue;

        if (src.folders[name] === folderId) {
          delete src.folders[name];
          dirty.set(fromId, true);
          try {
            await collectFolderRecursive(folderId);
          } catch (e) {
            if (e?.message === 'TOO_MANY_DELETES') {
              return new Response('Too many deletes. Please delete in smaller batches.', { status: 413, headers: BASE_CORS });
            }
            throw e;
          }
        }
      }
    }

    for (const [id, d] of sourceDirs.entries()) {
      if (dirty.get(id)) await putDir(env, d);
    }

    const uniqBin = Array.from(new Set(binToDelete));
    for (const k of uniqBin) await env.MY_BUCKET.delete(k);

    const uniqDirFolderIds = Array.from(new Set(dirToDeleteFolderIds));
    for (const folderId of uniqDirFolderIds) await deleteDir(env, folderId);

    // ===== 方案C：purge edge cache（不消耗 KV 次数）=====
    const uniqFileIds = Array.from(new Set(fileIdsToPurgeCache.filter(Boolean)));
    if (uniqFileIds.length) {
      const origin = url.origin;
      const cache = caches.default;
      const purgeTasks = uniqFileIds.map((fid) => {
        const p = `/file/${encodeURIComponent(fid)}`;
        const cacheKey = new Request(origin + p, { method: 'GET' });
        return cache.delete(cacheKey);
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(Promise.allSettled(purgeTasks));
      else await Promise.allSettled(purgeTasks);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS },
    });
  }

  return new Response('Not Found', { status: 404, headers: BASE_CORS });
}

// ======= /file with edge cache + immutable 1y =======
async function handleFile(request, env, ctx) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: BASE_CORS });
    }
    if (!env.MY_BUCKET) return new Response('KV not bound', { status: 500, headers: BASE_CORS });

    const url = new URL(request.url);
    const fileId = decodeURIComponent(url.pathname.slice('/file/'.length) || '');
    if (!fileId || fileId.length < 5) return new Response('Invalid ID', { status: 400, headers: BASE_CORS });

    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) {
      if (request.method === 'HEAD') return new Response(null, { status: cached.status, headers: new Headers(cached.headers) });
      return cached;
    }

    const ext = (fileId.split('.').pop() || '').toLowerCase();
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(binKey(fileId), { type: 'arrayBuffer' });
    if (!value) return new Response('File Not Found', { status: 404, headers: BASE_CORS });

    const headers = new Headers(BASE_CORS);
    headers.set('Content-Type', MIME_TYPES[ext] || metadata?.type || 'application/octet-stream');
    headers.set(
      'Cache-Control',
      `public, max-age=${FILE_CACHE_SECONDS}, s-maxage=${FILE_CACHE_SECONDS}, immutable, stale-while-revalidate=60`
    );

    const resp = new Response(value, { headers });

    // 不阻塞首个响应：后台写 cache
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    else await cache.put(cacheKey, resp.clone());

    if (request.method === 'HEAD') return new Response(null, { headers });
    return resp;
  } catch (e) {
    return new Response(`File Error: ${e?.message || 'Unknown'}`, { status: 500, headers: BASE_CORS });
  }
}