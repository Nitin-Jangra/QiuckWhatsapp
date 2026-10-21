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
  const activeTenantId = user?.tenant_id || '11111111-1111-4000-8000-000000000001';
  const activeBranchId = user?.branch_id || 'aaaaaaaa-0001-4000-8000-000000000001';

  // Live WhatsApp Socket State
  const [waStatus, setWaStatus] = useState('DISCONNECTED'); // DISCONNECTED, SCAN_QR, CONNECTED, CONNECTING
  const [waQrDataUrl, setWaQrDataUrl] = useState(null);
  const [waPhone, setWaPhone] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);

  // Backend Data
  const [branches, setBranches] = useState([]);
  const [usersList, setUsersList] = useState([]);

  // Phone number normalization & display helpers
  const cleanPhoneDigits = (raw) => {
    if (!raw) return '';
    return raw.toString().split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  };

  const formatDisplayPhone = (raw) => {
    const digits = cleanPhoneDigits(raw);
    if (!digits) return raw || '';
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return `+${digits}`;
  };

  // Conversations State (Real WhatsApp conversations only - no hardcoded fakes)
  const [conversations, setConversations] = useState([]);
  const [selectedConvId, setSelectedConvId] = useState(null);
  const [chatFilter, setChatFilter] = useState('all'); // 'all', 'mine', 'unread', 'resolved'
  const [agentFilter, setAgentFilter] = useState('all'); // 'all' or agent user id (for Branch Lead)
  const [searchQuery, setSearchQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [transferNotice, setTransferNotice] = useState('');

  // New Real Chat Modal State
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatInitialMsg, setNewChatInitialMsg] = useState('Hi! Thank you for contacting M Square Professionals.');

  const messagesEndRef = useRef(null);

  // Workload balancer: auto-assign incoming chats to the agent with the lowest open workload
  const getLeastLoadedAgent = (currentConvs) => {
    const branchAgents = usersList.filter(u => u.branch_id === activeBranchId && u.role_id === 'AGENT');
    if (branchAgents.length === 0) {
      return { id: 'alpha_employee', full_name: 'Diya Patel (Helpdesk Specialist)', role_id: 'AGENT' };
    }
    const counts = {};
    branchAgents.forEach(a => { counts[a.id] = 0; });
    (currentConvs || []).forEach(c => {
      if (c.status !== 'resolved' && counts[c.assignedUserId] !== undefined) {
        counts[c.assignedUserId]++;
      }
    });
    const sorted = [...branchAgents].sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0));
    return sorted[0];
  };

  // Filter conversations with strict agent isolation
  const filteredConversations = conversations.filter(c => {
    // 1. Strict Agent Isolation: Non-lead employees can ONLY see chats assigned to them in their branch
    if (!isBranchLead && user) {
      const isAssigned = c.assignedUserId === user.id || c.assignedTo === user.full_name;
      const isCurrentBranch = !c.branchId || c.branchId === activeBranchId;
      if (!isAssigned || !isCurrentBranch) return false;
    }

    // 2. Branch Lead: Filter by Agent
    if (isBranchLead && agentFilter !== 'all') {
      if (c.assignedUserId !== agentFilter && c.assignedTo !== agentFilter) return false;
    }

    // 3. Status/View filters
    if (chatFilter === 'mine' && user) {
      if (c.assignedUserId !== user.id && c.assignedTo !== user.full_name) return false;
    }
    if (chatFilter === 'unread' && c.unreadCount === 0) return false;
    if (chatFilter === 'resolved' && c.status !== 'resolved') return false;

    // 4. Search query
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

  // Selected conversation must strictly come from filtered list to preserve agent privacy
  const selectedConv = filteredConversations.find(c => c.id === selectedConvId) || filteredConversations[0] || null;

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

  // Load live branches, users, and message history from Express API
  const refreshData = async () => {
    setIsSyncing(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [bRes, uRes, mRes] = await Promise.all([
        fetch('/api/branches', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/users', { headers }).then(r => r.json()).catch(() => ({})),
        fetch(`/api/whatsapp/messages?tenantId=${activeTenantId}&branchId=${activeBranchId}`).then(r => r.json()).catch(() => ({}))
      ]);
      if (bRes.success) setBranches(bRes.data || []);
      if (uRes.success) setUsersList(uRes.data || []);

      // If backend has real messages, reconstruct conversations
      if (mRes.success && Array.isArray(mRes.data) && mRes.data.length > 0) {
        setConversations(prev => {
          if (prev.length > 0) return prev; // Do not overwrite active state
          const map = new Map();
          const sorted = [...mRes.data].reverse();
          for (const msg of sorted) {
            const digits = cleanPhoneDigits(msg.customerPhone || msg.remoteJid);
            if (!digits) continue;
            // Filter out empty messages and internal WhatsApp self-device syncs
            if (!msg.text || !msg.text.trim()) continue;
            if (digits === '141382521979108' || (msg.remoteJid && msg.remoteJid.endsWith('@lid') && msg.fromMe)) continue;
            const cPhone = `+${digits}`;
            const dPhone = formatDisplayPhone(digits);
            if (!map.has(digits)) {
              const displayName = msg.pushName ? `${msg.pushName} (${dPhone})` : `Customer (${dPhone})`;
              const branchAgents = (uRes.data || []).filter(u => u.branch_id === activeBranchId && u.role_id === 'AGENT');
              const assignedAgent = branchAgents.length > 0
                ? branchAgents[map.size % branchAgents.length]
                : { id: 'alpha_employee', full_name: 'Diya Patel (Helpdesk Specialist)' };
              map.set(digits, {
                id: 'conv-' + digits,
                customerName: displayName,
                customerPhone: cPhone,
                remoteJid: msg.remoteJid || null,
                branchName: 'Greater Noida Hub',
                branchId: activeBranchId,
                status: 'open',
                assignedTo: assignedAgent.full_name,
                assignedUserId: assignedAgent.id,
                unreadCount: 0,
                lastMessage: msg.text || '',
                lastMessageTime: new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                messages: [],
                leadInfo: {
                  stage: 'WhatsApp Inbound',
                  tags: ['Live WhatsApp'],
                  budget: 'TBD',
                  internalNote: `Live WhatsApp conversation assigned to ${assignedAgent.full_name}.`
                }
              });
            }
            const conv = map.get(digits);
            conv.lastMessage = msg.text || '';
            conv.lastMessageTime = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (!conv.messages.some(m => m.id === msg.messageId)) {
              conv.messages.push({
                id: msg.messageId || 'm-' + Date.now(),
                fromMe: msg.fromMe || false,
                text: msg.text || '',
                time: new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'delivered'
              });
            }
          }
          const loaded = Array.from(map.values());
          if (loaded.length > 0 && !selectedConvId) {
            setSelectedConvId(loaded[0].id);
          }
          return loaded;
        });
      }

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

  // Real-Time Server-Sent Events (SSE) Listener for live QR & real WhatsApp messages
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
        const incomingDigits = cleanPhoneDigits(msg.customerPhone || msg.remoteJid);
        const incomingText = msg.text || '';
        // Completely ignore empty messages and internal self-device frames
        if (!incomingText.trim()) return;
        if (incomingDigits === '141382521979108' || (msg.remoteJid && msg.remoteJid.endsWith('@lid') && msg.fromMe)) return;

        const canonicalPhone = `+${incomingDigits}`;
        const displayPhone = formatDisplayPhone(incomingDigits);

        // Auto-assign chat to branch agent (e.g., Diya Patel)
        const branchAgent = usersList.find(u => u.branch_id === activeBranchId && u.role_id === 'AGENT')
          || usersList.find(u => u.role_id === 'AGENT')
          || { full_name: 'Diya Patel (Helpdesk Specialist)', id: 'alpha_employee' };

        setConversations(prev => {
          const existing = prev.find(c => cleanPhoneDigits(c.customerPhone) === incomingDigits);
          const newMsgObj = {
            id: msg.messageId || 'm-' + Date.now(),
            fromMe: msg.fromMe || false,
            text: incomingText,
            time: new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'delivered'
          };

          if (existing) {
            // Deduplication: reconcile optimistic messages with real Baileys echo to prevent double bubbles
            const isDuplicate = existing.messages.some(m =>
              m.id === newMsgObj.id ||
              (m.fromMe && newMsgObj.fromMe && m.text === newMsgObj.text)
            );

            if (isDuplicate) {
              return prev.map(c => {
                if (c.id === existing.id) {
                  return {
                    ...c,
                    remoteJid: c.remoteJid || msg.remoteJid,
                    customerName: (msg.pushName && c.customerName.startsWith('Customer (')) ? `${msg.pushName} (${displayPhone})` : c.customerName,
                    messages: c.messages.map(m =>
                      (m.id === newMsgObj.id || (m.fromMe && newMsgObj.fromMe && m.text === newMsgObj.text))
                        ? { ...m, id: newMsgObj.id, status: 'delivered' }
                        : m
                    )
                  };
                }
                return c;
              });
            }

            return prev.map(c => {
              if (c.id === existing.id) {
                return {
                  ...c,
                  remoteJid: c.remoteJid || msg.remoteJid,
                  customerName: (msg.pushName && c.customerName.startsWith('Customer (')) ? `${msg.pushName} (${displayPhone})` : c.customerName,
                  lastMessage: incomingText,
                  lastMessageTime: 'Just now',
                  unreadCount: (!msg.fromMe && c.id !== selectedConvId) ? c.unreadCount + 1 : c.unreadCount,
                  messages: [...c.messages, newMsgObj]
                };
              }
              return c;
            });
          } else {
            // New incoming customer conversation: auto-assign via workload balancer across branch agents!
            const assignedAgent = getLeastLoadedAgent(prev);
            const displayName = msg.pushName ? `${msg.pushName} (${displayPhone})` : `Customer (${displayPhone})`;
            const newConv = {
              id: 'conv-' + incomingDigits,
              customerName: displayName,
              customerPhone: canonicalPhone,
              remoteJid: msg.remoteJid || null,
              branchName: 'Greater Noida Hub',
              branchId: activeBranchId,
              status: 'open',
              assignedTo: assignedAgent.full_name,
              assignedUserId: assignedAgent.id,
              unreadCount: msg.fromMe ? 0 : 1,
              lastMessage: incomingText,
              lastMessageTime: 'Just now',
              messages: [newMsgObj],
              leadInfo: {
                stage: 'New Inquiry',
                tags: ['Live WhatsApp', 'Inbound'],
                budget: 'TBD',
                internalNote: `Incoming customer inquiry auto-assigned to ${assignedAgent.full_name}.`
              }
            };

            // Auto-select conversation if none active
            setSelectedConvId(prevId => prevId || newConv.id);
            return [newConv, ...prev];
          }
        });
      } catch (err) {
        console.error('Error handling SSE message event:', err);
      }
    });

    return () => es.close();
  }, [activeTenantId, activeBranchId, selectedConvId, usersList]);

  // Lead only: Reassign conversation to another employee in the SAME branch
  const handleAssignAgent = (convId, agent) => {
    if (!isBranchLead) {
      alert('Access Restricted: Only Branch Lead can reassign chats within this branch.');
      return;
    }
    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return {
          ...c,
          assignedTo: agent.full_name,
          assignedUserId: agent.id,
          leadInfo: {
            ...c.leadInfo,
            internalNote: `${c.leadInfo?.internalNote || ''}\n[Reassigned to ${agent.full_name} by Branch Lead at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]`.trim()
          }
        };
      }
      return c;
    }));
    setTransferNotice(`Chat reassigned to ${agent.full_name}`);
    setTimeout(() => setTransferNotice(''), 3500);
  };

  // Transfer conversation to ANOTHER branch (Allowed for both Lead and Regular Agent)
  const handleTransferBranch = (convId, targetBranch) => {
    if (targetBranch.id === activeBranchId) {
      alert('Please select a different branch to transfer.');
      return;
    }
    setConversations(prev => prev.map(c => {
      if (c.id === convId) {
        return {
          ...c,
          branchId: targetBranch.id,
          branchName: targetBranch.name,
          assignedTo: `Transferred (${targetBranch.name} Queue)`,
          assignedUserId: null,
          leadInfo: {
            ...c.leadInfo,
            stage: 'Transferred Branch',
            internalNote: `${c.leadInfo?.internalNote || ''}\n[Transferred to ${targetBranch.name} by ${user?.full_name || 'Agent'} at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]`.trim()
          }
        };
      }
      return c;
    }));
    setTransferNotice(`Chat successfully transferred to ${targetBranch.name}`);
    setTimeout(() => setTransferNotice(''), 4000);
  };

  // Delete / Remove a conversation
  const handleDeleteConversation = async (convId, e) => {
    e?.stopPropagation();
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;

    if (!window.confirm(`Are you sure you want to remove the conversation with ${conv.customerName}?`)) {
      return;
    }

    setConversations(prev => prev.filter(c => c.id !== convId));
    if (selectedConvId === convId) {
      setSelectedConvId(null);
    }

    try {
      await fetch(`/api/whatsapp/messages?tenantId=${activeTenantId}&branchId=${activeBranchId}&phone=${encodeURIComponent(conv.customerPhone)}`, {
        method: 'DELETE'
      });
    } catch (err) {}

    setTransferNotice(`Removed conversation with ${conv.customerName}`);
    setTimeout(() => setTransferNotice(''), 3000);
  };

  // Send WhatsApp message back to customer
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!replyText.trim() || !selectedConv) return;

    setSendError('');
    const messageText = replyText.trim();
    setReplyText('');
    setIsSending(true);

    const newMsgId = 'm-' + Date.now();
    const newMsg = {
      id: newMsgId,
      fromMe: true,
      text: messageText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sending'
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

    // Trigger backend WhatsApp connector dispatch to real customer phone
    try {
      const cleanTargetPhone = cleanPhoneDigits(selectedConv.customerPhone);
      const targetDestination = selectedConv.remoteJid || (cleanTargetPhone ? `+${cleanTargetPhone}` : selectedConv.customerPhone);
      if (!targetDestination) {
        throw new Error('Destination phone number or WhatsApp JID is invalid.');
      }

      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: activeTenantId,
          branchId: activeBranchId,
          to: targetDestination,
          remoteJid: selectedConv.remoteJid || null,
          text: messageText
        })
      });
      const data = await res.json();
      if (!data.success) {
        const errMsg = data.error || 'Failed to dispatch via WhatsApp';
        setSendError(errMsg);
        // Mark message status as failed
        setConversations(prev => prev.map(c => {
          if (c.id === selectedConv.id) {
            return {
              ...c,
              messages: c.messages.map(m => m.id === newMsgId ? { ...m, status: 'failed' } : m)
            };
          }
          return c;
        }));
      } else {
        // Mark as delivered and reconcile real WhatsApp messageId
        const realId = data.data?.messageId || newMsgId;
        setConversations(prev => prev.map(c => {
          if (c.id === selectedConv.id) {
            return {
              ...c,
              messages: c.messages.map(m => m.id === newMsgId ? { ...m, id: realId, status: 'delivered' } : m)
            };
          }
          return c;
        }));
      }
    } catch (err) {
      setSendError(err.message || 'Network error sending WhatsApp message');
      setConversations(prev => prev.map(c => {
        if (c.id === selectedConv.id) {
          return {
            ...c,
            messages: c.messages.map(m => m.id === newMsgId ? { ...m, status: 'failed' } : m)
          };
        }
        return c;
      }));
    } finally {
      setIsSending(false);
    }
  };

  // Start a new chat with a real customer phone number
  const handleStartNewRealChat = async (e) => {
    e?.preventDefault();
    if (!newChatPhone.trim()) return;

    const digits = cleanPhoneDigits(newChatPhone);
    if (!digits) {
      alert('Please enter a valid phone number with country code (e.g. 919053229254)');
      return;
    }

    const canonicalPhone = `+${digits}`;
    const displayPhone = formatDisplayPhone(digits);
    const customerTitle = newChatName.trim() || `Customer (${displayPhone})`;

    // Check if conversation already exists
    const existing = conversations.find(c => cleanPhoneDigits(c.customerPhone) === digits);
    if (existing) {
      setSelectedConvId(existing.id);
      setShowNewChatModal(false);
      setMobileChatOpen(true);
      return;
    }

    const assignedAgent = (!isBranchLead && user)
      ? { full_name: user.full_name, id: user.id }
      : getLeastLoadedAgent(conversations);

    const newConvId = 'conv-' + digits;
    const newConv = {
      id: newConvId,
      customerName: customerTitle,
      customerPhone: canonicalPhone,
      branchName: 'Greater Noida Hub',
      branchId: activeBranchId,
      status: 'open',
      assignedTo: assignedAgent.full_name,
      assignedUserId: assignedAgent.id,
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
        budget: 'TBD',
        internalNote: `Real chat initiated by ${user?.full_name || 'Team'}. Assigned to ${assignedAgent.full_name}.`
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
            to: canonicalPhone,
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
              ) : isBranchLead ? (
                <button
                  type="button"
                  className="btn btn-sm btn-msquare-primary py-1 px-2 d-flex align-items-center gap-1"
                  onClick={handleConnectWhatsApp}
                  title="Connect or Pair WhatsApp (Branch Lead only)"
                >
                  <i className="bi bi-qr-code"></i>
                  <span className="d-none d-sm-inline">{waStatus === 'SCAN_QR' ? 'Scan QR' : 'WhatsApp Connect'}</span>
                </button>
              ) : (
                <span className="badge bg-secondary-subtle text-muted py-1.5 px-2.5 small d-flex align-items-center gap-1">
                  <i className="bi bi-circle-fill text-secondary" style={{ fontSize: '0.45rem' }}></i>
                  <span className="d-none d-sm-inline">WhatsApp Offline</span>
                </span>
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

          {isBranchLead && (
            <>
              <div className="px-3 mt-4 mb-2 small text-uppercase fw-bold text-muted" style={{ fontSize: '0.72rem', letterSpacing: '0.5px' }}>
                Operations & WhatsApp
              </div>
              <div
                className={`sidebar-nav-link ${activeView === 'channels' ? 'active' : ''}`}
                onClick={() => { setActiveView('channels'); setSidebarMobileOpen(false); }}
              >
                <i className="bi bi-qr-code text-success"></i>
                <span>WhatsApp Channel</span>
                <span className="badge bg-success-subtle text-success ms-auto" style={{ fontSize: '0.68rem' }}>Lead Admin</span>
              </div>
              <div
                className={`sidebar-nav-link ${activeView === 'branches' ? 'active' : ''}`}
                onClick={() => { setActiveView('branches'); setSidebarMobileOpen(false); }}
              >
                <i className="bi bi-diagram-3-fill text-primary"></i>
                <span>Branches & Roster</span>
              </div>
            </>
          )}

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
            <div className="small text-muted mb-1 fw-bold" style={{ fontSize: '0.72rem' }}>Role Switcher (Testing)</div>
            <div className="d-flex flex-column gap-1">
              <button
                className={`btn btn-xs text-start py-1 px-2 rounded small ${user?.email === 'aarav@msquare.com' ? 'btn-warning' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.74rem' }}
                onClick={() => login('aarav@msquare.com')}
                title="Branch Lead: Can see all chats, filter by agent, reassign to same branch, manage WhatsApp"
              >
                <i className="bi bi-shield-check me-1"></i> Aarav (Branch Lead)
              </button>
              <button
                className={`btn btn-xs text-start py-1 px-2 rounded small ${user?.email === 'diya@msquare.com' ? 'btn-success' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.74rem' }}
                onClick={() => login('diya@msquare.com')}
                title="Agent 1: Can only see own assigned chats, can only transfer to another branch"
              >
                <i className="bi bi-person me-1"></i> Diya (Agent 1)
              </button>
              <button
                className={`btn btn-xs text-start py-1 px-2 rounded small ${user?.email === 'rohan@msquare.com' ? 'btn-success' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.74rem' }}
                onClick={() => login('rohan@msquare.com')}
                title="Agent 2: Can only see own assigned chats, can only transfer to another branch"
              >
                <i className="bi bi-person me-1"></i> Rohan (Agent 2)
              </button>
              <button
                className={`btn btn-xs text-start py-1 px-2 rounded small ${user?.email === 'kavita@msquare.com' ? 'btn-success' : 'btn-outline-secondary'}`}
                style={{ fontSize: '0.74rem' }}
                onClick={() => login('kavita@msquare.com')}
                title="Agent 3: Can only see own assigned chats, can only transfer to another branch"
              >
                <i className="bi bi-person me-1"></i> Kavita (Agent 3)
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
                <div className="d-flex gap-1 overflow-x-auto pb-1 mb-2">
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

                {/* Branch Lead: Filter by Agent */}
                {isBranchLead ? (
                  <div className="pt-2 border-top" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <span className="small text-muted fw-bold" style={{ fontSize: '0.72rem' }}>
                        <i className="bi bi-funnel-fill text-warning me-1"></i> Filter by Agent (Lead):
                      </span>
                      {agentFilter !== 'all' && (
                        <button
                          className="btn btn-link btn-xs p-0 text-muted"
                          style={{ fontSize: '0.7rem' }}
                          onClick={() => setAgentFilter('all')}
                        >
                          Show All
                        </button>
                      )}
                    </div>
                    <select
                      className="form-select form-select-sm message-input"
                      style={{ fontSize: '0.78rem' }}
                      value={agentFilter}
                      onChange={(e) => setAgentFilter(e.target.value)}
                    >
                      <option value="all">👥 All Agents ({conversations.length} total)</option>
                      {(usersList.length > 0 ? usersList.filter(u => u.branch_id === activeBranchId && u.role_id === 'AGENT') : [
                        { id: 'alpha_employee', full_name: 'Diya Patel (Helpdesk Specialist)' },
                        { id: 'alpha_agent_rohan', full_name: 'Rohan Mehta (Support Specialist)' },
                        { id: 'alpha_agent_kavita', full_name: 'Kavita Sen (Customer Success)' }
                      ]).map(agent => {
                        const count = conversations.filter(c => c.assignedUserId === agent.id).length;
                        return (
                          <option key={agent.id} value={agent.id}>
                            👤 {agent.full_name} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ) : (
                  <div className="pt-2 border-top" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="py-1 px-2 rounded bg-body-tertiary border d-flex align-items-center justify-content-between">
                      <span className="small text-muted" style={{ fontSize: '0.72rem' }}>
                        <i className="bi bi-shield-lock-fill text-success me-1"></i> Isolated Inbox (Mine Only)
                      </span>
                      <span className="badge bg-success-subtle text-success small">{filteredConversations.length}</span>
                    </div>
                  </div>
                )}
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
                          <span className="fw-semibold text-truncate text-body" style={{ maxWidth: '170px' }}>
                            {c.customerName}
                          </span>
                          <div className="d-flex align-items-center gap-1">
                            <span className="text-muted small" style={{ fontSize: '0.72rem' }}>
                              {c.lastMessageTime}
                            </span>
                            <button
                              className="btn btn-xs btn-link text-muted p-0 ms-1 opacity-50 hover-opacity-100"
                              title="Delete conversation"
                              onClick={(e) => handleDeleteConversation(c.id, e)}
                            >
                              <i className="bi bi-x-circle text-danger" style={{ fontSize: '0.85rem' }}></i>
                            </button>
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-1 mb-1">
                          <span className="badge bg-body-tertiary border text-body" style={{ fontSize: '0.68rem' }}>
                            {formatDisplayPhone(c.customerPhone)}
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
                            {formatDisplayPhone(selectedConv.customerPhone)}
                          </span>
                        </div>
                        <div className="text-muted small d-flex align-items-center gap-2" style={{ fontSize: '0.74rem' }}>
                          <span><i className="bi bi-geo-alt me-1 text-danger"></i>{selectedConv.branchName}</span>
                          <span>•</span>
                          <span><i className="bi bi-person me-1 text-primary"></i>{selectedConv.assignedTo}</span>
                        </div>
                      </div>
                    </div>

                    {/* Agent Assignment & Transfer Controls */}
                    <div className="d-flex align-items-center gap-2">
                      {/* Branch Lead: Can reassign conversation to another employee in the SAME branch */}
                      {isBranchLead ? (
                        <div className="dropdown d-none d-sm-block">
                          <button
                            className="btn btn-sm btn-outline-secondary dropdown-toggle d-flex align-items-center gap-1 py-1 px-2"
                            type="button"
                            data-bs-toggle="dropdown"
                            aria-expanded="false"
                            style={{ fontSize: '0.78rem' }}
                            title="Reassign to another agent in this branch"
                          >
                            <i className="bi bi-person-gear text-primary"></i>
                            <span className="text-truncate" style={{ maxWidth: '140px' }}>
                              {selectedConv.assignedTo || 'Assign Agent'}
                            </span>
                          </button>
                          <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ fontSize: '0.82rem' }}>
                            <li className="dropdown-header small text-muted">Reassign to Same Branch Agent</li>
                            {(usersList.length > 0 ? usersList.filter(u => u.branch_id === activeBranchId && u.role_id === 'AGENT') : [
                              { id: 'alpha_employee', full_name: 'Diya Patel (Helpdesk Specialist)' },
                              { id: 'alpha_agent_rohan', full_name: 'Rohan Mehta (Support Specialist)' },
                              { id: 'alpha_agent_kavita', full_name: 'Kavita Sen (Customer Success)' }
                            ]).map(agent => (
                              <li key={agent.id}>
                                <button
                                  className={`dropdown-item d-flex align-items-center justify-content-between ${selectedConv.assignedUserId === agent.id ? 'active' : ''}`}
                                  onClick={() => handleAssignAgent(selectedConv.id, agent)}
                                >
                                  <span>{agent.full_name}</span>
                                  {selectedConv.assignedUserId === agent.id && (
                                    <span className="badge bg-primary-subtle text-primary small ms-2">Current</span>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="d-none d-sm-flex align-items-center gap-1 py-1 px-2 rounded border bg-body-tertiary small text-muted" style={{ fontSize: '0.75rem' }}>
                          <i className="bi bi-person-check-fill text-success"></i>
                          <span className="text-truncate" style={{ maxWidth: '130px' }}>Assigned to You</span>
                        </div>
                      )}

                      {/* Transfer to Another Branch Dropdown (Available to both Lead and Regular Agent) */}
                      <div className="dropdown d-none d-sm-block">
                        <button
                          className="btn btn-sm btn-outline-warning dropdown-toggle d-flex align-items-center gap-1 py-1 px-2"
                          type="button"
                          data-bs-toggle="dropdown"
                          aria-expanded="false"
                          style={{ fontSize: '0.78rem' }}
                          title="Transfer conversation to another branch"
                        >
                          <i className="bi bi-arrow-left-right text-warning"></i>
                          <span className="d-none d-md-inline">Transfer Branch</span>
                        </button>
                        <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ fontSize: '0.82rem' }}>
                          <li className="dropdown-header small text-muted">Transfer to Another Branch</li>
                          {(branches.length > 0 ? branches.filter(b => b.id !== activeBranchId) : [
                            { id: 'aaaaaaaa-0002-4000-8000-000000000002', name: 'Noida HQ' },
                            { id: 'aaaaaaaa-0003-4000-8000-000000000003', name: 'Gurugram Central' }
                          ]).map(b => (
                            <li key={b.id}>
                              <button
                                className="dropdown-item d-flex align-items-center justify-content-between"
                                onClick={() => handleTransferBranch(selectedConv.id, b)}
                              >
                                <span><i className="bi bi-building me-1 text-primary"></i>{b.name}</span>
                                <span className="badge bg-light text-muted small ms-2">Transfer</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <select
                        className="form-select form-select-sm message-input d-none d-sm-block"
                        style={{ width: '115px' }}
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

                      <button
                        className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1 py-1 px-2"
                        style={{ fontSize: '0.78rem' }}
                        onClick={(e) => handleDeleteConversation(selectedConv.id, e)}
                        title="Delete this conversation"
                      >
                        <i className="bi bi-trash text-danger"></i>
                        <span className="small d-none d-sm-inline">Delete Chat</span>
                      </button>
                    </div>
                  </div>

                  {transferNotice && (
                    <div className="alert alert-success py-1.5 px-3 small m-2 mb-0 d-flex align-items-center justify-content-between shadow-sm">
                      <span><i className="bi bi-check-circle-fill me-2 text-success"></i> {transferNotice}</span>
                      <button className="btn btn-xs btn-link p-0 text-dark" onClick={() => setTransferNotice('')}>×</button>
                    </div>
                  )}

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
                <div className="d-flex flex-column align-items-center justify-content-center h-100 p-4 text-center">
                  <div className="rounded-circle bg-body-tertiary d-inline-flex p-4 mb-3 text-secondary shadow-sm">
                    <i className="bi bi-whatsapp fs-1 text-success"></i>
                  </div>
                  <h5 className="fw-bold text-body mb-2">WhatsApp Live CRM Inbox</h5>
                  <p className="text-muted small mb-4" style={{ maxWidth: '440px' }}>
                    No hardcoded fake chats. Connect your live WhatsApp session using the QR button in the header. When any customer sends a message to your WhatsApp number, it will instantly appear here and automatically assign to an agent.
                  </p>
                  <div className="d-flex gap-2">
                    {isBranchLead && (
                      <button
                        className="btn btn-sm btn-msquare-primary"
                        onClick={handleConnectWhatsApp}
                      >
                        <i className="bi bi-qr-code me-1"></i> Connect WhatsApp QR
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-msquare-outline"
                      onClick={() => setShowNewChatModal(true)}
                    >
                      <i className="bi bi-chat-dots me-1"></i> + New Real Chat
                    </button>
                  </div>
                </div>
              )}
            </div>

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
