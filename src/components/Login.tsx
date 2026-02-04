// Login.tsx
import React, { useState } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface LoginProps {
  onLogin: (password: string) => Promise<boolean>;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const pwd = password.trim();
    if (!pwd) return;

    setLoading(true);
    try {
      const success = await onLogin(pwd);
      if (success) {
        toast.success('登录成功');
        setPassword(''); // 成功后清空，减少明文停留
      } else {
        toast.error('密码错误');
      }
    } catch (error) {
      toast.error('登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-8 shadow-lg">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <Lock className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">管理员访问</h2>
          <p className="mt-2 text-sm text-gray-600">请输入密码以管理文件</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="password" className="sr-only">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              disabled={loading}
              className="relative block w-full rounded-lg border border-gray-300 px-3 py-3 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm disabled:opacity-60"
              placeholder="请输入访问密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative flex w-full justify-center rounded-lg border border-transparent bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : '登 录'}
          </button>
        </form>

        <div className="text-center text-xs text-gray-400">基于 Cloudflare KV 存储</div>
      </div>
    </div>
  );
}
