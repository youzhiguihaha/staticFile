export interface FileItem {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  displayPath?: string; 
}

const TOKEN_KEY = 'auth_token';
const LOGIN_TIME_KEY = 'login_timestamp';
const SEP = '|';
const TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 小时

function toBase64(str: string) {
    return btoa(unescape(encodeURIComponent(str)));
}

export const api = {
  // 检查是否超时
  checkAuth() {
      const timeStr = localStorage.getItem(LOGIN_TIME_KEY);
      if (!timeStr) return false;
      const time = parseInt(timeStr, 10);
      if (Date.now() - time > TIMEOUT_MS) {
          this.logout();
          return false;
      }
      return !!localStorage.getItem(TOKEN_KEY);
  },

  getToken: () => localStorage.getItem(TOKEN_KEY),
  
  logout: () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LOGIN_TIME_KEY);
      window.location.reload(); // 强制刷新回登录页
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
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(LOGIN_TIME_KEY, Date.now().toString()); // 记录登录时间
            return true;
        }
        return false;
    } catch (e) { return false; }
  },

  async listFiles(): Promise<FileItem[]> {
    if (!this.checkAuth()) throw new Error('Session Expired');
    try {
        const token = this.getToken();
        const res = await fetch('/api/list', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const data = await res.json();
            return data.files.map((f: FileItem) => ({
                ...f,
                key: f.key.replaceAll(SEP, '/')
            }));
        }
        throw new Error('API Error');
    } catch (e) { return []; }
  },

  toStoreKey(uiKey: string) {
      return uiKey.replaceAll('/', SEP);
  },

  async createFolder(path: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Session Expired');
    const token = this.getToken();
    await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }) 
    });
  },

  async upload(file: File, folderPath: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Session Expired');
    const token = this.getToken();
    const safeName = file.name.replace(/[|]/g, '_');
    const safeFile = new File([file], safeName, { type: file.type });
    
    const formData = new FormData();
    formData.append('file', safeFile);
    formData.append('folder', folderPath); 
    
    await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
  },
  
  async batchDelete(uiKeys: string[]): Promise<void> {
    if (!this.checkAuth()) throw new Error('Session Expired');
    const token = this.getToken();
    const storeKeys = uiKeys.map(k => this.toStoreKey(k));
    await fetch('/api/batch-delete', {
         method: 'POST',
         headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ keys: storeKeys })
    });
  },

  async moveFile(sourceUiKey: string, targetPath: string): Promise<void> {
    if (!this.checkAuth()) throw new Error('Session Expired');
    const token = this.getToken();
    await fetch('/api/move', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            sourceKey: this.toStoreKey(sourceUiKey), 
            targetPath 
        })
    });
  },

  getFileUrl(uiKey: string) {
     const storeKey = this.toStoreKey(uiKey);
     const b64 = toBase64(storeKey);
     const parts = storeKey.split('.');
     const ext = parts.length > 1 ? parts.pop() : '';
     const suffix = ext ? `.${ext}` : '';
     return `${window.location.origin}/file/${b64}${suffix}`;
  }
};
