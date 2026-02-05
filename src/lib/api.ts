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
// /api/list 成本优化：in-flight 合并 + 超短 TTL 内存缓存
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

type MemCacheEntry<T> = { ts: number; value: T };
const listMemCache = new Map<ListKey, MemCacheEntry<ListResponse>>();

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

export const api = {
  // ===== list cache controls（仅前端内存，不增加 KV 写删）=====
  invalidateListCache(folderId: string, path?: string) {
    if (!folderId) return;

    if (typeof path === 'string') {
      listMemCache.delete(makeListKey(folderId, path));
      return;
    }

    const prefix = `${folderId}|`;
    for (const k of listMemCache.keys()) {
      if (k.startsWith(prefix)) listMemCache.delete(k);
    }
  },

  clearListCache() {
    listMemCache.clear();
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
      return true;
    } catch {
      return false;
    }
  },

  // ===== list（in-flight 合并 + 微 TTL cache + 可 abort + 可 bypassCache）=====
  async list(folderId: string, path: string, opts?: { signal?: AbortSignal; bypassCache?: boolean }): Promise<ListResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const k = makeListKey(folderId, path);

    // 1) 微 TTL 内存缓存（不 bypass 时启用）
    if (!opts?.bypassCache) {
      const cached = listMemCache.get(k);
      if (cached && Date.now() - cached.ts <= LIST_MEM_CACHE_TTL_MS) {
        return withConsumerSignal(cloneListResponse(cached.value), opts?.signal);
      }
    }

    // 2) in-flight 合并（无论 bypassCache 与否都合并；bypass 的语义是“别用旧缓存”，不是“必须重复发请求”）
    let entry = listInflight.get(k);
    if (!entry) {
      const controller = new AbortController();
      const qs = new URLSearchParams({ fid: folderId, path }).toString();

      const promise = fetch(`/api/list?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }).then(async (res) => {
        if (!res.ok) throw new Error(await readTextSafe(res));
        return (await res.json()) as ListResponse;
      });

      entry = { controller, promise, refCount: 0, done: false };
      listInflight.set(k, entry);

      entry.promise
        .then((data) => {
          // 只缓存成功结果
          listMemCache.set(k, { ts: Date.now(), value: data });
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
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const qs = new URLSearchParams({ fid: folderId }).toString();
    const res = await fetch(`/api/crumbs?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = await res.json();
    return Array.isArray(data?.crumbs) ? (data.crumbs as Crumb[]) : [];
  },

  // ===== create/upload/move/delete/rename =====
  async createFolder(parentId: string, name: string): Promise<CreateFolderResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, name }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    return (await res.json()) as CreateFolderResponse;
  },

  async upload(files: File[], folderId: string): Promise<UploadResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const form = new FormData();

    for (const f of files) {
      const safeName = f.name.replace(/[\/|]/g, '_');
      const safeFile = new File([f], safeName, { type: f.type });
      form.append('file', safeFile);
    }
    form.append('folderId', folderId);

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    const data = (await res.json()) as UploadResponse;
    return { success: true, uploaded: Array.isArray(data?.uploaded) ? data.uploaded : [] };
  },

  async move(items: MoveItem[], targetFolderId: string): Promise<MoveResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, targetFolderId }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    return (await res.json()) as MoveResponse;
  },

  async batchDelete(items: DeleteItem[]): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/batch-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
  },

  async renameFile(folderId: string, oldName: string, newName: string): Promise<RenameResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/rename-file', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, oldName, newName }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    return (await res.json()) as RenameResponse;
  },

  async renameFolder(parentId: string, folderId: string, oldName: string, newName: string): Promise<RenameResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/rename-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, folderId, oldName, newName }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
    return (await res.json()) as RenameResponse;
  },

  getFileUrl(fileId: string) {
    if (!fileId) return '';
    return `${window.location.origin}/file/${encodeURIComponent(fileId)}`;
  },
};