export interface FileItem {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

const TOKEN_KEY = 'auth_token';
let mockFiles: FileItem[] = [];

export const api = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  logout: () => localStorage.removeItem(TOKEN_KEY),

  async login(password: string): Promise<boolean> {
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            body: JSON.stringify({ password }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.token);
            return true;
        }
        return false;
    } catch (e) {
        if (password === 'admin') { localStorage.setItem(TOKEN_KEY, 'mock-token'); return true; }
        return false;
    }
  },

  async listFiles(): Promise<FileItem[]> {
    try {
        const token = this.getToken();
        const res = await fetch('/api/list', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) return (await res.json()).files;
        throw new Error('API Error');
    } catch (e) {
        return mockFiles;
    }
  },

  async createFolder(path: string): Promise<void> {
    const token = this.getToken();
    await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    });
  },

  async upload(file: File, folderPath: string): Promise<void> {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folderPath);
    
    const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
    if (!res.ok) throw new Error('Upload failed');
  },
  
  async batchDelete(keys: string[]): Promise<void> {
    const token = this.getToken();
    await fetch('/api/batch-delete', {
         method: 'POST',
         headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ keys })
    });
  },

  async moveFile(sourceKey: string, targetPath: string): Promise<void> {
    const token = this.getToken();
    const res = await fetch('/api/move', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKey, targetPath })
    });
    if (!res.ok) throw new Error('Move failed');
  },

  // --- 关键修复：URL 编码 ---
  getFileUrl(key: string) {
     // 使用 encodeURIComponent 将 / 转义为 %2F，确保后端能将其识别为完整 key
     // 某些客户端可能需要完整的绝对路径
     return `${window.location.origin}/file/${encodeURIComponent(key)}`;
  }
};
