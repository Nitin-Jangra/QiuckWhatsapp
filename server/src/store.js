const fs = require('fs');
const path = require('path');

class Store {
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'data', 'wacrm-store.json');
    this.ensureDirectory();
    this.accounts = new Map();
    this.chats = new Map(); // key: `${accountId}:${remoteJid}` -> chat summary
    this.contacts = new Map(); // key: `${accountId}:${cleanDigits}` -> { name }
    this.messages = [];
    this.load();
  }

  ensureDirectory() {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.accounts)) {
          this.accounts = new Map(data.accounts.map(acc => [acc.id, acc]));
        }
        if (Array.isArray(data.chats)) {
          this.chats = new Map(data.chats.map(c => [c.id, c]));
        }
        if (Array.isArray(data.messages)) {
          this.messages = data.messages;
        }
        if (Array.isArray(data.contacts)) {
          this.contacts = new Map(data.contacts.map(c => [c.key, c]));
        }
      }
    } catch (err) {
      console.warn('[Store] Could not load stored data, starting fresh:', err.message);
      this.accounts = new Map();
      this.chats = new Map();
      this.messages = [];
      this.contacts = new Map();
    }
  }

  persist() {
    try {
      this.ensureDirectory();
      const payload = {
        accounts: Array.from(this.accounts.values()),
        chats: Array.from(this.chats.values()),
        contacts: Array.from(this.contacts.values()),
        // Keep up to 10,000 recent messages for complete history
        messages: this.messages.slice(-10000)
      };
      fs.writeFileSync(this.dataPath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to persist data:', err.message);
    }
  }

  // Accounts
  getAccounts() {
    return Array.from(this.accounts.values());
  }

  getAccount(id) {
    return this.accounts.get(id) || null;
  }

  saveAccount(account) {
    const existing = this.accounts.get(account.id) || {};
    const updated = {
      ...existing,
      ...account,
      updatedAt: new Date().toISOString()
    };
    if (!updated.createdAt) {
      updated.createdAt = new Date().toISOString();
    }
    this.accounts.set(account.id, updated);
    this.persist();
    return updated;
  }

  deleteAccount(id) {
    const existed = this.accounts.delete(id);
    if (existed) {
      this.messages = this.messages.filter(m => m.accountId !== id);
      for (const [key, chat] of this.chats.entries()) {
        if (chat.accountId === id) this.chats.delete(key);
      }
      this.persist();
    }
    return existed;
  }

  // Contacts
  saveContact(accountId, jid, name) {
    if (!accountId || !jid || !name) return;
    const clean = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const key = `${accountId}:${clean || jid}`;
    this.contacts.set(key, { key, accountId, jid, name: name.trim() });

    // Update matching chat if already in chats map
    const chatKey = `${accountId}:${jid}`;
    if (this.chats.has(chatKey)) {
      const c = this.chats.get(chatKey);
      c.customerName = name.trim();
    }
  }

  getContactName(accountId, jid) {
    if (!accountId || !jid) return '';
    const clean = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const c = this.contacts.get(`${accountId}:${clean}`) || this.contacts.get(`${accountId}:${jid}`);
    return c?.name || '';
  }

  // Chats synced from phone
  saveChat(accountId, chat) {
    const remoteJid = chat.id || chat.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;
    const key = `${accountId}:${remoteJid}`;
    const existing = this.chats.get(key) || {};

    const cleanDigits = remoteJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const customerPhone = cleanDigits ? `+${cleanDigits}` : remoteJid;
    const contactName = chat.name || this.getContactName(accountId, remoteJid) || '';

    let lastTimestamp = existing.lastTimestamp || new Date().toISOString();
    if (chat.conversationTimestamp) {
      const ts = Number(chat.conversationTimestamp);
      lastTimestamp = new Date(ts > 1e11 ? ts : ts * 1000).toISOString();
    }

    this.chats.set(key, {
      ...existing,
      id: key,
      accountId,
      remoteJid,
      customerPhone: existing.customerPhone || customerPhone,
      customerName: contactName || existing.customerName || '',
      unreadCount: chat.unreadCount !== undefined ? chat.unreadCount : (existing.unreadCount || 0),
      lastMessage: existing.lastMessage || 'Chat synchronized from phone',
      lastTimestamp
    });

    if (contactName) {
      this.saveContact(accountId, remoteJid, contactName);
    }

    this.persist();
  }

  // Messages
  addMessage(msg) {
    if (!msg || !msg.id) return null;
    const existsIdx = this.messages.findIndex(m => m.id === msg.id && m.accountId === msg.accountId);
    if (existsIdx !== -1) {
      if (msg.mediaUrl && !this.messages[existsIdx].mediaUrl) {
        this.messages[existsIdx].mediaUrl = msg.mediaUrl;
        this.persist();
      }
      return this.messages[existsIdx];
    }

    const customerName = msg.customerName || this.getContactName(msg.accountId, msg.remoteJid) || '';

    const record = {
      id: msg.id,
      accountId: msg.accountId,
      remoteJid: msg.remoteJid,
      customerPhone: msg.customerPhone || msg.remoteJid,
      customerName,
      text: msg.text || '',
      mediaType: msg.mediaType || null,
      mediaUrl: msg.mediaUrl || null,
      fileName: msg.fileName || null,
      mimetype: msg.mimetype || null,
      fromMe: Boolean(msg.fromMe),
      timestamp: msg.timestamp || new Date().toISOString()
    };

    if (customerName) {
      this.saveContact(msg.accountId, msg.remoteJid, customerName);
    }

    this.messages.push(record);

    // Update conversation record in this.chats
    const chatKey = `${msg.accountId}:${msg.remoteJid}`;
    const preview = this.getLastMessagePreview(record);
    const existingChat = this.chats.get(chatKey) || {};

    this.chats.set(chatKey, {
      ...existingChat,
      id: chatKey,
      accountId: msg.accountId,
      remoteJid: msg.remoteJid,
      customerPhone: record.customerPhone,
      customerName: customerName || existingChat.customerName || '',
      lastMessage: preview,
      mediaType: record.mediaType,
      lastTimestamp: record.timestamp,
      lastFromMe: record.fromMe,
      unreadCount: record.fromMe ? 0 : (existingChat.unreadCount || 0) + 1
    });

    this.persist();
    return record;
  }

  getMessages(accountId, remoteJid) {
    return this.messages.filter(m => {
      if (accountId && m.accountId !== accountId) return false;
      if (remoteJid && m.remoteJid !== remoteJid) return false;
      return true;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  getLastMessagePreview(msg) {
    if (msg.text && msg.text.trim()) {
      return msg.text.trim();
    }
    if (msg.mediaType === 'image') return '📷 Photo';
    if (msg.mediaType === 'video') return '🎥 Video';
    if (msg.mediaType === 'audio') return '🎵 Voice Message';
    if (msg.mediaType === 'document') return `📄 ${msg.fileName || 'Document'}`;
    return 'Message';
  }

  // Conversations list: merges synced chats with message history
  getChats(filterAccountId = null) {
    const chatMap = new Map();

    // 1. First populate registered chats from phone sync
    for (const [key, c] of this.chats.entries()) {
      if (filterAccountId && c.accountId !== filterAccountId) continue;
      const account = this.accounts.get(c.accountId);
      chatMap.set(key, {
        ...c,
        accountName: account?.name || c.accountId,
        accountPhone: account?.phone || null,
        customerName: c.customerName || this.getContactName(c.accountId, c.remoteJid) || ''
      });
    }

    // 2. Overlay messages to ensure accurate lastMessage, fromMe & timestamp
    for (const msg of this.messages) {
      if (filterAccountId && msg.accountId !== filterAccountId) continue;

      const key = `${msg.accountId}:${msg.remoteJid}`;
      const account = this.accounts.get(msg.accountId);
      const accountName = account?.name || msg.accountId;
      const contactName = msg.customerName || this.getContactName(msg.accountId, msg.remoteJid) || '';
      const preview = this.getLastMessagePreview(msg);

      if (!chatMap.has(key)) {
        chatMap.set(key, {
          id: key,
          accountId: msg.accountId,
          accountName,
          accountPhone: account?.phone || null,
          remoteJid: msg.remoteJid,
          customerPhone: msg.customerPhone || msg.remoteJid,
          customerName: contactName,
          lastMessage: preview,
          mediaType: msg.mediaType || null,
          lastTimestamp: msg.timestamp,
          lastFromMe: msg.fromMe,
          unreadCount: (!msg.fromMe ? 1 : 0)
        });
      } else {
        const chat = chatMap.get(key);
        if (new Date(msg.timestamp) >= new Date(chat.lastTimestamp)) {
          chat.lastMessage = preview;
          chat.mediaType = msg.mediaType || null;
          chat.lastTimestamp = msg.timestamp;
          chat.lastFromMe = msg.fromMe;
        }
        if (contactName && !chat.customerName) {
          chat.customerName = contactName;
        }
      }
    }

    // Sort newest to oldest
    return Array.from(chatMap.values()).sort(
      (a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp)
    );
  }
}

module.exports = new Store();
