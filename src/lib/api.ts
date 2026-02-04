// src/lib/api.ts

export type EntryKind = 'file' | 'folder';

export interface EntryItem {
  id: string;              // fileId 或 folderId
  kind: EntryKind;
  name: string;
  type?: string;           // file only
  size?: number;           // file only
  uploadedAt: number;

  // trash / search 才会出现的字段
  deletedAt?: number;
  origParentId?: string;

  // search results
  parentId?: string;
  path?: string;
  crumb?: { id: string; name: string }[]; // 用于从搜索结果/树跳转时恢复面包屑
}

const TOKEN_KEY = 'auth_token';

function parseTokenExp(token: string): number | null {
  try {
    const [payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(pad);
    const obj = JSON.parse(json);
    return typeof obj?.exp === 'number' ? obj.exp : null;
  } catch {
    return null;
  }
}

export const api = {
  getToken: () => localStorage.getItem(TOKEN_KEY) || '',

  checkAuth(): boolean {
    const token = this.getToken();
    if (!token) return false;
    const exp = parseTokenExp(token);
    if (!exp) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now >= exp) {
      this.logout();
      return false;
    }
    return true;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
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
      if (!data?.token) return false;
      localStorage.setItem(TOKEN_KEY, data.token);
      return true;
    } catch {
      return false;
    }
  },

  async listFolder(folderId: string): Promise<EntryItem[]> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch(`/api/list-folder?folderId=${encodeURIComponent(folderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    return (data.items || []) as EntryItem[];
  },

  async createFolder(parentId: string, name: string): Promise<{ folderId: string; name: string }> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, name }),
    });
    if (!res.ok) throw new Error('Create folder failed');
    const data = await res.json();
    return { folderId: data.folderId, name: data.name };
  },

  async upload(files: File[], folderId: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const formData = new FormData();
    formData.append('folderId', folderId);

    for (const file of files) {
      const safeName = file.name.replace(/[\/|]/g, '_');
      const safeFile = new File([file], safeName, { type: file.type });
      formData.append('file', safeFile);
    }

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
  },

  async move(items: { id: string; fromFolderId: string }[], toFolderId: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, toFolderId }),
    });
    if (!res.ok) throw new Error('Move failed');
  },

  // 默认软删（移入 trash），hard=true 才会真的删 blob（消耗 delete 配额）
  async batchDelete(items: { id: string; fromFolderId: string }[], hard = false): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/batch-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, hard }),
    });
    if (!res.ok) throw new Error('Delete failed');
  },

  async purgeTrash(ids: string[]): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/purge-trash', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error('Purge failed');
  },

  async search(q: string, limit = 200): Promise<EntryItem[]> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    return (data.items || []) as EntryItem[];
  },

  getFileUrl(fileId: string) {
    return `${window.location.origin}/file/${encodeURIComponent(fileId)}`;
  },
};
