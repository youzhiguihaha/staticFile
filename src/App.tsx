import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Login } from './components/Login';
import { FileExplorer } from './components/FileExplorer';
import { api } from './lib/api';
import { LogOut, RefreshCw, HardDrive } from 'lucide-react';

export function App() {
  const [auth, setAuth] = useState(false); 
  const [boot, setBoot] = useState(true); 
  const [nonce, setNonce] = useState(0); // 用于触发全局刷新

  // 启动时检查 token
  useEffect(() => { 
    setAuth(api.checkAuth()); 
    setBoot(false); 
  }, []);

  if (boot) return null; // 启动白屏防止闪烁

  // 未登录状态
  if (!auth) return (
    <>
      <Login onLogin={async(p) => {
        const ok = await api.login(p);
        if(ok) { setAuth(true); setNonce(n => n + 1); }
        return ok;
      }} />
      <Toaster position="bottom-center" />
    </>
  );

  // 已登录主界面
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="bg-white/80 backdrop-blur border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <HardDrive className="w-5 h-5"/>
            </div>
            <h1 className="font-bold text-slate-800 hidden sm:block tracking-tight">CloudDrive</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={()=>setNonce(n=>n+1)} 
              className="p-2 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors" 
              title="刷新所有数据"
            >
              <RefreshCw className="h-5 w-5"/>
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <button 
              onClick={()=>{api.logout();setAuth(false)}} 
              className="flex items-center gap-2 text-sm text-slate-600 hover:text-red-600 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
            >
              <LogOut className="h-4 w-4"/>
              <span className="hidden sm:inline">退出</span>
            </button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 max-w-[1920px] mx-auto w-full p-4 sm:p-6 lg:p-8">
        <FileExplorer refreshNonce={nonce}/>
      </main>
      
      <Toaster position="bottom-center" toastOptions={{className:'shadow-xl border border-slate-100 font-medium', duration:3000}} />
    </div>
  );
}