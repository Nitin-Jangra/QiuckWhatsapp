import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [branch, setBranch] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('wacrm_token') || '');
  const [loading, setLoading] = useState(true);

  // Fetch /api/auth/me whenever token changes
  useEffect(() => {
    async function loadProfile() {
      if (!token) {
        setUser(null);
        setTenant(null);
        setBranch(null);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success && json.data) {
          setUser(json.data.user);
          setTenant(json.data.tenant);
          setBranch(json.data.branch);
        } else {
          // Token expired or invalid
          logout();
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [token]);

  const login = async (email, password = '') => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Login failed');
      }

      const newToken = data.data.token;
      localStorage.setItem('wacrm_token', newToken);
      setToken(newToken);
      return data.data;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('wacrm_token');
    setToken('');
    setUser(null);
    setTenant(null);
    setBranch(null);
  };

  const hasRole = (...roles) => {
    if (!user) return false;
    if (user.role_id === 'ROOT_ADMIN') return true;
    return roles.includes(user.role_id);
  };

  const hasPermission = (perm) => {
    if (!user) return false;
    if (user.role_id === 'ROOT_ADMIN') return true;
    return user.permissions?.includes('*') || user.permissions?.includes(perm);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tenant,
        branch,
        token,
        loading,
        isAuthenticated: Boolean(user),
        login,
        logout,
        hasRole,
        hasPermission
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
