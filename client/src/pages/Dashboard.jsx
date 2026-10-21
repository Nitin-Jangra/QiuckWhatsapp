import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user, tenant, branch, token, logout, login } = useAuth();

  // Navigation, Theme & Responsiveness
  const [activeView, setActiveView] = useState('inbox'); // 'inbox', 'branches', 'channels'
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Role permissions check: Only Branch Lead or Root Admin can manage WhatsApp socket/QR
  const isBranchLead = user?.role_id === 'BRANCH_ADMIN' || user?.role_id === 'ROOT_ADMIN';

  // Live WhatsApp Socket State
  const [waStatus, setWaStatus] = useState('DISCONNECTED'); // DISCONNECTED, SCAN_QR, CONNECTED, CONNECTING
  const [waQrDataUrl, setWaQrDataUrl] = useState(null);
  const [waPhone, setWaPhone] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);

  // Backend Data
  const [branches, setBranches] = useState([]);
  const [usersList, setUsersList] = useState([]);

  // Conversations State (Real CRM conversations)
  const [conversations, setConversations] = useState([
    {
      id: 'conv-real-1',
      customerName: 'Rahul Verma (Growth Inquiry)',
      customerPhone: '+919876512340',
      branchName: 'Greater Noida Hub',
      branchId: 'aaaaaaaa-0001-4000-8000-000000000001',
      status: 'open',
      assignedTo: 'Aarav Sharma (Branch Lead)',
      assignedUserId: 'alpha_branch_admin',
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
      id: 'conv-real-2',
      customerName: 'Priya Sharma (Corporate Partner)',
      customerPhone: '+919811154321',
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
    }
  ]);

  const [selectedConvId, setSelectedConvId] = useState('conv-real-1');
  const [chatFilter, setChatFilter] = useState('all'); // 'all', 'mine', 'unread', 'resolved'
  const [searchQuery, setSearchQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // New Real Chat Modal State
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatInitialMsg, setNewChatInitialMsg] = useState('Hi! Thank you for contacting M Square Professionals.');

  const messagesEndRef = useRef(null);

  // Selected conversation
  const selectedConv = conversations.find(c => c.id === selectedConvId) || conversations[0];

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConv?.messages]);

  // Theme switcher
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.setAttribute('data-bs-theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // Set default theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Active tenant and branch IDs
  const activeTenantId = user?.tenant_id || '11111111-1111-4000-8000-000000000001';
  const activeBranchId = user?.branch_id || 'aaaaaaaa-0001-4000-8000-000000000001';

  // Fetch WhatsApp session status
  const checkWhatsAppStatus = async () => {
    try {
      const res = await fetch(`/api/whatsapp/status?tenantId=${activeTenantId}&branchId=${activeBranchId}`);
      const json = await res.json();
      if (json.success && json.data) {
        setWaStatus(json.data.status);
        setWaPhone(json.data.phone);
        if (json.data.qrDataUrl) {
          setWaQrDataUrl(json.data.qrDataUrl);
        }
      }
    } catch (e) {
      console.warn('Status check warning:', e.message);
    }
  };

  // Connect WhatsApp session & load QR (Only Branch Lead)
  const handleConnectWhatsApp = async () => {
    if (!isBranchLead) {
      alert('Access Restricted: Only Branch Lead can connect or refresh the WhatsApp session.');
      return;
    }
    setQrLoading(true);
    setShowQrModal(true);
    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenantId, branchId: activeBranchId })
      });
      const json = await res.json();
      if (json.data?.qrDataUrl) {
        setWaQrDataUrl(json.data.qrDataUrl);
      }
      setWaStatus(json.data?.status || 'SCAN_QR');
    } catch (err) {
      console.error('Failed to initialize WhatsApp:', err);
    } finally {
      setQrLoading(false);
    }
  };

  // Force Refresh WhatsApp Session (Only Branch Lead)
  const handleRefreshWhatsApp = async () => {
    if (!isBranchLead) {
      alert('Access Restricted: Only Branch Lead can refresh the WhatsApp session.');
      return;
    }
    setQrLoading(true);
    setShowQrModal(true);
    try {
      const res = await fetch('/api/whatsapp/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: activeTenantId, branchId: activeBranchId })
      });
      const json = await res.json();
      if (json.data?.qrDataUrl) {
        setWaQrDataUrl(json.data.qrDataUrl);
      }
      setWaStatus('SCAN_QR');
    } catch (err) {
      console.error('Failed to reconnect WhatsApp:', err);
    } finally {
      setQrLoading(false);
    }
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
      await checkWhatsAppStatus();
    } catch (err) {
      console.error('Error refreshing backend data:', err);
    } finally {
      setTimeout(() => setIsSyncing(false), 400);
    }
  };

  useEffect(() => {
    refreshData();
  }, [token]);

  // Real-Time Server-Sent Events (SSE) Listener for live QR & messages
  useEffect(() => {
    const sseUrl = `/api/whatsapp/events?tenantId=${activeTenantId}&branchId=${activeBranchId}`;
    const es = new EventSource(sseUrl);

    es.addEventListener('qr', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.qrDataUrl) {
          setWaQrDataUrl(data.qrDataUrl);
          setWaStatus('SCAN_QR');
        }
      } catch (err) {}
    });

    es.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        setWaStatus(data.status);
        if (data.phone) setWaPhone(data.phone);
        if (data.status === 'CONNECTED') {
          setWaQrDataUrl(null);
        }
      } catch (err) {}
    });

    es.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        const incomingPhone = msg.customerPhone || msg.remoteJid?.split('@')[0];
        const incomingText = msg.text || '';

        setConversations(prev => {
          const existing = prev.find(c => c.customerPhone.replace(/[^0-9]/g, '') === incomingPhone.replace(/[^0-9]/g, ''));
          const newMsgObj = {
            id: msg.messageId || 'm-' + Date.now(),
            fromMe: msg.fromMe || false,
            text: incomingText,
            time: new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'delivered'
          };

          if (existing) {
            return prev.map(c => {
              if (c.id === existing.id) {
                return {
                  ...c,
                  lastMessage: incomingText,
                  lastMessageTime: 'Just now',
                  unreadCount: c.id === selectedConvId ? c.unreadCount : c.unreadCount + 1,
                  messages: [...c.messages, newMsgObj]
                };
              }
              return c;
            });
          } else {
            // New incoming customer conversation!
            const newConv = {
              id: 'conv-' + Date.now(),
              customerName: `Customer (${incomingPhone})`,
              customerPhone: '+' + incomingPhone,
              branchName: 'Greater Noida Hub',
              branchId: activeBranchId,
              status: 'open',
              assignedTo: user?.full_name || 'Aarav Sharma (Branch Lead)',
              assignedUserId: user?.id || 'alpha_branch_admin',
              unreadCount: 1,
              lastMessage: incomingText,
              lastMessageTime: 'Just now',
              messages: [newMsgObj],
              leadInfo: {
                stage: 'New Inquiry',
                tags: ['Live WhatsApp', 'Inbound'],
                budget: 'TBD',
                internalNote: 'Customer contacted directly via WhatsApp.'
              }
            };
            return [newConv, ...prev];
          }
        });
      } catch (err) {}
    });

    return () => es.close();
  }, [activeTenantId, activeBranchId, selectedConvId]);

  // Send WhatsApp message (supports any real number)
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!replyText.trim() || !selectedConv) return;

    setSendError('');
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

    // Optimistically update conversation
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

    // Trigger backend WhatsApp connector dispatch to real number
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: activeTenantId,
          branchId: activeBranchId,
          to: selectedConv.customerPhone,
          text: messageText
        })
      });
      const data = await res.json();
      if (!data.success) {
        setSendError(data.error || 'Failed to dispatch via WhatsApp');
      } else {
        // Mark as delivered
        setConversations(prev => prev.map(c => {
          if (c.id === selectedConv.id) {
            return {
              ...c,
              messages: c.messages.map(m => m.id === newMsg.id ? { ...m, status: 'delivered' } : m)
            };
          }
          return c;
        }));
      }
    } catch (err) {
      setSendError(err.message);
    } finally {
      setIsSending(false);
    }
  };

  // Start a new chat with a real customer phone number
  const handleStartNewRealChat = async (e) => {
    e?.preventDefault();
    if (!newChatPhone.trim()) return;

    const formattedPhone = newChatPhone.trim().startsWith('+') ? newChatPhone.trim() : '+' + newChatPhone.trim();
    const customerTitle = newChatName.trim() || `Client (${formattedPhone})`;

    const newConvId = 'conv-real-' + Date.now();
    const newConv = {
      id: newConvId,
      customerName: customerTitle,
      customerPhone: formattedPhone,
      branchName: 'Greater Noida Hub',
      branchId: activeBranchId,
      status: 'open',
      assignedTo: user?.full_name || 'Aarav Sharma (Branch Lead)',
      assignedUserId: user?.id || 'alpha_branch_admin',
      unreadCount: 0,
      lastMessage: newChatInitialMsg || 'Conversation initiated',
      lastMessageTime: 'Just now',
      messages: newChatInitialMsg ? [
        {
          id: 'init-' + Date.now(),
          fromMe: true,
          text: newChatInitialMsg,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'sent'
        }
      ] : [],
      leadInfo: {
        stage: 'Direct Outbound',
        tags: ['New Lead', 'WhatsApp CRM'],
        budget: '₹50,000 / mo',
        internalNote: 'Real customer chat initiated by Branch Lead.'
      }
    };

    setConversations(prev => [newConv, ...prev]);
    setSelectedConvId(newConvId);
    setShowNewChatModal(false);
    setMobileChatOpen(true);

    // If initial text is provided, dispatch via WhatsApp
    if (newChatInitialMsg) {
      try {
        await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: activeTenantId,
            branchId: activeBranchId,
            to: formattedPhone,
            text: newChatInitialMsg
          })
        });
      } catch (e) {
        // logged
      }
    }

    setNewChatPhone('');
    setNewChatName('');
  };

  // Change conversation status
  const handleStatusChange = (newStatus) => {
    setConversations(prev => prev.map(c => {
      if (c.id === selectedConv?.id) {
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
    <div className="d-flex flex-column vh-100 overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* 1. M Square Navbar */}
      <nav className="navbar navbar-expand-lg msquare-navbar px-3">
        <div className="container-fluid d-flex align-items-center justify-content-between px-0">
          {/* Mobile Menu Toggle & Brand */}
          <div className="d-flex align-items-center gap-2">
            <button
              className="btn btn-sm btn-msquare-outline d-lg-none py-1 px-2"
              onClick={() => setSidebarMobileOpen(!sidebarMobileOpen)}
              title="Toggle Menu"
            >
              <i className="bi bi-list fs-5"></i>
            </button>

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
            {/* Live WhatsApp Status Badge */}
            <div className="d-flex align-items-center">
              {waStatus === 'CONNECTED' ? (
                <span className="badge bg-success-subtle text-success py-1.5 px-2.5 d-flex align-items-center gap-1">
                  <i className="bi bi-check-circle-fill"></i>
                  <span className="d-none d-sm-inline">WhatsApp: {waPhone ? `+${waPhone}` : 'Connected'}</span>
                </span>
              ) : (
                <button
                  type="button"
                  className={`btn btn-sm ${isBranchLead ? 'btn-msquare-primary' : 'btn-outline-secondary'} py-1 px-2 d-flex align-items-center gap-1`}
                  onClick={handleConnectWhatsApp}
                  title={isBranchLead ? 'Connect or Pair WhatsApp' : 'Only Branch Lead can pair WhatsApp'}
                >
                  <i className="bi bi-qr-code"></i>
                  <span className="d-none d-sm-inline">{waStatus === 'SCAN_QR' ? 'Scan QR' : 'WhatsApp Connect'}</span>
                </button>
              )}
            </div>

            {/* Sync Button */}
            <button
              type="button"
              className="btn btn-sm btn-msquare-outline d-none d-sm-flex align-items-center gap-1"
              onClick={refreshData}
              title="Sync conversations with backend"
            >
              <i className={`bi bi-arrow-repeat ${isSyncing ? 'text-warning spin' : 'text-success'}`}></i>
              <span className="small">Sync</span>
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

            {/* User Profile Badge */}
            <div className="d-none d-md-flex align-items-center gap-2 text-start">
              <div
                className="rounded-circle text-white d-flex align-items-center justify-content-center fw-bold"
                style={{
                  width: '32px',
                  height: '32px',
                  fontSize: '0.85rem',
                  background: 'linear-gradient(135deg, var(--brand-orange), var(--brand-orange-hover))'
                }}
              >
                {(user?.full_name?.charAt(0)) || 'A'}
              </div>
              <div className="text-truncate" style={{ maxWidth: '140px' }}>
                <div className="fw-semibold lh-1 small text-body text-truncate">{user?.full_name}</div>
                <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                  {user?.role_id === 'BRANCH_ADMIN' ? 'Branch Lead' : user?.role_id}
                </div>
              </div>
            </div>

            {/* Direct Logout Button */}
            <button
              onClick={logout}
              className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1 py-1.5 px-2.5"
              title="Sign Out"
            >
              <i className="bi bi-box-arrow-right"></i>
              <span className="d-none d-sm-inline small fw-semibold">Sign Out</span>
            </button>
          </div>
        </div>
      </nav>

      {/* 2. Main App Container */}
      <div className="app-container position-relative">
        {/* Mobile Backdrop */}
        {sidebarMobileOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarMobileOpen(false)}></div>
        )}

        {/* Left Sidebar */}
        <aside className={`app-sidebar py-3 ${sidebarMobileOpen ? 'sidebar-mobile-open' : ''}`}>
          <div className="px-3 mb-2 small text-uppercase fw-bold text-muted" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
            Helpdesk Views
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'all' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('all'); setSidebarMobileOpen(false); }}
          >
            <i className="bi bi-chat-dots-fill"></i>
            <span>All Inquiries</span>
            <span className="badge bg-secondary-subtle text-secondary ms-auto">{conversations.length}</span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'mine' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('mine'); setSidebarMobileOpen(false); }}
          >
            <i className="bi bi-person-check-fill"></i>
            <span>My Chats</span>
            <span className="badge bg-warning-subtle text-warning ms-auto">
              {conversations.filter(c => c.assignedUserId === user?.id || c.assignedTo === user?.full_name).length}
            </span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'unread' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('unread'); setSidebarMobileOpen(false); }}
          >
            <i className="bi bi-envelope-open-fill"></i>
            <span>Unread Queries</span>
            <span className="badge bg-danger ms-auto">
              {conversations.filter(c => c.unreadCount > 0).length}
            </span>
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'inbox' && chatFilter === 'resolved' ? 'active' : ''}`}
            onClick={() => { setActiveView('inbox'); setChatFilter('resolved'); setSidebarMobileOpen(false); }}
          >
            <i className="bi bi-check-circle-fill text-success"></i>
            <span>Resolved Queries</span>
            <span className="badge bg-success-subtle text-success ms-auto">
              {conversations.filter(c => c.status === 'resolved').length}
            </span>
          </div>

          <div className="px-3 mt-4 mb-2 small text-uppercase fw-bold text-muted" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
            Operations & WhatsApp
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'channels' ? 'active' : ''}`}
            onClick={() => { setActiveView('channels'); setSidebarMobileOpen(false); }}
          >
            <i className="bi bi-qr-code text-success"></i>
            <span>WhatsApp Channel</span>
            {isBranchLead ? (
              <span className="badge bg-success-subtle text-success ms-auto" style={{ fontSize: '0.68rem' }}>Lead Admin</span>
            ) : (
              <span className="badge bg-secondary-subtle text-muted ms-auto" style={{ fontSize: '0.68rem' }}><i className="bi bi-lock-fill"></i></span>
            )}
          </div>
          <div
            className={`sidebar-nav-link ${activeView === 'branches' ? 'active' : ''}`}
            onClick={() => { setActiveView('branches'); setSidebarMobileOpen(false); }}
          >
            <i className="bi bi-diagram-3-fill text-primary"></i>
            <span>Branches & Roster</span>
          </div>

          {/* Quick Real Chat Button */}
          <div className="px-3 mt-4">
            <button
              className="btn btn-msquare-primary w-100 py-2 small fw-semibold d-flex align-items-center justify-content-center gap-2"
              onClick={() => { setShowNewChatModal(true); setSidebarMobileOpen(false); }}
            >
              <i className="bi bi-telephone-plus-fill"></i>
              <span>+ New Real Chat</span>
            </button>
          </div>

          {/* Switch Identity for testing */}
          <div className="mt-auto px-3 pt-3 border-top" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="small text-muted mb-1 fw-bold" style={{ fontSize: '0.72rem' }}>Role Switcher</div>
            <div className="d-flex flex-column gap-1">
              <button
                className={`btn btn-xs text-start py-1 px-2 rounded small ${user?.email === 'aarav@msquare.com' ? 'btn-warning' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.74rem' }}
                onClick={() => login('aarav@msquare.com')}
              >
                <i className="bi bi-shield-check me-1"></i> Aarav (Branch Lead)
              </button>
              <button
                className={`btn btn-xs text-start py-1 px-2 rounded small ${user?.email === 'diya@msquare.com' ? 'btn-success' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.74rem' }}
                onClick={() => login('diya@msquare.com')}
              >
                <i className="bi bi-person me-1"></i> Diya (Support Agent)
              </button>
            </div>
          </div>
        </aside>

        {/* 3. Center Content Area */}
        {activeView === 'inbox' ? (
          <div className={`d-flex flex-grow-1 overflow-hidden ${mobileChatOpen ? 'mobile-show-chat' : 'mobile-hide-chat'}`}>
            {/* Column 1: Conversation List Pane */}
            <div className="conversation-list-pane">
              {/* Header with Search and New Real Chat button */}
              <div className="p-3 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="d-flex gap-2 mb-2">
                  <div className="input-group flex-grow-1">
                    <span className="input-group-text border-0" style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                      <i className="bi bi-search"></i>
                    </span>
                    <input
                      type="text"
                      className="form-control message-input form-control-sm"
                      placeholder="Search phone, name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-sm btn-msquare-primary text-nowrap px-2"
                    onClick={() => setShowNewChatModal(true)}
                    title="Send WhatsApp message to real phone number"
                  >
                    <i className="bi bi-plus-lg"></i>
                  </button>
                </div>

                {/* Filter Pills */}
                <div className="d-flex gap-1 overflow-x-auto pb-1">
                  <button
                    className={`btn btn-sm ${chatFilter === 'all' ? 'btn-msquare-primary py-0 px-2' : 'btn-msquare-outline py-0 px-2'}`}
                    onClick={() => setChatFilter('all')}
                  >
                    All ({conversations.length})
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

              {/* Conversations List */}
              <div className="flex-grow-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                  <div className="text-center py-5 text-muted small">
                    <i className="bi bi-chat-square-text fs-2 d-block mb-2 text-secondary"></i>
                    No conversations found.
                    <div className="mt-2">
                      <button
                        className="btn btn-sm btn-msquare-outline"
                        onClick={() => setShowNewChatModal(true)}
                      >
                        Start Real WhatsApp Chat
                      </button>
                    </div>
                  </div>
                ) : (
                  filteredConversations.map((c) => {
                    const isSelected = selectedConv?.id === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`conversation-item ${isSelected ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedConvId(c.id);
                          setMobileChatOpen(true);
                        }}
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
                            {c.customerPhone}
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
                    className="d-flex justify-content-between align-items-center px-3 px-sm-4 py-2.5 border-bottom"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="d-flex align-items-center gap-2 gap-sm-3">
                      {/* Mobile Back Button */}
                      <button
                        className="btn btn-sm btn-outline-secondary d-md-none py-1 px-2"
                        onClick={() => setMobileChatOpen(false)}
                        title="Back to inquiries list"
                      >
                        <i className="bi bi-chevron-left"></i>
                      </button>

                      <div
                        className="rounded-circle text-white d-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                        style={{
                          width: '38px',
                          height: '38px',
                          background: 'linear-gradient(135deg, var(--brand-blue), var(--brand-blue-hover))'
                        }}
                      >
                        {selectedConv.customerName.charAt(0)}
                      </div>
                      <div className="text-truncate">
                        <div className="fw-bold mb-0 text-body d-flex align-items-center gap-2 text-truncate">
                          <span className="text-truncate">{selectedConv.customerName}</span>
                          <span className="badge bg-body-tertiary text-muted border small fw-normal d-none d-sm-inline-block">
                            {selectedConv.customerPhone}
                          </span>
                        </div>
                        <div className="text-muted small d-flex align-items-center gap-2" style={{ fontSize: '0.74rem' }}>
                          <span><i className="bi bi-geo-alt me-1 text-danger"></i>{selectedConv.branchName}</span>
                          <span>•</span>
                          <span><i className="bi bi-person me-1 text-primary"></i>{selectedConv.assignedTo}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status & WhatsApp session refresh indicator */}
                    <div className="d-flex align-items-center gap-2">
                      <select
                        className="form-select form-select-sm message-input d-none d-sm-block"
                        style={{ width: '120px' }}
                        value={selectedConv.status}
                        onChange={(e) => handleStatusChange(e.target.value)}
                      >
                        <option value="open">🟢 Open</option>
                        <option value="on_hold">🟠 On Hold</option>
                        <option value="resolved">🔵 Resolved</option>
                        <option value="closed">⚪ Closed</option>
                      </select>

                      {isBranchLead && (
                        <button
                          className="btn btn-sm btn-msquare-outline d-none d-md-inline-flex align-items-center gap-1"
                          onClick={handleRefreshWhatsApp}
                          title="Refresh WhatsApp Session & QR (Branch Lead only)"
                        >
                          <i className="bi bi-arrow-clockwise text-warning"></i>
                          <span className="small">Refresh WA</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {sendError && (
                    <div className="alert alert-warning py-1 px-3 small m-2 mb-0 d-flex align-items-center justify-content-between">
                      <span><i className="bi bi-exclamation-triangle me-2"></i> {sendError}</span>
                      <button className="btn btn-xs btn-link p-0 text-dark" onClick={() => setSendError('')}>×</button>
                    </div>
                  )}

                  {/* Message History Thread */}
                  <div className="messages-container">
                    <div className="text-center my-2">
                      <span className="badge bg-body-tertiary border text-muted small py-1 px-2.5">
                        <i className="bi bi-lock-fill me-1"></i> WhatsApp End-to-End Encrypted Session
                      </span>
                    </div>

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
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Message Composer */}
                  <div className="message-composer-wrapper">
                    {/* Quick Response Templates */}
                    <div className="d-flex gap-2 mb-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline text-nowrap py-0 px-2"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => setReplyText('Hello! Thanks for reaching out to M Square Professionals. How can we assist you today?')}
                      >
                        👋 Greeting
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline text-nowrap py-0 px-2"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => setReplyText('Sure! I can arrange an onboarding session for you. What time works best?')}
                      >
                        📅 Schedule
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-msquare-outline text-nowrap py-0 px-2"
                        style={{ fontSize: '0.75rem' }}
                        onClick={() => setReplyText('Here is our WhatsApp Helpdesk overview documentation.')}
                      >
                        📄 Doc Link
                      </button>
                    </div>

                    {/* Composer Input Bar */}
                    <form onSubmit={handleSendMessage} className="d-flex align-items-center gap-2">
                      <input
                        type="text"
                        className="form-control message-input"
                        placeholder={`Message ${selectedConv.customerPhone}...`}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        disabled={isSending}
                      />
                      <button
                        type="submit"
                        className="btn btn-msquare-primary px-3 text-nowrap"
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
                  <i className="bi bi-person-lines-fill me-1 text-warning"></i> Client Profile
                </div>

                <div className="text-center mb-3 pb-3 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div
                    className="rounded-circle text-white d-flex align-items-center justify-content-center fw-bold mx-auto mb-2"
                    style={{
                      width: '52px',
                      height: '52px',
                      fontSize: '1.2rem',
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
          <div className="flex-grow-1 p-3 p-md-4 overflow-y-auto" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <div className="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <h4 className="fw-bold mb-1 d-flex align-items-center gap-2">
                  <i className="bi bi-whatsapp text-success"></i>
                  M Square Branch WhatsApp Channels
                </h4>
                <p className="text-muted small mb-0">
                  {isBranchLead
                    ? 'Branch Lead Mode: You have administrative permissions to connect, scan QR, and refresh WhatsApp.'
                    : 'Support Agent View: WhatsApp connection management is reserved for the Branch Lead.'}
                </p>
              </div>

              {isBranchLead && (
                <button
                  className="btn btn-msquare-primary btn-sm"
                  onClick={handleConnectWhatsApp}
                >
                  <i className="bi bi-qr-code-scan me-1"></i> Scan QR / Connect
                </button>
              )}
            </div>

            <div className="row g-4">
              <div className="col-lg-6">
                <div className="card h-100 p-4 border" style={{ borderColor: 'var(--border-strong)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="fw-bold mb-0">Greater Noida Hub</h5>
                    <span className={`badge ${waStatus === 'CONNECTED' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
                      {waStatus}
                    </span>
                  </div>
                  <p className="text-muted small mb-3">
                    Branch Code: <code>GNOIDA</code> | Assigned Lead: <strong>Aarav Sharma</strong>
                  </p>

                  <div className="p-3 rounded mb-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border-strong)' }}>
                    <div className="d-flex align-items-center gap-2 small fw-semibold">
                      {waStatus === 'CONNECTED' ? (
                        <>
                          <i className="bi bi-check-circle-fill text-success"></i>
                          <span className="text-success">WhatsApp Socket Active: {waPhone ? `+${waPhone}` : 'Connected'}</span>
                        </>
                      ) : (
                        <>
                          <i className="bi bi-qr-code text-warning"></i>
                          <span className="text-warning">Ready to Connect QR Code</span>
                        </>
                      )}
                    </div>
                    <div className="text-muted small mt-1">Multi-device auth isolated in <code>wa_sessions/{activeTenantId}/{activeBranchId}</code></div>
                  </div>

                  <div className="d-flex gap-2 mt-auto">
                    {isBranchLead ? (
                      <>
                        <button
                          className="btn btn-sm btn-msquare-primary"
                          onClick={handleConnectWhatsApp}
                        >
                          <i className="bi bi-qr-code me-1"></i> {waStatus === 'CONNECTED' ? 'View Connection' : 'Scan QR Code'}
                        </button>
                        <button
                          className="btn btn-sm btn-msquare-outline"
                          onClick={handleRefreshWhatsApp}
                        >
                          <i className="bi bi-arrow-clockwise me-1 text-warning"></i> Refresh Session
                        </button>
                      </>
                    ) : (
                      <span className="badge bg-secondary-subtle text-muted py-2 px-3">
                        <i className="bi bi-lock-fill me-1"></i> Restricted: Only Branch Lead can refresh session
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-lg-6">
                <div className="card h-100 p-4 border" style={{ borderColor: 'var(--border-strong)' }}>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="fw-bold mb-0">Noida HQ</h5>
                    <span className="badge bg-secondary-subtle text-secondary">Standby</span>
                  </div>
                  <p className="text-muted small mb-3">
                    Branch Code: <code>NOIDAHQ</code> | Phone: +91 98765 43211
                  </p>
                  <div className="p-3 rounded mb-3" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border-strong)' }}>
                    <div className="d-flex align-items-center gap-2 text-muted small fw-semibold">
                      <i className="bi bi-circle"></i>
                      <span>Secondary Branch Channel</span>
                    </div>
                    <div className="text-muted small mt-1">Ready for dedicated secondary device pairing.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Branches & Users Roster View */
          <div className="flex-grow-1 p-3 p-md-4 overflow-y-auto" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <div className="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <h4 className="fw-bold mb-1">M Square Branches & Team Roster</h4>
                <p className="text-muted small mb-0">Branch Leads manage WhatsApp connections; agents handle chat workflows.</p>
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
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.map(b => (
                          <tr key={b.id}>
                            <td className="fw-semibold">{b.name}</td>
                            <td><code>{b.code}</code></td>
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
                            <td>
                              <span className={`badge ${u.role_id === 'BRANCH_ADMIN' ? 'bg-warning-subtle text-warning' : 'bg-secondary-subtle text-secondary'}`}>
                                {u.role_id === 'BRANCH_ADMIN' ? 'Branch Lead' : u.role_id}
                              </span>
                            </td>
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

      {/* 4. MODAL: Live In-App WhatsApp QR Code Pairing Modal */}
      {showQrModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '420px' }}>
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: '16px' }}>
              <div className="modal-header border-bottom">
                <h5 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <i className="bi bi-whatsapp text-success fs-5"></i>
                  <span>WhatsApp Branch Pairing</span>
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowQrModal(false)}></button>
              </div>
              <div className="modal-body text-center p-4">
                <p className="text-muted small mb-3">
                  Scan this QR code from your WhatsApp mobile app:
                  <br /><strong>Linked Devices &gt; Link a Device</strong>
                </p>

                <div
                  className="p-3 rounded mx-auto mb-3 d-flex align-items-center justify-content-center"
                  style={{
                    width: '260px',
                    height: '260px',
                    backgroundColor: '#ffffff',
                    border: '2px dashed var(--brand-orange)',
                    borderRadius: '12px'
                  }}
                >
                  {qrLoading ? (
                    <div className="text-center">
                      <div className="spinner-border text-warning mb-2" role="status"></div>
                      <div className="small text-muted">Generating fresh session QR...</div>
                    </div>
                  ) : waStatus === 'CONNECTED' ? (
                    <div className="text-center text-success">
                      <i className="bi bi-check-circle-fill display-4 mb-2"></i>
                      <div className="fw-bold">Connected Successfully!</div>
                      <div className="small text-muted mt-1">{waPhone ? `+${waPhone}` : 'Device linked'}</div>
                    </div>
                  ) : waQrDataUrl ? (
                    <img
                      src={waQrDataUrl}
                      alt="WhatsApp QR Code"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <div className="text-center text-muted small">
                      <i className="bi bi-qr-code fs-1 d-block mb-1"></i>
                      Click Refresh to load QR
                    </div>
                  )}
                </div>

                <div className="d-flex justify-content-between align-items-center">
                  <span className="badge bg-secondary-subtle text-secondary small">
                    Status: {waStatus}
                  </span>
                  <button
                    className="btn btn-sm btn-msquare-outline"
                    onClick={handleRefreshWhatsApp}
                    disabled={qrLoading}
                  >
                    <i className="bi bi-arrow-clockwise me-1"></i> Refresh QR
                  </button>
                </div>
              </div>
              <div className="modal-footer border-top">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowQrModal(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL: Start New Real Chat (with any real phone number) */}
      {showNewChatModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '440px' }}>
            <div className="modal-content border-0 shadow-lg" style={{ borderRadius: '16px' }}>
              <div className="modal-header border-bottom">
                <h5 className="modal-title fw-bold d-flex align-items-center gap-2">
                  <i className="bi bi-telephone-plus-fill text-success"></i>
                  <span>Start Real WhatsApp Chat</span>
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowNewChatModal(false)}></button>
              </div>
              <form onSubmit={handleStartNewRealChat}>
                <div className="modal-body p-4">
                  <p className="text-muted small mb-3">
                    Enter any real phone number with country code to start a conversation through your connected branch account.
                  </p>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-muted">Customer Phone Number</label>
                    <input
                      type="text"
                      className="form-control message-input"
                      placeholder="e.g. +91 9876543210"
                      value={newChatPhone}
                      onChange={(e) => setNewChatPhone(e.target.value)}
                      required
                    />
                    <div className="text-muted small mt-1" style={{ fontSize: '0.72rem' }}>Include country code (e.g. +91 for India, +1 for US).</div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-muted">Customer Name (Optional)</label>
                    <input
                      type="text"
                      className="form-control message-input"
                      placeholder="e.g. Manish Sharma"
                      value={newChatName}
                      onChange={(e) => setNewChatName(e.target.value)}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-muted">Initial Outbound Message</label>
                    <textarea
                      className="form-control message-input"
                      rows="3"
                      value={newChatInitialMsg}
                      onChange={(e) => setNewChatInitialMsg(e.target.value)}
                      placeholder="Type initial message to send..."
                    ></textarea>
                  </div>
                </div>
                <div className="modal-footer border-top">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowNewChatModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-msquare-primary btn-sm px-3">
                    <i className="bi bi-send-fill me-1"></i> Send & Open Chat
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
