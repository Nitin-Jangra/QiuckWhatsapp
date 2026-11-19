const fs = require('fs');
const path = require('path');
const db = require('./db');

const parse = (row) => (row ? JSON.parse(row.data) : null);
const digitsOf = (jid) => (jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

class Store {
  constructor() {
    this.q = {
      accountGet: db.prepare('SELECT data, user_id FROM accounts WHERE id = ?'),
      accountAll: db.prepare('SELECT data, user_id FROM accounts ORDER BY rowid'),
      accountPut: db.prepare(`
        INSERT INTO accounts (id, user_id, data) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET user_id = COALESCE(excluded.user_id, accounts.user_id), data = excluded.data
      `),
      chatGet: db.prepare('SELECT data, user_id, is_pinned, is_archived FROM chats WHERE id = ?'),
      chatPut: db.prepare(`
        INSERT INTO chats (id, account_id, user_id, last_ts, is_pinned, is_archived, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_ts = excluded.last_ts,
          user_id = COALESCE(excluded.user_id, chats.user_id),
          is_pinned = excluded.is_pinned,
          is_archived = excluded.is_archived,
          data = excluded.data
      `),
      chatsAll: db.prepare('SELECT data, user_id, is_pinned, is_archived FROM chats ORDER BY is_pinned DESC, last_ts DESC'),
      contactGet: db.prepare('SELECT name FROM contacts WHERE key = ? OR key = ? LIMIT 1'),
      contactPut: db.prepare(`
        INSERT INTO contacts (key, account_id, user_id, jid, name) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET name = excluded.name, jid = excluded.jid, user_id = COALESCE(excluded.user_id, contacts.user_id)
      `),
      msgGet: db.prepare('SELECT data, user_id FROM messages WHERE account_id = ? AND id = ?'),
      msgInsert: db.prepare(`
        INSERT OR IGNORE INTO messages (account_id, id, user_id, remote_jid, ts, delivery_status, data)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      msgUpdate: db.prepare('UPDATE messages SET data = ? WHERE account_id = ? AND id = ?'),
      msgsChat: db.prepare(`
        SELECT data FROM (
          SELECT data, ts FROM messages WHERE account_id = ? AND remote_jid = ? ORDER BY ts DESC LIMIT ?
        ) ORDER BY ts ASC
      `),
      userPrefGet: db.prepare('SELECT * FROM user_preferences WHERE user_id = ?'),
      userPrefPut: db.prepare(`
        INSERT INTO user_preferences (user_id, theme, sound_enabled, enter_is_send, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          theme = excluded.theme,
          sound_enabled = excluded.sound_enabled,
          enter_is_send = excluded.enter_is_send,
          updated_at = excluded.updated_at
      `)
    };
    this.importLegacyJson();
  }

  // One-time import of the old wacrm-store.json file, if present
  importLegacyJson() {
    const file = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'data', 'wacrm-store.json');
    if (!fs.existsSync(file) || this.getAccounts().length) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      db.tx(() => {
        (data.accounts || []).forEach(a => this.saveAccount(a));
        (data.contacts || []).forEach(c => c.accountId && this.saveContact(c.accountId, c.jid, c.name));
        (data.chats || []).forEach(c => this.q.chatPut.run(c.id, c.accountId, null, c.lastTimestamp || '', 0, 0, JSON.stringify(c)));
        (data.messages || []).forEach(m => this.addMessage(m, { history: true }));
      });
      fs.renameSync(file, `${file}.migrated`);
      console.log('[Store] Imported legacy wacrm-store.json into SQLite');
    } catch (err) {
      console.warn('[Store] Legacy import skipped:', err.message);
    }
  }

  // ---- Accounts (Multi-Tenant Scoped) ----
  getAccounts(userId = null) {
    const rows = this.q.accountAll.all();
    return rows
      .map(r => {
        const item = parse(r);
        if (item && r.user_id !== null && r.user_id !== undefined) item.userId = r.user_id;
        return item;
      })
      .filter(a => {
        if (!a) return false;
        if (userId === null || userId === undefined) return true;
        return a.userId === userId;
      });
  }

  getAccount(id, userId = null) {
    const row = this.q.accountGet.get(id);
    if (!row) return null;
    const account = parse(row);
    if (account && row.user_id !== null && row.user_id !== undefined) account.userId = row.user_id;
    if (userId !== null && userId !== undefined) {
      if (account.userId && account.userId !== userId) return null;
    }
    return account;
  }

  saveAccount(account, userId = null) {
    const now = new Date().toISOString();
    const existing = this.getAccount(account.id) || {};
    const effectiveUserId = userId !== null && userId !== undefined ? userId : account.userId || existing.userId || null;
    const merged = { ...existing, ...account, userId: effectiveUserId, updatedAt: now };
    merged.createdAt = merged.createdAt || now;
    delete merged.qrDataUrl; // QR codes are short-lived; never stored

    this.q.accountPut.run(account.id, effectiveUserId, JSON.stringify(merged));
    return merged;
  }

  deleteAccount(id, userId = null) {
    const acc = this.getAccount(id, userId);
    if (!acc) return false;
    db.tx(() => {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      db.prepare('DELETE FROM chats WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM messages WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM contacts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM user_accounts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM whatsapp_sessions WHERE account_id = ?').run(id);
    });
    return true;
  }

  // ---- Contacts ----
  saveContact(accountId, jid, name, userId = null) {
    if (!accountId || !jid || !name) return;
    const clean = digitsOf(jid);
    const acc = this.getAccount(accountId);
    const effectiveUserId = userId || acc?.userId || null;
    this.q.contactPut.run(`${accountId}:${clean || jid}`, accountId, effectiveUserId, jid, name.trim());

    const chatRow = this.q.chatGet.get(`${accountId}:${jid}`);
    const chat = parse(chatRow);
    if (chat) {
      chat.customerName = name.trim();
      this.q.chatPut.run(chat.id, accountId, effectiveUserId, chat.lastTimestamp || '', chat.isPinned ? 1 : 0, chat.isArchived ? 1 : 0, JSON.stringify(chat));
    }
  }

  getContactName(accountId, jid) {
    if (!accountId || !jid) return '';
    const row = this.q.contactGet.get(`${accountId}:${digitsOf(jid)}`, `${accountId}:${jid}`);
    return row?.name || '';
  }

  // ---- Chats (Unified Inbox with Pin, Archive, Unread, Multi-Tenant Filter) ----
  saveChat(accountId, chat, userId = null) {
    const remoteJid = chat.id || chat.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;
    const key = `${accountId}:${remoteJid}`;
    const existing = parse(this.q.chatGet.get(key)) || {};

    const acc = this.getAccount(accountId);
    const effectiveUserId = userId || acc?.userId || existing.userId || null;

    const clean = digitsOf(remoteJid);
    const contactName = chat.name || this.getContactName(accountId, remoteJid) || '';

    let lastTimestamp = existing.lastTimestamp || new Date().toISOString();
    if (chat.conversationTimestamp) {
      const ts = Number(chat.conversationTimestamp);
      lastTimestamp = new Date(ts > 1e11 ? ts : ts * 1000).toISOString();
    }

    const isPinned = chat.isPinned !== undefined ? Boolean(chat.isPinned) : Boolean(existing.isPinned);
    const isArchived = chat.isArchived !== undefined ? Boolean(chat.isArchived) : Boolean(existing.isArchived);

    const record = {
      ...existing,
      id: key,
      accountId,
      userId: effectiveUserId,
      remoteJid,
      customerPhone: existing.customerPhone || (clean ? `+${clean}` : remoteJid),
      customerName: contactName || existing.customerName || '',
      unreadCount: chat.unreadCount !== undefined ? Math.max(0, chat.unreadCount) : existing.unreadCount || 0,
      lastMessage: existing.lastMessage || 'Chat synchronized from phone',
      lastTimestamp,
      isPinned,
      isArchived
    };

    this.q.chatPut.run(key, accountId, effectiveUserId, lastTimestamp, isPinned ? 1 : 0, isArchived ? 1 : 0, JSON.stringify(record));
    if (contactName) this.saveContact(accountId, remoteJid, contactName, effectiveUserId);
    return record;
  }

  pinChat(accountId, remoteJid, isPinned = true) {
    const key = `${accountId}:${remoteJid}`;
    const chat = parse(this.q.chatGet.get(key));
    if (!chat) return null;
    chat.isPinned = Boolean(isPinned);
    this.q.chatPut.run(key, accountId, chat.userId || null, chat.lastTimestamp || '', chat.isPinned ? 1 : 0, chat.isArchived ? 1 : 0, JSON.stringify(chat));
    return chat;
  }

  archiveChat(accountId, remoteJid, isArchived = true) {
    const key = `${accountId}:${remoteJid}`;
    const chat = parse(this.q.chatGet.get(key));
    if (!chat) return null;
    chat.isArchived = Boolean(isArchived);
    this.q.chatPut.run(key, accountId, chat.userId || null, chat.lastTimestamp || '', chat.isPinned ? 1 : 0, chat.isArchived ? 1 : 0, JSON.stringify(chat));
    return chat;
  }

  markRead(accountId, remoteJid) {
    const key = `${accountId}:${remoteJid}`;
    const chat = parse(this.q.chatGet.get(key));
    if (chat && chat.unreadCount) {
      chat.unreadCount = 0;
      this.q.chatPut.run(key, accountId, chat.userId || null, chat.lastTimestamp || '', chat.isPinned ? 1 : 0, chat.isArchived ? 1 : 0, JSON.stringify(chat));
    }
  }

  // ---- Messages ----
  addMessage(msg, options = {}, userId = null) {
    if (!msg || !msg.id || !msg.accountId) return null;

    const existing = parse(this.q.msgGet.get(msg.accountId, msg.id));
    if (existing) {
      if (msg.mediaUrl && !existing.mediaUrl) {
        existing.mediaUrl = msg.mediaUrl;
        this.q.msgUpdate.run(JSON.stringify(existing), msg.accountId, msg.id);
      }
      return existing;
    }

    const acc = this.getAccount(msg.accountId);
    const effectiveUserId = userId || msg.userId || acc?.userId || null;
    const customerName = msg.customerName || this.getContactName(msg.accountId, msg.remoteJid) || '';

    const record = {
      id: msg.id,
      accountId: msg.accountId,
      userId: effectiveUserId,
      remoteJid: msg.remoteJid,
      customerPhone: msg.customerPhone || msg.remoteJid,
      customerName,
      text: msg.text || '',
      mediaType: msg.mediaType || null,
      mediaUrl: msg.mediaUrl || null,
      fileName: msg.fileName || null,
      mimetype: msg.mimetype || null,
      fromMe: Boolean(msg.fromMe),
      deliveryStatus: msg.deliveryStatus || 'sent',
      timestamp: msg.timestamp || new Date().toISOString()
    };

    db.tx(() => {
      this.q.msgInsert.run(record.accountId, record.id, effectiveUserId, record.remoteJid, record.timestamp, record.deliveryStatus, JSON.stringify(record));

      const key = `${record.accountId}:${record.remoteJid}`;
      const chatRow = this.q.chatGet.get(key);
      const chat = parse(chatRow) || {};
      const isNewest = !chat.lastTimestamp || record.timestamp >= chat.lastTimestamp;

      const next = {
        ...chat,
        id: key,
        accountId: record.accountId,
        userId: effectiveUserId,
        remoteJid: record.remoteJid,
        customerPhone: chat.customerPhone || record.customerPhone,
        customerName: customerName || chat.customerName || '',
        unreadCount: record.fromMe ? 0 : (chat.unreadCount || 0) + (options.history ? 0 : 1),
        isPinned: Boolean(chat.isPinned),
        isArchived: Boolean(chat.isArchived)
      };
      if (isNewest) {
        next.lastMessage = this.getLastMessagePreview(record);
        next.mediaType = record.mediaType;
        next.lastTimestamp = record.timestamp;
        next.lastFromMe = record.fromMe;
      }
      this.q.chatPut.run(key, record.accountId, effectiveUserId, next.lastTimestamp || '', next.isPinned ? 1 : 0, next.isArchived ? 1 : 0, JSON.stringify(next));
    });

    if (customerName) this.saveContact(record.accountId, record.remoteJid, customerName, effectiveUserId);
    return record;
  }

  getMessages(accountId, remoteJid, limit = 1000) {
    return this.q.msgsChat.all(accountId, remoteJid, limit).map(parse);
  }

  getLastMessagePreview(msg) {
    if (msg.text && msg.text.trim()) return msg.text.trim();
    if (msg.mediaType === 'image') return '📷 Photo';
    if (msg.mediaType === 'video') return '🎥 Video';
    if (msg.mediaType === 'audio') return '🎵 Voice Message';
    if (msg.mediaType === 'document') return `📄 ${msg.fileName || 'Document'}`;
    return 'Message';
  }

  // Conversation list. filter: null (all) | accountId | array of accountIds
  getChats(filter = null) {
    const allowed = filter == null ? null : new Set([].concat(filter));
    const accounts = new Map(this.getAccounts().map(a => [a.id, a]));

    return this.q.chatsAll
      .all()
      .map(r => {
        const c = parse(r);
        if (c) {
          c.isPinned = Boolean(r.is_pinned);
          c.isArchived = Boolean(r.is_archived);
        }
        return c;
      })
      .filter(c => {
        if (!c) return false;
        return !allowed || allowed.has(c.accountId);
      })
      .map(c => {
        const account = accounts.get(c.accountId);
        return {
          ...c,
          accountName: account?.name || c.accountId,
          accountPhone: account?.phone || null,
          customerName: c.customerName || this.getContactName(c.accountId, c.remoteJid) || ''
        };
      });
  }

  // ---- User Preferences (Theme, Sound, Enter-is-send) ----
  getUserPreferences(userId) {
    if (!userId) return { theme: 'light', soundEnabled: true, enterIsSend: true };
    const row = this.q.userPrefGet.get(userId);
    if (!row) return { theme: 'light', soundEnabled: true, enterIsSend: true };
    return {
      theme: row.theme || 'light',
      soundEnabled: Boolean(row.sound_enabled),
      enterIsSend: Boolean(row.enter_is_send)
    };
  }

  setUserPreferences(userId, { theme, soundEnabled, enterIsSend }) {
    if (!userId) return;
    const current = this.getUserPreferences(userId);
    const nextTheme = theme || current.theme;
    const nextSound = soundEnabled !== undefined ? (soundEnabled ? 1 : 0) : (current.soundEnabled ? 1 : 0);
    const nextEnter = enterIsSend !== undefined ? (enterIsSend ? 1 : 0) : (current.enterIsSend ? 1 : 0);
    const now = new Date().toISOString();

    this.q.userPrefPut.run(userId, nextTheme, nextSound, nextEnter, now);
    return {
      theme: nextTheme,
      soundEnabled: Boolean(nextSound),
      enterIsSend: Boolean(nextEnter)
    };
  }
}

module.exports = new Store();
