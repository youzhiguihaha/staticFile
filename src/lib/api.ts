// src/lib/api.ts

export interface FolderItem {
  key: string;
  folderId: string;
  name: string;
  type: 'folder';
  size: 0;
  uploadedAt: number;
  fileId: null;
}

export interface FileItem {
  key: string;
  fileId: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

export type ExplorerItem = FolderItem | FileItem;

export type MoveItem =
  | { kind: 'file'; fromFolderId: string; name: string }
  | { kind: 'folder'; fromFolderId: string; folderId: string; name: string };

export type DeleteItem =
  | { kind: 'file'; fromFolderId: string; name: string; fileId: string }
  | { kind: 'folder'; fromFolderId: string; name: string; folderId: string };

export interface ListResponse {
  success: true;
  folderId: string;
  parentId: string | null;
  path: string;
  updatedAt: number;
  folders: FolderItem[];
  files: FileItem[];
}

export interface Crumb {
  folderId: string;
  name: string;
  path: string;
}

export interface UploadResultItem {
  name: string;
  fileId: string;
  type: string;
  size: number;
  uploadedAt: number;
}

export interface UploadResponse {
  success: true;
  uploaded: UploadResultItem[];
}

export interface MoveTargetAdded {
  files: UploadResultItem[];
  folders: { name: string; folderId: string }[];
}

export interface MoveResponse {
  success: true;
  noop?: boolean;
  targetAdded?: MoveTargetAdded;
}

export interface CreateFolderResponse {
  success: true;
  folderId: string;
  existed: boolean;
  name: string; // 最终生效名称（可能被 ensureUniqueName 修改）
}

export interface RenameResponse {
  success: true;
  noop?: boolean;
  newName: string; // 最终生效名称（可能被 ensureUniqueName 修改）
}

const TOKEN_KEY = 'auth_token';
const LOGIN_TIME_KEY = 'login_timestamp';
const TIMEOUT_MS = 12 * 60 * 60 * 1000;

async function readTextSafe(res: Response) {
  try {
    return await res.text();
  } catch {
    return 'Request failed';
  }
}

function abortError() {
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const e: any = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  }
}

// ==============================
// /api/list 成本优化：in-flight 合并 + 超短 TTL 内存缓存 + LRU 上限
// ==============================
type ListKey = string;

function makeListKey(folderId: string, path: string) {
  return `${folderId}|${path}`;
}

type InflightEntry<T> = {
  controller: AbortController;
  promise: Promise<T>;
  refCount: number;
  done: boolean;
};

const listInflight = new Map<ListKey, InflightEntry<ListResponse>>();

// 微 TTL：尽量“用户无感”，但能吃掉短时间重复请求
const LIST_MEM_CACHE_TTL_MS = 800;
// 增加容量上限，避免长时间使用 Map 无上限增长
const LIST_MEM_CACHE_MAX = 256;
const LIST_HTTP_CACHE_MAX = 256;

type MemCacheEntry<T> = { ts: number; value: T };
const listMemCache = new Map<ListKey, MemCacheEntry<ListResponse>>();
const listHttpCache = new Map<ListKey, { etag: string; value: ListResponse; ts: number }>();

function memCacheGet(k: ListKey) {
  const v = listMemCache.get(k);
  if (!v) return null;
  // 刷新 LRU 顺序
  listMemCache.delete(k);
  listMemCache.set(k, v);
  return v;
}

function memCacheSet(k: ListKey, v: MemCacheEntry<ListResponse>) {
  // 刷新 LRU 顺序
  if (listMemCache.has(k)) listMemCache.delete(k);
  listMemCache.set(k, v);

  if (listMemCache.size > LIST_MEM_CACHE_MAX) {
    const firstKey = listMemCache.keys().next().value;
    if (firstKey !== undefined) listMemCache.delete(firstKey);
  }
}

function httpCacheGet(k: ListKey) {
  const v = listHttpCache.get(k);
  if (!v) return null;
  listHttpCache.delete(k);
  listHttpCache.set(k, v);
  return v;
}

function httpCacheSet(k: ListKey, v: { etag: string; value: ListResponse; ts: number }) {
  if (listHttpCache.has(k)) listHttpCache.delete(k);
  listHttpCache.set(k, v);
  if (listHttpCache.size > LIST_HTTP_CACHE_MAX) {
    const firstKey = listHttpCache.keys().next().value;
    if (firstKey !== undefined) listHttpCache.delete(firstKey);
  }
}

function cloneListResponse(r: ListResponse): ListResponse {
  return {
    ...r,
    folders: Array.isArray(r.folders) ? [...r.folders] : [],
    files: Array.isArray(r.files) ? [...r.files] : [],
  };
}

