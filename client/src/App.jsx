import React, { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import AuthScreen from './components/AuthScreen';

// If the session expires while the app is open, drop back to the sign-in screen
const nativeFetch = window.fetch.bind(window);

export default function App() {
  const [state, setState] = useState({ loading: true, user: null, needsSetup: false, authRequired: false });

  const loadMe = async () => {
    try {
      const json = await (await nativeFetch('/api/auth/me')).json();
      const authRequired = Boolean(json.data?.authRequired);
      setState({
        loading: false,
        user: json.data?.user || null,
        needsSetup: Boolean(json.data?.needsSetup),
        authRequired
      });
    } catch (e) {
      // If offline or error, open dashboard directly without blocking
      setState({ loading: false, user: null, needsSetup: false, authRequired: false });
    }
  };

  useEffect(() => {
    window.fetch = async (...args) => {
      const res = await nativeFetch(...args);
      const url = String(args[0] && args[0].url ? args[0].url : args[0]);
      if (res.status === 401 && !url.includes('/auth/')) setState(s => ({ ...s, user: null }));
      return res;
    };
    loadMe();
    return () => { window.fetch = nativeFetch; };
  }, []);

  const logout = async () => {
    await nativeFetch('/api/auth/logout', { method: 'POST' });
    setState(s => ({ ...s, user: null }));
  };

  if (state.loading) {
    return <div className="d-flex vh-100 align-items-center justify-content-center"><div className="spinner-border text-primary" /></div>;
  }
  // Only display AuthScreen if authentication is explicitly required
  if (state.authRequired && !state.user) {
    return <AuthScreen needsSetup={state.needsSetup} offline={state.offline} onDone={loadMe} />;
  }
  return <Dashboard user={state.user} onLogout={state.authRequired ? logout : undefined} />;
}
