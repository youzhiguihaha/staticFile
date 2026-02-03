import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Login } from './components/Login';
import { UploadArea } from './components/UploadArea';
import { FileGrid } from './components/FileGrid';
import { api, FileItem } from './lib/api';
import { LogOut, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const token = api.getToken();
    if (token) {
        setIsAuthenticated(true);
        loadFiles();
    } else {
        setLoading(false);
    }
  }, []);

  const loadFiles = async () => {
    setLoading(true);
    try {
        const list = await api.listFiles();
        setFiles(list);
    } catch (e) {
        toast.error('加载文件列表失败');
    } finally {
        setLoading(false);
    }
  };

  const handleLogin = async (password: string) => {
    const success = await api.login(password);
    if (success) {
        setIsAuthenticated(true);
        loadFiles();
    }
    return success;
  };

  const handleLogout = () => {
    api.logout();
    setIsAuthenticated(false);
    setFiles([]);
  };

  const handleUpload = async (filesToUpload: File[]) => {
     setUploading(true);
     const promises = filesToUpload.map(file => api.upload(file));
     
     const results = await Promise.allSettled(promises);
     const successCount = results.filter(r => r.status === 'fulfilled').length;
     const failCount = results.length - successCount;
     
     if (successCount > 0) toast.success(`成功上传 ${successCount} 个文件`);
     if (failCount > 0) toast.error(`${failCount} 个文件上传失败`);
     
     setUploading(false);
     loadFiles();
  };

  const handleDelete = async (key: string) => {
     if (!confirm('确定要删除这个文件吗？')) return;
     try {
         await api.deleteFile(key);
         toast.success('文件已删除');
         setFiles(prev => prev.filter(f => f.key !== key));
     } catch (e) {
         toast.error('删除文件失败');
     }
  };

  if (!isAuthenticated) {
     return (
        <>
            <Login onLogin={handleLogin} />
            <Toaster position="bottom-right" />
        </>
     );
  }

  return (
    <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
            <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">自托管文件系统</h1>
                <div className="flex items-center space-x-4">
                     <button onClick={loadFiles} className="p-2 text-gray-500 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors" title="刷新列表">
                        <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                     </button>
                     <button onClick={handleLogout} className="flex items-center space-x-2 text-sm text-gray-600 hover:text-red-600 font-medium px-3 py-2 rounded-md hover:bg-red-50 transition-colors">
                        <LogOut className="h-4 w-4" />
                        <span>退出登录</span>
                     </button>
                </div>
            </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
            <section className="space-y-4">
                <h2 className="text-lg font-medium text-gray-900">上传文件</h2>
                <UploadArea onUpload={handleUpload} uploading={uploading} />
            </section>

            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-900">我的文件 ({files.length})</h2>
                </div>
                <FileGrid files={files} onDelete={handleDelete} />
            </section>
        </main>
        <Toaster position="bottom-right" />
    </div>
  );
}
