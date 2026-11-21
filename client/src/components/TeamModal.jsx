import React, { useEffect, useState } from 'react';

// Grouped permission labels (keys must match server/src/auth.js PERMISSIONS)
const PERM_GROUPS = [
  ['WhatsApp Accounts', [['accounts.manage', 'Connect, disconnect, delete numbers and pause sending']]],
  ['Conversations', [
    ['chats.view', 'View chats and message history'],
    ['chats.send', 'Send messages and media'],
    ['chats.organize', 'Pin, archive and mark chats read'],
    ['media.view', 'Open and download attachments']
  ]],
  ['Team', [['team.view', 'View members and their activity'], ['team.manage', 'Add, edit, activate, deactivate and remove members']]],
  ['Administration', [['audit.view', 'View workspace activity log']]]
];
const ROLE_LABEL = { manager: 'Administrator', agent: 'Agent' };
const EMPTY = { fullName: '', username: '', email: '', phone: '', role: 'agent', password: '', permissions: null, accountIds: [] };

const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');

export default function TeamModal({ user, can, accounts, endpoint, onClose }) {
  const canView = can('team.view');
  const canManage = can('team.manage');
  const [tab, setTab] = useState(canView ? 'members' : 'me');
  const [members, setMembers] = useState([]);
  const [stats, setStats] = useState(null);
  const [roleDefaults, setRoleDefaults] = useState({});
  const [invites, setInvites] = useState([]);
  const [activity, setActivity] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState(null); // { mode: 'add'|'invite'|'edit', id?, ...fields }
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  const call = async (path, method = 'GET', body) => {
    const res = await fetch(endpoint(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!json.success) throw new Error(json.error || 'Request failed');
    return json;
  };
  const run = async (fn, okMsg) => {
    setError('');
    try {
      await fn();
      if (okMsg) { setNotice(okMsg); setTimeout(() => setNotice(''), 4000); }
    } catch (e) { setError(e.message); }
  };

  const load = () => run(async () => {
    if (!canView) return;
    const m = await call('/api/team/members');
    setMembers(m.data); setStats(m.stats); setRoleDefaults(m.roleDefaults || {});
    setInvites((await call('/api/team/invitations')).data);
    if (can('audit.view')) setActivity((await call('/api/team/activity?limit=200')).data);
  });
  useEffect(() => { load(); }, []);

  const ownedAccounts = accounts.filter(a => !user?.workspaceId || a.userId === user.workspaceId || !a.userId);

  const effectivePerms = (f) => f.permissions ?? roleDefaults[f.role] ?? [];
  const togglePerm = (key) => setForm(f => {
    const cur = new Set(effectivePerms(f));
    cur.has(key) ? cur.delete(key) : cur.add(key);
    return { ...f, permissions: [...cur] };
  });
  const toggleAcc = (id) => setForm(f => ({ ...f, accountIds: f.accountIds.includes(id) ? f.accountIds.filter(x => x !== id) : [...f.accountIds, id] }));

  const submitForm = (e) => {
    e.preventDefault();
    const { mode, id, ...fields } = form;
    run(async () => {
      if (mode === 'add') await call('/api/team/members', 'POST', fields);
      if (mode === 'invite') {
        const { password, ...rest } = fields;
        const r = await call('/api/team/invitations', 'POST', rest);
        setInviteLink(r.data.inviteUrl);
      }
      if (mode === 'edit') {
        const { username, password, ...rest } = fields;
        await call(`/api/team/members/${id}`, 'PUT', rest);
      }
      setForm(null);
      await load();
    }, mode === 'invite' ? 'Invitation created. Share the link below with the member.' : 'Saved');
  };

  const setStatus = (m, status) => {
    if (status === 'inactive' && !window.confirm(`Deactivate @${m.username}? They will be signed out everywhere immediately.`)) return;
    run(async () => { await call(`/api/team/members/${m.id}/status`, 'PATCH', { status }); await load(); }, `@${m.username} is now ${status}`);
  };
  const resetPassword = (m) => {
    const newPassword = window.prompt(`New temporary password for @${m.username} (min 8 chars, letters and numbers):`);
    if (newPassword) run(() => call(`/api/team/members/${m.id}/reset-password`, 'POST', { newPassword }), 'Password reset; member signed out');
  };
  const revoke = (m) => run(async () => { await call(`/api/team/members/${m.id}/revoke-sessions`, 'POST', {}); await load(); }, 'Sessions revoked');
  const remove = (m) => {
    if (!window.confirm(`Remove @${m.username} from the workspace? Chats, messages and history are kept.`)) return;
    run(async () => { await call(`/api/team/members/${m.id}`, 'DELETE'); await load(); }, 'Member removed');
  };
  const openDetail = (m) => run(async () => {
    const [d, s] = await Promise.all([call(`/api/team/members/${m.id}`), call(`/api/team/members/${m.id}/sessions`)]);
    setDetail({ ...d.data, sessions: s.data });
  });

  const shown = members.filter(m =>
    (roleFilter === 'all' || m.role === roleFilter) &&
    (statusFilter === 'all' || m.status === statusFilter) &&
    (!search || `${m.fullName} ${m.username} ${m.email || ''} ${m.phoneNumber || ''}`.toLowerCase().includes(search.toLowerCase()))
  );
  const accName = (id) => accounts.find(a => a.id === id)?.name || id;

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }} role="dialog">
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title"><i className="bi bi-people-fill me-2"></i>{canView ? 'Team Management' : 'My Account'}</h5>
            <button className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <ul className="nav nav-tabs mb-3">
              {canView && <li className="nav-item"><button className={`nav-link ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>Members</button></li>}
              {canView && <li className="nav-item"><button className={`nav-link ${tab === 'invites' ? 'active' : ''}`} onClick={() => setTab('invites')}>Invitations</button></li>}
              {can('audit.view') && <li className="nav-item"><button className={`nav-link ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Member Activity</button></li>}
              <li className="nav-item"><button className={`nav-link ${tab === 'me' ? 'active' : ''}`} onClick={() => setTab('me')}>My Account &amp; Security</button></li>
            </ul>

            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            {notice && <div className="alert alert-success py-2 small">{notice}</div>}
            {inviteLink && (
              <div className="alert alert-info py-2 small">
                <div className="fw-semibold mb-1">Invitation link (shown once, single use):</div>
                <div className="input-group input-group-sm">
                  <input className="form-control" readOnly value={inviteLink} onFocus={e => e.target.select()} />
                  <button className="btn btn-outline-secondary" onClick={() => navigator.clipboard?.writeText(inviteLink)}>Copy</button>
                  <button className="btn btn-outline-secondary" onClick={() => setInviteLink('')}>Done</button>
                </div>
              </div>
            )}

            {tab === 'members' && (
              <>
                {stats && (
                  <div className="row g-2 mb-3 text-center">
                    {[['Total', stats.total], ['Active', stats.active], ['Inactive', stats.inactive], ['Pending invites', stats.pendingInvitations], ['Active in 24h', stats.recentlyActive]].map(([k, v]) => (
                      <div className="col" key={k}><div className="border rounded p-2"><div className="fs-5 fw-bold">{v}</div><div className="small text-muted">{k}</div></div></div>
                    ))}
                  </div>
                )}
                <div className="d-flex flex-wrap gap-2 mb-2">
                  <input className="form-control form-control-sm" style={{ maxWidth: 240 }} placeholder="Search members" value={search} onChange={e => setSearch(e.target.value)} />
                  <select className="form-select form-select-sm" style={{ maxWidth: 160 }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                    <option value="all">All roles</option><option value="manager">Administrators</option><option value="agent">Agents</option>
                  </select>
                  <select className="form-select form-select-sm" style={{ maxWidth: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
                  </select>
                  {canManage && (
                    <div className="ms-auto d-flex gap-2">
                      <button className="btn btn-sm btn-msquare-primary" onClick={() => setForm({ mode: 'add', ...EMPTY })}><i className="bi bi-person-plus me-1"></i>Add Member</button>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => setForm({ mode: 'invite', ...EMPTY })}><i className="bi bi-envelope-plus me-1"></i>Invite</button>
                    </div>
                  )}
                </div>

                <div className="table-responsive">
                  <table className="table table-sm align-middle small">
                    <thead><tr><th>Member</th><th>Role</th><th>WhatsApp numbers</th><th>Status</th><th>Last login</th><th>Last active</th><th className="text-end">Actions</th></tr></thead>
                    <tbody>
                      {shown.length === 0 && <tr><td colSpan="7" className="text-muted text-center py-3">No members yet</td></tr>}
                      {shown.map(m => {
                        const editable = canManage && m.id !== user?.id && (user?.isOwner || m.role !== 'manager');
                        return (
                          <tr key={m.id}>
                            <td><div className="fw-semibold">{m.fullName}</div><div className="text-muted">@{m.username}{m.email ? ` · ${m.email}` : ''}</div></td>
                            <td>{ROLE_LABEL[m.role] || m.role}{m.customPermissions && <span className="badge bg-info-subtle text-info-emphasis ms-1">custom</span>}</td>
                            <td>{m.accountIds.length ? m.accountIds.map(accName).join(', ') : <span className="text-muted">None</span>}</td>
                            <td>
                              {editable ? (
                                <div className="form-check form-switch mb-0">
                                  <input className="form-check-input" type="checkbox" checked={m.status === 'active'} onChange={() => setStatus(m, m.status === 'active' ? 'inactive' : 'active')} />
                                  <label className="form-check-label">{m.status === 'active' ? 'Active' : 'Inactive'}</label>
                                </div>
                              ) : (m.status === 'active' ? 'Active' : 'Inactive')}
                            </td>
                            <td>{fmt(m.lastLoginAt)}</td>
                            <td>{fmt(m.lastActiveAt)}</td>
                            <td className="text-end">
                              <div className="btn-group btn-group-sm">
                                <button className="btn btn-outline-secondary" title="View" onClick={() => openDetail(m)}><i className="bi bi-eye"></i></button>
                                {editable && <>
                                  <button className="btn btn-outline-secondary" title="Edit" onClick={() => setForm({ mode: 'edit', id: m.id, fullName: m.fullName, username: m.username, email: m.email || '', phone: m.phoneNumber || '', role: m.role, permissions: m.customPermissions ? m.permissions : null, accountIds: m.accountIds })}><i className="bi bi-pencil"></i></button>
                                  <button className="btn btn-outline-secondary" title="Reset password" onClick={() => resetPassword(m)}><i className="bi bi-key"></i></button>
                                  <button className="btn btn-outline-secondary" title={`Revoke sessions (${m.activeSessions})`} onClick={() => revoke(m)}><i className="bi bi-box-arrow-right"></i></button>
                                  <button className="btn btn-outline-danger" title="Remove member" onClick={() => remove(m)}><i className="bi bi-trash"></i></button>
                                </>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'invites' && (
              <table className="table table-sm small align-middle">
                <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Expires</th><th></th></tr></thead>
                <tbody>
                  {invites.length === 0 && <tr><td colSpan="6" className="text-muted text-center py-3">No invitations</td></tr>}
                  {invites.map(i => (
                    <tr key={i.id}>
                      <td>{i.full_name}</td><td>@{i.username}</td><td>{ROLE_LABEL[i.role]}</td><td>{i.status}</td><td>{fmt(i.expires_at)}</td>
                      <td className="text-end">{canManage && i.status === 'pending' && (
                        <button className="btn btn-sm btn-outline-danger" onClick={() => run(async () => { await call(`/api/team/invitations/${i.id}`, 'DELETE'); await load(); }, 'Invitation revoked')}>Revoke</button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'activity' && (
              <table className="table table-sm small">
                <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
                <tbody>
                  {activity.map(a => (
                    <tr key={a.id}>
                      <td className="text-nowrap">{fmt(a.created_at)}</td>
                      <td>{a.username ? `@${a.username}` : <span className="text-muted">removed user</span>}</td>
                      <td><code>{a.action}</code></td>
                      <td className="text-muted" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{JSON.stringify(a.details)}</td>
                      <td>{a.ip_address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'me' && (
              <div className="row g-3">
                <div className="col-md-6">
                  <div className="border rounded p-3 small">
                    <div className="fw-bold mb-2">Profile</div>
                    <div>Name: {user?.fullName || user?.name}</div>
                    <div>Username: @{user?.username}</div>
                    <div>Role: {user?.isOwner ? 'Account Owner' : ROLE_LABEL[user?.role] || user?.role}</div>
                    <div>Permissions: {(user?.permissions || []).join(', ') || 'none'}</div>
                  </div>
                  <button className="btn btn-sm btn-outline-danger mt-2" onClick={async () => { await fetch(endpoint('/api/auth/logout-all'), { method: 'POST' }); window.location.reload(); }}>
                    <i className="bi bi-box-arrow-right me-1"></i>Sign out from all devices
                  </button>
                </div>
                <form className="col-md-6" onSubmit={e => { e.preventDefault(); run(async () => { await call('/api/auth/change-password', 'POST', pw); setPw({ currentPassword: '', newPassword: '' }); }, 'Password changed. Other devices were signed out.'); }}>
                  <div className="fw-bold mb-2 small">Change password</div>
                  <input type="password" className="form-control form-control-sm mb-2" placeholder="Current password" value={pw.currentPassword} onChange={e => setPw({ ...pw, currentPassword: e.target.value })} required autoComplete="current-password" />
                  <input type="password" className="form-control form-control-sm mb-2" placeholder="New password (8+ chars, letters and numbers)" value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} required autoComplete="new-password" />
                  <button className="btn btn-sm btn-msquare-primary">Update password</button>
                </form>
              </div>
            )}

            {detail && (
              <div className="border rounded p-3 mt-3 small">
                <div className="d-flex justify-content-between"><div className="fw-bold">@{detail.username} · {ROLE_LABEL[detail.role]}</div><button className="btn-close" onClick={() => setDetail(null)}></button></div>
                <div>Last login {fmt(detail.lastLoginAt)} · Last active {fmt(detail.lastActiveAt)} · Status {detail.status}</div>
                <div className="mt-2 fw-semibold">Active sessions ({detail.sessions.length})</div>
                {detail.sessions.map(s => <div key={s.ref} className="text-muted">{s.ipAddress} · {s.userAgent?.slice(0, 80)} · since {fmt(s.createdAt)}</div>)}
                <div className="mt-2 fw-semibold">Recent actions</div>
                {detail.recentActivity.length === 0 && <div className="text-muted">None</div>}
                {detail.recentActivity.map((a, i) => <div key={i}><code>{a.action}</code> <span className="text-muted">{fmt(a.created_at)}</span></div>)}
              </div>
            )}

            {form && (
              <form className="border rounded p-3 mt-3" onSubmit={submitForm}>
                <div className="fw-bold mb-2">{form.mode === 'add' ? 'Add member' : form.mode === 'invite' ? 'Invite member' : `Edit @${form.username}`}</div>
                <div className="row g-2">
                  <div className="col-md-4"><input className="form-control form-control-sm" placeholder="Full name" required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} /></div>
                  <div className="col-md-4"><input className="form-control form-control-sm" placeholder="Username" required disabled={form.mode === 'edit'} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
                  <div className="col-md-4">
                    <select className="form-select form-select-sm" value={form.role} onChange={e => setForm({ ...form, role: e.target.value, permissions: null })}>
                      <option value="agent">Agent</option>
                      {user?.isOwner && <option value="manager">Administrator</option>}
                    </select>
                  </div>
                  <div className="col-md-4"><input type="email" className="form-control form-control-sm" placeholder="Email (optional)" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                  <div className="col-md-4"><input className="form-control form-control-sm" placeholder="Mobile with country code (optional)" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                  {form.mode === 'add' && <div className="col-md-4"><input type="password" className="form-control form-control-sm" placeholder="Temporary password" required autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>}
                </div>

                <div className="row mt-3 small">
                  <div className="col-md-7">
                    <div className="fw-semibold mb-1">Permissions {form.permissions === null && <span className="text-muted fw-normal">(role defaults)</span>}</div>
                    {PERM_GROUPS.map(([group, perms]) => (
                      <div key={group} className="mb-2">
                        <div className="text-muted text-uppercase" style={{ fontSize: '0.7rem' }}>{group}</div>
                        {perms.map(([key, label]) => (
                          <div className="form-check form-switch" key={key}>
                            <input className="form-check-input" type="checkbox" id={`p-${key}`} checked={effectivePerms(form).includes(key)} onChange={() => togglePerm(key)}
                              disabled={!user?.isOwner && !user?.permissions?.includes(key)} />
                            <label className="form-check-label" htmlFor={`p-${key}`}>{label}</label>
                          </div>
                        ))}
                      </div>
                    ))}
                    {form.permissions !== null && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setForm({ ...form, permissions: null })}>Reset to role defaults</button>}
                  </div>
                  <div className="col-md-5">
                    <div className="fw-semibold mb-1">WhatsApp number access</div>
                    {ownedAccounts.length === 0 && <div className="text-muted">No numbers connected yet</div>}
                    {ownedAccounts.map(a => (
                      <div className="form-check" key={a.id}>
                        <input className="form-check-input" type="checkbox" id={`a-${a.id}`} checked={form.accountIds.includes(a.id)} onChange={() => toggleAcc(a.id)} />
                        <label className="form-check-label" htmlFor={`a-${a.id}`}>{a.name}{a.phone ? ` (${a.phone})` : ''}</label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="d-flex gap-2 mt-2">
                  <button className="btn btn-sm btn-msquare-primary">{form.mode === 'invite' ? 'Create invitation' : 'Save'}</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setForm(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
