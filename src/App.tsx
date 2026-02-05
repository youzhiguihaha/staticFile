import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Login } from './components/Login';
import { FileExplorer } from './components/FileExplorer';
import { api } from './lib/api';
import { LogOut, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const ok = api.checkAuth();
    setIsAuthenticated(ok);
    setBootLoading(false);
  }, []);

  const handleLogin = async (password: string) => {
    const success = await api.login(password);
    if (success) {
      setIsAuthenticated(true);
      setRefreshNonce((x) => x + 1);
    }
    return success;
  };

  const handleRefresh = () => {
    if (!api.checkAuth()) {
      toast.error('登录已过期，请重新登录');
      setIsAuthenticated(false);
      return;
    }
    setRefreshNonce((x) => x + 1);
  };

  if (bootLoading) {
    return (
      <>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center text-slate-500">Loading...</div>
        <Toaster position="bottom-right" />
      </>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <Toaster position="bottom-right" />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">C</span>
            </div>
            <h1 className="text-lg font-bold text-gray-800 hidden sm:block">CloudDrive</h1>
          </div>

          <div className="flex items-center space-x-2">
            <button onClick={handleRefresh} className="p-2 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100 transition-colors" title="刷新">
              <RefreshCw className="h-5 w-5" />
            </button>

            <button
              onClick={() => {
                api.logout();
                setIsAuthenticated(false);
              }}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-red-600 font-medium px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
              title="退出"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">退出</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 w-full">
        <FileExplorer refreshNonce={refreshNonce} />
      </main>

      <Toaster position="bottom-right" />
    </div>
  );
}
