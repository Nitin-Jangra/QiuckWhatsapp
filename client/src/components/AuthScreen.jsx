import React, { useState } from 'react';

// Sign-in, or first-run admin setup when no users exist yet
export default function AuthScreen({ needsSetup, offline, onDone }) {
  const [form, setForm] = useState({ username: '', name: '', password: '', setupKey: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(needsSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || `Server error (HTTP ${res.status})`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="msquare-logo-badge mx-auto mb-3" style={{ width: 56, height: 56, fontSize: '1.5rem' }}>M²</div>
        <h4 className="text-center fw-bold mb-1">WaCRM</h4>
        <p className="text-center text-secondary small mb-4">
          {needsSetup ? 'Create the admin account to get started' : 'Sign in to your WhatsApp workspace'}
        </p>

        {offline && <div className="alert alert-warning py-2 small">Cannot reach the server. Check your connection and reload.</div>}
        {error && <div className="alert alert-danger py-2 small">{error}</div>}

        <label className="form-label small fw-semibold">Username</label>
        <input className="form-control mb-3" value={form.username} onChange={set('username')} autoFocus autoComplete="username" required />

        {needsSetup && (
          <>
            <label className="form-label small fw-semibold">Your name</label>
            <input className="form-control mb-3" value={form.name} onChange={set('name')} />
          </>
        )}

        <label className="form-label small fw-semibold">Password{needsSetup && ' (min 8 characters)'}</label>
        <input
          className="form-control mb-3"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete={needsSetup ? 'new-password' : 'current-password'}
          required
        />

        {needsSetup && (
          <>
            <label className="form-label small fw-semibold">Setup key <span className="text-muted fw-normal">(only if your server requires one)</span></label>
            <input className="form-control mb-3" value={form.setupKey} onChange={set('setupKey')} />
          </>
        )}

        <button className="btn btn-msquare-primary w-100 py-2" disabled={busy}>
          {busy ? <span className="spinner-border spinner-border-sm" /> : needsSetup ? 'Create admin & continue' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
