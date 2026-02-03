import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Simple client-side check "simulation", real check happens on every API call.
    // We store it and try to list files. If it fails, password is wrong.
    localStorage.setItem('site_password', password);
    
    try {
      // Test the credentials
      const res = await fetch('/api/list?limit=1', {
        headers: { 'Authorization': `Bearer ${password}` }
      });

      if (res.ok) {
        toast.success('登录成功');
        onLogin();
      } else {
        localStorage.removeItem('site_password');
        toast.error('密码错误');
      }
    } catch (error) {
      // If the backend isn't running (local dev), we might just want to let them in for UI testing
      // But for production code, we should error.
      // For this "demo" environment, we will assume backend might not be there yet.
      // However, the instructions say "deploy to pages", so we should be strict.
      console.error(error);
      toast.error('连接失败或后端服务未就绪');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 bg-white p-8 shadow-lg rounded-xl">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <Lock className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
            访问受限
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            请输入管理员密码以管理文件。
          </p>
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
              className="relative block w-full rounded-md border-0 py-1.5 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 px-3"
              placeholder="请输入管理员密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
            >
              {loading ? '验证中...' : '登录'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
