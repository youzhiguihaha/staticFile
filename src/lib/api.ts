export interface FileItem {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  // 辅助字段：前端转换后的显示路径
  displayPath?: string; 
}

const TOKEN_KEY = 'auth_token';
const SEP = '|'; // 与后端保持一致

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
                // 将后端存储的 "A|B|c.jpg" 转换为 "A/B/c.jpg" 供前端逻辑使用
                // 注意：我们这里不改变 key 本身，因为 key 是唯一标识
                // 但为了兼容之前的 UI 逻辑 (key.split('/'))，我们需要把 key 中的 | 替换为 /
                // 或者修改 UI 逻辑。为了最小改动，我们这里做一层转换，但在发回后端操作时要转回去？
                // 更好的策略：前端统一用 / 逻辑，所有发给后端的 API 都负责把 / 转为 |
                
                // 方案 B：key 保持 "A|B|c.jpg"，前端 UI 适配 | 分隔符
                // 方案 C (当前采用)：我们在 listFiles 里把 key 里的 | 全部换成 / 返回给 UI
                // 这样 UI 代码不用大改。但在调用 delete/move 等 API 时，key 已经是 / 格式了
                // 我们在 delete/move 的 API 封装里，再把 / 换回 | 发给后端？
                // 不行，如果文件名本身包含 / 就乱了（虽然我们上传时过滤了）。
                // 最稳妥方案：UI 逻辑全部改为识别 | 分隔符。
                
                // 决定：修改 UI 组件识别 |。
                // 为了兼容现有的 FileExplorer 代码 (大量 split('/'))，我们还是在这里把 key 伪装成 / 格式
                key: f.key.replaceAll(SEP, '/')
            }));
        }
        throw new Error('API Error');
    } catch (e) { return []; }
  },

  // 辅助：把前端的 / 路径转回后端的 | key
  toStoreKey(uiKey: string) {
      return uiKey.replaceAll('/', SEP);
  },

  async createFolder(path: string): Promise<void> {
    const token = this.getToken();
    await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }) // path: "A/B/"
    });
  },

  async upload(file: File, folderPath: string): Promise<void> {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folderPath); // folderPath: "A/B/"
    
    await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });
  },
  
  async batchDelete(uiKeys: string[]): Promise<void> {
    const token = this.getToken();
    // 转换 key
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
            targetPath // targetPath 保持 "A/B/" 格式，后端会处理转换
        })
    });
  },

  getFileUrl(uiKey: string) {
     // 生成直链：使用后端真实 Key (带 |)
     // 例如 /file/photos|2023|cat.jpg
     // encodeURIComponent 会把 | 变成 %7C，这也是安全的
     // 后端 handleFile 接收到后 decode 即可
     const storeKey = this.toStoreKey(uiKey);
     return `${window.location.origin}/file/${encodeURIComponent(storeKey)}`;
  }
};
