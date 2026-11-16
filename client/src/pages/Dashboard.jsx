import React, { useState, useEffect, useRef } from 'react';

// Backend base URL. Empty in dev (Vite proxies /api); set VITE_API_URL when the API is hosted elsewhere.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const media = (u) => (u && u.startsWith('/') ? API + u : u);

export default function Dashboard() {
  // Accounts state
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('all'); // 'all' or specific accountId
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // Chats state
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  // Messaging state
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // Attachment / Media sharing state
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [fileBase64, setFileBase64] = useState(null);
  const fileInputRef = useRef(null);

  // Modals state
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [qrModalAccount, setQrModalAccount] = useState(null);

  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatAccountId, setNewChatAccountId] = useState('');
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatText, setNewChatText] = useState('Hi! Thank you for contacting us.');
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);

  // Lightbox modal for previewing images
  const [lightboxImage, setLightboxImage] = useState(null);

  const messagesEndRef = useRef(null);

  // Helper phone formatter
  const formatPhone = (raw) => {
    if (!raw) return '';
    const digits = raw.toString().replace(/[^0-9]/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return `+${digits}`;
  };

  // Helper date formatter
  const formatTime = (isoString) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatClock = (iso) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const formatDay = (iso) => {
    const d = new Date(iso);
    const diff = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Helper file size formatter
  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 1. Load Accounts
  const fetchAccounts = async () => {
    try {
      const res = await fetch(API + '/api/accounts');
      const json = await res.json();
      if (json.success) {
        setAccounts(json.data);
        if (qrModalAccount) {
          const updated = json.data.find(a => a.id === qrModalAccount.id);
          if (updated) setQrModalAccount(updated);
        }
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // 2. Load Chats
  const fetchChats = async () => {
    try {
      const url = selectedAccountId && selectedAccountId !== 'all'
        ? `${API}/api/chats?accountId=${encodeURIComponent(selectedAccountId)}`
        : API + '/api/chats';
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setChats(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch chats:', err);
    }
  };

  // 3. Load Messages for Selected Chat
  const fetchMessages = async (chat) => {
    if (!chat) return;
    setLoadingMessages(true);
    setSendError('');
    try {
      const url = `${API}/api/chats/messages?accountId=${encodeURIComponent(chat.accountId)}&remoteJid=${encodeURIComponent(chat.remoteJid)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setMessages(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  // 4. Trigger Mobile Sync
  const handleSyncWithPhone = async () => {
    setIsManualSyncing(true);
    try {
      const targetAccountId = selectedChat?.accountId || (selectedAccountId !== 'all' ? selectedAccountId : null);
      await fetch(API + '/api/chats/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: targetAccountId,
          remoteJid: selectedChat?.remoteJid || null
        })
      });
      await fetchChats();
      if (selectedChat) await fetchMessages(selectedChat);
      setSyncNotice('Phone chats synchronized');
      setTimeout(() => setSyncNotice(''), 4000);
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsManualSyncing(false);
    }
  };

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial load
  useEffect(() => {
    fetchAccounts();
  }, []);

  // Reload chats when account filter changes
  useEffect(() => {
    fetchChats();
  }, [selectedAccountId]);

  // Auto-poll QR status while QR modal is active to ensure instant display
  useEffect(() => {
    if (!showAccountsModal || !qrModalAccount || qrModalAccount.status === 'CONNECTED') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/accounts/${qrModalAccount.id}/status`);
        const json = await res.json();
        if (json.success && json.data) {
          setQrModalAccount(prev => {
            if (!prev || prev.id !== json.data.id) return prev;
            return {
              ...prev,
              ...json.data
            };
          });

          setAccounts(prev => prev.map(a => (a.id === json.data.id ? { ...a, ...json.data } : a)));
        }
      } catch (err) {}
    }, 1500);

    return () => clearInterval(interval);
  }, [showAccountsModal, qrModalAccount?.id, qrModalAccount?.status]);

  // Reload messages when selected chat changes
  useEffect(() => {
    if (selectedChat) {
      fetchMessages(selectedChat);
      clearAttachment();
    } else {
      setMessages([]);
    }
  }, [selectedChat]);

  // 5. Real-time SSE listener
  useEffect(() => {
    const sse = new EventSource(API + '/api/events');

    sse.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        setAccounts(prev => prev.map(acc => {
          if (acc.id === data.accountId) {
            return {
              ...acc,
              status: data.status,
              phone: data.phone || acc.phone,
              name: data.name || acc.name,
              lastError: data.error || null,
              qrDataUrl: data.qrDataUrl !== undefined ? data.qrDataUrl : acc.qrDataUrl
            };
          }
          return acc;
        }));

        setQrModalAccount(prev => {
          if (prev && prev.id === data.accountId) {
            return {
              ...prev,
              status: data.status,
              phone: data.phone || prev.phone,
              lastError: data.error || null,
              qrDataUrl: data.qrDataUrl !== undefined ? data.qrDataUrl : prev.qrDataUrl
            };
          }
          return prev;
        });
      } catch (err) {}
    });

    sse.addEventListener('qr', (e) => {
      try {
        const data = JSON.parse(e.data);
        setAccounts(prev => prev.map(acc => {
          if (acc.id === data.accountId) {
            return { ...acc, status: 'SCAN_QR', qrDataUrl: data.qrDataUrl };
          }
          return acc;
        }));
        setQrModalAccount(prev => {
          if (prev && prev.id === data.accountId) {
            return { ...prev, status: 'SCAN_QR', qrDataUrl: data.qrDataUrl };
          }
          return prev;
        });
      } catch (err) {}
    });

    // Handle real-time incoming or phone-sent messages
    sse.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        fetchChats();

        setSelectedChat(currentChat => {
          if (currentChat && currentChat.accountId === msg.accountId && currentChat.remoteJid === msg.remoteJid) {
            setMessages(prev => {
              const idx = prev.findIndex(m => m.id === msg.id);
              if (idx !== -1) {
                const updated = [...prev];
                updated[idx] = msg;
                return updated;
              }
              return [...prev, msg];
            });
          }
          return currentChat;
        });
      } catch (err) {}
    });

    // Handle full history sync from phone
    sse.addEventListener('history_synced', (e) => {
      try {
        const data = JSON.parse(e.data);
        setSyncNotice(`Synced ${data.chatsCount || 0} chats from mobile phone`);
        setTimeout(() => setSyncNotice(''), 5000);
        fetchChats();
        if (selectedChat) fetchMessages(selectedChat);
      } catch (err) {}
    });

    // Handle chat updates from phone (e.g. read status, new chats)
    sse.addEventListener('chats_updated', () => {
      fetchChats();
    });

    return () => {
      sse.close();
    };
  }, []);

  // Handle file selection for sharing images/videos
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      alert('Selected file exceeds maximum allowed size (50MB). Please select a smaller file.');
      return;
    }

    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      setFileBase64(reader.result);
      if (file.type.startsWith('image/')) {
        setFilePreviewUrl(reader.result);
      } else {
        setFilePreviewUrl(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setFileBase64(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getMediaTypeFromFile = (file) => {
    if (!file) return 'document';
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'document';
  };

  // 6. Send Message (Text or Media)
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!selectedChat) return;

    const hasText = replyText.trim().length > 0;
    const hasMedia = Boolean(selectedFile && fileBase64);

    if (!hasText && !hasMedia) return;

    setIsSending(true);
    setSendError('');

    try {
      if (hasMedia) {
        const mediaType = getMediaTypeFromFile(selectedFile);
        const res = await fetch(API + '/api/messages/send-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: selectedChat.accountId,
            remoteJid: selectedChat.remoteJid,
            to: selectedChat.customerPhone,
            mediaBase64: fileBase64,
            mediaType,
            mimetype: selectedFile.type,
            fileName: selectedFile.name,
            caption: replyText.trim()
          })
        });

        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || 'Failed to send media');
        }

        clearAttachment();
        setReplyText('');
        fetchChats();
      } else {
        const res = await fetch(API + '/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: selectedChat.accountId,
            remoteJid: selectedChat.remoteJid,
            to: selectedChat.customerPhone,
            text: replyText.trim()
          })
        });

        const json = await res.json();
        if (!json.success) {
          throw new Error(json.error || 'Failed to send message');
        }

        setReplyText('');
        fetchChats();
      }
    } catch (err) {
      setSendError(err.message);
    } finally {
      setIsSending(false);
    }
  };

  // 7. Create Account & Open QR
  const handleCreateAccount = async (e) => {
    e?.preventDefault();
    if (!newAccountName.trim()) return;

    setIsCreatingAccount(true);
    try {
      const res = await fetch(API + '/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAccountName.trim() })
      });
      const json = await res.json();
      if (json.success) {
        setNewAccountName('');
        await fetchAccounts();
        setQrModalAccount(json.data);
      }
    } catch (err) {
      alert('Error creating account: ' + err.message);
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleConnectAccount = async (accId) => {
    try {
      const acc = accounts.find(a => a.id === accId);
      if (acc) setQrModalAccount(acc);
      await fetch(`${API}/api/accounts/${accId}/connect`, { method: 'POST' });
      fetchAccounts();
    } catch (err) {
      alert('Failed to connect: ' + err.message);
    }
  };

  const handleDisconnectAccount = async (accId, logout = false) => {
    if (!confirm(logout ? 'Are you sure you want to unlink and log out this WhatsApp account?' : 'Disconnect session?')) return;
    try {
      await fetch(`${API}/api/accounts/${accId}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logout })
      });
      fetchAccounts();
    } catch (err) {
      alert('Failed to disconnect: ' + err.message);
    }
  };

  const handleDeleteAccount = async (accId) => {
    if (!confirm('Are you sure you want to permanently delete this account? All session credentials and message history will be removed.')) return;
    try {
      await fetch(`${API}/api/accounts/${accId}`, { method: 'DELETE' });
      if (selectedAccountId === accId) setSelectedAccountId('all');
      if (selectedChat?.accountId === accId) setSelectedChat(null);
      fetchAccounts();
      fetchChats();
    } catch (err) {
      alert('Failed to delete account: ' + err.message);
    }
  };

  // 8. Start New Chat
  const handleStartNewChat = async (e) => {
    e?.preventDefault();
    if (!newChatAccountId) {
      alert('Please select an account to send from');
      return;
    }
    if (!newChatPhone.trim()) {
      alert('Please enter a destination phone number');
      return;
    }

    setIsStartingNewChat(true);
    try {
      const res = await fetch(API + '/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: newChatAccountId,
          to: newChatPhone.trim(),
          text: newChatText.trim()
        })
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Failed to send initial message');
      }

      setShowNewChatModal(false);
      setNewChatPhone('');
      await fetchChats();

      const account = accounts.find(a => a.id === newChatAccountId);
      setSelectedChat({
        id: `${newChatAccountId}:${json.data.remoteJid}`,
        accountId: newChatAccountId,
        accountName: account?.name || newChatAccountId,
        accountPhone: account?.phone || null,
        remoteJid: json.data.remoteJid,
        customerPhone: json.data.customerPhone || newChatPhone.trim(),
        customerName: ''
      });
    } catch (err) {
      alert('Error starting chat: ' + err.message);
    } finally {
      setIsStartingNewChat(false);
    }
  };

  const filteredChats = chats.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.customerName && c.customerName.toLowerCase().includes(q)) ||
      (c.customerPhone && c.customerPhone.toLowerCase().includes(q)) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(q)) ||
      (c.accountName && c.accountName.toLowerCase().includes(q))
    );
  });

  const connectedAccountsCount = accounts.filter(a => a.status === 'CONNECTED').length;

  return (
    <div className="wa-app">
      {/* Top Navbar */}
      <header className="navbar navbar-expand px-3 msquare-navbar">
        <div className="container-fluid p-0 d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center gap-2">
            <div className="msquare-logo-badge" style={{ width: '38px', height: '38px', fontSize: '1.1rem' }}>
              <span>M²</span>
            </div>
            <div>
              <span className="fw-bold" style={{ fontSize: '1.05rem', letterSpacing: '-0.3px' }}>WaCRM</span>
              <span className="msquare-badge ms-2 d-none d-sm-inline-block">WhatsApp Helpdesk</span>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            {/* Sync notice toast */}
            {syncNotice && (
              <span className="badge bg-success-subtle text-success border border-success-subtle py-1 px-2 d-none d-md-inline-flex align-items-center gap-1 small">
                <i className="bi bi-phone"></i>
                {syncNotice}
              </span>
            )}

            {/* Manual Sync With Phone Button */}
            <button
              className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 py-1 px-2"
              onClick={handleSyncWithPhone}
              disabled={isManualSyncing || connectedAccountsCount === 0}
              title="Sync latest chats and messages from mobile phone"
            >
              <i className={`bi bi-arrow-clockwise ${isManualSyncing ? 'spin-icon' : ''}`}></i>
              <span className="d-none d-lg-inline small">
                {isManualSyncing ? 'Syncing...' : 'Sync Mobile'}
              </span>
            </button>

            {/* Account Status Pill */}
            <button
              className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-2 py-1 px-2"
              onClick={() => setShowAccountsModal(true)}
              title="Manage WhatsApp Accounts"
            >
              <i className="bi bi-whatsapp text-success fs-6"></i>
              <span className="d-none d-md-inline small fw-semibold">
                {connectedAccountsCount} of {accounts.length} Connected
              </span>
              <span className="badge bg-secondary rounded-pill">{accounts.length}</span>
            </button>

            {/* Add Account Button */}
            <button
              className="btn btn-sm btn-msquare-primary d-flex align-items-center gap-1 py-1 px-3"
              onClick={() => setShowAccountsModal(true)}
            >
              <i className="bi bi-plus-lg"></i>
              <span className="d-none d-sm-inline small">Add Account</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className={`wa-main ${selectedChat ? 'has-chat' : ''}`}>
        {/* Left Column: Accounts & Chats Pane */}
        <div className="wa-list">
          {/* Account Filter Bar */}
          <div className="p-2 border-bottom" style={{ backgroundColor: 'var(--bg-card-header)' }}>
            <div className="d-flex align-items-center justify-content-between mb-2">
              <span className="text-secondary small fw-bold text-uppercase" style={{ fontSize: '0.75rem', letterSpacing: '0.5px' }}>
                Filter By Account
              </span>
              <div className="d-flex align-items-center gap-2">
                <button
                  className="btn btn-link btn-sm text-decoration-none p-0 small text-secondary"
                  onClick={() => setShowAccountsModal(true)}
                >
                  <i className="bi bi-gear me-1"></i>Manage
                </button>
              </div>
            </div>

            {/* Account Selector Pills */}
            <div className="d-flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              <button
                className={`btn btn-sm rounded-pill text-nowrap py-0 px-2 ${
                  selectedAccountId === 'all' ? 'btn-primary' : 'btn-outline-secondary border-0'
                }`}
                style={{ fontSize: '0.8rem' }}
                onClick={() => setSelectedAccountId('all')}
              >
                All Accounts ({chats.length})
              </button>

              {accounts.map(acc => {
                const isConn = acc.status === 'CONNECTED';
                const count = chats.filter(c => c.accountId === acc.id).length;
                return (
                  <button
                    key={acc.id}
                    className={`btn btn-sm rounded-pill text-nowrap py-0 px-2 d-flex align-items-center gap-1 ${
                      selectedAccountId === acc.id ? 'btn-primary' : 'btn-outline-secondary'
                    }`}
                    style={{ fontSize: '0.8rem' }}
                    onClick={() => setSelectedAccountId(acc.id)}
                  >
                    <span
                      className={`d-inline-block rounded-circle`}
                      style={{
                        width: '7px',
                        height: '7px',
                        backgroundColor: isConn ? '#198754' : acc.status === 'SCAN_QR' ? '#ffc107' : '#6c757d'
                      }}
                    ></span>
                    <span>{acc.name}</span>
                    <span className="badge bg-secondary-subtle text-secondary py-0 px-1 rounded-pill" style={{ fontSize: '0.7rem' }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search Bar & New Chat Button */}
          <div className="p-2 border-bottom d-flex gap-2">
            <div className="input-group input-group-sm flex-grow-1">
              <span className="input-group-text border-0 bg-transparent text-secondary">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control border-0 bg-transparent message-input"
                placeholder="Search chats, contacts, media..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="btn btn-sm text-secondary" onClick={() => setSearchQuery('')}>
                  <i className="bi bi-x"></i>
                </button>
              )}
            </div>

            <button
              className="btn btn-sm btn-outline-success d-flex align-items-center gap-1"
              title="Start New Chat"
              onClick={() => {
                if (accounts.length === 0) {
                  setShowAccountsModal(true);
                  return;
                }
                const firstConnected = accounts.find(a => a.status === 'CONNECTED') || accounts[0];
                setNewChatAccountId(firstConnected ? firstConnected.id : '');
                setShowNewChatModal(true);
              }}
            >
              <i className="bi bi-chat-plus-fill"></i>
              <span className="d-none d-lg-inline small">New</span>
            </button>
          </div>

          {/* Conversations List */}
          <div className="flex-grow-1 overflow-y-auto">
            {filteredChats.length === 0 ? (
              <div className="p-4 text-center text-muted">
                <i className="bi bi-chat-dots fs-1 d-block mb-2 text-secondary opacity-50"></i>
                <p className="small mb-2">No conversations found</p>
                {accounts.length === 0 ? (
                  <button
                    className="btn btn-sm btn-msquare-primary mt-1"
                    onClick={() => setShowAccountsModal(true)}
                  >
                    + Add WhatsApp Account
                  </button>
                ) : (
                  <div className="d-flex flex-column gap-2 align-items-center">
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={handleSyncWithPhone}
                      disabled={isManualSyncing}
                    >
                      <i className="bi bi-arrow-repeat me-1"></i>Sync Chats from Phone
                    </button>
                    <button
                      className="btn btn-sm btn-outline-success"
                      onClick={() => {
                        const firstConnected = accounts.find(a => a.status === 'CONNECTED') || accounts[0];
                        setNewChatAccountId(firstConnected ? firstConnected.id : '');
                        setShowNewChatModal(true);
                      }}
                    >
                      Start a New Chat
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredChats.map(chat => {
                const isSelected = selectedChat?.id === chat.id;
                return (
                  <div
                    key={chat.id}
                    className={`wa-row ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedChat(chat)}
                  >
                    {/* Avatar */}
                    <div className="wa-avatar">
                      {(chat.customerName || chat.customerPhone || '?').charAt(0).toUpperCase()}
                    </div>

                    {/* Chat Info */}
                    <div className="flex-grow-1 overflow-hidden">
                      <div className="d-flex justify-content-between align-items-baseline">
                        <span className="fw-semibold text-truncate">
                          {chat.customerName || formatPhone(chat.customerPhone)}
                        </span>
                        <span className="text-secondary flex-shrink-0 ms-2" style={{ fontSize: '0.72rem' }}>
                          {formatTime(chat.lastTimestamp)}
                        </span>
                      </div>

                      <div className="d-flex align-items-center justify-content-between mt-1">
                        <span className="text-muted text-truncate" style={{ fontSize: '0.84rem' }}>
                          {chat.lastFromMe ? <i className="bi bi-check2-all text-info me-1"></i> : null}
                          {chat.lastMessage}
                        </span>

                        {/* Account Badge */}
                        <span
                          className="badge bg-secondary-subtle text-secondary border px-1 py-0 rounded"
                          style={{ fontSize: '0.68rem', letterSpacing: '0.2px' }}
                          title={`Received on ${chat.accountName}`}
                        >
                          {chat.accountName}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right / Middle Column: Active Chat Thread Pane */}
        {selectedChat ? (
          <div className="wa-chat">
            {/* Active Chat Header */}
            <div className="wa-chat-header">
              <div className="d-flex align-items-center gap-2">
                <button
                  className="wa-icon-btn d-md-none"
                  onClick={() => setSelectedChat(null)}
                >
                  <i className="bi bi-arrow-left"></i>
                </button>

                <div className="wa-avatar">
                  {(selectedChat.customerName || selectedChat.customerPhone || '?').charAt(0).toUpperCase()}
                </div>

                <div>
                  <h6 className="mb-0 fw-bold">
                    {selectedChat.customerName || formatPhone(selectedChat.customerPhone)}
                  </h6>
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <span className="text-muted small" style={{ fontSize: '0.78rem' }}>
                      {formatPhone(selectedChat.customerPhone)}
                    </span>
                    <span className="text-secondary" style={{ fontSize: '0.75rem' }}>•</span>
                    <span className="msquare-badge py-0" style={{ fontSize: '0.75rem' }}>
                      <i className="bi bi-whatsapp me-1 text-success"></i>
                      Via {selectedChat.accountName}
                    </span>
                  </div>
                </div>
              </div>

              <div className="d-flex align-items-center gap-2">
                <button
                  className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1"
                  onClick={handleSyncWithPhone}
                  disabled={isManualSyncing}
                  title="Fetch older messages from phone for this chat"
                >
                  <i className={`bi bi-arrow-down-circle ${isManualSyncing ? 'spin-icon' : ''}`}></i>
                  <span className="d-none d-sm-inline small">Sync History</span>
                </button>

                <button
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => fetchMessages(selectedChat)}
                  title="Refresh chat messages"
                >
                  <i className="bi bi-arrow-clockwise"></i>
                </button>
              </div>
            </div>

            {/* Messages Thread */}
            <div
              className="wa-thread chat-thread"
            >
              {loadingMessages ? (
                <div className="d-flex justify-content-center align-items-center h-100">
                  <div className="spinner-border text-primary spinner-border-sm" role="status"></div>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-muted my-auto">
                  <i className="bi bi-chat-heart fs-1 opacity-50 d-block mb-2"></i>
                  <p className="small mb-2">No local message history yet.</p>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={handleSyncWithPhone}
                    disabled={isManualSyncing}
                  >
                    <i className="bi bi-arrow-down-circle me-1"></i>Fetch Messages from Phone
                  </button>
                </div>
              ) : (
                messages.map((m, idx) => {
                  const isMe = m.fromMe;
                  const newDay =
                    idx === 0 || new Date(messages[idx - 1].timestamp).toDateString() !== new Date(m.timestamp).toDateString();
                  return (
                    <React.Fragment key={m.id || idx}>
                    {newDay && <div className="wa-day"><span>{formatDay(m.timestamp)}</span></div>}
                    <div className={`d-flex ${isMe ? 'justify-content-end' : 'justify-content-start'}`}>
                      <div
                        className={`bubble ${isMe ? 'bubble-out' : 'bubble-in'}`}
                      >
                        {/* Media Display: IMAGE */}
                        {m.mediaType === 'image' && (
                          <div className="mb-2">
                            {media(m.mediaUrl) ? (
                              <img
                                src={media(m.mediaUrl)}
                                alt="Shared WhatsApp Image"
                                className="img-fluid rounded shadow-sm"
                                style={{ maxHeight: '320px', cursor: 'zoom-in', objectFit: 'contain' }}
                                onClick={() => setLightboxImage(media(m.mediaUrl))}
                              />
                            ) : (
                              <div className="p-2 border rounded small bg-body-tertiary text-muted">
                                <i className="bi bi-image me-1"></i> [Photo]
                              </div>
                            )}
                          </div>
                        )}

                        {/* Media Display: VIDEO */}
                        {m.mediaType === 'video' && (
                          <div className="mb-2">
                            {media(m.mediaUrl) ? (
                              <video
                                src={media(m.mediaUrl)}
                                controls
                                className="rounded shadow-sm w-100"
                                style={{ maxHeight: '320px', backgroundColor: '#000' }}
                              />
                            ) : (
                              <div className="p-2 border rounded small bg-body-tertiary text-muted">
                                <i className="bi bi-camera-video me-1"></i> [Video]
                              </div>
                            )}
                          </div>
                        )}

                        {/* Media Display: AUDIO */}
                        {m.mediaType === 'audio' && (
                          <div className="mb-2">
                            {media(m.mediaUrl) ? (
                              <audio src={media(m.mediaUrl)} controls className="w-100" style={{ minWidth: '220px' }} />
                            ) : (
                              <div className="p-2 border rounded small bg-body-tertiary text-muted">
                                <i className="bi bi-mic me-1"></i> [Voice Message]
                              </div>
                            )}
                          </div>
                        )}

                        {/* Media Display: DOCUMENT */}
                        {m.mediaType === 'document' && (
                          <div className="mb-2 p-2 rounded border bg-body-tertiary d-flex align-items-center justify-content-between gap-2">
                            <div className="d-flex align-items-center gap-2 overflow-hidden">
                              <i className="bi bi-file-earmark-text fs-4 text-primary"></i>
                              <span className="small text-truncate" style={{ maxWidth: '180px' }}>
                                {m.fileName || 'Document'}
                              </span>
                            </div>
                            {media(m.mediaUrl) && (
                              <a
                                href={media(m.mediaUrl)}
                                download={m.fileName || 'file'}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-sm btn-outline-primary py-0 px-2"
                              >
                                <i className="bi bi-download"></i>
                              </a>
                            )}
                          </div>
                        )}

                        {/* Text / Caption */}
                        {m.text && (
                          <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                            {m.text}
                          </div>
                        )}

                        {/* Timestamp & Phone-sent indicator */}
                        <div
                          className="wa-time" style={{ opacity: isMe ? 0.9 : 0.6 }}
                        >
                          <span>{formatClock(m.timestamp)}</span>
                          {isMe && <i className="bi bi-check2-all" title="Sent"></i>}
                        </div>
                      </div>
                    </div>
                    </React.Fragment>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Error banner if send failed */}
            {sendError && (
              <div className="px-3 py-2 bg-danger-subtle text-danger small d-flex align-items-center justify-content-between">
                <span>
                  <i className="bi bi-exclamation-circle-fill me-2"></i>
                  {sendError}
                </span>
                <button
                  className="btn btn-sm btn-link text-danger p-0"
                  onClick={() => handleConnectAccount(selectedChat.accountId)}
                >
                  Reconnect Account
                </button>
              </div>
            )}

            {/* Selected Attachment Preview Box */}
            {selectedFile && (
              <div
                className="p-2 border-top d-flex align-items-center justify-content-between"
                style={{ backgroundColor: 'var(--bg-card-header)' }}
              >
                <div className="d-flex align-items-center gap-2 overflow-hidden">
                  {filePreviewUrl ? (
                    <img
                      src={filePreviewUrl}
                      alt="Upload Preview"
                      style={{ width: '42px', height: '42px', objectFit: 'cover', borderRadius: '6px' }}
                    />
                  ) : (
                    <div
                      className="rounded bg-secondary text-white d-flex align-items-center justify-content-center"
                      style={{ width: '42px', height: '42px' }}
                    >
                      <i className={`bi ${selectedFile.type.startsWith('video/') ? 'bi-camera-video' : 'bi-file-earmark'}`}></i>
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <div className="small fw-semibold text-truncate" style={{ maxWidth: '280px' }}>
                      {selectedFile.name}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                      {formatFileSize(selectedFile.size)} • Ready to send
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger border-0"
                  onClick={clearAttachment}
                  title="Remove attachment"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
            )}

            {/* Reply Input Bar */}
            <form onSubmit={handleSendMessage} className="wa-composer">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                onChange={handleFileSelect}
              />
              <div className="wa-input-pill">
                <button
                  type="button"
                  className="wa-icon-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach Photo, Video or Document"
                  disabled={isSending}
                >
                  <i className="bi bi-paperclip"></i>
                </button>
                <input
                  type="text"
                  placeholder={selectedFile ? `Add caption to ${selectedFile.name}...` : 'Type a message'}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  disabled={isSending}
                />
              </div>
              <button
                type="submit"
                className="wa-send"
                disabled={isSending || (!replyText.trim() && !selectedFile)}
                title="Send"
              >
                {isSending ? (
                  <span className="spinner-border spinner-border-sm" role="status"></span>
                ) : (
                  <i className="bi bi-send-fill"></i>
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className="wa-empty">
            <div className="text-center" style={{ maxWidth: '400px' }}>
              <div
                className="msquare-logo-badge mx-auto mb-3"
                style={{ width: '64px', height: '64px', fontSize: '1.8rem' }}
              >
                <span>M²</span>
              </div>
              <h5>Mobile & Desktop WhatsApp Hub</h5>
              <p className="small text-secondary mb-4">
                Select a conversation on the left to read and reply. All messages sent or received on your phone sync automatically to this dashboard.
              </p>
              <div className="d-flex justify-content-center gap-2">
                <button
                  className="btn btn-sm btn-msquare-primary"
                  onClick={() => setShowAccountsModal(true)}
                >
                  <i className="bi bi-whatsapp me-1"></i>Manage Accounts
                </button>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={handleSyncWithPhone}
                  disabled={isManualSyncing || connectedAccountsCount === 0}
                >
                  <i className="bi bi-arrow-repeat me-1"></i>Sync Phone
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox Modal for Full Image View */}
      {lightboxImage && (
        <div
          className="modal show d-block"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1060 }}
          onClick={() => setLightboxImage(null)}
        >
          <div className="modal-dialog modal-dialog-centered modal-xl text-center">
            <div className="modal-content bg-transparent border-0">
              <div className="text-end mb-2">
                <button
                  className="btn btn-light btn-sm rounded-circle"
                  onClick={() => setLightboxImage(null)}
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
              <img
                src={lightboxImage}
                alt="Enlarged WhatsApp Media"
                className="img-fluid rounded mx-auto shadow-lg"
                style={{ maxHeight: '85vh', objectFit: 'contain' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Manage Accounts & Add Account */}
      {showAccountsModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content shadow-lg border-0" style={{ backgroundColor: 'var(--bg-card)' }}>
              <div className="modal-header border-bottom">
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-whatsapp text-success fs-5"></i>
                  <h5 className="modal-title fw-bold">WhatsApp Accounts</h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowAccountsModal(false);
                    setQrModalAccount(null);
                  }}
                ></button>
              </div>

              <div className="modal-body p-4">
                {/* Section 1: Add New Account */}
                <div className="p-3 rounded mb-4" style={{ backgroundColor: 'var(--bg-card-header)', border: '1px solid var(--border-subtle)' }}>
                  <h6 className="fw-bold mb-2">
                    <i className="bi bi-plus-circle-fill text-primary me-2"></i>
                    Add New WhatsApp Account
                  </h6>
                  <p className="small text-muted mb-3">
                    Give this WhatsApp account a label (e.g. "Personal", "Sales", "Support"). Scanning the QR code links this account and automatically syncs all existing chats, media, and phone messages.
                  </p>
                  <form onSubmit={handleCreateAccount} className="d-flex gap-2">
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder="Account Name (e.g. Sales Support)"
                      value={newAccountName}
                      onChange={e => setNewAccountName(e.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      className="btn btn-sm btn-msquare-primary text-nowrap"
                      disabled={isCreatingAccount || !newAccountName.trim()}
                    >
                      {isCreatingAccount ? (
                        <span className="spinner-border spinner-border-sm me-1"></span>
                      ) : (
                        <i className="bi bi-qr-code me-1"></i>
                      )}
                      Generate QR Code
                    </button>
                  </form>
                </div>

                {/* Section 2: Active QR Scanner if an account is in SCAN_QR state */}
                {qrModalAccount && (
                  <div className="p-4 rounded border border-success-subtle mb-4 text-center" style={{ backgroundColor: 'var(--bg-card-header)' }}>
                    <h6 className="fw-bold text-success mb-2">
                      Pair Account: {qrModalAccount.name}
                    </h6>
                    <p className="small text-muted mb-3">
                      Open WhatsApp on your phone → Settings / Menu → <strong>Linked Devices</strong> → <strong>Link a Device</strong> → Point camera at this QR code:
                    </p>

                    {qrModalAccount.status === 'CONNECTED' ? (
                      <div className="alert alert-success d-inline-block py-2 px-4 mb-0">
                        <i className="bi bi-check-circle-fill me-2 fs-5"></i>
                        <strong>Connected Successfully!</strong> Phone: {qrModalAccount.phone || 'Ready'}
                      </div>
                    ) : qrModalAccount.qrDataUrl ? (
                      <div className="d-flex flex-column align-items-center">
                        <div className="p-2 bg-white rounded shadow-sm d-inline-block mb-3">
                          <img
                            src={qrModalAccount.qrDataUrl}
                            alt="WhatsApp Web QR Code"
                            style={{ width: '220px', height: '220px', display: 'block' }}
                          />
                        </div>
                        <span className="badge bg-warning text-dark small py-1 px-3">
                          <span className="spinner-grow spinner-grow-sm me-1"></span>
                          Waiting for phone to scan...
                        </span>
                      </div>
                    ) : (
                      <div className="py-4">
                        <div className="spinner-border text-success mb-2" role="status"></div>
                        <p className="small text-muted">Initializing WhatsApp socket and generating QR code...</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Section 3: Existing Accounts Table */}
                <h6 className="fw-bold mb-3">Connected Accounts ({accounts.length})</h6>
                {loadingAccounts ? (
                  <div className="text-center py-3">
                    <div className="spinner-border text-primary spinner-border-sm" role="status"></div>
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="text-center py-4 text-muted border rounded">
                    <p className="small mb-0">No WhatsApp accounts linked yet. Use the form above to add your first account!</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle small mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Account Name</th>
                          <th>Phone Number</th>
                          <th>Status</th>
                          <th className="text-end">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map(acc => {
                          const isConn = acc.status === 'CONNECTED';
                          return (
                            <tr key={acc.id}>
                              <td>
                                <strong className="d-block">{acc.name}</strong>
                                <span className="text-secondary" style={{ fontSize: '0.72rem' }}>ID: {acc.id}</span>
                              </td>
                              <td>{acc.phone ? formatPhone(acc.phone) : '—'}</td>
                              <td>
                                {isConn ? (
                                  <span className="badge bg-success-subtle text-success border border-success-subtle">
                                    <i className="bi bi-check-circle-fill me-1"></i>Connected
                                  </span>
                                ) : acc.status === 'SCAN_QR' ? (
                                  <span className="badge bg-warning-subtle text-warning border border-warning-subtle">
                                    <i className="bi bi-qr-code me-1"></i>Scan QR Code
                                  </span>
                                ) : (
                                  <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle">
                                    Disconnected
                                  </span>
                                )}
                              </td>
                              <td className="text-end">
                                <div className="btn-group btn-group-sm">
                                  {!isConn && (
                                    <button
                                      className="btn btn-outline-primary"
                                      onClick={() => handleConnectAccount(acc.id)}
                                      title="Scan QR / Reconnect"
                                    >
                                      <i className="bi bi-qr-code"></i> Connect
                                    </button>
                                  )}
                                  {isConn && (
                                    <button
                                      className="btn btn-outline-warning"
                                      onClick={() => handleDisconnectAccount(acc.id, false)}
                                      title="Disconnect socket"
                                    >
                                      Disconnect
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-outline-danger"
                                    onClick={() => handleDeleteAccount(acc.id)}
                                    title="Unlink & Delete Account"
                                  >
                                    <i className="bi bi-trash"></i>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="modal-footer border-top">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowAccountsModal(false);
                    setQrModalAccount(null);
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: New Real Chat */}
      {showNewChatModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content shadow-lg border-0" style={{ backgroundColor: 'var(--bg-card)' }}>
              <div className="modal-header border-bottom">
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-chat-plus-fill text-success fs-5"></i>
                  <h5 className="modal-title fw-bold">Start New WhatsApp Chat</h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowNewChatModal(false)}
                ></button>
              </div>

              <form onSubmit={handleStartNewChat}>
                <div className="modal-body p-4">
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">Send From Account</label>
                    <select
                      className="form-select form-select-sm"
                      value={newChatAccountId}
                      onChange={e => setNewChatAccountId(e.target.value)}
                      required
                    >
                      <option value="" disabled>-- Select an Account --</option>
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.phone || acc.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">Customer Phone Number</label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text">
                        <i className="bi bi-telephone"></i>
                      </span>
                      <input
                        type="tel"
                        className="form-control"
                        placeholder="e.g. +91 98765 43210 or 9876543210"
                        value={newChatPhone}
                        onChange={e => setNewChatPhone(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-text" style={{ fontSize: '0.75rem' }}>
                      Include country code (e.g. +91 for India, +1 for US).
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small fw-semibold">Initial Message</label>
                    <textarea
                      className="form-control form-control-sm"
                      rows="3"
                      value={newChatText}
                      onChange={e => setNewChatText(e.target.value)}
                      required
                    ></textarea>
                  </div>
                </div>

                <div className="modal-footer border-top">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowNewChatModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-msquare-primary btn-sm"
                    disabled={isStartingNewChat}
                  >
                    {isStartingNewChat ? (
                      <span className="spinner-border spinner-border-sm me-1"></span>
                    ) : (
                      <i className="bi bi-send-fill me-1"></i>
                    )}
                    Send & Open Chat
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
