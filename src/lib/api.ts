export interface FileItem {
  key: string; // 显示路径 (A/B/c.jpg)
  fileId?: string; // 物理 ID (file:UUID)
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

const TOKEN_KEY = 'auth_token';
const LOGIN_TIME_KEY = 'login_timestamp';
const TIMEOUT_MS = 12 * 60 * 60 * 1000; 

// 简单的 SHA-256 (用于 Token 加密) - 前端不需要 hash，直接传后端返回的 token
// 这里不需要修改 login 逻辑

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
        return data.files; // 直接返回，后端已经处理好格式
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

  // 核心：根据 item 获取直链
  // 注意：这里需要传入 item 对象，不仅仅是 key
  getFileUrl(item: FileItem | string) {
     let fileId = '';
     let fileName = '';
     
     if (typeof item === 'string') {
         // 如果只传了 key (兼容旧调用)，我们无法获取 fileId
         // 这种情况下，说明是在列表加载前或者特殊情况
         // 临时方案：如果 UI 还没拿到 fileId，可能无法生成直链
         // 但通常 UI 都是从 listFiles 拿到的 item，里面有 fileId
         console.error("Old API usage: getFileUrl should receive FileItem object");
         return '';
     } else {
         fileId = item.fileId || '';
         fileName = item.name;
     }

     if (!fileId) return '';

     // 生成纯净链接：/file/file:UUID.js
     const ext = fileName.split('.').pop();
     const suffix = ext ? `.${ext}` : '';
     return `${window.location.origin}/file/${fileId}${suffix}`;
  }
};
