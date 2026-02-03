export interface FileItem {
  key: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
}

const TOKEN_KEY = 'auth_token';
const MOCK_DELAY = 600;

// LocalStorage Mock Data for Preview
let mockFiles: FileItem[] = [];
try {
  const saved = localStorage.getItem('mock_files');
  if (saved) mockFiles = JSON.parse(saved);
} catch(e) {}

const saveMock = () => localStorage.setItem('mock_files', JSON.stringify(mockFiles));

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
        
        const data = await res.json().catch(() => ({}));
        
        if (res.ok) {
            localStorage.setItem(TOKEN_KEY, data.token);
            return true;
        }
        
        if (res.status === 401) return false;
        
        // Check for specific configuration error from worker
        if (data.error && data.error.includes('KV binding is missing')) {
            alert(data.error); // Alert the user critically
            throw new Error(data.error); // Stop execution, do not fallback to mock
        }
        
        throw new Error('API Error');
    } catch (e: any) {
        // If it was a configuration error, rethrow it so we don't enter mock mode
        if (e.message && e.message.includes('KV binding is missing')) {
            throw e; 
        }

        console.warn('API Unreachable, using Mock (Password: admin)');
        await new Promise(r => setTimeout(r, MOCK_DELAY));
        if (password === 'admin') {
            localStorage.setItem(TOKEN_KEY, 'mock-token');
            return true;
        }
        return false;
    }
  },

  async listFiles(): Promise<FileItem[]> {
    try {
        const token = this.getToken();
        const res = await fetch('/api/list', {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            return data.files;
        }
        throw new Error('API Error');
    } catch (e) {
        console.warn('Using Mock List');
        await new Promise(r => setTimeout(r, MOCK_DELAY));
        return [...mockFiles].sort((a,b) => b.uploadedAt - a.uploadedAt);
    }
  },

  async upload(file: File): Promise<void> {
    try {
        const token = this.getToken();
        const formData = new FormData();
        formData.append('file', file);
        
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!res.ok) throw new Error('Upload failed');
    } catch (e) {
         console.warn('Using Mock Upload');
         await new Promise(r => setTimeout(r, MOCK_DELAY));
         const newItem: FileItem = {
            key: `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
            name: file.name,
            type: file.type,
            size: file.size,
            uploadedAt: Date.now()
         };
         mockFiles.push(newItem);
         saveMock();
         return;
    }
  },
  
  async deleteFile(key: string): Promise<void> {
    try {
        const token = this.getToken();
        const res = await fetch(`/api/delete?key=${key}`, {
             method: 'DELETE',
             headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Delete failed');
    } catch (e) {
         console.warn('Using Mock Delete');
         await new Promise(r => setTimeout(r, MOCK_DELAY));
         mockFiles = mockFiles.filter(f => f.key !== key);
         saveMock();
         return;
    }
  },

  getFileUrl(key: string) {
     return `${window.location.origin}/file/${key}`;
  }
};
