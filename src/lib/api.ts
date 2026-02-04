export interface FileItem {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  displayPath?: string; 
}

const TOKEN_KEY = 'auth_token';
const SEP = '|';

// Base64 编码辅助 (处理 UTF-8)
function toBase64(str: string) {
    return btoa(unescape(encodeURIComponent(str)));
}

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
    } catch (e) { return false; }
  },

  async listFiles(): Promise<FileItem[]> {
    try {
        const token = this.getToken();
        const res = await fetch('/api/list', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            const data = await res.json();
            return data.files.map((f: FileItem) => ({
                ...f,
                // UI 仍然使用 / 作为逻辑分隔符，方便 split 操作
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
    const token = this.getToken();
    await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }) 
    });
  },

  async upload(file: File, folderPath: string): Promise<void> {
    const token = this.getToken();
    
    // 前端也做一次过滤，防止 UI 显示不一致
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
    const token = this.getToken();
    const storeKeys = uiKeys.map(k => this.toStoreKey(k));
    await fetch('/api/batch-delete', {
         method: 'POST',
         headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ keys: storeKeys })
    });
  },

  async moveFile(sourceUiKey: string, targetPath: string): Promise<void> {
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
     // 1. 获取真实 KV Key (包含 | )
     const storeKey = this.toStoreKey(uiKey);
     
     // 2. Base64 编码 (彻底隐藏路径结构)
     const b64 = toBase64(storeKey);
     
     // 3. 加上扩展名伪装 (让客户端识别文件类型)
     // 获取真实扩展名
     const parts = storeKey.split('.');
     const ext = parts.length > 1 ? parts.pop() : '';
     const suffix = ext ? `.${ext}` : '';
     
     // 结果: /file/BASE64STRING.mp3
     return `${window.location.origin}/file/${b64}${suffix}`;
  }
};
