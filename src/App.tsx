import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Login } from './components/Login';
import { FileExplorer } from './components/FileExplorer';
import { api } from './lib/api';
import { LogOut, RefreshCw, Cloud, Github } from 'lucide-react';

export function App() {
  const [auth, setAuth] = useState(false);
  const [boot, setBoot] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => { setAuth(api.checkAuth()); setBoot(false); }, []);

  if (boot) return null;
  if (!auth) return <><Login onLogin={async(p)=>{const k=await api.login(p);if(k){setAuth(true);setNonce(n=>n+1)}return k}} /><Toaster position="bottom-center" /></>;

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-900 selection:bg-indigo-500/20 selection:text-indigo-700">
      {/* 顶部导航栏 - 玻璃拟态 */}
      <header className="sticky top-0 z-50 transition-all duration-300">
        <div className="absolute inset-0 bg-white/70 backdrop-blur-xl border-b border-white/50 shadow-sm"></div>
        <div className="relative max-w-[1920px] mx-auto px-6 h-20 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 ring-2 ring-white">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-800 tracking-tight leading-none">CloudDrive</h1>
              <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-widest">Pro</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setNonce(n => n + 1)} 
              className="group p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-white rounded-xl transition-all border border-transparent hover:border-slate-200 hover:shadow-sm" 
              title="刷新数据"
            >
              <RefreshCw className="h-5 w-5 group-hover:rotate-180 transition-transform duration-500" />
            </button>
            <div className="h-8 w-px bg-slate-200 mx-1"></div>
            <button
              onClick={() => { api.logout(); setAuth(false); }}
              className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-red-600 px-4 py-2.5 rounded-xl hover:bg-white transition-all border border-transparent hover:border-red-100 hover:shadow-sm group"
            >
              <LogOut className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
              <span className="hidden sm:inline">退出登录</span>
            </button>
          </div>
        </div>
      </header>

      {/* 主体内容 */}
      <main className="flex-1 max-w-[1920px] mx-auto w-full p-4 sm:p-6 lg:p-8 relative z-0">
        <FileExplorer refreshNonce={nonce} />
      </main>

      {/* 全局 Toast 配置 */}
      <Toaster 
        position="bottom-center" 
        toastOptions={{
          className: '!bg-white/90 !backdrop-blur-md !shadow-2xl !rounded-2xl !font-medium !text-slate-700 !border !border-white/50 !px-6 !py-3',
          duration: 3000,
          style: { padding: '12px 24px' }
        }} 
      />
    </div>
  );
}