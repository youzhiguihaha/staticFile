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

const TOKEN_KEY = 'auth_token';
const LOGIN_TIME_KEY = 'login_timestamp';
const TIMEOUT_MS = 12 * 60 * 60 * 1000;

export const api = {
  checkAuth() {
    const timeStr = localStorage.getItem(LOGIN_TIME_KEY);
    if (!timeStr) return false;
    if (Date.now() - parseInt(timeStr) > TIMEOUT_MS) {
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
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  },

  async createFolder(parentId: string, name: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, name }),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  async upload(files: File[], folderId: string): Promise<void> {
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
    if (!res.ok) throw new Error(await res.text());
  },

  async move(items: MoveItem[], targetFolderId: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, targetFolderId }),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  async batchDelete(items: DeleteItem[]): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/batch-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(await res.text());
  },

  getFileUrl(fileId: string) {
    if (!fileId) return '';
    return `${window.location.origin}/file/${encodeURIComponent(fileId)}`;
  },
};
