// _worker.js

// ===== Utilities =====
function shortId() {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  const randomValues = crypto.getRandomValues(new Uint8Array(12));
  for (let i = 0; i < 12; i++) result += chars[randomValues[i] % chars.length];
  return result;
}

function now() {
  return Date.now();
}

function safeName(name) {
  return (name || '').replace(/[\/|]/g, '_').trim();
}

function splitExt(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return { base: filename, ext: '' };
  return { base: filename.slice(0, idx), ext: filename.slice(idx) };
}

function makeUniqueName(existingNamesSet, desiredName) {
  if (!existingNamesSet.has(desiredName)) return desiredName;
  const { base, ext } = splitExt(desiredName);
  let i = 1;
  while (true) {
    const candidate = `${base}(${i})${ext}`;
    if (!existingNamesSet.has(candidate)) return candidate;
    i++;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...BASE_CORS, ...extraHeaders },
  });
}

function bad(msg, status = 400) {
  return new Response(msg, { status, headers: BASE_CORS });
}

function ctEqual(a, b) {
  // constant-time compare for Uint8Array
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = (hex || '').trim();
  if (!clean || clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64UrlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToBytes(b64url) {
  let s = (b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ===== MIME =====
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
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition, ETag',
};

// ===== Storage Keys =====
const ROOT_ID = 'root';
const TRASH_ID = 'trash';
const IDX_PREFIX = 'idx:';
const BLOB_PREFIX = 'blob:';

function idxKey(folderId) {
  return `${IDX_PREFIX}${folderId}`;
}
function blobKey(fileId) {
  return `${BLOB_PREFIX}${fileId}`;
}

// ===== KV Index Format =====
// idx:<folderId> => { v:1, updatedAt:number, items: { [id]: Entry } }
// Entry (file): { id, kind:'file', name, type, size, uploadedAt, deletedAt?, origParentId? }
// Entry (folder): { id, kind:'folder', name, uploadedAt, deletedAt?, origParentId? }

async function getFolderIndex(env, folderId) {
  const raw = await env.MY_BUCKET.get(idxKey(folderId));
  if (!raw) return { v: 1, updatedAt: 0, items: {} };
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || !obj.items) return { v: 1, updatedAt: 0, items: {} };
    return obj;
  } catch {
    return { v: 1, updatedAt: 0, items: {} };
  }
}

async function putFolderIndex(env, folderId, indexObj) {
  indexObj.v = 1;
  indexObj.updatedAt = now();
  // 重要：每次请求对同一 idx key 最多写一次，避免触发 1/sec 限制
  await env.MY_BUCKET.put(idxKey(folderId), JSON.stringify(indexObj));
}

function sortEntries(entries) {
  // folders first, then by uploadedAt desc
  return entries.sort((a, b) => {
    const af = a.kind === 'folder' ? 0 : 1;
    const bf = b.kind === 'folder' ? 0 : 1;
    if (af !== bf) return af - bf;
    return (b.uploadedAt || 0) - (a.uploadedAt || 0);
  });
}

// ===== Auth: PBKDF2 password hash + HMAC token =====
const PBKDF2_ITERATIONS = 210_000; // 够用且不算太慢（你可自行调）
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

async function pbkdf2Sha256(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const pwKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    pwKey,
    256
  );
  return new Uint8Array(bits);
}

async function hmacSign(secret, dataBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
  return new Uint8Array(sig);
}

async function issueToken(env) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = Math.floor((Date.now() + TOKEN_TTL_MS) / 1000);
  const payload = { iat, exp };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = base64UrlEncode(payloadBytes);

  const secret = env.TOKEN_SECRET || '';
  if (!secret) throw new Error('Missing TOKEN_SECRET');

  const sigBytes = await hmacSign(secret, new TextEncoder().encode(payloadB64));
  const sigB64 = base64UrlEncode(sigBytes);

  return `${payloadB64}.${sigB64}`;
}

