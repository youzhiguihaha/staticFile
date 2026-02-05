import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { api } from './lib/api';
import FileExplorer from './components/FileExplorer';

export default function App() {
  const [auth, setAuth] = useState(false);
  const [boot, setBoot] = useState(true);
  const [pwd, setPwd] = useState('');

  useEffect(() => {
    setAuth(!!api.token);
    setBoot(false);
  }, []);

  if (boot) return null;

  if (!auth) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm border border-slate-100">
          <h1 className="text-2xl font-bold mb-2 text-center text-slate-800">CloudDrive</h1>
          <p className="text-center text-slate-400 text-sm mb-8">请输入管理员密码</p>
          <form onSubmit={async e => { e.preventDefault(); if(await api.login(pwd)) setAuth(true); else alert('密码错误'); }}>
            <input type="password" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Password" value={pwd} onChange={e => setPwd(e.target.value)} />
            <button className="w-full bg-blue-600 text-white p-3 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">登录</button>
          </form>
        </div>
        <Toaster />
      </div>
    );
  }

  return (
    <>
      <FileExplorer />
      <Toaster position="bottom-center" toastOptions={{ className: 'font-medium shadow-xl' }} />
    </>
  );
}