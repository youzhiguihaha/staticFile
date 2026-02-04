export interface FileItem {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

const TOKEN_KEY = 'auth_token';
const LOGIN_TIME_KEY = 'login_timestamp';
// 移除 SEP 转换，回归标准路径
const TIMEOUT_MS = 12 * 60 * 60 * 1000; 

function toBase64(str: string) {
    return btoa(unescape(encodeURIComponent(str)));
}

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
            headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.token); // Hash
            localStorage.setItem(LOGIN_TIME_KEY, Date.now().toString());
            return true;
        }
        return false;
    } catch (e) { return false; }
  },

  async listFiles(): Promise<FileItem[]> {
    if (!this.checkAuth()) throw new Error('Expired');
    try {
        const token = this.getToken();
        const res = await fetch('/api/list', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) return (await res.json()).files; // 直接返回，无需转换
        throw new Error('API Error');
    } catch (e) { return []; }
  },

  async createFolder(path: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }) 
    });
  },

  async upload(file: File, folderPath: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folderPath); 
    await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
  },
  
  async batchDelete(keys: string[]): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    await fetch('/api/batch-delete', {
         method: 'POST',
         headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ keys })
    });
  },

  async moveFile(sourceKey: string, targetPath: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    await fetch('/api/move', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKey, targetPath })
    });
  },

  getFileUrl(key: string) {
     // 使用 Base64 编码路径，防止洛雪音乐解析 URL 失败
     const b64 = toBase64(key);
     const parts = key.split('.');
     const ext = parts.length > 1 ? parts.pop() : '';
     const suffix = ext ? `.${ext}` : '';
     return `${window.location.origin}/file/${b64}${suffix}`;
  }
};
