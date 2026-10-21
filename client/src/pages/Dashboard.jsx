import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user, tenant, branch, token, logout, hasRole } = useAuth();

  const [branches, setBranches] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [activeTab, setActiveTab] = useState('branches');
  const [loadingData, setLoadingData] = useState(false);

  // New Branch Form state
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [branchMsg, setBranchMsg] = useState('');

  // New User Form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState('AGENT');
  const [newUserBranch, setNewUserBranch] = useState('');
  const [userMsg, setUserMsg] = useState('');

  // Load Branches & Users for the authenticated tenant
  const loadData = async () => {
    setLoadingData(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };

      // 1. Fetch branches
      const bRes = await fetch('/api/branches', { headers });
      const bData = await bRes.json();
      if (bData.success) {
        setBranches(bData.data || []);
      }

      // 2. Fetch users
      const uRes = await fetch('/api/users', { headers });
      const uData = await uRes.json();
      if (uData.success) {
        setUsersList(uData.data || []);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const handleCreateBranch = async (e) => {
    e.preventDefault();
    setBranchMsg('');
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newBranchName,
          code: newBranchCode,
          phone: newBranchPhone
        })
      });
      const data = await res.json();
      if (data.success) {
        setBranchMsg({ type: 'success', text: `Branch "${data.data.name}" added successfully!` });
        setNewBranchName('');
        setNewBranchCode('');
        setNewBranchPhone('');
        loadData();
      } else {
        setBranchMsg({ type: 'danger', text: data.error || 'Failed to add branch' });
      }
    } catch (err) {
      setBranchMsg({ type: 'danger', text: err.message });
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setUserMsg('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          email: newUserEmail,
          full_name: newUserName,
          role_id: newUserRole,
          branch_id: newUserBranch || null
        })
      });
      const data = await res.json();
      if (data.success) {
        setUserMsg({ type: 'success', text: `User "${data.data.full_name}" created successfully!` });
        setNewUserEmail('');
        setNewUserName('');
        loadData();
      } else {
        setUserMsg({ type: 'danger', text: data.error || 'Failed to create user' });
      }
    } catch (err) {
      setUserMsg({ type: 'danger', text: err.message });
    }
  };

  const getRoleBadge = (roleId) => {
    switch (roleId) {
      case 'ROOT_ADMIN':
        return <span className="badge bg-dark">Root Admin</span>;
      case 'TENANT_ADMIN':
        return <span className="badge bg-primary">Tenant Admin</span>;
      case 'BRANCH_ADMIN':
        return <span className="badge bg-info text-dark">Branch Admin</span>;
      case 'AGENT':
        return <span className="badge bg-success">Agent</span>;
      default:
        return <span className="badge bg-secondary">{roleId}</span>;
    }
  };

  return (
    <div className="min-vh-100 bg-light d-flex flex-column">
      {/* Top Navbar */}
      <nav className="navbar navbar-expand-lg navbar-dark bg-dark px-4 shadow-sm">
        <div className="container-fluid px-0">
          <div className="d-flex align-items-center gap-2">
            <span className="navbar-brand fw-bold d-flex align-items-center gap-2 text-success mb-0">
              <i className="bi bi-whatsapp"></i> WaCRM
            </span>
            <span className="badge bg-secondary-subtle text-secondary-emphasis small d-none d-md-inline-block">
              Phase 1: Multi-Tenant Foundation
            </span>
          </div>

          <div className="d-flex align-items-center gap-3">
            {tenant && (
              <div className="d-flex align-items-center text-white small me-2">
                <i className="bi bi-building me-1 text-info"></i>
                <span className="fw-semibold">{tenant.name}</span>
              </div>
            )}

            <div className="d-flex align-items-center gap-2 text-white small">
              <span className="d-none d-sm-inline">{user?.full_name || user?.email}</span>
              {getRoleBadge(user?.role_id)}
            </div>

            <button
              onClick={logout}
              className="btn btn-outline-light btn-sm ms-2"
              title="Sign Out"
            >
              <i className="bi bi-box-arrow-right"></i>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <div className="container-fluid px-4 py-4 flex-grow-1">
        {/* Navigation Tabs */}
        <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-4">
          <ul className="nav nav-pills gap-2">
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'branches' ? 'active' : ''}`}
                onClick={() => setActiveTab('branches')}
              >
                <i className="bi bi-diagram-3 me-1"></i> Branches ({branches.length})
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'users' ? 'active' : ''}`}
                onClick={() => setActiveTab('users')}
              >
                <i className="bi bi-people me-1"></i> Users & Roles ({usersList.length})
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'whatsapp' ? 'active' : ''}`}
                onClick={() => setActiveTab('whatsapp')}
              >
                <i className="bi bi-qr-code me-1"></i> WhatsApp Channels
              </button>
            </li>
          </ul>

          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm" onClick={loadData} disabled={loadingData}>
              <i className={`bi bi-arrow-clockwise me-1 ${loadingData ? 'spin' : ''}`}></i>
              Refresh
            </button>
          </div>
        </div>

        {/* Tab 1: Branches Management */}
        {activeTab === 'branches' && (
          <div className="row g-4">
            <div className="col-lg-8">
              <div className="card shadow-sm border-0">
                <div className="card-header bg-white py-3 fw-bold border-bottom">
                  <i className="bi bi-diagram-3-fill text-primary me-2"></i>
                  Tenant Branches
                </div>
                <div className="card-body p-0 table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light text-muted small text-uppercase">
                      <tr>
                        <th>Branch Name</th>
                        <th>Code</th>
                        <th>Phone</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branches.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="text-center py-4 text-muted">
                            No branches configured for this tenant.
                          </td>
                        </tr>
                      ) : (
                        branches.map((b) => (
                          <tr key={b.id}>
                            <td className="fw-semibold">
                              <i className="bi bi-geo-alt-fill text-danger me-1"></i>
                              {b.name}
                            </td>
                            <td><span className="badge bg-light text-dark border">{b.code}</span></td>
                            <td className="small text-muted">{b.phone || 'N/A'}</td>
                            <td>
                              <span className={`badge ${b.status === 'active' ? 'bg-success' : 'bg-secondary'}`}>
                                {b.status}
                              </span>
                            </td>
                            <td>
                              <a
                                href={`http://localhost:5000/?tenant=${b.tenant_id}&branch=${b.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-sm btn-outline-success"
                              >
                                <i className="bi bi-qr-code me-1"></i> Connect QR
                              </a>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Add Branch Card */}
            {hasRole('TENANT_ADMIN', 'ROOT_ADMIN') && (
              <div className="col-lg-4">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white py-3 fw-bold border-bottom">
                    <i className="bi bi-plus-circle text-success me-2"></i>
                    Add New Branch
                  </div>
                  <div className="card-body">
                    {branchMsg && (
                      <div className={`alert alert-${branchMsg.type} py-2 px-3 small mb-3`}>
                        {branchMsg.text}
                      </div>
                    )}
                    <form onSubmit={handleCreateBranch}>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Branch Name</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          placeholder="e.g. East Metro Branch"
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Branch Code</label>
                        <input
                          type="text"
                          className="form-control form-control-sm text-uppercase"
                          placeholder="e.g. EAST"
                          value={newBranchCode}
                          onChange={(e) => setNewBranchCode(e.target.value)}
                          required
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Phone Number</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          placeholder="+15551234567"
                          value={newBranchPhone}
                          onChange={(e) => setNewBranchPhone(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="btn btn-primary btn-sm w-100">
                        Create Branch
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Users & Roles */}
        {activeTab === 'users' && (
          <div className="row g-4">
            <div className="col-lg-8">
              <div className="card shadow-sm border-0">
                <div className="card-header bg-white py-3 fw-bold border-bottom">
                  <i className="bi bi-people-fill text-primary me-2"></i>
                  Tenant Users & Employees
                </div>
                <div className="card-body p-0 table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light text-muted small text-uppercase">
                      <tr>
                        <th>User Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Branch</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersList.map((u) => (
                        <tr key={u.id}>
                          <td className="fw-semibold">{u.full_name}</td>
                          <td className="small text-muted">{u.email}</td>
                          <td>{getRoleBadge(u.role_id)}</td>
                          <td className="small">
                            {branches.find(b => b.id === u.branch_id)?.name || <span className="text-muted">All Branches</span>}
                          </td>
                          <td>
                            <span className={`badge ${u.is_active ? 'bg-success' : 'bg-secondary'}`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Add User Card */}
            {hasRole('TENANT_ADMIN', 'ROOT_ADMIN') && (
              <div className="col-lg-4">
                <div className="card shadow-sm border-0">
                  <div className="card-header bg-white py-3 fw-bold border-bottom">
                    <i className="bi bi-person-plus text-primary me-2"></i>
                    Provision User
                  </div>
                  <div className="card-body">
                    {userMsg && (
                      <div className={`alert alert-${userMsg.type} py-2 px-3 small mb-3`}>
                        {userMsg.text}
                      </div>
                    )}
                    <form onSubmit={handleCreateUser}>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Full Name</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          placeholder="Employee Name"
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Email Address</label>
                        <input
                          type="email"
                          className="form-control form-control-sm"
                          placeholder="employee@business.com"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Role</label>
                        <select
                          className="form-select form-select-sm"
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value)}
                        >
                          <option value="AGENT">Support Agent</option>
                          <option value="BRANCH_ADMIN">Branch Administrator</option>
                          <option value="TENANT_ADMIN">Tenant Administrator</option>
                        </select>
                      </div>
                      <div className="mb-3">
                        <label className="form-label small text-muted">Assigned Branch</label>
                        <select
                          className="form-select form-select-sm"
                          value={newUserBranch}
                          onChange={(e) => setNewUserBranch(e.target.value)}
                        >
                          <option value="">All Branches / Global</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="btn btn-primary btn-sm w-100">
                        Create User
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: WhatsApp Channels */}
        {activeTab === 'whatsapp' && (
          <div className="card shadow-sm border-0 p-4">
            <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom">
              <div>
                <h5 className="fw-bold mb-0 text-success">
                  <i className="bi bi-whatsapp me-2"></i> WhatsApp Channel Management
                </h5>
                <p className="text-muted small mb-0">
                  Each branch maintains its own dedicated WhatsApp connection and isolated session keys.
                </p>
              </div>
            </div>

            <div className="row g-3">
              {branches.map((b) => (
                <div key={b.id} className="col-md-6">
                  <div className="card border p-3 h-100">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h6 className="fw-bold mb-0">{b.name}</h6>
                      <span className="badge bg-secondary-subtle text-secondary">{b.code}</span>
                    </div>
                    <p className="text-muted small mb-3">
                      Phone: {b.phone || 'Not configured'} | Tenant: {b.tenant_id}
                    </p>
                    <div className="d-flex gap-2 mt-auto">
                      <a
                        href={`http://localhost:5000/?tenant=${b.tenant_id}&branch=${b.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm btn-outline-success"
                      >
                        <i className="bi bi-qr-code me-1"></i> Scan QR & Pair
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
