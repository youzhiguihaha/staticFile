import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { UploadArea } from './components/UploadArea';
import { FileList } from './components/FileList';
import { Toaster } from 'sonner';
import { LogOut, HardDrive } from 'lucide-react';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    // Check if we have a password saved
    const pwd = localStorage.getItem('site_password');
    if (pwd) {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('site_password');
    setIsAuthenticated(false);
  };

  const handleUploadComplete = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  if (!isAuthenticated) {
    return (
      <>
        <Toaster position="top-right" />
        <Login onLogin={() => setIsAuthenticated(true)} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <HardDrive className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">文件管理器</h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 text-gray-500 hover:text-red-600 transition-colors"
          >
            <LogOut className="h-5 w-5" />
            <span className="hidden sm:inline">退出登录</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">上传文件</h2>
          <UploadArea onUploadComplete={handleUploadComplete} />
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">文件列表</h2>
            <button 
                onClick={() => setRefreshTrigger(prev => prev + 1)}
                className="text-sm text-blue-600 hover:text-blue-800"
            >
                刷新列表
            </button>
          </div>
          <FileList refreshTrigger={refreshTrigger} />
        </section>

      </main>

      <footer className="bg-white border-t mt-auto py-6">
        <div className="max-w-5xl mx-auto px-4 text-center text-sm text-gray-400">
          自托管文件系统 • 运行于 Cloudflare Pages
        </div>
      </footer>
    </div>
  );
}
