import React, { useState } from 'react';
import { Lock, Loader2, HardDrive } from 'lucide-react';
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
        toast.success('登录成功');
      } else {
        toast.error('密码错误');
      }
    } catch {
      toast.error('系统错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-white p-10 shadow-xl border border-slate-100">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
            <HardDrive className="h-8 w-8" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-slate-800">CloudDrive</h2>
          <p className="mt-2 text-sm text-slate-400">私人云存储 (KV版)</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Lock className="h-5 w-5 text-slate-400" />
            </div>
            <input
              type="password"
              required
              autoFocus
              disabled={loading}
              className="block w-full rounded-xl border border-slate-300 pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="请输入管理员密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center rounded-xl bg-blue-600 px-4 py-3 text-white font-bold hover:bg-blue-700 disabled:opacity-70 transition-all shadow-md"
          >
            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : '解锁进入'}
          </button>
        </form>
      </div>
    </div>
  );
}