function withConsumerSignal<T>(p: Promise<T> | T, signal?: AbortSignal): Promise<T> {
  const basePromise = p instanceof Promise ? p : Promise.resolve(p);
  if (!signal) return basePromise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    let finished = false;

    const onAbort = () => {
      if (finished) return;
      finished = true;
      reject(abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });

    basePromise
      .then((v) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort as any);
        resolve(v);
      })
      .catch((e) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', onAbort as any);
        reject(e);
      });
  });
}

function subscribeInflight<T>(entry: InflightEntry<T>, signal?: AbortSignal): Promise<T> {
  entry.refCount += 1;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.refCount = Math.max(0, entry.refCount - 1);
    // 当所有订阅者都不需要结果了，且请求仍未完成 -> abort 底层请求，省掉无意义读取
    if (entry.refCount === 0 && !entry.done) entry.controller.abort();
  };

  if (!signal) return entry.promise.finally(release);

  if (signal.aborted) {
    release();
    return Promise.reject(abortError());
  }

  return new Promise<T>((resolve, reject) => {
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      release();
      reject(abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });

    entry.promise
      .then((v) => {
        signal.removeEventListener('abort', onAbort as any);
        if (aborted) return;
        release();
        resolve(v);
      })
      .catch((e) => {
        signal.removeEventListener('abort', onAbort as any);
        if (aborted) return;
        release();
        reject(e);
      });
  });
}

