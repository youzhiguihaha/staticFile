// public/_worker.js

// ======= 1. MIME 类型定义 =======
const MIME_TYPES = {
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const BASE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition, ETag',
};

const ROOT_ID = 'root';
const DIR_PREFIX = 'dir:';
const BIN_PREFIX = 'bin:';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const FILE_CACHE_TTL = 31536000; 
const API_CACHE_TTL = 3; 
const DEFAULT_PBKDF2_ITER = 100000;

// 内存缓存
let _rootEnsured = false;
const DIR_CACHE_TTL_MS = 5000;
const _dirCache = new Map();

// ======= 工具函数 =======
function now() { return Date.now(); }
function shortId(len = 12) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const rv = crypto.getRandomValues(new Uint8Array(len));
  let res = ''; for(let i=0; i<len; i++) res += chars[rv[i] % chars.length];
  return res;
}
function dirKey(folderId) { return `${DIR_PREFIX}${folderId}`; }
function binKey(fileId) { return `${BIN_PREFIX}${fileId}`; }
function cleanName(name) { return (name || '').replace(/[\/\\|<>:"*?]/g, '').trim(); }
function utf8Encode(str) { return new TextEncoder().encode(str); }
function utf8Decode(bytes) { return new TextDecoder().decode(bytes); }
function base64urlEncode(bytes) {
  let s = ''; for(let i=0; i<bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for(let i=0; i<s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) {
  const h = (hex || '').trim().toLowerCase();
  if(!h || h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for(let i=0; i<out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function constantTimeEqual(a, b) {
  if(typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for(let i=0; i<a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ======= 认证 =======
let _hmacKeyPromise = null;
async function getHmacKey(env) {
  if (!_hmacKeyPromise) {
    const secret = (env.TOKEN_SECRET || 'default-secret-change-me').trim();
    _hmacKeyPromise = crypto.subtle.importKey('raw', utf8Encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  return _hmacKeyPromise;
}
async function hmacSign(env, msgBytes) {
  const key = await getHmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
  return new Uint8Array(sig);
}
async function verifyPassword(env, input) {
  input = (input || '').trim();
  const hashHex = (env.PASSWORD_HASH_HEX || '').trim().toLowerCase();
  const saltHex = (env.PASSWORD_SALT_HEX || '').trim().toLowerCase();
  if (hashHex && saltHex) {
    const salt = hexToBytes(saltHex);
    if (!salt) return false;
    const keyMaterial = await crypto.subtle.importKey('raw', utf8Encode(input), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: DEFAULT_PBKDF2_ITER }, keyMaterial, 256);
    return constantTimeEqual(bytesToHex(new Uint8Array(bits)), hashHex);
  }
  return input === (env.PASSWORD_PLAIN || env.PASSWORD || '').toString();
}
async function issueToken(env) {
  const payload = JSON.stringify({ iat: now(), exp: now() + TOKEN_TTL_MS });
  const pB64 = base64urlEncode(utf8Encode(payload));
  const sB64 = base64urlEncode(await hmacSign(env, utf8Encode(pB64)));
  return `${pB64}.${sB64}`;
}
async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return null;
  const [pB64, sB64] = token.split('.');
  try {
    const p = JSON.parse(utf8Decode(base64urlDecode(pB64)));
    if (!p.exp || now() > p.exp) return null;
    const expected = await hmacSign(env, utf8Encode(pB64));
    const given = base64urlDecode(sB64);
    if (given.length !== expected.length) return null;
    let r = 0; for(let i=0; i<given.length; i++) r |= given[i] ^ expected[i];
    return r === 0 ? p : null;
  } catch { return null; }
}

// ======= 目录操作 =======
function newDir(id, name, parentId) {
  const t = now();
  return { id, name, parentId: parentId ?? null, updatedAt: t, folders: {}, files: {} };
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
function ensureUniqueName(mapObj, name) {
  if (!mapObj[name]) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  while (true) {
    const cand = `${base}(${i})${ext}`;
    if (!mapObj[cand]) return cand;
    i++;
  }
}
async function isDescendant(env, childId, ancestorId) {
  let cur = childId;
  for (let i = 0; i < 32; i++) {
    if (!cur) return false;
    if (cur === ancestorId) return true;
    const d = await getDir(env, cur);
    cur = d?.parentId || null;
  }
  return false;
}

// ======= 主逻辑 =======
export default {
  // 注意这里的参数签名：fetch(request, env, ctx)
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: BASE_CORS });
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/api/')) return handleApi(req, env, url);
      // 传递 ctx 给 handleFile 以便使用 waitUntil
      if (url.pathname.startsWith('/file/')) return handleFile(req, env, ctx, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return new Response(e.message || 'Server Error', { status: 500, headers: BASE_CORS });
    }
  },
};

async function handleApi(req, env, url) {
  if (url.pathname === '/api/login') {
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    const body = await req.json().catch(() => ({}));
    if (await verifyPassword(env, body.password)) {
      const token = await issueToken(env);
      return new Response(JSON.stringify({ success: true, token }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
    }
    return new Response('Invalid Password', { status: 401, headers: BASE_CORS });
  }

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!(await verifyToken(env, token))) return new Response('Unauthorized', { status: 401, headers: BASE_CORS });
  if (!env.MY_BUCKET) return new Response('KV Bucket Not Bound', { status: 500, headers: BASE_CORS });

  if (!_rootEnsured) {
    if (!(await env.MY_BUCKET.get(dirKey(ROOT_ID)))) {
      await env.MY_BUCKET.put(dirKey(ROOT_ID), JSON.stringify(newDir(ROOT_ID, '', null)));
    }
    _rootEnsured = true;
  }

  if (url.pathname === '/api/list') {
    const fid = url.searchParams.get('fid') || ROOT_ID;
    const path = url.searchParams.get('path') || '';
    const dir = await getDir(env, fid);
    if (!dir) return new Response('Dir Not Found', { status: 404, headers: BASE_CORS });
    const folders = Object.entries(dir.folders || {}).map(([name, id]) => ({
      key: `${path}${name}/`, name, type: 'folder', size: 0, uploadedAt: dir.updatedAt || 0, folderId: id
    })).sort((a, b) => b.uploadedAt - a.uploadedAt);
    const files = Object.entries(dir.files || {}).map(([name, meta]) => ({
      key: `${path}${name}`, name, type: meta.type, size: meta.size, uploadedAt: meta.uploadedAt, fileId: meta.fileId
    })).sort((a, b) => b.uploadedAt - a.uploadedAt);
    return new Response(JSON.stringify({ success: true, folderId: dir.id, parentId: dir.parentId, path, folders, files }), {
      headers: { ...BASE_CORS, 'Content-Type': 'application/json', 'Cache-Control': `private, max-age=${API_CACHE_TTL}` }
    });
  }

  if (url.pathname === '/api/create-folder') {
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    const { parentId = ROOT_ID, name } = await req.json();
    const clean = cleanName(name);
    if (!clean) return new Response('Invalid Name', { status: 400, headers: BASE_CORS });
    const parent = await getDir(env, parentId);
    if (!parent) return new Response('Parent Not Found', { status: 404, headers: BASE_CORS });
    parent.folders = parent.folders || {};
    if (parent.folders[clean]) return new Response(JSON.stringify({ success: true }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
    const newId = shortId();
    await putDir(env, newDir(newId, clean, parentId));
    parent.folders[clean] = newId;
    await putDir(env, parent);
    return new Response(JSON.stringify({ success: true }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/upload') {
    if (req.method !== 'POST') return new Response(null, { status: 405 });
    const fd = await req.formData();
    const folderId = fd.get('folderId') || ROOT_ID;
    const dir = await getDir(env, folderId);
    if (!dir) return new Response('Dir Not Found', { status: 404, headers: BASE_CORS });
    dir.files = dir.files || {};
    let isDirDirty = false;
    for (const f of fd.getAll('file')) {
      if (typeof f === 'string' || f.size > MAX_FILE_BYTES) continue;
      const name = cleanName(f.name);
      if (!name) continue;
      const finalName = ensureUniqueName(dir.files, name);
      const ext = finalName.includes('.') ? finalName.split('.').pop() : '';
      const fileId = crypto.randomUUID().replace(/-/g, '') + (ext ? `.${ext}` : '');
      await env.MY_BUCKET.put(binKey(fileId), f.stream(), { metadata: { type: f.type, size: f.size, name: finalName } });
      dir.files[finalName] = { fileId, type: f.type || MIME_TYPES[ext] || 'application/octet-stream', size: f.size, uploadedAt: now() };
      isDirDirty = true;
    }
    if (isDirDirty) await putDir(env, dir);
    return new Response(JSON.stringify({ success: true }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/move') {
    const { items, targetFolderId } = await req.json();
    const target = await getDir(env, targetFolderId);
    if (!target) return new Response('Target Not Found', { status: 404, headers: BASE_CORS });
    target.folders = target.folders || {};
    target.files = target.files || {};
    const groups = new Map();
    items.forEach(i => {
      if (i.fromFolderId !== targetFolderId) {
        if (!groups.has(i.fromFolderId)) groups.set(i.fromFolderId, []);
        groups.get(i.fromFolderId).push(i);
      }
    });
    let isTargetDirty = false;
    for (const [fid, list] of groups) {
      const src = await getDir(env, fid);
      if (!src) continue;
      let isSrcDirty = false;
      for (const item of list) {
        if (item.kind === 'file' && src.files[item.name]) {
          const newName = ensureUniqueName(target.files, item.name);
          target.files[newName] = src.files[item.name];
          delete src.files[item.name];
          isSrcDirty = true; isTargetDirty = true;
        } else if (item.kind === 'folder' && src.folders[item.name]) {
          const childId = src.folders[item.name];
          if (await isDescendant(env, targetFolderId, childId)) continue;
          const newName = ensureUniqueName(target.folders, item.name);
          target.folders[newName] = childId;
          delete src.folders[item.name];
          const child = await getDir(env, childId);
          if (child) { child.parentId = targetFolderId; child.name = newName; await putDir(env, child); }
          isSrcDirty = true; isTargetDirty = true;
        }
      }
      if (isSrcDirty) await putDir(env, src);
    }
    if (isTargetDirty) await putDir(env, target);
    return new Response(JSON.stringify({ success: true }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/batch-delete') {
    const { items } = await req.json();
    const groups = new Map();
    items.forEach(i => {
      if (!groups.has(i.fromFolderId)) groups.set(i.fromFolderId, []);
      groups.get(i.fromFolderId).push(i);
    });
    const binsToDelete = [];
    const dirsToDelete = [];
    const collectRecursive = async (fid) => {
      const d = await getDir(env, fid);
      if (!d) return;
      if (d.files) Object.values(d.files).forEach(m => binsToDelete.push(binKey(m.fileId)));
      if (d.folders) for (const cid of Object.values(d.folders)) await collectRecursive(cid);
      dirsToDelete.push(dirKey(fid));
    };
    for (const [fid, list] of groups) {
      const src = await getDir(env, fid);
      if (!src) continue;
      let isSrcDirty = false;
      for (const item of list) {
        if (item.kind === 'file' && src.files[item.name]) {
          binsToDelete.push(binKey(src.files[item.name].fileId));
          delete src.files[item.name];
          isSrcDirty = true;
        } else if (item.kind === 'folder' && src.folders[item.name]) {
          await collectRecursive(src.folders[item.name]);
          delete src.folders[item.name];
          isSrcDirty = true;
        }
      }
      if (isSrcDirty) await putDir(env, src);
    }
    const allKeys = [...binsToDelete, ...dirsToDelete];
    for (let i = 0; i < allKeys.length; i += 50) await Promise.all(allKeys.slice(i, i + 50).map(k => env.MY_BUCKET.delete(k)));
    return new Response(JSON.stringify({ success: true }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/api/rename-file' || url.pathname === '/api/rename-folder') {
    const { folderId, parentId, oldName, newName } = await req.json();
    const isFile = url.pathname.includes('rename-file');
    const dirId = isFile ? folderId : parentId;
    const dir = await getDir(env, dirId);
    if (!dir) return new Response('404', { status: 404, headers: BASE_CORS });
    const targetMap = isFile ? dir.files : dir.folders;
    if (!targetMap[oldName]) return new Response('Item 404', { status: 404, headers: BASE_CORS });
    const clean = cleanName(newName);
    if (!clean) return new Response('Invalid Name', { status: 400, headers: BASE_CORS });
    const finalName = ensureUniqueName(targetMap, clean);
    targetMap[finalName] = targetMap[oldName];
    delete targetMap[oldName];
    if (!isFile) {
      const child = await getDir(env, targetMap[finalName]);
      if (child) { child.name = finalName; await putDir(env, child); }
    }
    await putDir(env, dir);
    return new Response(JSON.stringify({ success: true }), { headers: { ...BASE_CORS, 'Content-Type': 'application/json' } });
  }

  return new Response('API Endpoint Not Found', { status: 404, headers: BASE_CORS });
}

// 接收 ctx 参数
async function handleFile(req, env, ctx, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: BASE_CORS });
  const fileId = decodeURIComponent(url.pathname.slice('/file/'.length));
  if (!fileId || fileId.length < 5) return new Response('Invalid ID', { status: 400, headers: BASE_CORS });

  const cache = caches.default;
  const cachedResp = await cache.match(req);
  if (cachedResp) return cachedResp;

  const { value, metadata } = await env.MY_BUCKET.getWithMetadata(binKey(fileId), { type: 'stream' });
  if (!value) return new Response('File Not Found', { status: 404, headers: BASE_CORS });

  const h = new Headers(BASE_CORS);
  const ext = fileId.split('.').pop();
  const mime = metadata?.type || MIME_TYPES[ext] || 'application/octet-stream';
  h.set('Content-Type', mime);
  h.set('Content-Disposition', `inline; filename="${metadata?.name || 'file'}"`);
  h.set('Cache-Control', `public, max-age=${FILE_CACHE_TTL}, immutable`);
  h.set('Cloudflare-CDN-Cache-Control', `max-age=${FILE_CACHE_TTL}`);

  const resp = new Response(value, { headers: h });
  // 使用 ctx.waitUntil
  ctx.waitUntil(cache.put(req, resp.clone()));
  return resp;
}