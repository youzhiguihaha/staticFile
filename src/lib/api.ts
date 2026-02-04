export interface FileItem {
  key: string;
  fileId?: string; 
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
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
            headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(LOGIN_TIME_KEY, Date.now().toString());
            return true;
        }
        return false;
    } catch (e) { return false; }
  },

  async listFiles(): Promise<FileItem[]> {
    if (!this.checkAuth()) throw new Error('Expired');
    const token = this.getToken();
    const res = await fetch('/api/list', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const data = await res.json();
        return data.files;
    }
    throw new Error('API Error');
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
    // 只替换斜杠，竖线已经不是系统分隔符了，但为了安全还是替换
    const safeName = file.name.replace(/[\/|]/g, '_');
    const safeFile = new File([file], safeName, { type: file.type });
    formData.append('file', safeFile);
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

  getFileUrl(item: FileItem | string) {
     let fileId = '';
     let fileName = '';
     
     if (typeof item === 'string') {
         // 兼容处理
         return '';
     } else {
         fileId = item.fileId || '';
         fileName = item.name;
     }

     if (!fileId) return '';

     // 直接拼接 ID 和后缀，不使用 Base64，越简单越好
     const ext = fileName.split('.').pop();
     const suffix = ext ? `.${ext}` : '';
     return `${window.location.origin}/file/${fileId}${suffix}`;
  }
};
