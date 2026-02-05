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
  files: UploadResultItem[]; // 结构同上传返回（name/fileId/type/size/uploadedAt）
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

  async list(folderId: string, path: string): Promise<ListResponse> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const qs = new URLSearchParams({ fid: folderId, path }).toString();
    const res = await fetch(`/api/list?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await readTextSafe(res));
    return await res.json();
  },

  // 解析最新面包屑链：folder 移动/重命名后仍正确（只读）
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

  // 改为：返回 uploaded 列表（不改变“上传成功/失败”的功能，只是给 UI 减少一次 list 的机会）
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

  // 改为：返回 targetAdded（不改变移动功能，只是给 UI 减少 list 的机会）
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