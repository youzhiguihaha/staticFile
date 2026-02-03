import { useState, useCallback } from 'react';
import type { AuthState } from '../types';

const AUTH_KEY = 'cf_file_auth';
const TOKEN_KEY = 'cf_file_token';

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>(() => {
    const stored = localStorage.getItem(AUTH_KEY);
    const token = localStorage.getItem(TOKEN_KEY);
    return {
      isAuthenticated: stored === 'true',
      token: token
    };
  });

  const login = useCallback(async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      
      if (response.ok) {
        const data = await response.json();
        localStorage.setItem(AUTH_KEY, 'true');
        localStorage.setItem(TOKEN_KEY, data.token);
        setAuthState({ isAuthenticated: true, token: data.token });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setAuthState({ isAuthenticated: false, token: null });
  }, []);

  const getToken = useCallback(() => {
    return authState.token;
  }, [authState.token]);

  return {
    isAuthenticated: authState.isAuthenticated,
    token: authState.token,
    login,
    logout,
    getToken
  };
}
