const fs = require('fs');
const path = require('path');
const db = require('./db');

const parse = (row) => (row ? JSON.parse(row.data) : null);
const digitsOf = (jid) => jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

class Store {
  constructor() {
    this.q = {
      accountGet: db.prepare('SELECT data FROM accounts WHERE id = ?'),
      accountAll: db.prepare('SELECT data FROM accounts ORDER BY rowid'),
      accountPut: db.prepare('INSERT INTO accounts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'),
      chatGet: db.prepare('SELECT data FROM chats WHERE id = ?'),
      chatPut: db.prepare(
        'INSERT INTO chats (id, account_id, last_ts, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_ts = excluded.last_ts, data = excluded.data'
      ),
      chatsAll: db.prepare('SELECT data FROM chats ORDER BY last_ts DESC'),
      contactGet: db.prepare('SELECT name FROM contacts WHERE key = ? OR key = ? LIMIT 1'),
      contactPut: db.prepare(
        'INSERT INTO contacts (key, account_id, jid, name) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name, jid = excluded.jid'
      ),
      msgGet: db.prepare('SELECT data FROM messages WHERE account_id = ? AND id = ?'),
      msgInsert: db.prepare('INSERT OR IGNORE INTO messages (account_id, id, remote_jid, ts, data) VALUES (?, ?, ?, ?, ?)'),
      msgUpdate: db.prepare('UPDATE messages SET data = ? WHERE account_id = ? AND id = ?'),
      msgsChat: db.prepare(
        'SELECT data FROM (SELECT data, ts FROM messages WHERE account_id = ? AND remote_jid = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC'
      )
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
        (data.chats || []).forEach(c => this.q.chatPut.run(c.id, c.accountId, c.lastTimestamp || '', JSON.stringify(c)));
        (data.messages || []).forEach(m => this.addMessage(m, { history: true }));
      });
      fs.renameSync(file, `${file}.migrated`);
      console.log('[Store] Imported legacy wacrm-store.json into SQLite');
    } catch (err) {
      console.warn('[Store] Legacy import skipped:', err.message);
    }
  }

  // ---- Accounts ----
  getAccounts() {
    return this.q.accountAll.all().map(parse);
  }

  getAccount(id) {
    return parse(this.q.accountGet.get(id));
  }

  saveAccount(account) {
    const now = new Date().toISOString();
    const merged = { ...(this.getAccount(account.id) || {}), ...account, updatedAt: now };
    merged.createdAt = merged.createdAt || now;
    delete merged.qrDataUrl; // QR codes are short-lived; never stored
    this.q.accountPut.run(account.id, JSON.stringify(merged));
    return merged;
  }

  deleteAccount(id) {
    if (!this.getAccount(id)) return false;
    db.tx(() => {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      db.prepare('DELETE FROM chats WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM messages WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM contacts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM user_accounts WHERE account_id = ?').run(id);
    });
    return true;
  }

  // ---- Contacts ----
  saveContact(accountId, jid, name) {
    if (!accountId || !jid || !name) return;
    const clean = digitsOf(jid);
    this.q.contactPut.run(`${accountId}:${clean || jid}`, accountId, jid, name.trim());

    const chat = parse(this.q.chatGet.get(`${accountId}:${jid}`));
    if (chat) {
      chat.customerName = name.trim();
      this.q.chatPut.run(chat.id, accountId, chat.lastTimestamp || '', JSON.stringify(chat));
    }
  }

  getContactName(accountId, jid) {
    if (!accountId || !jid) return '';
    const row = this.q.contactGet.get(`${accountId}:${digitsOf(jid)}`, `${accountId}:${jid}`);
    return row?.name || '';
  }

  // ---- Chats synced from the phone ----
  saveChat(accountId, chat) {
    const remoteJid = chat.id || chat.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;
    const key = `${accountId}:${remoteJid}`;
    const existing = parse(this.q.chatGet.get(key)) || {};

    const clean = digitsOf(remoteJid);
    const contactName = chat.name || this.getContactName(accountId, remoteJid) || '';

    let lastTimestamp = existing.lastTimestamp || new Date().toISOString();
    if (chat.conversationTimestamp) {
      const ts = Number(chat.conversationTimestamp);
      lastTimestamp = new Date(ts > 1e11 ? ts : ts * 1000).toISOString();
    }

    const record = {
      ...existing,
      id: key,
      accountId,
      remoteJid,
      customerPhone: existing.customerPhone || (clean ? `+${clean}` : remoteJid),
      customerName: contactName || existing.customerName || '',
      unreadCount: chat.unreadCount !== undefined ? Math.max(0, chat.unreadCount) : existing.unreadCount || 0,
      lastMessage: existing.lastMessage || 'Chat synchronized from phone',
      lastTimestamp
    };
    this.q.chatPut.run(key, accountId, lastTimestamp, JSON.stringify(record));
    if (contactName) this.saveContact(accountId, remoteJid, contactName);
  }

  markRead(accountId, remoteJid) {
    const key = `${accountId}:${remoteJid}`;
    const chat = parse(this.q.chatGet.get(key));
    if (chat && chat.unreadCount) {
      chat.unreadCount = 0;
      this.q.chatPut.run(key, accountId, chat.lastTimestamp || '', JSON.stringify(chat));
    }
  }

  // ---- Messages ----
  // options.history: message comes from the phone's history snapshot (does not count as unread)
  addMessage(msg, options = {}) {
    if (!msg || !msg.id || !msg.accountId) return null;

    const existing = parse(this.q.msgGet.get(msg.accountId, msg.id));
    if (existing) {
      if (msg.mediaUrl && !existing.mediaUrl) {
        existing.mediaUrl = msg.mediaUrl;
        this.q.msgUpdate.run(JSON.stringify(existing), msg.accountId, msg.id);
      }
      return existing;
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

    db.tx(() => {
      this.q.msgInsert.run(record.accountId, record.id, record.remoteJid, record.timestamp, JSON.stringify(record));

      const key = `${record.accountId}:${record.remoteJid}`;
      const chat = parse(this.q.chatGet.get(key)) || {};
      const isNewest = !chat.lastTimestamp || record.timestamp >= chat.lastTimestamp;

      const next = {
        ...chat,
        id: key,
        accountId: record.accountId,
        remoteJid: record.remoteJid,
        customerPhone: chat.customerPhone || record.customerPhone,
        customerName: customerName || chat.customerName || '',
        unreadCount: record.fromMe ? 0 : (chat.unreadCount || 0) + (options.history ? 0 : 1)
      };
      if (isNewest) {
        next.lastMessage = this.getLastMessagePreview(record);
        next.mediaType = record.mediaType;
        next.lastTimestamp = record.timestamp;
        next.lastFromMe = record.fromMe;
      }
      this.q.chatPut.run(key, record.accountId, next.lastTimestamp || '', JSON.stringify(next));
    });

    if (customerName) this.saveContact(record.accountId, record.remoteJid, customerName);
    return record;
  }

  // Latest `limit` messages of a conversation, oldest first
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
      .map(parse)
      .filter(c => !allowed || allowed.has(c.accountId))
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
}

module.exports = new Store();
