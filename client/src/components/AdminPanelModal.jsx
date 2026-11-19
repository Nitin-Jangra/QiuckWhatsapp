import React, { useEffect, useState } from 'react';

export default function AdminPanelModal({ currentUserId, onClose }) {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, usersRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users')
      ]);

      const statsJson = await statsRes.json();
      const usersJson = await usersRes.json();

      if (!statsJson.success) throw new Error(statsJson.error || 'Failed to load platform stats');
      if (!usersJson.success) throw new Error(usersJson.error || 'Failed to load users list');

      setStats(statsJson.data);
      setUsers(usersJson.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showToast = (msg) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(''), 4000);
  };

  const handleToggleStatus = async (user) => {
    const nextStatus = user.status === 'active' ? 'suspended' : 'active';
    if (!window.confirm(`Are you sure you want to change @${user.username}'s status to "${nextStatus}"?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to update status');

      showToast(`User @${user.username} is now ${nextStatus}`);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleRole = async (user) => {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    if (!window.confirm(`Change role for @${user.username} to "${nextRole}"?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to update role');

      showToast(`User @${user.username} role changed to ${nextRole}`);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleResetPassword = async (user) => {
    const newPassword = window.prompt(`Enter new password for @${user.username} (min 8 characters):`);
    if (!newPassword) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to reset password');

      showToast(`Password updated for @${user.username}`);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`PERMANENTLY DELETE user @${user.username} and all associated data? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to delete user');

      showToast(`User @${user.username} deleted`);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="modal d-block" style={{ background: 'rgba(15, 23, 42, 0.75)', zIndex: 1055 }} onClick={onClose}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable" onClick={e => e.stopPropagation()}>
        <div className="modal-content shadow-lg border-0 rounded-4">
          {/* Header */}
          <div className="modal-header border-bottom px-4 py-3 bg-body-tertiary">
            <div className="d-flex align-items-center gap-2">
              <div className="rounded-3 bg-danger-subtle text-danger p-2 d-flex align-items-center justify-content-center" style={{ width: 36, height: 36 }}>
                <i className="bi bi-shield-lock-fill fs-5"></i>
              </div>
              <div>
                <h5 className="modal-title fw-bold mb-0">Platform Administration</h5>
                <span className="text-muted small">Multi-User Management & System Metrics</span>
              </div>
            </div>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>

          {/* Body */}
          <div className="modal-body px-4 py-4">
            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            {actionNotice && <div className="alert alert-success py-2 small">{actionNotice}</div>}

            {/* Metrics Cards */}
            {stats && (
              <div className="row g-3 mb-4">
                <div className="col-6 col-md-3">
                  <div className="p-3 border rounded-3 bg-body-tertiary">
                    <span className="text-secondary small fw-semibold text-uppercase d-block mb-1" style={{ fontSize: '0.75rem' }}>Total Users</span>
                    <h3 className="fw-bold mb-0 text-primary">{stats.totalUsers}</h3>
                    <span className="text-muted small">{stats.activeUsers} active • {stats.verifiedUsers} verified</span>
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <div className="p-3 border rounded-3 bg-body-tertiary">
                    <span className="text-secondary small fw-semibold text-uppercase d-block mb-1" style={{ fontSize: '0.75rem' }}>Active Sessions</span>
                    <h3 className="fw-bold mb-0 text-success">{stats.activeSessions}</h3>
                    <span className="text-muted small">Live authenticated devices</span>
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <div className="p-3 border rounded-3 bg-body-tertiary">
                    <span className="text-secondary small fw-semibold text-uppercase d-block mb-1" style={{ fontSize: '0.75rem' }}>WhatsApp Accounts</span>
                    <h3 className="fw-bold mb-0 text-info">{stats.totalAccounts}</h3>
                    <span className="text-muted small">{stats.connectedAccounts} connected lines</span>
                  </div>
                </div>
                <div className="col-6 col-md-3">
                  <div className="p-3 border rounded-3 bg-body-tertiary">
                    <span className="text-secondary small fw-semibold text-uppercase d-block mb-1" style={{ fontSize: '0.75rem' }}>Messages & Chats</span>
                    <h3 className="fw-bold mb-0 text-warning">{stats.totalMessages}</h3>
                    <span className="text-muted small">across {stats.totalChats} conversations</span>
                  </div>
                </div>
              </div>
            )}

            {/* Admin Notice Banner */}
            <div className="alert alert-info py-2 px-3 small d-flex align-items-center justify-content-between mb-4">
              <div>
                <i className="bi bi-info-circle-fill me-2"></i>
                <strong>Default Administrator Credentials:</strong> Username: <code>admin</code> | Password: <code>Admin@WaCRM2026!</code>
              </div>
              <span className="badge bg-primary">Owner Only</span>
            </div>

            {/* Users Table */}
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h6 className="fw-bold mb-0">Registered Platform Users ({users.length})</h6>
              <button className="btn btn-sm btn-outline-secondary" onClick={loadData} disabled={loading}>
                <i className={`bi bi-arrow-clockwise me-1 ${loading ? 'spin-icon' : ''}`}></i>Refresh
              </button>
            </div>

            <div className="table-responsive border rounded-3">
              <table className="table table-hover align-middle mb-0 small">
                <thead className="table-light">
                  <tr>
                    <th>User</th>
                    <th>Phone Number</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Sessions</th>
                    <th>Registered</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center text-muted py-4">No users found</td>
                    </tr>
                  ) : (
                    users.map(u => {
                      const isSelf = u.id === currentUserId;
                      return (
                        <tr key={u.id}>
                          <td>
                            <div className="fw-bold">{u.fullName || u.name}</div>
                            <div className="text-muted small">@{u.username}</div>
                          </td>
                          <td>
                            {u.phoneNumber ? (
                              <span>
                                {u.phoneNumber}
                                {u.phoneVerified && <i className="bi bi-check-circle-fill text-success ms-1" title="Phone Verified"></i>}
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${u.role === 'admin' ? 'bg-danger-subtle text-danger border border-danger-subtle' : 'bg-secondary-subtle text-secondary'}`}>
                              {u.role === 'admin' ? 'Administrator' : 'User'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${u.status === 'active' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
                              {u.status || (u.active ? 'active' : 'disabled')}
                            </span>
                          </td>
                          <td>
                            <span className="badge bg-secondary rounded-pill">{u.sessionsCount || 0}</span>
                          </td>
                          <td className="text-muted">
                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="text-end">
                            <div className="btn-group btn-group-sm">
                              <button
                                className="btn btn-outline-secondary"
                                title="Reset Password"
                                onClick={() => handleResetPassword(u)}
                              >
                                <i className="bi bi-key"></i>
                              </button>
                              <button
                                className="btn btn-outline-secondary"
                                title={u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                                disabled={isSelf}
                                onClick={() => handleToggleRole(u)}
                              >
                                <i className="bi bi-person-gear"></i>
                              </button>
                              <button
                                className={`btn ${u.status === 'active' ? 'btn-outline-warning' : 'btn-outline-success'}`}
                                title={u.status === 'active' ? 'Suspend Account' : 'Activate Account'}
                                disabled={isSelf}
                                onClick={() => handleToggleStatus(u)}
                              >
                                <i className={`bi ${u.status === 'active' ? 'bi-slash-circle' : 'bi-check-lg'}`}></i>
                              </button>
                              <button
                                className="btn btn-outline-danger"
                                title="Delete User"
                                disabled={isSelf}
                                onClick={() => handleDeleteUser(u)}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer border-top px-4 py-2 bg-body-tertiary">
            <button type="button" className="btn btn-sm btn-secondary px-3" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