// ==============================
// auth helper（不改对外接口；减少同一次调用内 localStorage 重复读取）
// ==============================
function requireAuthToken(logout: () => void): string {
  const timeStr = localStorage.getItem(LOGIN_TIME_KEY);
  if (!timeStr) throw new Error('Expired');

  const ts = Number(timeStr);
  if (!Number.isFinite(ts)) {
    logout();
    throw new Error('Expired');
  }

  if (Date.now() - ts > TIMEOUT_MS) {
    logout();
    throw new Error('Expired');
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Expired');
  return token;
}

export const api = {
  // ===== list cache controls（仅前端内存，不增加 KV 写删）=====
  invalidateListCache(folderId: string, path?: string) {
    if (!folderId) return;

    if (typeof path === 'string') {
      const k = makeListKey(folderId, path);
      listMemCache.delete(k);
      listHttpCache.delete(k);
      return;
    }

    const prefix = `${folderId}|`;
    for (const k of listMemCache.keys()) {
      if (k.startsWith(prefix)) listMemCache.delete(k);
    }
    for (const k of listHttpCache.keys()) {
      if (k.startsWith(prefix)) listHttpCache.delete(k);
    }
  },

  clearListCache() {
    listMemCache.clear();
    listHttpCache.clear();
  },

  // ===== auth =====
  checkAuth() {
    const timeStr = localStorage.getItem(LOGIN_TIME_KEY);
    if (!timeStr) return false;

    const ts = Number(timeStr);
    if (!Number.isFinite(ts)) {
      this.logout();
      return false;
    }

    if (Date.now() - ts > TIMEOUT_MS) {
      this.logout();
      return false;
    }

    return !!localStorage.getItem(TOKEN_KEY);
  },

  getToken: () => localStorage.getItem(TOKEN_KEY),

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOGIN_TIME_KEY);
    window.location.reload();
  },

  async login(password: string): Promise<boolean> {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(LOGIN_TIME_KEY, Date.now().toString());

      // 登录后清理 list 缓存，避免显示旧状态
      this.clearListCache();

      return true;
    } catch {
      return false;
    }
  },

  // ===== list（in-flight 合并 + 微 TTL cache + LRU 上限 + HTTP 条件请求 + 可 abort + 可 bypassCache）=====
  async list(
    folderId: string,
    path: string,
    opts?: { signal?: AbortSignal; bypassCache?: boolean }
  ): Promise<ListResponse> {
    const token = requireAuthToken(this.logout.bind(this));
    const k = makeListKey(folderId, path);

    // 1) 微 TTL 内存缓存（不 bypass 时启用）
    if (!opts?.bypassCache) {
      const cached = memCacheGet(k);
      if (cached && Date.now() - cached.ts <= LIST_MEM_CACHE_TTL_MS) {
        return withConsumerSignal(cloneListResponse(cached.value), opts?.signal);
      }
    }

    // 2) in-flight 合并（无论 bypassCache 与否都合并；bypass 的语义是“别用旧缓存”，不是“必须重复发请求”）
    let entry = listInflight.get(k);
    if (!entry) {
      const controller = new AbortController();
      const qs = new URLSearchParams({ fid: folderId, path }).toString();

      const prevHttp = httpCacheGet(k);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (prevHttp?.etag) headers['If-None-Match'] = prevHttp.etag;

      const promise = fetch(`/api/list?${qs}`, {
        headers,
        signal: controller.signal,
        cache: 'no-cache', // 每次重验证，避免显示长期陈旧数据
      }).then(async (res) => {
        if (res.status === 304 && prevHttp?.value) {
          return prevHttp.value;
        }
        if (!res.ok) throw new Error(await readTextSafe(res));

        const data = (await res.json()) as ListResponse;
        const etag = res.headers.get('ETag');
        if (etag) {
          httpCacheSet(k, { etag, value: data, ts: Date.now() });
        }
        return data;
      });

      entry = { controller, promise, refCount: 0, done: false };
      listInflight.set(k, entry);

      entry.promise
        .then((data) => {
          // 只缓存成功结果
          memCacheSet(k, { ts: Date.now(), value: data });
        })
        .catch(() => {})
        .finally(() => {
          entry!.done = true;
          listInflight.delete(k);
        });
    }

    const res = await subscribeInflight(entry, opts?.signal);
    return cloneListResponse(res);
  },

  async crumbs(folderId: string): Promise<Crumb[]> {
    const token = requireAuthToken(this.logout.bind(this));
    const qs = new URLSearchParams({ fid: folderId }).toString();
    const res = await fetch(`/api/crumbs?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-cache',
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = await res.json();
    return Array.isArray(data?.crumbs) ? (data.crumbs as Crumb[]) : [];
  },

  // ===== create/upload/move/delete/rename =====
  async createFolder(parentId: string, name: string): Promise<CreateFolderResponse> {
    const token = requireAuthToken(this.logout.bind(this));
    const res = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, name }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = (await res.json()) as CreateFolderResponse;

    // 写操作成功后：立刻失效相关 list 缓存，避免短时间旧列表
    this.invalidateListCache(parentId);

    return data;
  },

  async upload(files: File[], folderId: string): Promise<UploadResponse> {
    const token = requireAuthToken(this.logout.bind(this));
    const form = new FormData();

    for (const f of files) {
      // 对齐后端 cleanName：处理 / \ |
      const safeName = f.name.replace(/[\/\\|]/g, '_');
      // 避免 new File([f], ...) 的额外开销：直接指定 filename
      form.append('file', f, safeName);
    }
    form.append('folderId', folderId);

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = (await res.json()) as UploadResponse;

    // 写操作成功后：立刻失效相关 list 缓存
    this.invalidateListCache(folderId);

    return { success: true, uploaded: Array.isArray(data?.uploaded) ? data.uploaded : [] };
  },

  async move(items: MoveItem[], targetFolderId: string): Promise<MoveResponse> {
    const token = requireAuthToken(this.logout.bind(this));
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, targetFolderId }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = (await res.json()) as MoveResponse;

    // 写操作成功后：失效源目录与目标目录的 list 缓存
    const ids = new Set<string>();
    ids.add(targetFolderId);
    for (const it of items || []) {
      if (it && typeof (it as any).fromFolderId === 'string') ids.add((it as any).fromFolderId);
    }
    for (const id of ids) this.invalidateListCache(id);

    return data;
  },

  async batchDelete(items: DeleteItem[]): Promise<void> {
    const token = requireAuthToken(this.logout.bind(this));
    const res = await fetch('/api/batch-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));

    // 写操作成功后：失效涉及到的来源目录 list 缓存
    const ids = new Set<string>();
    for (const it of items || []) {
      if (it && typeof (it as any).fromFolderId === 'string') ids.add((it as any).fromFolderId);
    }
    for (const id of ids) this.invalidateListCache(id);
  },

  async renameFile(folderId: string, oldName: string, newName: string): Promise<RenameResponse> {
    const token = requireAuthToken(this.logout.bind(this));
    const res = await fetch('/api/rename-file', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, oldName, newName }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = (await res.json()) as RenameResponse;

    // 写操作成功后：失效当前目录 list 缓存
    this.invalidateListCache(folderId);

    return data;
  },

  async renameFolder(parentId: string, folderId: string, oldName: string, newName: string): Promise<RenameResponse> {
    const token = requireAuthToken(this.logout.bind(this));
    const res = await fetch('/api/rename-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, folderId, oldName, newName }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = (await res.json()) as RenameResponse;

    // 写操作成功后：失效父目录 list 缓存
    this.invalidateListCache(parentId);

    return data;
  },

  getFileUrl(fileId: string) {
    if (!fileId) return '';
    return `${window.location.origin}/file/${encodeURIComponent(fileId)}`;
  },
};