async function verifyToken(env, authHeader) {
  if (!authHeader) return { ok: false, reason: 'no auth' };
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'bad token' };

  const [payloadB64, sigB64] = parts;
  const secret = env.TOKEN_SECRET || '';
  if (!secret) return { ok: false, reason: 'Missing TOKEN_SECRET' };

  const expectedSig = await hmacSign(secret, new TextEncoder().encode(payloadB64));
  const gotSig = base64UrlDecodeToBytes(sigB64);
  if (!ctEqual(expectedSig, gotSig)) return { ok: false, reason: 'bad signature' };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'bad payload' };
  }
  const exp = payload?.exp;
  if (!exp || typeof exp !== 'number') return { ok: false, reason: 'no exp' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

async function verifyPassword(env, plainPassword) {
  // 强安全模式：使用 PBKDF2 + salt + hash（推荐）
  const saltHex = env.PASSWORD_SALT_HEX || '';
  const hashHex = env.PASSWORD_HASH_HEX || '';
  if (saltHex && hashHex) {
    const saltBytes = hexToBytes(saltHex);
    const derived = await pbkdf2Sha256(plainPassword, saltBytes);
    const derivedHex = bytesToHex(derived);
    // 常量时间比较
    const a = new TextEncoder().encode(derivedHex);
    const b = new TextEncoder().encode(hashHex.toLowerCase());
    return ctEqual(a, b);
  }

  // 兼容模式（不推荐）：回退到明文 env.PASSWORD
  const pw = env.PASSWORD || 'admin';
  return plainPassword === pw;
}

// ===== Worker Entrypoint =====
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: BASE_CORS });

    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (url.pathname.startsWith('/file/')) return handleFile(request, env);

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(e?.message || 'Internal Error', { status: 500, headers: BASE_CORS });
    }
  },
};

