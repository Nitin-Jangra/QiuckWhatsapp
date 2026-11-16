const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion,
  normalizeMessageContent
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const store = require('../store');

// Extension helper from mimetype or media type
function getMediaExtension(mimetype, defaultType) {
  if (!mimetype) {
    if (defaultType === 'image') return 'jpg';
    if (defaultType === 'video') return 'mp4';
    if (defaultType === 'audio') return 'mp3';
    return 'bin';
  }
  const m = mimetype.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('csv')) return 'csv';
  if (m.includes('plain')) return 'txt';
  return 'bin';
}

// Unwraps deviceSentMessage (phone outgoing sync), ephemeral, view-once, and caption-wrapped messages
function unwrapMessage(msg) {
  let m = msg?.message;
  if (!m) return null;

  // If sent from the mobile phone, unwrap deviceSentMessage
  if (m.deviceSentMessage?.message) {
    m = m.deviceSentMessage.message;
  }

  // Use Baileys official normalizer to unwrap ephemeral, viewOnce, edited messages
  m = normalizeMessageContent(m) || m;

  return m;
}

// Extracts text and media metadata from raw message
function extractMessageContent(m) {
  if (!m) return { text: '', mediaType: null };

  if (m.imageMessage) {
    return {
      text: m.imageMessage.caption || '',
      mediaType: 'image',
      mimetype: m.imageMessage.mimetype || 'image/jpeg',
      fileName: 'photo.jpg'
    };
  }
  if (m.videoMessage) {
    return {
      text: m.videoMessage.caption || '',
      mediaType: 'video',
      mimetype: m.videoMessage.mimetype || 'video/mp4',
      fileName: 'video.mp4'
    };
  }
  if (m.audioMessage) {
    return {
      text: '',
      mediaType: 'audio',
      mimetype: m.audioMessage.mimetype || 'audio/ogg; codecs=opus',
      fileName: 'audio.ogg'
    };
  }
  if (m.documentMessage) {
    return {
      text: m.documentMessage.caption || '',
      mediaType: 'document',
      mimetype: m.documentMessage.mimetype || 'application/octet-stream',
      fileName: m.documentMessage.fileName || 'document'
    };
  }

  const text = m.conversation ||
               m.extendedTextMessage?.text ||
               m.buttonsResponseMessage?.selectedDisplayText ||
               m.templateButtonReplyMessage?.selectedDisplayText ||
               m.listResponseMessage?.title ||
               m.contactMessage?.displayName ||
               m.locationMessage?.name ||
               '';
  return { text, mediaType: null };
}

class WhatsAppSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionBasePath = options.sessionBasePath || path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..'), 'wa_sessions');
    this.mediaBasePath = options.mediaBasePath || path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..'), 'media');
    this.sessions = new Map(); // accountId -> session object
    this.processedMessageIds = new Map(); // msgId -> timestamp for deduplication
    this.destinationJidCache = new Map(); // phone/digits -> original remoteJid
    this.logger = pino({ level: options.logLevel || 'silent' });

    this.ensureMediaDirectory();

    // Clean up deduplication cache periodically
    this.cleanupTimer = setInterval(() => this.cleanupDeduplicationCache(), 15 * 60 * 1000);
    if (this.cleanupTimer && this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  ensureMediaDirectory() {
    if (!fs.existsSync(this.mediaBasePath)) {
      fs.mkdirSync(this.mediaBasePath, { recursive: true });
    }
  }

  getAccountSessionDir(accountId) {
    const safeId = (accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(this.sessionBasePath, safeId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getAccountStatus(accountId) {
    const session = this.sessions.get(accountId);
    if (!session) {
      return {
        accountId,
        status: 'DISCONNECTED',
        phone: null,
        name: null,
        qrDataUrl: null,
        lastError: null,
        lastConnectedAt: null
      };
    }
    return {
      accountId,
      status: session.status,
      phone: session.userInfo?.phone || null,
      name: session.userInfo?.name || null,
      qrDataUrl: session.status === 'SCAN_QR' ? session.qrDataUrl : null,
      lastError: session.lastError || null,
      lastConnectedAt: session.lastConnectedAt || null
    };
  }

  async downloadAndSaveIncomingMedia(sock, msg, accountId, mediaType, mimetype) {
    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: this.logger,
          reuploadRequest: sock.updateMediaMessage
        }
      );

      const ext = getMediaExtension(mimetype, mediaType);
      const safeMsgId = (msg.key?.id || `m_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeMsgId}.${ext}`;

      const accountMediaDir = path.join(this.mediaBasePath, accountId);
      if (!fs.existsSync(accountMediaDir)) {
        fs.mkdirSync(accountMediaDir, { recursive: true });
      }

      const filePath = path.join(accountMediaDir, filename);
      fs.writeFileSync(filePath, buffer);

      return `/api/media/${accountId}/${filename}`;
    } catch (err) {
      return null;
    }
  }

  async processIncomingMessage(sock, msg, accountId, isHistorySync = false) {
    const msgId = msg.key?.id;
    if (!msgId) return null;

    if (this.isDuplicateMessage(msgId)) return null;
    this.recordMessageId(msgId);

    const fromMe = Boolean(msg.key?.fromMe);

    // If sent from the mobile phone via deviceSentMessage, extract the actual recipient destination
    let remoteJid = msg.key?.remoteJid;
    if (msg.message?.deviceSentMessage?.destinationJid) {
      remoteJid = msg.message.deviceSentMessage.destinationJid;
    }

    if (!remoteJid || remoteJid === 'status@broadcast') return null;
    if (msg.message?.protocolMessage && !msg.message?.protocolMessage?.editedMessage) return null;
    if (msg.message?.reactionMessage) return null;

    const unwrapped = unwrapMessage(msg);
    if (!unwrapped) return null;

    const content = extractMessageContent(unwrapped);

    // Skip protocol notifications with no content
    if (!content.text && !content.mediaType) return null;

    const withoutDomain = remoteJid.split('@')[0];
    const cleanDigits = withoutDomain.split(':')[0].replace(/[^0-9]/g, '');
    const customerPhone = cleanDigits ? `+${cleanDigits}` : remoteJid;

    if (cleanDigits && remoteJid) {
      this.destinationJidCache.set(cleanDigits, remoteJid);
      this.destinationJidCache.set(`+${cleanDigits}`, remoteJid);
    }

    let mediaUrl = null;
    // Download media in real-time; during bulk history sync, download on demand or background
    if (content.mediaType && !isHistorySync) {
      mediaUrl = await this.downloadAndSaveIncomingMedia(sock, msg, accountId, content.mediaType, content.mimetype);
    }

    const messageRecord = {
      id: msgId,
      accountId,
      remoteJid,
      customerPhone,
      customerName: msg.pushName || '',
      fromMe,
      text: content.text,
      mediaType: content.mediaType,
      mediaUrl,
      fileName: content.fileName || null,
      mimetype: content.mimetype || null,
      timestamp: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()
    };

    store.addMessage(messageRecord);
    this.emit('message', messageRecord);
    return messageRecord;
  }

  async initAccount(accountId) {
    if (!accountId) throw new Error('accountId is required');

    let session = this.sessions.get(accountId);

    if (session && session.status === 'CONNECTED' && session.sock) {
      return this.getAccountStatus(accountId);
    }

    if (session && session.sock) {
      try {
        session.sock.ev.removeAllListeners();
        session.sock.end(undefined);
      } catch (e) {}
    }

    const sessionDir = this.getAccountSessionDir(accountId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    session = {
      accountId,
      status: 'CONNECTING',
      sock: null,
      qr: null,
      qrDataUrl: null,
      userInfo: null,
      lastError: null,
      lastConnectedAt: null
    };
    this.sessions.set(accountId, session);
    this.emit('status', { accountId, status: 'CONNECTING' });

    try {
      const sock = makeWASocket({
        auth: state,
        logger: this.logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        markOnlineOnConnect: true,
        emitOwnEvents: true
      });

      session.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      // 1. Connection updates
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          session.status = 'SCAN_QR';
          session.qr = qr;
          try {
            session.qrDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
          } catch (e) {
            session.qrDataUrl = null;
          }

          store.saveAccount({
            id: accountId,
            status: 'SCAN_QR',
            qrDataUrl: session.qrDataUrl
          });

          this.emit('qr', { accountId, qr, qrDataUrl: session.qrDataUrl });
          this.emit('status', { accountId, status: 'SCAN_QR', qrDataUrl: session.qrDataUrl });
        }

        if (connection === 'open') {
          const userJid = sock.user?.id || '';
          const rawPhone = userJid.split(':')[0] || userJid.split('@')[0];
          const phone = rawPhone ? `+${rawPhone.replace(/[^0-9]/g, '')}` : null;
          const name = sock.user?.name || null;

          session.status = 'CONNECTED';
          session.qr = null;
          session.qrDataUrl = null;
          session.lastConnectedAt = new Date().toISOString();
          session.userInfo = { jid: userJid, phone, name };

          store.saveAccount({
            id: accountId,
            phone,
            status: 'CONNECTED',
            lastConnectedAt: session.lastConnectedAt
          });

          this.emit('status', { accountId, status: 'CONNECTED', phone, name });
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

          session.qr = null;
          session.qrDataUrl = null;

          if (isLoggedOut) {
            session.status = 'REAUTH_REQUIRED';
            session.lastError = 'Session unlinked or logged out from WhatsApp';
            this.clearSessionFolder(sessionDir);
            try {
              sock.ev.removeAllListeners();
            } catch (e) {}
            session.sock = null;
            this.emit('status', { accountId, status: 'REAUTH_REQUIRED', error: session.lastError });
          } else {
            session.status = 'DISCONNECTED';
            session.lastError = lastDisconnect?.error?.message || 'Connection closed';
            this.emit('status', { accountId, status: 'DISCONNECTED', error: session.lastError });

            const shouldReconnect = statusCode !== DisconnectReason.connectionReplaced;
            if (shouldReconnect) {
              setTimeout(() => {
                const cur = this.sessions.get(accountId);
                if (cur && cur.status === 'DISCONNECTED') {
                  this.initAccount(accountId).catch(() => {});
                }
              }, 4000);
            }
          }
        }
      });

      // 2. Chat history sync from phone (initial bootstrap or reconnect)
      sock.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
        console.log(`[WaCRM] Full phone sync received for ${accountId}: ${chats?.length || 0} chats, ${messages?.length || 0} messages, ${contacts?.length || 0} contacts`);

        // Register all contacts from phone
        if (Array.isArray(contacts)) {
          for (const c of contacts) {
            const name = c.name || c.notify || c.verifiedName;
            if (name && c.id) {
              store.saveContact(accountId, c.id, name);
              const clean = c.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
              if (clean) this.destinationJidCache.set(clean, c.id);
            }
          }
        }

        // Register all chats from phone
        if (Array.isArray(chats)) {
          for (const c of chats) {
            store.saveChat(accountId, c);
            const clean = c.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (clean) this.destinationJidCache.set(clean, c.id);
          }
        }

        // Ingest historical messages
        if (Array.isArray(messages)) {
          for (const msg of messages) {
            try {
              await this.processIncomingMessage(sock, msg, accountId, true);
            } catch (err) {}
          }
        }

        this.emit('history_synced', {
          accountId,
          chatsCount: chats?.length || 0,
          messagesCount: messages?.length || 0
        });
      });

      // 3. Phone-side chat updates (chats created or updated on mobile)
      sock.ev.on('chats.upsert', (newChats) => {
        for (const c of newChats) {
          store.saveChat(accountId, c);
        }
        this.emit('chats_updated', { accountId });
      });

      sock.ev.on('chats.update', (updatedChats) => {
        for (const c of updatedChats) {
          store.saveChat(accountId, c);
        }
        this.emit('chats_updated', { accountId });
      });

      // 4. Contact sync updates
      sock.ev.on('contacts.upsert', (newContacts) => {
        for (const c of newContacts) {
          const name = c.name || c.notify || c.verifiedName;
          if (name && c.id) store.saveContact(accountId, c.id, name);
        }
      });

      sock.ev.on('contacts.update', (updatedContacts) => {
        for (const c of updatedContacts) {
          const name = c.name || c.notify || c.verifiedName;
          if (name && c.id) store.saveContact(accountId, c.id, name);
        }
      });

      // 5. Incoming and phone-sent messages (real-time stream)
      sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || !m.messages.length) return;

        for (const msg of m.messages) {
          try {
            await this.processIncomingMessage(sock, msg, accountId, false);
          } catch (err) {
            console.warn('[WaCRM] Error processing message:', err.message);
          }
        }
      });

      return this.getAccountStatus(accountId);
    } catch (err) {
      session.status = 'ERROR';
      session.lastError = err.message;
      this.emit('status', { accountId, status: 'ERROR', error: err.message });
      throw err;
    }
  }

  // Request on-demand chat history from phone for a conversation
  async syncChatFromPhone(accountId, remoteJid) {
    const session = this.sessions.get(accountId);
    if (!session || !session.sock || session.status !== 'CONNECTED') {
      return false;
    }

    try {
      const messages = store.getMessages(accountId, remoteJid);
      if (messages.length > 0 && session.sock.fetchMessageHistory) {
        const oldest = messages[0];
        const oldestKey = {
          remoteJid: oldest.remoteJid,
          id: oldest.id,
          fromMe: oldest.fromMe
        };
        const ts = new Date(oldest.timestamp).getTime();
        await session.sock.fetchMessageHistory(50, oldestKey, ts);
        return true;
      }
    } catch (err) {
      console.warn('[WaCRM] fetchMessageHistory warning:', err.message);
    }
    return false;
  }

  resolveDestinationJid(toPhoneOrJid) {
    if (toPhoneOrJid.includes('@lid')) {
      const user = toPhoneOrJid.split('@')[0].split(':')[0];
      return `${user}@lid`;
    }
    if (toPhoneOrJid.includes('@s.whatsapp.net')) {
      const cleanDigits = toPhoneOrJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      return `${cleanDigits}@s.whatsapp.net`;
    }
    if (toPhoneOrJid.includes('@g.us')) {
      return toPhoneOrJid;
    }

    const cleanDigits = toPhoneOrJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    if (this.destinationJidCache.has(cleanDigits)) {
      return this.destinationJidCache.get(cleanDigits);
    }
    if (this.destinationJidCache.has(`+${cleanDigits}`)) {
      return this.destinationJidCache.get(`+${cleanDigits}`);
    }
    if (!cleanDigits) {
      throw new Error(`Invalid destination phone number: "${toPhoneOrJid}"`);
    }
    return `${cleanDigits}@s.whatsapp.net`;
  }

  async sendMessage(accountId, toPhoneOrJid, text) {
    if (!accountId) throw new Error('accountId is required');
    if (!toPhoneOrJid) throw new Error('to destination is required');
    if (!text || !text.trim()) throw new Error('text message cannot be empty');

    const session = this.sessions.get(accountId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      throw new Error(`WhatsApp account "${accountId}" is not connected. Scan QR code to connect first.`);
    }

    const jid = this.resolveDestinationJid(toPhoneOrJid);
    const result = await session.sock.sendMessage(jid, { text });
    const sentMessageId = result?.key?.id;
    if (sentMessageId) {
      this.recordMessageId(sentMessageId);
    }

    const cleanDigits = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const customerPhone = cleanDigits ? `+${cleanDigits}` : jid;

    const record = {
      id: sentMessageId || `sent_${Date.now()}`,
      accountId,
      remoteJid: jid,
      customerPhone,
      customerName: '',
      fromMe: true,
      text,
      mediaType: null,
      mediaUrl: null,
      timestamp: new Date().toISOString()
    };

    store.addMessage(record);
    this.emit('message', record);
    return record;
  }

  async sendMedia(accountId, toPhoneOrJid, { mediaBuffer, mediaType, mimetype, fileName, caption }) {
    if (!accountId) throw new Error('accountId is required');
    if (!toPhoneOrJid) throw new Error('to destination is required');
    if (!mediaBuffer || !Buffer.isBuffer(mediaBuffer)) {
      throw new Error('Valid media buffer is required');
    }

    const session = this.sessions.get(accountId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      throw new Error(`WhatsApp account "${accountId}" is not connected. Scan QR code to connect first.`);
    }

    const jid = this.resolveDestinationJid(toPhoneOrJid);
    const textCaption = caption ? caption.trim() : '';

    let sendOptions = {};
    if (mediaType === 'image') {
      sendOptions = { image: mediaBuffer, caption: textCaption };
    } else if (mediaType === 'video') {
      sendOptions = { video: mediaBuffer, caption: textCaption };
    } else if (mediaType === 'audio') {
      sendOptions = { audio: mediaBuffer, mimetype: mimetype || 'audio/mp4', ptt: true };
    } else {
      sendOptions = {
        document: mediaBuffer,
        mimetype: mimetype || 'application/octet-stream',
        fileName: fileName || 'document',
        caption: textCaption
      };
    }

    const result = await session.sock.sendMessage(jid, sendOptions);
    const sentMessageId = result?.key?.id || `sent_${Date.now()}`;
    this.recordMessageId(sentMessageId);

    const ext = getMediaExtension(mimetype, mediaType);
    const safeMsgId = sentMessageId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const diskFilename = `${safeMsgId}.${ext}`;

    const accountMediaDir = path.join(this.mediaBasePath, accountId);
    if (!fs.existsSync(accountMediaDir)) {
      fs.mkdirSync(accountMediaDir, { recursive: true });
    }
    fs.writeFileSync(path.join(accountMediaDir, diskFilename), mediaBuffer);
    const mediaUrl = `/api/media/${accountId}/${diskFilename}`;

    const cleanDigits = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const customerPhone = cleanDigits ? `+${cleanDigits}` : jid;

    const record = {
      id: sentMessageId,
      accountId,
      remoteJid: jid,
      customerPhone,
      customerName: '',
      fromMe: true,
      text: textCaption,
      mediaType: mediaType || 'document',
      mediaUrl,
      fileName: fileName || diskFilename,
      mimetype: mimetype || null,
      timestamp: new Date().toISOString()
    };

    store.addMessage(record);
    this.emit('message', record);
    return record;
  }

  async disconnectAccount(accountId, logout = false) {
    const session = this.sessions.get(accountId);
    if (session && session.sock) {
      try {
        if (logout) {
          await session.sock.logout();
        } else {
          session.sock.end(undefined);
        }
      } catch (e) {}
    }

    if (logout) {
      const sessionDir = this.getAccountSessionDir(accountId);
      this.clearSessionFolder(sessionDir);
    }

    this.sessions.delete(accountId);
    this.emit('status', { accountId, status: 'DISCONNECTED' });
    return { success: true };
  }

  async deleteAccount(accountId) {
    await this.disconnectAccount(accountId, true);
    store.deleteAccount(accountId);
    this.emit('status', { accountId, status: 'DELETED' });
    return { success: true };
  }

  clearSessionFolder(sessionDir) {
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (e) {}
  }

  isDuplicateMessage(messageId) {
    return this.processedMessageIds.has(messageId);
  }

  recordMessageId(messageId) {
    this.processedMessageIds.set(messageId, Date.now());
  }

  cleanupDeduplicationCache() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    for (const [id, ts] of this.processedMessageIds.entries()) {
      if (now - ts > oneHour) {
        this.processedMessageIds.delete(id);
      }
    }
  }

  async autoRestore() {
    const accounts = store.getAccounts();
    for (const acc of accounts) {
      const dir = path.join(this.sessionBasePath, acc.id);
      if (fs.existsSync(dir)) {
        console.log(`[WaCRM] Restoring session for account: ${acc.name} (${acc.id})`);
        this.initAccount(acc.id).catch(err => {
          console.warn(`[WaCRM] Session auto-restore failed for ${acc.id}:`, err.message);
        });
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    for (const [, session] of this.sessions) {
      if (session.sock) {
        try {
          session.sock.end(undefined);
        } catch (e) {}
      }
    }
    this.sessions.clear();
  }

  // Compatibility helpers
  getBranchKey(tenantId, branchId) {
    return `${tenantId || 'tenant'}:${branchId}`;
  }
  getSessionDir(tenantId, branchId) {
    return this.getAccountSessionDir(`${tenantId || 'tenant'}_${branchId}`);
  }
  getSessionStatus(tenantId, branchId) {
    return this.getAccountStatus(`${tenantId || 'tenant'}_${branchId}`);
  }
  initSession(tenantId, branchId) {
    return this.initAccount(`${tenantId || 'tenant'}_${branchId}`);
  }
  disconnectSession(tenantId, branchId, logout = false) {
    return this.disconnectAccount(`${tenantId || 'tenant'}_${branchId}`, logout);
  }
}

module.exports = WhatsAppSessionManager;
