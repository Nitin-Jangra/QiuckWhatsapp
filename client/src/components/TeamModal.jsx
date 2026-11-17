import React, { useEffect, useState } from 'react';

const api = async (path, method = 'GET', body) => {
  const res = await fetch(`/api/users${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || `Server error (HTTP ${res.status})`);
  return json.data;
};

const EMPTY = { username: '', name: '', password: '', role: 'agent', accountIds: [] };

// Admin-only: add staff, choose which WhatsApp accounts each can see, reset passwords, disable
export default function TeamModal({ accounts, currentUserId, onClose }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  useEffect(() => { api('').then(setUsers).catch(e => setError(e.message)); }, []);

  const run = async (fn) => {
    setError('');
    try { setUsers(await fn()); } catch (e) { setError(e.message); }
  };

  const toggle = (ids, id) => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const add = async (e) => {
    e.preventDefault();
    await run(async () => { const d = await api('', 'POST', form); setForm(EMPTY); return d; });
  };

  const resetPassword = (u) => {
    const password = window.prompt(`New password for ${u.username} (min 8 characters):`);
    if (password) run(() => api(`/${u.id}`, 'PUT', { password }));
  };

  return (
    <div className="modal d-block" style={{ background: 'rgba(15,23,42,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={e => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title fw-bold"><i className="bi bi-people me-2" />Team</h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {error && <div className="alert alert-danger py-2 small">{error}</div>}

            <h6 className="fw-bold">Add a team member</h6>
            <form onSubmit={add} className="row g-2 mb-4">
              <div className="col-sm-4"><input className="form-control" placeholder="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required /></div>
              <div className="col-sm-4"><input className="form-control" placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="col-sm-4"><input className="form-control" type="password" placeholder="Password (min 8)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></div>
              <div className="col-12 d-flex flex-wrap align-items-center gap-3">
                <select className="form-select w-auto" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="agent">Staff</option>
                  <option value="admin">Admin</option>
                </select>
                {form.role === 'agent' && accounts.map(a => (
                  <label key={a.id} className="small d-flex align-items-center gap-1">
                    <input type="checkbox" checked={form.accountIds.includes(a.id)} onChange={() => setForm({ ...form, accountIds: toggle(form.accountIds, a.id) })} />
                    {a.name}
                  </label>
                ))}
                <button className="btn btn-msquare-primary btn-sm ms-auto">Add</button>
              </div>
            </form>

            <h6 className="fw-bold">Members ({users.length})</h6>
            {users.map(u => (
              <div key={u.id} className="border rounded p-2 mb-2">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <strong>{u.name}</strong>
                  <span className="text-muted small">@{u.username}</span>
                  <span className={`badge ${u.role === 'admin' ? 'bg-primary' : 'bg-secondary'}`}>{u.role === 'admin' ? 'Admin' : 'Staff'}</span>
                  {!u.active && <span className="badge bg-danger">Disabled</span>}
                  <div className="ms-auto d-flex gap-1">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => resetPassword(u)}>Reset password</button>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => run(() => api(`/${u.id}`, 'PUT', { active: !u.active }))}>
                      {u.active ? 'Disable' : 'Enable'}
                    </button>
                    {u.id !== currentUserId && (
                      <button className="btn btn-sm btn-outline-danger" onClick={() => window.confirm(`Delete ${u.username}?`) && run(() => api(`/${u.id}`, 'DELETE'))}>
                        <i className="bi bi-trash" />
                      </button>
                    )}
                  </div>
                </div>
                {u.role === 'agent' ? (
                  <div className="d-flex flex-wrap gap-3 mt-2">
                    <span className="small text-muted">Can access:</span>
                    {accounts.map(a => (
                      <label key={a.id} className="small d-flex align-items-center gap-1">
                        <input type="checkbox" checked={u.accountIds.includes(a.id)} onChange={() => run(() => api(`/${u.id}`, 'PUT', { accountIds: toggle(u.accountIds, a.id) }))} />
                        {a.name}
                      </label>
                    ))}
                    {!accounts.length && <span className="small text-muted">No WhatsApp accounts yet</span>}
                  </div>
                ) : (
                  <div className="small text-muted mt-1">Admins can access every account.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
