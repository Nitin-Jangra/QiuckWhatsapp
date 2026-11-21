const fs = require('fs');
const path = require('path');
const db = require('./db');

const parse = (row) => (row ? JSON.parse(row.data) : null);
const digitsOf = (jid) => (jid || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

const SQL = {
  accountGet: 'SELECT data, user_id FROM accounts WHERE id = ?',
  accountAll: 'SELECT data, user_id FROM accounts ORDER BY id',
  accountByUser: 'SELECT data, user_id FROM accounts WHERE user_id = ? ORDER BY id',
  accountPut: `
    INSERT INTO accounts (id, user_id, data) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET user_id = COALESCE(excluded.user_id, accounts.user_id), data = excluded.data`,
  chatGet: 'SELECT data, user_id, is_pinned, is_archived FROM chats WHERE id = ?',
  chatPut: `
    INSERT INTO chats (id, account_id, user_id, last_ts, is_pinned, is_archived, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_ts = excluded.last_ts,
      user_id = COALESCE(excluded.user_id, chats.user_id),
      is_pinned = excluded.is_pinned,
      is_archived = excluded.is_archived,
      data = excluded.data`,
  contactGet: 'SELECT name FROM contacts WHERE key = ? OR key = ? LIMIT 1',
  contactPut: `
    INSERT INTO contacts (key, account_id, user_id, jid, name) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET name = excluded.name, jid = excluded.jid, user_id = COALESCE(excluded.user_id, contacts.user_id)`,
  msgGet: 'SELECT data, user_id FROM messages WHERE account_id = ? AND id = ?',
  msgInsert: `
    INSERT INTO messages (account_id, id, user_id, remote_jid, ts, delivery_status, data)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  msgUpdate: 'UPDATE messages SET data = ? WHERE account_id = ? AND id = ?',
  msgsChat: `
    SELECT data FROM (
      SELECT data, ts FROM messages WHERE account_id = ? AND remote_jid = ? ORDER BY ts DESC LIMIT ?
    ) AS recent ORDER BY ts ASC`,
  userPrefGet: 'SELECT * FROM user_preferences WHERE user_id = ?',
  userPrefPut: `
    INSERT INTO user_preferences (user_id, theme, sound_enabled, enter_is_send, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      theme = excluded.theme,
      sound_enabled = excluded.sound_enabled,
      enter_is_send = excluded.enter_is_send,
      updated_at = excluded.updated_at`
};

const withOwner = (r) => {
  const item = parse(r);
  if (item && r.user_id !== null && r.user_id !== undefined) item.userId = r.user_id;
  return item;
};

class Store {
  // Called once at startup after the database is ready
  async init() {
    await this.importLegacyJson();
  }

  // One-time import of the old wacrm-store.json file, if present
  async importLegacyJson() {
    const file = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'data', 'wacrm-store.json');
    if (!fs.existsSync(file) || (await this.getAccounts()).length) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      await db.tx(async () => {
        for (const a of data.accounts || []) await this.saveAccount(a);
        for (const c of data.contacts || []) if (c.accountId) await this.saveContact(c.accountId, c.jid, c.name);
        for (const c of data.chats || []) await db.run(SQL.chatPut, c.id, c.accountId, null, c.lastTimestamp || '', 0, 0, JSON.stringify(c));
        for (const m of data.messages || []) await this.addMessage(m, { history: true });
      });
      fs.renameSync(file, `${file}.migrated`);
      console.log('[Store] Imported legacy wacrm-store.json into the database');
    } catch (err) {
      console.warn('[Store] Legacy import skipped:', err.message);
    }
  }

  // ---- Accounts (Multi-Tenant Scoped) ----
  async getAccounts(userId = null) {
    const rows = userId === null || userId === undefined
      ? await db.all(SQL.accountAll)
      : await db.all(SQL.accountByUser, userId);
    return rows.map(withOwner).filter(Boolean);
  }

  async getAccount(id, userId = null) {
    const row = await db.get(SQL.accountGet, id);
    if (!row) return null;
    const account = withOwner(row);
    if (userId !== null && userId !== undefined && account.userId && account.userId !== userId) return null;
    return account;
  }

  async saveAccount(account, userId = null) {
    const now = new Date().toISOString();
    const existing = (await this.getAccount(account.id)) || {};
    const effectiveUserId = userId !== null && userId !== undefined ? userId : account.userId || existing.userId || null;
    const merged = { ...existing, ...account, userId: effectiveUserId, updatedAt: now };
    merged.createdAt = merged.createdAt || now;
    delete merged.qrDataUrl; // QR codes are short-lived; never stored

    await db.run(SQL.accountPut, account.id, effectiveUserId, JSON.stringify(merged));
    return merged;
  }

  async deleteAccount(id, userId = null) {
    const acc = await this.getAccount(id, userId);
    if (!acc) return false;
    await db.tx(async () => {
      for (const t of ['accounts WHERE id', 'chats WHERE account_id', 'messages WHERE account_id', 'contacts WHERE account_id', 'user_accounts WHERE account_id', 'whatsapp_sessions WHERE account_id']) {
        await db.run(`DELETE FROM ${t} = ?`, id);
      }
    });
    return true;
  }

  // ---- Contacts ----
  async saveContact(accountId, jid, name, userId = null) {
    if (!accountId || !jid || !name) return;
    const clean = digitsOf(jid);
    const acc = await this.getAccount(accountId);
    const effectiveUserId = userId || acc?.userId || null;
    await db.run(SQL.contactPut, `${accountId}:${clean || jid}`, accountId, effectiveUserId, jid, name.trim());

    const chat = parse(await db.get(SQL.chatGet, `${accountId}:${jid}`));
    if (chat) {
      chat.customerName = name.trim();
      await db.run(SQL.chatPut, chat.id, accountId, effectiveUserId, chat.lastTimestamp || '', chat.isPinned ? 1 : 0, chat.isArchived ? 1 : 0, JSON.stringify(chat));
    }
  }

  async getContactName(accountId, jid) {
    if (!accountId || !jid) return '';
    const row = await db.get(SQL.contactGet, `${accountId}:${digitsOf(jid)}`, `${accountId}:${jid}`);
    return row?.name || '';
  }

  // ---- Chats (Unified Inbox with Pin, Archive, Unread, Multi-Tenant Filter) ----
  async saveChat(accountId, chat, userId = null) {
    const remoteJid = chat.id || chat.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;
    const key = `${accountId}:${remoteJid}`;
    const existing = parse(await db.get(SQL.chatGet, key)) || {};

    const acc = await this.getAccount(accountId);
    const effectiveUserId = userId || acc?.userId || existing.userId || null;

    const clean = digitsOf(remoteJid);
    const contactName = chat.name || (await this.getContactName(accountId, remoteJid)) || '';

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

    await db.run(SQL.chatPut, key, accountId, effectiveUserId, lastTimestamp, isPinned ? 1 : 0, isArchived ? 1 : 0, JSON.stringify(record));
    if (contactName) await this.saveContact(accountId, remoteJid, contactName, effectiveUserId);
    return record;
  }

  async updateChat(accountId, remoteJid, change) {
    const key = `${accountId}:${remoteJid}`;
    const chat = parse(await db.get(SQL.chatGet, key));
    if (!chat) return null;
    Object.assign(chat, change);
    await db.run(SQL.chatPut, key, accountId, chat.userId || null, chat.lastTimestamp || '', chat.isPinned ? 1 : 0, chat.isArchived ? 1 : 0, JSON.stringify(chat));
    return chat;
  }

  pinChat(accountId, remoteJid, isPinned = true) {
    return this.updateChat(accountId, remoteJid, { isPinned: Boolean(isPinned) });
  }

  archiveChat(accountId, remoteJid, isArchived = true) {
    return this.updateChat(accountId, remoteJid, { isArchived: Boolean(isArchived) });
  }

  async markRead(accountId, remoteJid) {
    const chat = parse(await db.get(SQL.chatGet, `${accountId}:${remoteJid}`));
    if (chat && chat.unreadCount) await this.updateChat(accountId, remoteJid, { unreadCount: 0 });
  }

  async deleteChat(accountId, remoteJid) {
    if (!accountId || !remoteJid) return false;
    const key = `${accountId}:${remoteJid}`;
    await db.tx(async () => {
      await db.run('DELETE FROM chats WHERE id = ?', key);
      await db.run('DELETE FROM messages WHERE account_id = ? AND remote_jid = ?', accountId, remoteJid);
    });
    return true;
  }

  async clearEmptySyncedChats(accountId = null) {
    const defaultPlaceholder = 'Chat synchronized from phone';
    const filter = accountId ? [accountId] : null;
    const allChats = await this.getChats(filter);
    let clearedCount = 0;
    for (const chat of allChats) {
      if (chat.lastMessage === defaultPlaceholder) {
        const msgs = await this.getMessages(chat.accountId, chat.remoteJid, 1);
        if (msgs.length === 0) {
          await this.deleteChat(chat.accountId, chat.remoteJid);
          clearedCount++;
        }
      }
    }
    return clearedCount;
  }

  // ---- Messages ----
  async addMessage(msg, options = {}, userId = null) {
    if (!msg || !msg.id || !msg.accountId) return null;

    const existing = parse(await db.get(SQL.msgGet, msg.accountId, msg.id));
    if (existing) {
      if (msg.mediaUrl && !existing.mediaUrl) {
        existing.mediaUrl = msg.mediaUrl;
        await db.run(SQL.msgUpdate, JSON.stringify(existing), msg.accountId, msg.id);
      }
      return existing;
    }

    const acc = await this.getAccount(msg.accountId);
    const effectiveUserId = userId || msg.userId || acc?.userId || null;
    const customerName = msg.customerName || (await this.getContactName(msg.accountId, msg.remoteJid)) || '';

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
      sentBy: msg.sentBy || null, // { id, name } of the team member who sent it from the app
      timestamp: msg.timestamp || new Date().toISOString()
    };

    await db.tx(async () => {
      await db.run(SQL.msgInsert, record.accountId, record.id, effectiveUserId, record.remoteJid, record.timestamp, record.deliveryStatus, JSON.stringify(record));

      const key = `${record.accountId}:${record.remoteJid}`;
      const chat = parse(await db.get(SQL.chatGet, key)) || {};
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
      await db.run(SQL.chatPut, key, record.accountId, effectiveUserId, next.lastTimestamp || '', next.isPinned ? 1 : 0, next.isArchived ? 1 : 0, JSON.stringify(next));
    });

    if (customerName) await this.saveContact(record.accountId, record.remoteJid, customerName, effectiveUserId);
    return record;
  }

  async getMessages(accountId, remoteJid, limit = 1000) {
    return (await db.all(SQL.msgsChat, accountId, remoteJid, limit)).map(parse);
  }

  getLastMessagePreview(msg) {
    if (msg.text && msg.text.trim()) return msg.text.trim();
    if (msg.mediaType === 'image') return '📷 Photo';
    if (msg.mediaType === 'video') return '🎥 Video';
    if (msg.mediaType === 'audio') return '🎵 Voice Message';
    if (msg.mediaType === 'document') return `📄 ${msg.fileName || 'Document'}`;
    return 'Message';
  }

  // Unified conversation list across WhatsApp numbers. filter: null (all) | accountId | array of accountIds
  async getChats(filter = null) {
    const ids = filter == null ? null : [].concat(filter);
    if (ids && !ids.length) return [];
    const rows = ids
      ? await db.all(`SELECT data, is_pinned, is_archived FROM chats WHERE account_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_pinned DESC, last_ts DESC`, ...ids)
      : await db.all('SELECT data, is_pinned, is_archived FROM chats ORDER BY is_pinned DESC, last_ts DESC');
    const accounts = new Map((await this.getAccounts()).map(a => [a.id, a]));

    const out = [];
    for (const r of rows) {
      const c = parse(r);
      if (!c) continue;
      c.isPinned = Boolean(r.is_pinned);
      c.isArchived = Boolean(r.is_archived);
      const account = accounts.get(c.accountId);
      out.push({
        ...c,
        accountName: account?.name || c.accountId,
        accountPhone: account?.phone || null,
        customerName: c.customerName || (await this.getContactName(c.accountId, c.remoteJid)) || ''
      });
    }
    return out;
  }

  // ---- User Preferences (Theme, Sound, Enter-is-send) ----
  async getUserPreferences(userId) {
    const defaults = { theme: 'light', soundEnabled: true, enterIsSend: true };
    if (!userId || typeof userId !== 'number') return defaults;
    const row = await db.get(SQL.userPrefGet, userId);
    if (!row) return defaults;
    return {
      theme: row.theme || 'light',
      soundEnabled: Boolean(row.sound_enabled),
      enterIsSend: Boolean(row.enter_is_send)
    };
  }

  async setUserPreferences(userId, { theme, soundEnabled, enterIsSend }) {
    if (!userId || typeof userId !== 'number') return;
    const current = await this.getUserPreferences(userId);
    const nextTheme = theme || current.theme;
    const nextSound = soundEnabled !== undefined ? (soundEnabled ? 1 : 0) : (current.soundEnabled ? 1 : 0);
    const nextEnter = enterIsSend !== undefined ? (enterIsSend ? 1 : 0) : (current.enterIsSend ? 1 : 0);

    await db.run(SQL.userPrefPut, userId, nextTheme, nextSound, nextEnter, new Date().toISOString());
    return { theme: nextTheme, soundEnabled: Boolean(nextSound), enterIsSend: Boolean(nextEnter) };
  }
}

module.exports = new Store();
