import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user, tenant, branch, token, logout, login } = useAuth();

  // Navigation & Theme
  const [activeView, setActiveView] = useState('inbox'); // 'dashboard', 'inbox', 'branches', 'channels'
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [isSyncing, setIsSyncing] = useState(false);

  // Data states
  const [branches, setBranches] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [conversations, setConversations] = useState([
    {
      id: 'conv-1',
      customerName: 'Rahul Verma',
      customerPhone: '+91 98765 12340',
      branchName: 'Greater Noida Hub',
      branchId: 'aaaaaaaa-0001-4000-8000-000000000001',
      status: 'open',
      assignedTo: 'Diya Patel (Helpdesk Specialist)',
      assignedUserId: 'alpha_employee',
      unreadCount: 1,
      lastMessage: 'Hi, I need pricing information for the Enterprise growth automation package.',
      lastMessageTime: '10:42 AM',
      messages: [
        { id: 'm1', fromMe: false, text: 'Hello M Square Support team!', time: '10:40 AM', status: 'read' },
        { id: 'm2', fromMe: true, text: 'Hello Rahul! Welcome to M Square Professionals. How can we assist you today?', time: '10:41 AM', status: 'read' },
        { id: 'm3', fromMe: false, text: 'Hi, I need pricing information for the Enterprise growth automation package.', time: '10:42 AM', status: 'delivered' }
      ],
      leadInfo: {
        stage: 'Qualified Lead',
        tags: ['Growth Package', 'Enterprise', 'WhatsApp CRM'],
        budget: '₹45,000 / mo',
        internalNote: 'Followed up via WhatsApp. Interested in multi-branch WhatsApp connector module.'
      }
    },
    {
      id: 'conv-2',
      customerName: 'Priya Sharma',
      customerPhone: '+91 98111 54321',
      branchName: 'Greater Noida Hub',
      branchId: 'aaaaaaaa-0001-4000-8000-000000000001',
      status: 'open',
      assignedTo: 'Aarav Sharma (Branch Lead)',
      assignedUserId: 'alpha_branch_admin',
      unreadCount: 0,
      lastMessage: 'Sure, let us schedule a demo tomorrow at 3 PM.',
      lastMessageTime: '09:15 AM',
      messages: [
        { id: 'm21', fromMe: false, text: 'Can we connect our official WhatsApp number without losing existing chat history?', time: '09:10 AM', status: 'read' },
        { id: 'm22', fromMe: true, text: 'Sure, let us schedule a demo tomorrow at 3 PM.', time: '09:15 AM', status: 'read' }
      ],
      leadInfo: {
        stage: 'Demo Scheduled',
        tags: ['Demo', 'High Priority'],
        budget: '₹75,000 / mo',
        internalNote: 'Scheduled for tomorrow at 3 PM. Needs QR reconnection walkthrough.'
      }
    },
    {
      id: 'conv-3',
      customerName: 'Vikrant Roy',
      customerPhone: '+91 97222 99887',
      branchName: 'Noida HQ',
      branchId: 'aaaaaaaa-0002-4000-8000-000000000002',
      status: 'resolved',
      assignedTo: 'Diya Patel (Helpdesk Specialist)',
      assignedUserId: 'alpha_employee',
      unreadCount: 0,
      lastMessage: 'Thank you for resolving the branch configuration so quickly!',
      lastMessageTime: 'Yesterday',
      messages: [
        { id: 'm31', fromMe: false, text: 'How do I add a 2nd branch in our tenant dashboard?', time: 'Yesterday 3:15 PM', status: 'read' },
        { id: 'm32', fromMe: true, text: 'Navigate to Branches > Add New Branch and specify branch code.', time: 'Yesterday 3:20 PM', status: 'read' },
        { id: 'm33', fromMe: false, text: 'Thank you for resolving the branch configuration so quickly!', time: 'Yesterday 3:30 PM', status: 'read' }
      ],
      leadInfo: {
        stage: 'Active Client',
        tags: ['Support', 'Resolved'],
        budget: '₹30,000 / mo',
        internalNote: 'Client onboarded on 2 branches.'
      }
    }
  ]);

  const [selectedConvId, setSelectedConvId] = useState('conv-1');
  const [chatFilter, setChatFilter] = useState('all'); // 'all', 'mine', 'unread', 'resolved'
  const [searchQuery, setSearchQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Selected conversation
  const selectedConv = conversations.find(c => c.id === selectedConvId) || conversations[0];

  // Theme switcher
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.setAttribute('data-bs-theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // Load live branches and users from Express API
  const refreshData = async () => {
    setIsSyncing(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [bRes, uRes] = await Promise.all([
        fetch('/api/branches', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/users', { headers }).then(r => r.json()).catch(() => ({}))
      ]);
      if (bRes.success) setBranches(bRes.data || []);
      if (uRes.success) setUsersList(uRes.data || []);
    } catch (err) {
      console.error('Error refreshing backend data:', err);
    } finally {
      setTimeout(() => setIsSyncing(false), 400);
    }
  };

  useEffect(() => {
    refreshData();
  }, [token]);

  // Send WhatsApp message
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!replyText.trim() || !selectedConv) return;

    const messageText = replyText.trim();
    setReplyText('');
    setIsSending(true);

    const newMsg = {
      id: 'm-' + Date.now(),
      fromMe: true,
      text: messageText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent'
    };

    // Update in-memory chat
    setConversations(prev => prev.map(c => {
      if (c.id === selectedConv.id) {
        return {
          ...c,
          lastMessage: messageText,
          lastMessageTime: 'Just now',
          messages: [...c.messages, newMsg]
        };
      }
      return c;
    }));

    // Send to WhatsApp API endpoint if branch connected
    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: selectedConv.branchId ? tenant?.id : '11111111-1111-4000-8000-000000000001',
          branchId: selectedConv.branchId || 'aaaaaaaa-0001-4000-8000-000000000001',
          to: selectedConv.customerPhone,
          text: messageText
        })
      });
      // Update message status to delivered
      setConversations(prev => prev.map(c => {
        if (c.id === selectedConv.id) {
          return {
            ...c,
            messages: c.messages.map(m => m.id === newMsg.id ? { ...m, status: 'delivered' } : m)
          };
        }
        return c;
      }));
    } catch (e) {
      // ignore in offline prototype
    } finally {
      setIsSending(false);
    }
  };

  // Change conversation status
  const handleStatusChange = (newStatus) => {
    setConversations(prev => prev.map(c => {
      if (c.id === selectedConv.id) {
        return { ...c, status: newStatus };
      }
      return c;
    }));
  };

  // Filter conversations
  const filteredConversations = conversations.filter(c => {
    if (chatFilter === 'mine' && user) {
      if (c.assignedUserId !== user.id && c.assignedTo !== user.full_name) return false;
    }
    if (chatFilter === 'unread' && c.unreadCount === 0) return false;
    if (chatFilter === 'resolved' && c.status !== 'resolved') return false;
    if (chatFilter === 'open' && c.status !== 'open') return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        c.customerName.toLowerCase().includes(q) ||
        c.customerPhone.includes(q) ||
        c.lastMessage.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'open':
        return <span className="badge badge-open">Open</span>;
      case 'on_hold':
        return <span className="badge badge-on_hold">On Hold</span>;
      case 'resolved':
        return <span className="badge badge-resolved">Resolved</span>;
      case 'closed':
        return <span className="badge badge-closed">Closed</span>;
      default:
        return <span className="badge bg-secondary">{status}</span>;
    }
  };

  return (
    <div className="d-flex flex-column vh-100">
      {/* 1. M Square Navbar */}
      <nav className="navbar navbar-expand-lg msquare-navbar px-3">
        <div className="container-fluid d-flex align-items-center justify-content-between px-0">
          {/* Logo & Brand Stack */}
          <div className="d-flex align-items-center gap-2">
            <div className="msquare-logo-badge" title="M Square Professionals">
              <span>M²</span>
            </div>
            <div className="msquare-brand-stacked">
              <span className="brand-word-top">M SQUARE</span>
              <span className="brand-word-bottom">PROFESSIONALS</span>
            </div>
            <span className="msquare-helpdesk-badge ms-2 d-none d-md-inline-flex align-items-center gap-1">
              <i className="bi bi-whatsapp text-success fs-6"></i>
              <span>WhatsApp Helpdesk</span>
            </span>
          </div>

          {/* Right Action Bar */}
          <div className="d-flex align-items-center gap-2 gap-sm-3">
            {/* Tenant & Branch Indicator */}
            <div className="d-none d-lg-flex align-items-center gap-2 small">
              <span className="badge bg-body-tertiary border text-body py-2 px-2.5">
                <i className="bi bi-building me-1 text-warning"></i>
                {tenant?.name || 'M Square Professionals'}
              </span>
              <span className="badge bg-body-tertiary border text-body py-2 px-2.5">
                <i className="bi bi-geo-alt me-1 text-danger"></i>
                {branch?.name || (user?.badge?.includes('Hub') ? user.badge : 'Greater Noida Hub')}
              </span>
            </div>

            {/* Sync Button */}
            <button
              type="button"
              className="btn btn-sm btn-msquare-outline d-flex align-items-center gap-1"
              onClick={refreshData}
              title="Sync conversations with backend"
            >
              <i className={`bi bi-arrow-repeat ${isSyncing ? 'text-warning spin' : 'text-success'}`}></i>
              <span className="d-none d-sm-inline small">Sync</span>
            </button>

            {/* Theme Toggle Button */}
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
            >
              {theme === 'dark' ? (
                <i className="bi bi-sun-fill text-warning fs-5"></i>
              ) : (
                <i className="bi bi-moon-stars-fill text-primary fs-5"></i>
              )}
            </button>

            {/* Switch Identity / User Profile Dropdown */}
            <div className="dropdown">
              <button
                className="btn btn-sm btn-msquare-outline dropdown-toggle d-flex align-items-center gap-2 text-start"
                type="button"
                id="identityDropdown"
                data-bs-toggle="dropdown"
                aria-expanded="false"
              >
                <div
                  className="rounded-circle text-white d-flex align-items-center justify-content-center fw-bold"
                  style={{
                    width: '28px',
                    height: '28px',
                    fontSize: '0.8rem',
                    background: 'linear-gradient(135deg, var(--brand-orange), var(--brand-orange-hover))'
                  }}
                >
                  {(user?.full_name?.charAt(0)) || 'M'}
                </div>
                <div className="d-none d-sm-block text-truncate" style={{ maxWidth: '170px' }}>
                  <div className="fw-semibold lh-1 small text-body">{user?.full_name || 'Aarav Sharma'}</div>
                  <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                    {user?.role_id?.replace('_', ' ') || 'BRANCH ADMIN'}
                  </div>
                </div>
              </button>
              <ul className="dropdown-menu dropdown-menu-end shadow border" aria-labelledby="identityDropdown">
                <li className="dropdown-header text-uppercase fw-bold text-muted small">Switch M Square Identity</li>
                <li>
                  <button
                    className={`dropdown-item d-flex align-items-center justify-content-between py-2 ${user?.email === 'aarav@msquare.com' ? 'active' : ''}`}
                    onClick={() => login('aarav@msquare.com')}
                  >
                    <div>
                      <div className="fw-semibold small">Aarav Sharma (Branch Lead)</div>
                      <div className="text-muted small" style={{ fontSize: '0.72rem' }}>Greater Noida Hub • Branch Lead</div>
                    </div>
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item d-flex align-items-center justify-content-between py-2 ${user?.email === 'diya@msquare.com' ? 'active' : ''}`}
                    onClick={() => login('diya@msquare.com')}
                  >
                    <div>
                      <div className="fw-semibold small">Diya Patel (Helpdesk Specialist)</div>
                      <div className="text-muted small" style={{ fontSize: '0.72rem' }}>Greater Noida Support • Agent</div>
                    </div>
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item d-flex align-items-center justify-content-between py-2 ${user?.email === 'vikram@msquare.com' ? 'active' : ''}`}
                    onClick={() => login('vikram@msquare.com')}
                  >
                    <div>
                      <div className="fw-semibold small">Vikram Mehta (VP Operations)</div>
                      <div className="text-muted small" style={{ fontSize: '0.72rem' }}>Corporate HQ • Tenant Admin</div>
                    </div>
                  </button>
                </li>
                <li>
                  <button
                    className={`dropdown-item d-flex align-items-center justify-content-between py-2 ${user?.email === 'superadmin@msquare.com' ? 'active' : ''}`}
                    onClick={() => login('superadmin@msquare.com')}
                  >
                    <div>
                      <div className="fw-semibold small">System Super Admin</div>
                      <div className="text-muted small" style={{ fontSize: '0.72rem' }}>M Square Global • Global Super Admin</div>
                    </div>
                  </button>
                </li>
                <li><hr className="dropdown-divider my-1" /></li>
                <li>
                  <button className="dropdown-item text-danger small py-1.5" onClick={logout}>
                    <i className="bi bi-box-arrow-right me-2"></i> Sign Out
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </nav>

      {/* 2. Main App Container */}
      <div className="app-container">
        {/* Left Sidebar */}
        <aside className="app-sidebar py-3">
          <div className="px-3 mb-2 small text-uppercase fw-bold text-muted" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
            Helpdesk Views
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('all'); }}
          >
            <i className="bi bi-chat-dots-fill"></i>
            <span>All Inquiries</span>
            <span className="badge bg-secondary-subtle text-secondary ms-auto">{conversations.length}</span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'mine' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('mine'); }}
          >
            <i className="bi bi-person-check-fill"></i>
            <span>My Chats</span>
            <span className="badge bg-warning-subtle text-warning ms-auto">
              {conversations.filter(c => c.assignedUserId === user?.id || c.assignedTo === user?.full_name).length}
            </span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'unread' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('unread'); }}
          >
            <i className="bi bi-envelope-open-fill"></i>
            <span>Unread Queries</span>
            <span className="badge bg-danger ms-auto">
              {conversations.filter(c => c.unreadCount > 0).length}
            </span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'resolved' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('resolved'); }}
          >
            <i className="bi bi-check-circle-fill text-success"></i>
            <span>Resolved Queries</span>
            <span className="badge bg-success-subtle text-success ms-auto">
              {conversations.filter(c => c.status === 'resolved').length}
            </span>
          </div>

          <div className="px-3 mt-4 mb-2 small text-uppercase fw-bold text-muted" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
            Operations & Channels
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'channels' ? 'active' : ''}`}
            onClick={() => setActiveView('channels')}
          >
            <i className="bi bi-qr-code text-success"></i>
            <span>WhatsApp Channels</span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'branches' ? 'active' : ''}`}
            onClick={() => setActiveView('branches')}
          >
            <i className="bi bi-diagram-3-fill text-primary"></i>
            <span>Branches & Users</span>
          </div>

          {/* Footer Ecosystem Badge */}
          <div className="mt-auto px-3 pt-3 border-top" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="small text-muted mb-1" style={{ fontSize: '0.72rem' }}>Platform Engine</div>
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-success-subtle text-success small py-1 px-2">
                <i className="bi bi-lightning-charge-fill me-1"></i> WhatsApp Cloud Engine
              </span>
            </div>
          </div>
        </aside>

        {/* 3. Center Content Area */}
        {activeView === 'inbox' ? (
          <div className="d-flex flex-grow-1 overflow-hidden">
            {/* Column 1: Conversation List Pane */}
            <div className="conversation-list-pane">
              {/* Search & Filter Header */}
              <div className="p-3 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="input-group mb-2">
                  <span className="input-group-text border-0" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                    <i className="bi bi-search"></i>
                  </span>
                  <input
                    type="text"
                    className="form-control message-input form-control-sm"
                    placeholder="Search client name or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="d-flex gap-1 overflow-x-auto pb-1">
                  <button
                    className={`btn btn-sm ${chatFilter === 'all' ? 'btn-msquare-primary py-0 px-2' : 'btn-msquare-outline py-0 px-2'}`}
                    onClick={() => setChatFilter('all')}
                  >
                    All
                  </button>
                  <button
                    className={`btn btn-sm ${chatFilter === 'mine' ? 'btn-msquare-primary py-0 px-2' : 'btn-msquare-outline py-0 px-2'}`}
                    onClick={() => setChatFilter('mine')}
                  >
                    Mine
                  </button>
                  <button
                    className={`btn btn-sm ${chatFilter === 'unread' ? 'btn-msquare-primary py-0 px-2' : 'btn-msquare-outline py-0 px-2'}`}
                    onClick={() => setChatFilter('unread')}
                  >
                    Unread
                  </button>
                  <button
                    className={`btn btn-sm ${chatFilter === 'resolved' ? 'btn-msquare-primary py-0 px-2' : 'btn-msquare-outline py-0 px-2'}`}
                    onClick={() => setChatFilter('resolved')}
                  >
                    Resolved
                  </button>
                </div>
              </div>

              {/* Conversations Scrollable List */}
              <div className="flex-grow-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                  <div className="text-center py-5 text-muted small">
                    <i className="bi bi-chat-square-text fs-2 d-block mb-2 text-secondary"></i>
                    No conversations found
                  </div>
                ) : (
                  filteredConversations.map((c) => {
                    const isSelected = selectedConv?.id === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`conversation-item ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedConvId(c.id)}
                      >
                        <div className="d-flex justify-content-between align-items-start mb-1">
                          <span className="fw-semibold text-truncate text-body" style={{ maxWidth: '190px' }}>
                            {c.customerName}
                          </span>
                          <span className="text-muted small" style={{ fontSize: '0.72rem' }}>
                            {c.lastMessageTime}
                          </span>
                        </div>
                        <div className="d-flex align-items-center gap-1 mb-1">
                          <span className="badge bg-body-tertiary border text-body" style={{ fontSize: '0.68rem' }}>
                            {c.branchName}
                          </span>
                          {getStatusBadge(c.status)}
                          {c.unreadCount > 0 && (
                            <span className="badge bg-danger rounded-pill ms-auto" style={{ fontSize: '0.68rem' }}>
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                        <p className="text-muted small mb-0 text-truncate" style={{ fontSize: '0.82rem' }}>
                          {c.lastMessage}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Column 2: Chat Detail Pane */}
            <div className="chat-detail-pane">
              {selectedConv ? (
                <>
                  {/* Chat Header */}
                  <div
                    className="d-flex justify-content-between align-items-center px-4 py-3 border-bottom"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="d-flex align-items-center gap-3">
                      <div
                        className="rounded-circle text-white d-flex align-items-center justify-content-center fw-bold"
                        style={{
                          width: '40px',
                          height: '40px',
                          background: 'linear-gradient(135deg, var(--brand-blue), var(--brand-blue-hover))'
                        }}
                      >
                        {selectedConv.customerName.charAt(0)}
                      </div>
                      <div>
                        <div className="fw-bold mb-0 text-body d-flex align-items-center gap-2">
                          {selectedConv.customerName}
                          <span className="badge bg-body-tertiary text-muted border small fw-normal">
                            {selectedConv.customerPhone}
                          </span>
                        </div>
                        <div className="text-muted small d-flex align-items-center gap-2" style={{ fontSize: '0.75rem' }}>
                          <span><i className="bi bi-geo-alt me-1 text-danger"></i>{selectedConv.branchName}</span>
                          <span>•</span>
                          <span><i className="bi bi-person me-1 text-primary"></i>{selectedConv.assignedTo}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status & Transfer Controls */}
                    <div className="d-flex align-items-center gap-2">
                      <select
                        className="form-select form-select-sm message-input"
                        style={{ width: '130px' }}
                        value={selectedConv.status}
                        onChange={(e) => handleStatusChange(e.target.value)}
                      >
                        <option value="open">🟢 Open</option>
                        <option value="on_hold">🟠 On Hold</option>
                        <option value="resolved">🔵 Resolved</option>
                        <option value="closed">⚪ Closed</option>
                      </select>

                      <button
                        className="btn btn-sm btn-msquare-outline"
                        title="Transfer conversation to another agent"
                        onClick={() => alert(`Transfer ${selectedConv.customerName} to another branch agent.`)}
                      >
                        <i className="bi bi-arrow-left-right me-1"></i> Transfer
                      </button>
                    </div>
                  </div>

                  {/* Message History Thread */}
                  <div className="messages-container">
                    {selectedConv.messages.map((m) => (
                      <div key={m.id} className={`message-bubble ${m.fromMe ? 'outbound' : 'inbound'}`}>
                        <div className="message-text">{m.text}</div>
                        <div className="message-meta">
                          <span>{m.time}</span>
                          {m.fromMe && (
                            <span>
                              {m.status === 'read' ? (
                                <i className="bi bi-check2-all text-info" title="Read"></i>
                              ) : m.status === 'delivered' ? (
                                <i className="bi bi-check2-all text-muted" title="Delivered"></i>
                              ) : (
                                <i className="bi bi-check2 text-muted" title="Sent"></i>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Message Composer */}
                  <div className="message-composer-wrapper">
                    {/* Quick Response Templates */}
                    <div className="d-flex gap-2 mb-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline text-nowrap py-0 px-2"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => setReplyText('Hello! Thanks for reaching out to M Square Professionals. How can I help you today?')}
                      >
                        👋 Welcome Greeting
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline text-nowrap py-0 px-2"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => setReplyText('I have scheduled your demo session. Our branch specialist will contact you shortly.')}
                      >
                        📅 Demo Confirmation
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline text-nowrap py-0 px-2"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => setReplyText('Your query has been resolved! Please let us know if you need anything else.')}
                      >
                        ✅ Query Resolved
                      </button>
                    </div>

                    {/* Composer Input Bar */}
                    <form onSubmit={handleSendMessage} className="d-flex align-items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline"
                        title="Attach Media / Document"
                      >
                        <i className="bi bi-paperclip"></i>
                      </button>
                      <input
                        type="text"
                        className="form-control message-input"
                        placeholder="Type a WhatsApp reply (Enter to send)..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        disabled={isSending}
                      />
                      <button
                        type="submit"
                        className="btn btn-msquare-primary px-3"
                        disabled={isSending || !replyText.trim()}
                      >
                        {isSending ? (
                          <span className="spinner-border spinner-border-sm" role="status"></span>
                        ) : (
                          <>
                            <i className="bi bi-send-fill me-1"></i> Send
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div className="d-flex align-items-center justify-content-center h-100 text-muted">
                  No conversation selected
                </div>
              )}
            </div>

            {/* Column 3: Contact Context / Lead Details Pane */}
            {selectedConv && (
              <div
                className="d-none d-xl-flex flex-column p-3 border-start overflow-y-auto"
                style={{
                  width: '320px',
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-subtle)'
                }}
              >
                <div className="small fw-bold text-uppercase text-muted mb-3" style={{ fontSize: '0.74rem', letterSpacing: '0.5px' }}>
                  <i className="bi bi-person-lines-fill me-1 text-warning"></i> Client CRM Profile
                </div>

                <div className="text-center mb-3 pb-3 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div
                    className="rounded-circle text-white d-flex align-items-center justify-content-center fw-bold mx-auto mb-2"
                    style={{
                      width: '56px',
                      height: '56px',
                      fontSize: '1.25rem',
                      background: 'linear-gradient(135deg, var(--brand-orange), var(--brand-orange-hover))'
                    }}
                  >
                    {selectedConv.customerName.charAt(0)}
                  </div>
                  <h6 className="fw-bold mb-0 text-body">{selectedConv.customerName}</h6>
                  <span className="text-muted small">{selectedConv.customerPhone}</span>
                </div>

                <div className="mb-3">
                  <label className="small text-muted fw-semibold d-block mb-1">Pipeline Stage</label>
                  <span className="badge bg-primary-subtle text-primary py-1 px-2">
                    {selectedConv.leadInfo.stage}
                  </span>
                </div>

                <div className="mb-3">
                  <label className="small text-muted fw-semibold d-block mb-1">Estimated Budget</label>
                  <span className="fw-semibold text-body small">{selectedConv.leadInfo.budget}</span>
                </div>

                <div className="mb-3">
                  <label className="small text-muted fw-semibold d-block mb-1">Tags</label>
                  <div className="d-flex flex-wrap gap-1">
                    {selectedConv.leadInfo.tags.map(t => (
                      <span key={t} className="badge bg-body-tertiary text-body border" style={{ fontSize: '0.7rem' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mb-3">
                  <label className="small text-muted fw-semibold d-block mb-1">Internal Notes</label>
                  <textarea
                    className="form-control message-input small"
                    rows="3"
                    defaultValue={selectedConv.leadInfo.internalNote}
                    placeholder="Add team notes..."
                  ></textarea>
                </div>

                <button
                  type="button"
                  className="btn btn-sm btn-msquare-primary w-100 mt-auto"
                  onClick={() => alert(`Saved notes for ${selectedConv.customerName}`)}
                >
                  <i className="bi bi-save me-1"></i> Save CRM Note
                </button>
              </div>
            )}
          </div>
        ) : activeView === 'channels' ? (
          /* WhatsApp Channels View */
          <div className="flex-grow-1 p-4 overflow-y-auto" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <div className="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
                  <i className="bi bi-whatsapp text-success"></i>
                  M Square Branch WhatsApp Channels
                </h4>
                <p className="text-muted small mb-0">
                  Manage dedicated WhatsApp connections and pairing codes per branch.
                </p>
              </div>
              <a
                href="http://localhost:5000"
                target="_blank"
                rel="noreferrer"
                className="btn btn-msquare-primary btn-sm"
              >
                <i className="bi bi-qr-code-scan me-1"></i> Open Live QR Hub
              </a>
            </div>

            <div className="row g-4">
              <div className="col-md-6">
                <div className="card h-100 p-4 border" style={{ borderColor: 'var(--border-strong)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="fw-bold mb-0">Greater Noida Hub</h5>
                    <span className="badge bg-success-subtle text-success">Active Branch</span>
                  </div>
                  <p className="text-muted small mb-3">
                    Branch Code: <code>GNOIDA</code> | Phone: +91 98765 43210
                  </p>
                  <div className="p-3 rounded mb-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border-strong)' }}>
                    <div className="d-flex align-items-center gap-2 text-success small fw-semibold">
                      <i className="bi bi-check-circle-fill"></i>
                      <span>WhatsApp Socket Connected</span>
                    </div>
                    <div className="text-muted small mt-1">Multi-device auth state stored isolated in <code>wa_sessions/11111111-1111.../aaaaaaaa-0001...</code></div>
                  </div>
                  <div className="d-flex gap-2 mt-auto">
                    <a
                      href="http://localhost:5000/?tenant=11111111-1111-4000-8000-000000000001&branch=aaaaaaaa-0001-4000-8000-000000000001"
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm btn-msquare-outline"
                    >
                      <i className="bi bi-arrow-clockwise me-1"></i> Re-pair QR
                    </a>
                  </div>
                </div>
              </div>

              <div className="col-md-6">
                <div className="card h-100 p-4 border" style={{ borderColor: 'var(--border-strong)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="fw-bold mb-0">Noida HQ</h5>
                    <span className="badge bg-secondary-subtle text-secondary">Standby</span>
                  </div>
                  <p className="text-muted small mb-3">
                    Branch Code: <code>NOIDAHQ</code> | Phone: +91 98765 43211
                  </p>
                  <div className="p-3 rounded mb-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border-strong)' }}>
                    <div className="d-flex align-items-center gap-2 text-warning small fw-semibold">
                      <i className="bi bi-qr-code"></i>
                      <span>Ready to Pair WhatsApp Web</span>
                    </div>
                    <div className="text-muted small mt-1">Ready for QR scan or 8-digit mobile pairing code.</div>
                  </div>
                  <div className="d-flex gap-2 mt-auto">
                    <a
                      href="http://localhost:5000/?tenant=11111111-1111-4000-8000-000000000001&branch=aaaaaaaa-0002-4000-8000-000000000002"
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm btn-msquare-primary"
                    >
                      <i className="bi bi-qr-code me-1"></i> Connect WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Branches & Users View */
          <div className="flex-grow-1 p-4 overflow-y-auto" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <div className="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <h4 className="fw-bold mb-1">M Square Branches & Team Roster</h4>
                <p className="text-muted small mb-0">Manage branches, employee roles, and cross-branch permissions.</p>
              </div>
            </div>

            <div className="row g-4">
              <div className="col-lg-6">
                <div className="card p-3 shadow-sm border">
                  <h6 className="fw-bold mb-3"><i className="bi bi-building me-2 text-warning"></i>Active Branches</h6>
                  <div className="table-responsive">
                    <table className="table table-hover align-middle small mb-0">
                      <thead>
                        <tr>
                          <th>Branch Name</th>
                          <th>Code</th>
                          <th>Phone</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map(b => (
                          <tr key={b.id}>
                            <td className="fw-semibold">{b.name}</td>
                            <td><code>{b.code}</code></td>
                            <td>{b.phone}</td>
                            <td><span className="badge bg-success-subtle text-success">{b.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="col-lg-6">
                <div className="card p-3 shadow-sm border">
                  <h6 className="fw-bold mb-3"><i className="bi bi-people me-2 text-primary"></i>Assigned Team Members</h6>
                  <div className="table-responsive">
                    <table className="table table-hover align-middle small mb-0">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Assigned Branch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.map(u => (
                          <tr key={u.id}>
                            <td className="fw-semibold">{u.full_name}</td>
                            <td><span className="badge bg-secondary-subtle text-secondary">{u.role_id}</span></td>
                            <td>{branches.find(b => b.id === u.branch_id)?.name || 'HQ / Global'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
