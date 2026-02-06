// _worker.js
// Cloudflare Worker / Pages Functions 入口（module worker）
// 目标：不改前端接口路径（/api/list /api/crumbs /file/:id），增强并发与缓存性能

const MEM_CACHE_MAX = 6000;
const LIST_TTL_MS = 8000;
const CRUMBS_TTL_MS = 8000;
const FILE_META_TTL_MS = 15000;
const EDGE_FILE_CACHE_TTL = 3600;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return handleOptions();

    try {
      if (request.method === "GET" && path === "/api/list") {
        return withCors(await handleList(request, env, url));
      }

      if (request.method === "GET" && path === "/api/crumbs") {
        return withCors(await handleCrumbs(request, env, url));
      }

      if ((request.method === "GET" || request.method === "HEAD") && path.startsWith("/file/")) {
        const fileId = path.slice("/file/".length).trim();
        if (!fileId) return withCors(text("Bad Request", 400));
        return withCors(await handleFile(request, env, ctx, fileId));
      }

      return withCors(text("Not Found", 404));
    } catch (e) {
      return withCors(json({ ok: false, error: e?.message || "Internal Error" }, 500));
    }
  },
};

// ===== handlers =====

async function handleList(request, env, url) {
  const dir = url.searchParams.get("dir") || "root";
  const kvKey = `list:${dir}`;
  const mKey = `L:${kvKey}`;

  let payload = mem.get(mKey);
  if (!payload) {
    payload = await sf.do(mKey, async () => {
      const raw = await env.META_KV.get(kvKey, "text"); // 绑定名：META_KV
      const arr = raw ? safeJson(raw, []) : [];
      const body = JSON.stringify({ ok: true, data: arr });
      const etag = weakEtag(`${kvKey}|${arr.length}|${pickMaxUpdatedAt(arr)}|${body.length}`);
      const v = { body, etag };
      mem.set(mKey, v, jitter(LIST_TTL_MS));
      return v;
    });
  }

  const inm = request.headers.get("If-None-Match");
  if (inm && inm === payload.etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: payload.etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  return new Response(payload.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ETag: payload.etag,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

async function handleCrumbs(request, env, url) {
  const dir = url.searchParams.get("dir") || "root";
  const kvKey = `crumbs:${dir}`;
  const mKey = `C:${kvKey}`;

  let payload = mem.get(mKey);
  if (!payload) {
    payload = await sf.do(mKey, async () => {
      const raw = await env.META_KV.get(kvKey, "text");
      const arr = raw ? safeJson(raw, []) : [];
      const body = JSON.stringify({ ok: true, data: arr });
      const etag = weakEtag(`${kvKey}|${arr.length}|${pickMaxUpdatedAt(arr)}|${body.length}`);
      const v = { body, etag };
      mem.set(mKey, v, jitter(CRUMBS_TTL_MS));
      return v;
    });
  }

  const inm = request.headers.get("If-None-Match");
  if (inm && inm === payload.etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: payload.etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  return new Response(payload.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ETag: payload.etag,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

async function handleFile(request, env, ctx, fileId) {
  const method = request.method;
  const range = request.headers.get("Range");
  const isRange = !!range;

  // 1) 元数据缓存（singleflight + 内存短 TTL）
  const mKey = `FM:${fileId}`;
  let meta = mem.get(mKey);
  if (!meta) {
    meta = await sf.do(mKey, async () => {
      const raw = await env.META_KV.get(`file:${fileId}`, "text");
      const m = raw ? safeJson(raw, null) : null;
      if (m) mem.set(mKey, m, jitter(FILE_META_TTL_MS));
      return m;
    });
  }
  if (!meta) return text("Not Found", 404);

  const etag = meta.etag || weakEtag(`${fileId}|${meta.updatedAt || 0}|${meta.size || 0}`);
  const baseHeaders = fileHeaders({
    etag,
    contentType: meta.contentType || "application/octet-stream",
    size: Number(meta.size) || undefined,
    fileName: meta.name,
    cacheSeconds: Number(meta.cacheSeconds || EDGE_FILE_CACHE_TTL),
  });

  const inm = request.headers.get("If-None-Match");
  if (!isRange && inm && inm === etag) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  // 2) 直链跳转（最省成本）
  if (meta.redirectUrl) {
    const redirectHeaders = new Headers(baseHeaders);
    redirectHeaders.set("Location", meta.redirectUrl);

    if (method === "HEAD") {
      return new Response(null, { status: 302, headers: redirectHeaders });
    }

    // 非 range GET 走 edge cache
    if (!isRange && method === "GET") {
      const c = caches.default;
      const cacheKey = new Request(request.url, { method: "GET" });
      const hit = await c.match(cacheKey);
      if (hit) return hit;

      const resp = new Response(null, { status: 302, headers: redirectHeaders });
      ctx.waitUntil(c.put(cacheKey, resp.clone()));
      return resp;
    }

    return new Response(null, { status: 302, headers: redirectHeaders });
  }

  // 3) HEAD 直接返回，不读二进制
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers: baseHeaders });
  }

  // 4) 非 range GET：先查 edge cache（修复顺序）
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  if (!isRange && method === "GET") {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  // 5) 读取二进制
  const dataKey = meta.dataKey || `blob:${fileId}`;
  const bin = await sf.do(`FB:${dataKey}`, async () => {
    if (env.BLOB_KV) return await env.BLOB_KV.get(dataKey, "arrayBuffer");
    return await env.META_KV.get(dataKey, "arrayBuffer");
  });
  if (!bin) return text("Not Found", 404);

  const total = bin.byteLength;
  baseHeaders.set("Content-Length", String(total));

  if (isRange) {
    const r = parseRange(range, total);
    if (!r) {
      return new Response(null, {
        status: 416,
        headers: new Headers({ "Content-Range": `bytes */${total}` }),
      });
    }
    const chunk = bin.slice(r.start, r.end + 1);
    const h = new Headers(baseHeaders);
    h.set("Content-Range", `bytes ${r.start}-${r.end}/${total}`);
    h.set("Content-Length", String(r.end - r.start + 1));
    return new Response(chunk, { status: 206, headers: h });
  }

  const resp = new Response(bin, { status: 200, headers: baseHeaders });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

// ===== utils =====

class LruTtlCache {
  constructor(max = 3000) {
    this.max = max;
    this.map = new Map();
  }
  get(k) {
    const n = this.map.get(k);
    if (!n) return null;
    if (n.exp <= Date.now()) {
      this.map.delete(k);
      return null;
    }
    this.map.delete(k);
    this.map.set(k, n);
    return n.v;
  }
  set(k, v, ttlMs) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { v, exp: Date.now() + ttlMs });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

class SingleFlight {
  constructor() {
    this.m = new Map();
  }
  async do(key, fn) {
    if (this.m.has(key)) return this.m.get(key);
    const p = (async () => {
      try {
        return await fn();
      } finally {
        this.m.delete(key);
      }
    })();
    this.m.set(key, p);
    return p;
  }
}

// ✅ 放在 class 定义之后，避免初始化时引用未完成
const mem = new LruTtlCache(MEM_CACHE_MAX);
const sf = new SingleFlight();

function parseRange(header, total) {
  if (!header || !header.startsWith("bytes=") || total <= 0) return null;
  if (header.includes(",")) return null;
  const [a, b] = header.slice(6).split("-");
  let start = a === "" ? NaN : Number(a);
  let end = b === "" ? NaN : Number(b);

  if (Number.isNaN(start) && Number.isNaN(end)) return null;

  // bytes=-500
  if (Number.isNaN(start)) {
    const suffix = end;
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else if (Number.isNaN(end)) {
    end = total - 1;
  }

  if (start < 0 || end < 0 || start > end || start >= total) return null;
  if (end >= total) end = total - 1;
  return { start, end };
}

function weakEtag(input) {
  const h = fnv1a32(String(input || ""));
  return `W/"${h.toString(16)}"`;
}
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function jitter(ms) {
  return Math.floor(ms * (0.9 + Math.random() * 0.2));
}

function pickMaxUpdatedAt(arr) {
  let m = 0;
  for (const x of arr || []) {
    const v = Number(x?.updatedAt || x?.updateAt || x?.mtime || 0);
    if (v > m) m = v;
  }
  return m;
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function fileHeaders({ etag, contentType, size, fileName, cacheSeconds }) {
  const h = new Headers();
  h.set("ETag", etag);
  h.set("Content-Type", contentType || "application/octet-stream");
  h.set("Accept-Ranges", "bytes");
  h.set("Cache-Control", `public, max-age=${cacheSeconds || 3600}, stale-while-revalidate=86400`);
  if (typeof size === "number" && size >= 0) h.set("Content-Length", String(size));
  if (fileName) h.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return h;
}

function handleOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function withCors(resp) {
  const h = new Headers(resp.headers);
  const c = corsHeaders();
  for (const k in c) h.set(k, c[k]);
  return new Response(resp.body, { status: resp.status, headers: h });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, Range",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Range, Accept-Ranges, Content-Disposition",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function text(s, status = 200) {
  return new Response(s, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
