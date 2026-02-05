import React, { useState } from 'react';
import { Lock, Loader2, Cloud, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

export function Login({ onLogin }: { onLogin: (p: string) => Promise<boolean> }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !password.trim()) return;
    setLoading(true);
    try {
      if (await onLogin(password)) {
        toast.success('欢迎回来');
      } else {
        toast.error('密码无效');
      }
    } catch {
      toast.error('登录服务暂时不可用');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-slate-100 overflow-hidden">
      {/* 动态背景装饰 */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-200/40 blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-[10%] right-[10%] w-[40%] h-[40%] rounded-full bg-blue-200/40 blur-[100px]"></div>
      </div>

      <div className="relative z-10 w-full max-w-md p-8 animate-enter">
        <div className="bg-white/70 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 p-8">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-lg shadow-indigo-500/30 mb-6 transform rotate-3 hover:rotate-6 transition-transform">
              <Cloud className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">CloudDrive</h1>
            <p className="text-slate-500 mt-2 text-sm">安全、高速的个人云存储空间</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">访问密码</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                </div>
                <input
                  type="password"
                  required
                  autoFocus
                  disabled={loading}
                  className="block w-full rounded-2xl border-0 bg-slate-50/50 ring-1 ring-slate-200 pl-11 pr-4 py-4 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/50 focus:bg-white transition-all outline-none"
                  placeholder="请输入您的密钥"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white hover:bg-indigo-600 hover:shadow-lg hover:shadow-indigo-500/30 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : <>解锁进入 <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
          
          <div className="mt-8 text-center">
             <span className="text-xs text-slate-400 font-medium">Powered by Workers KV</span>
          </div>
        </div>
      </div>
    </div>
  );
}