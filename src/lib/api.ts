// api.ts
// 前端 API 层：不改接口路径，只加“304/ETag + 超时 + 轻重试”
// 兼容调用：getList / getCrumbs / getFileUrl

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error?: string };
export type ApiResp<T> = ApiOk<T> | ApiErr;

const ETAG_CACHE = new Map<string, string>();
const JSON_CACHE = new Map<string, any>();

const DEFAULT_TIMEOUT = 12000;
const RETRY_COUNT = 1; // GET 失败最多重试 1 次
const RETRY_DELAY = 250;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(resp: Response) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

async function requestJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  const oldEtag = ETAG_CACHE.get(url);
  if (oldEtag) headers.set("If-None-Match", oldEtag);

  let lastErr: any = null;

  for (let i = 0; i <= RETRY_COUNT; i++) {
    try {
      let resp = await fetchWithTimeout(url, { ...init, headers }, DEFAULT_TIMEOUT);

      // 修复点：304 且本地无缓存时，去掉 If-None-Match 再拉一次
      if (resp.status === 304) {
        const cached = JSON_CACHE.get(url);
        if (cached !== undefined) return cached as T;

        headers.delete("If-None-Match");
        resp = await fetchWithTimeout(url, { ...init, headers }, DEFAULT_TIMEOUT);
      }

      if (!resp.ok) {
        const txt = await safeText(resp);
        throw new Error(`HTTP ${resp.status}: ${txt || resp.statusText}`);
      }

      const etag = resp.headers.get("ETag");
      if (etag) ETAG_CACHE.set(url, etag);

      const data = (await resp.json()) as T;
      JSON_CACHE.set(url, data);
      return data;
    } catch (e: any) {
      lastErr = e;
      if (i < RETRY_COUNT && method === "GET") {
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }
      break;
    }
  }

  throw lastErr || new Error("request failed");
}

/** 保持接口：/api/list?dir=xxx */
export async function getList<T = any[]>(dir = "root"): Promise<ApiResp<T>> {
  const url = `/api/list?dir=${encodeURIComponent(dir)}`;
  return requestJson<ApiResp<T>>(url, { method: "GET" });
}

/** 保持接口：/api/crumbs?dir=xxx */
export async function getCrumbs<T = any[]>(dir = "root"): Promise<ApiResp<T>> {
  const url = `/api/crumbs?dir=${encodeURIComponent(dir)}`;
  return requestJson<ApiResp<T>>(url, { method: "GET" });
}

/** 保持直链路径：/file/:id */
export function getFileUrl(fileId: string): string {
  return `/file/${encodeURIComponent(fileId)}`;
}

/** 可选：拿文件头信息（不下载 body） */
export async function headFile(fileId: string): Promise<Response> {
  const url = getFileUrl(fileId);
  return fetchWithTimeout(url, { method: "HEAD" }, 10000);
}

/** 可选：按需拉取 Range（例如视频播放器） */
export async function fetchFileRange(fileId: string, start: number, end?: number): Promise<Response> {
  const url = getFileUrl(fileId);
  const headers = new Headers();
  headers.set("Range", `bytes=${start}-${typeof end === "number" ? end : ""}`);
  return fetchWithTimeout(url, { method: "GET", headers }, 15000);
}

/** 手动清理前端缓存 */
export function clearApiCache(path?: string) {
  if (!path) {
    ETAG_CACHE.clear();
    JSON_CACHE.clear();
    return;
  }
  ETAG_CACHE.delete(path);
  JSON_CACHE.delete(path);
}

const api = {
  getList,
  getCrumbs,
  getFileUrl,
  headFile,
  fetchFileRange,
  clearApiCache,
};

export default api;
