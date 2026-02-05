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
  // 兼容性：DOMException 在现代浏览器都有；极端情况下 fallback Error
  try {
    return new DOMException('Aborted', 'AbortError');
  } catch {
    const e: any = new Error('Aborted');
    e.name = 'AbortError';
    return e;
  }
}

// ===== In-flight dedupe for /api/list =====
// 同一个 (fid|path) 并发只发一次请求，减少 KV.getDir 读取
type ListKey = string;
type InflightEntry<T> = {
  key: string;
  controller: AbortController;
  promise: Promise<T>;
  refCount: number;
  done: boolean;
};

const listInflight = new Map<ListKey, InflightEntry<ListResponse>>();

function listKey(folderId: string, path: string) {
  return `${folderId}|${path}`;
}

function wrapWithConsumerSignal<T>(
  entry: InflightEntry<T>,
  consumerSignal?: AbortSignal
): Promise<T> {
  if (!consumerSignal) return entry.promise;

  // 已经 abort：直接退订
  if (consumerSignal.aborted) {
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0 && !entry.done) entry.controller.abort();
    return Promise.reject(abortError());
  }

  let settled = false;
  let unsubscribed = false;

  const onAbort = () => {
    if (unsubscribed) return;
    unsubscribed = true;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount === 0 && !entry.done) entry.controller.abort();
  };

  // consumer abort 只影响自己：我们让返回的 promise 直接 AbortError
  return new Promise<T>((resolve, reject) => {
    consumerSignal.addEventListener('abort', onAbort, { once: true });

    entry.promise
      .then((v) => {
        settled = true;
        consumerSignal.removeEventListener('abort', onAbort as any);
        // 如果调用方在这之前 abort 了，就按 abort 处理
        if (consumerSignal.aborted) return reject(abortError());
        resolve(v);
      })
      .catch((e) => {
        settled = true;
        consumerSignal.removeEventListener('abort', onAbort as any);
        if (consumerSignal.aborted) return reject(abortError());
        reject(e);
      })
      .finally(() => {
        // 正常完成时需要退订一次
        if (!unsubscribed) {
          unsubscribed = true;
          entry.refCount = Math.max(0, entry.refCount - 1);
          // 如果此时所有订阅者都结束了，不需要 abort（done=true 也不会触发）
          if (entry.refCount === 0 && !entry.done && !settled) entry.controller.abort();
        }
      });
  });
}

export const api = {
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

  // 新增第三参 opts.signal（可选），不影响原有调用
  async list(folderId: string, path: string, opts?: { signal?: AbortSignal }): Promise<ListResponse> {
    if (!this.checkAuth()) throw new Error('Expired');

    const token = this.getToken();
    const key = listKey(folderId, path);

    // 复用并发中的同参请求
    let entry = listInflight.get(key);
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

      entry = { key, controller, promise, refCount: 0, done: false };
      listInflight.set(key, entry);

      // 结束后清理
      entry.promise
        .catch(() => {})
        .finally(() => {
          entry!.done = true;
          listInflight.delete(key);
        });
    }

    // 每个调用者算一个订阅者
    entry.refCount += 1;
    return wrapWithConsumerSignal(entry, opts?.signal);
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

  async createFolder(parentId: string, name: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, name }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
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
    const data = (await res.json()) as MoveResponse;
    return data;
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

  async renameFile(folderId: string, oldName: string, newName: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/rename-file', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, oldName, newName }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
  },

  async renameFolder(parentId: string, folderId: string, oldName: string, newName: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/rename-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, folderId, oldName, newName }),
    });
    if (!res.ok) throw new Error(await readTextSafe(res));
  },

  getFileUrl(fileId: string) {
    if (!fileId) return '';
    return `${window.location.origin}/file/${encodeURIComponent(fileId)}`;
  },
};