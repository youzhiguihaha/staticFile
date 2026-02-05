// src/lib/api.ts

// 定义数据类型，与后端保持一致
export interface FolderItem {
  key: string;      // 用于 UI 列表的唯一 Key (path + name)
  folderId: string; // KV 中的真实 ID
  name: string;
  type: 'folder';
  size: 0;
  uploadedAt: number;
  fileId: null;
}

export interface FileItem {
  key: string;
  fileId: string;   // 下载用的真实 ID
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

export type ExplorerItem = FolderItem | FileItem;

// 移动/删除操作的数据结构
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
const TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12小时超时

export const api = {
  // 检查本地登录状态 (不请求服务器，极致省流)
  checkAuth() {
    const t = localStorage.getItem(LOGIN_TIME_KEY);
    if (!t) return false;
    if (Date.now() - parseInt(t) > TIMEOUT_MS) {
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

  // 通用请求封装
  async request(path: string, opts: RequestInit = {}) {
    if (!this.checkAuth() && !path.includes('/login')) throw new Error('登录已过期');
    
    const headers = {
      'Authorization': `Bearer ${this.getToken()}`,
      ...opts.headers
    };

    const res = await fetch(path, { ...opts, headers });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || '请求失败');
    }
    return res.json();
  },

  async login(password: string): Promise<boolean> {
    try {
      const data = await this.request('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
        headers: { 'Content-Type': 'application/json' },
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(LOGIN_TIME_KEY, Date.now().toString());
      return true;
    } catch {
      return false;
    }
  },

  // 获取文件列表
  // bustCache: 当刚进行完上传/删除操作时设为 true，强制加上时间戳参数，绕过浏览器的强缓存
  async list(folderId: string, path: string, bustCache = false): Promise<ListResponse> {
    const params = new URLSearchParams({ fid: folderId, path });
    if (bustCache) params.append('_t', Date.now().toString());
    return this.request(`/api/list?${params.toString()}`);
  },

  async createFolder(parentId: string, name: string) {
    return this.request('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ parentId, name }),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async upload(files: File[], folderId: string) {
    const form = new FormData();
    // 简单净化文件名，防止 URL 编码问题
    files.forEach(f => {
      const safeName = f.name.replace(/[\/|]/g, '_');
      form.append('file', f, safeName);
    });
    form.append('folderId', folderId);
    return this.request('/api/upload', { method: 'POST', body: form });
  },

  async move(items: MoveItem[], targetFolderId: string) {
    return this.request('/api/move', {
      method: 'POST',
      body: JSON.stringify({ items, targetFolderId }),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async batchDelete(items: DeleteItem[]) {
    return this.request('/api/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ items }),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async renameFile(folderId: string, oldName: string, newName: string) {
    return this.request('/api/rename-file', {
      method: 'POST',
      body: JSON.stringify({ folderId, oldName, newName }),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  async renameFolder(parentId: string, folderId: string, oldName: string, newName: string) {
    return this.request('/api/rename-folder', {
      method: 'POST',
      body: JSON.stringify({ parentId, folderId, oldName, newName }),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // 生成下载直链
  getFileUrl(fileId: string) {
    if (!fileId) return '';
    return `${window.location.origin}/file/${encodeURIComponent(fileId)}`;
  },
};