// ===== API =====
async function handleApi(request, env) {
  const url = new URL(request.url);

  if (!env.MY_BUCKET) return json({ error: 'KV未绑定' }, 500);

  // ---- LOGIN ----
  if (url.pathname === '/api/login') {
    if (request.method !== 'POST') return bad('Method Not Allowed', 405);
    const body = await request.json().catch(() => ({}));
    const ok = await verifyPassword(env, body.password || '');
    if (!ok) return json({ success: false }, 401);

    const token = await issueToken(env);
    return json({ success: true, token });
  }

  // ---- AUTH REQUIRED ----
  const auth = await verifyToken(env, request.headers.get('Authorization'));
  if (!auth.ok) return bad('Unauthorized', 401);

  // ---- LIST FOLDER ----
  if (url.pathname === '/api/list-folder') {
    const folderId = url.searchParams.get('folderId') || ROOT_ID;
    const idx = await getFolderIndex(env, folderId);
    const items = sortEntries(Object.values(idx.items || {}));
    return json({ success: true, folderId, items, updatedAt: idx.updatedAt || 0 });
  }

  // ---- CREATE FOLDER ----
  if (url.pathname === '/api/create-folder') {
    if (request.method !== 'POST') return bad('Method Not Allowed', 405);
    const body = await request.json().catch(() => ({}));
    const parentId = body.parentId || ROOT_ID;
    const nameRaw = safeName(body.name || '');
    if (!nameRaw) return bad('Invalid name', 400);

    const parentIdx = await getFolderIndex(env, parentId);

    const existingNames = new Set(Object.values(parentIdx.items).map(x => x.name));
    const name = makeUniqueName(existingNames, nameRaw);

    const folderId = `f_${shortId()}`;
    parentIdx.items[folderId] = {
      id: folderId,
      kind: 'folder',
      name,
      uploadedAt: now(),
    };

    await putFolderIndex(env, parentId, parentIdx);

    // 注意：不强制创建 idx:<folderId>，懒创建（省一次写入）
    return json({ success: true, folderId, name });
  }

  // ---- UPLOAD (multi files, one index write) ----
  if (url.pathname === '/api/upload') {
    if (request.method !== 'POST') return bad('Method Not Allowed', 405);

    const formData = await request.formData();
    const folderId = (formData.get('folderId') || ROOT_ID).toString();
    const files = formData.getAll('file').filter(x => x && typeof x === 'object');

    if (!files.length) return bad('No file', 400);

    const idx = await getFolderIndex(env, folderId);
    const existingNames = new Set(Object.values(idx.items).map(x => x.name));

    for (const f of files) {
      const file = f; // File
      const rawName = safeName(file.name || 'file');
      const uniqueName = makeUniqueName(existingNames, rawName);
      existingNames.add(uniqueName);

      const ext = (() => {
        const p = uniqueName.split('.');
        return p.length > 1 ? '.' + p[p.length - 1] : '';
      })();
      const fileId = `${shortId()}${ext}`;
      const meta = { type: file.type || '', size: file.size || 0, name: uniqueName, uploadedAt: now() };

      await env.MY_BUCKET.put(blobKey(fileId), file.stream(), { metadata: meta });

      idx.items[fileId] = {
        id: fileId,
        kind: 'file',
        name: uniqueName,
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        uploadedAt: meta.uploadedAt,
      };
    }

    await putFolderIndex(env, folderId, idx);
    return json({ success: true });
  }

  // ---- MOVE (batch, grouped by fromFolderId) ----
  if (url.pathname === '/api/move') {
    if (request.method !== 'POST') return bad('Method Not Allowed', 405);
    const body = await request.json().catch(() => ({}));
    const toFolderId = body.toFolderId || ROOT_ID;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return bad('No items', 400);

    // dest index read once
    const destIdx = await getFolderIndex(env, toFolderId);
    const destNames = new Set(Object.values(destIdx.items).map(x => x.name));

    // group by source folder
    const groups = new Map();
    for (const it of items) {
      const from = it.fromFolderId || ROOT_ID;
      if (!groups.has(from)) groups.set(from, []);
      groups.get(from).push(it.id);
    }

    for (const [fromFolderId, ids] of groups.entries()) {
      if (fromFolderId === toFolderId) continue;

      const srcIdx = await getFolderIndex(env, fromFolderId);
      let changed = false;

      for (const id of ids) {
        const entry = srcIdx.items[id];
        if (!entry) continue;

        // 防止同名冲突：目标目录自动改名
        const newName = makeUniqueName(destNames, entry.name);
        destNames.add(newName);

        // 从源删
        delete srcIdx.items[id];
        changed = true;

        // 入目标（只改 name，不动 id）
        destIdx.items[id] = { ...entry, name: newName };
      }

      if (changed) await putFolderIndex(env, fromFolderId, srcIdx);
    }

    // 目标写一次
    await putFolderIndex(env, toFolderId, destIdx);
    return json({ success: true });
  }

  // ---- SOFT DELETE (default): move to trash; HARD delete optional ----
  if (url.pathname === '/api/batch-delete') {
    if (request.method !== 'POST') return bad('Method Not Allowed', 405);
    const body = await request.json().catch(() => ({}));
    const hard = !!body.hard;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return bad('No items', 400);

    if (!hard) {
      // soft delete => move into trash (0 blob deletes)
      const trashIdx = await getFolderIndex(env, TRASH_ID);
      const trashNames = new Set(Object.values(trashIdx.items).map(x => x.name));

      const groups = new Map();
      for (const it of items) {
        const from = it.fromFolderId || ROOT_ID;
        if (!groups.has(from)) groups.set(from, []);
        groups.get(from).push(it.id);
      }

      for (const [fromFolderId, ids] of groups.entries()) {
        const srcIdx = await getFolderIndex(env, fromFolderId);
        let changed = false;

        for (const id of ids) {
          const entry = srcIdx.items[id];
          if (!entry) continue;

          delete srcIdx.items[id];
          changed = true;

          const newName = makeUniqueName(trashNames, entry.name);
          trashNames.add(newName);

          trashIdx.items[id] = {
            ...entry,
            name: newName,
            deletedAt: now(),
            origParentId: fromFolderId,
          };
        }

        if (changed) await putFolderIndex(env, fromFolderId, srcIdx);
      }

      await putFolderIndex(env, TRASH_ID, trashIdx);
      return json({ success: true, soft: true });
    }

    // hard delete: remove from folder index + delete blobs for files (folders会一起删掉“入口”，子树仍在KV里无法枚举，无KV.list无法完全清理)
    // 为了“最大化不浪费资源”，强烈建议：平时用软删，偶尔在回收站 purge。
    const groups = new Map();
    for (const it of items) {
      const from = it.fromFolderId || ROOT_ID;
      if (!groups.has(from)) groups.set(from, []);
      groups.get(from).push(it.id);
    }

    // 先从索引移除（每个来源目录写一次）
    const toDeleteFileIds = [];
    for (const [fromFolderId, ids] of groups.entries()) {
      const srcIdx = await getFolderIndex(env, fromFolderId);
      let changed = false;

      for (const id of ids) {
        const entry = srcIdx.items[id];
        if (!entry) continue;
        delete srcIdx.items[id];
        changed = true;

        if (entry.kind === 'file') toDeleteFileIds.push(id);
        // folder hard delete：无 KV.list 很难完全清理其子树（你要“最大化利用”，建议软删+回收站集中清理）
      }

      if (changed) await putFolderIndex(env, fromFolderId, srcIdx);
    }

    // 再删 blob（消耗 delete 配额）
    for (const fid of toDeleteFileIds) {
      await env.MY_BUCKET.delete(blobKey(fid));
    }

    return json({ success: true, hard: true });
  }

  // ---- PURGE TRASH: truly delete file blobs from trash (hard) ----
  if (url.pathname === '/api/purge-trash') {
    if (request.method !== 'POST') return bad('Method Not Allowed', 405);
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return bad('No ids', 400);

    const trashIdx = await getFolderIndex(env, TRASH_ID);
    let changed = false;
    const deleteFileIds = [];

    for (const id of ids) {
      const entry = trashIdx.items[id];
      if (!entry) continue;
      delete trashIdx.items[id];
      changed = true;

      if (entry.kind === 'file') deleteFileIds.push(id);
      // folder purge：同样无法无 list 完全删子树入口以外的数据（建议仍以软删为主）
    }

    if (changed) await putFolderIndex(env, TRASH_ID, trashIdx);

    for (const fid of deleteFileIds) {
      await env.MY_BUCKET.delete(blobKey(fid));
    }

    return json({ success: true });
  }

  // ---- SEARCH (reads only) ----
  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (!q) return json({ success: true, items: [] });

    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);
    const results = [];

    // BFS from root
    const queue = [{ folderId: ROOT_ID, crumb: [] }]; // crumb: [{id,name}]
    while (queue.length && results.length < limit) {
      const { folderId, crumb } = queue.shift();
      const idx = await getFolderIndex(env, folderId);

      for (const entry of Object.values(idx.items)) {
        if (results.length >= limit) break;

        if ((entry.name || '').toLowerCase().includes(q)) {
          // file -> crumb points to parent; folder -> crumbChild points to itself
          const isFolder = entry.kind === 'folder';
          const path = (crumb.map(x => x.name).join('/') + (crumb.length ? '/' : '') + entry.name + (isFolder ? '/' : ''));

          results.push({
            ...entry,
            parentId: folderId,
            path,
            crumb: isFolder ? [...crumb, { id: entry.id, name: entry.name }] : crumb,
          });
        }

        if (entry.kind === 'folder') {
          queue.push({ folderId: entry.id, crumb: [...crumb, { id: entry.id, name: entry.name }] });
        }
      }
    }

    return json({ success: true, items: results });
  }

  return bad('Not Found', 404);
}

// ===== File Download (public) =====
async function handleFile(request, env) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: BASE_CORS });
    }
    if (!env.MY_BUCKET) return new Response('KV not bound', { status: 500, headers: BASE_CORS });

    const url = new URL(request.url);
    const fileId = decodeURIComponent(url.pathname.slice('/file/'.length) || '');
    if (!fileId || fileId.length < 5) return new Response('Invalid ID', { status: 400, headers: BASE_CORS });

    const ext = (fileId.split('.').pop() || '').toLowerCase();

    // 用 arrayBuffer 更稳（避免某些环境 stream 导致 ECONNRESET）
    const { value, metadata } = await env.MY_BUCKET.getWithMetadata(blobKey(fileId), { type: 'arrayBuffer' });
    if (!value) return new Response('File Not Found', { status: 404, headers: BASE_CORS });

    const headers = new Headers(BASE_CORS);
    headers.set('Content-Type', MIME_TYPES[ext] || metadata?.type || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=86400');

    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(value, { headers });
  } catch (e) {
    return new Response(`File Error: ${e?.message || 'Unknown'}`, { status: 500, headers: BASE_CORS });
  }
}
