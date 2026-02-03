import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';

export function App() {
  const { isAuthenticated, token, login, logout } = useAuth();

  if (!isAuthenticated) {
    return <Login onLogin={login} />;
  }

  return <Dashboard token={token} onLogout={logout} />;
}
