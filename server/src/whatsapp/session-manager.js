const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// AES-256-GCM key for WhatsApp credential backups: SESSION_SECRET, else the random secret stored
// in the database at first start (auth.init). Never a hardcoded value.
const LEGACY_CREDS_KEY = crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'wacrm-secret-key-2026').digest();
const credsKey = () => crypto.createHash('sha256').update(process.env.SESSION_SECRET || require('../auth').secret()).digest();

class WhatsAppSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionBasePath = options.sessionBasePath || path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..'), 'wa_sessions');
    this.mediaBasePath = options.mediaBasePath || path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..'), 'media');
    this.sessions = new Map(); // accountId -> session object
    this.initPromises = new Map(); // accountId -> in-flight init (prevents two sockets on one session)
    this.waVersion = null;
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
    try {
      if (!fs.existsSync(this.mediaBasePath)) {
        fs.mkdirSync(this.mediaBasePath, { recursive: true });
      }
    } catch (e) {
      console.warn(`[WaCRM] Media directory error at ${this.mediaBasePath} (${e.message}). Falling back to local ./data/media`);
      this.mediaBasePath = path.join(__dirname, '..', '..', 'data', 'media');
      try { fs.mkdirSync(this.mediaBasePath, { recursive: true }); } catch (e2) {}
    }
  }

  getAccountSessionDir(accountId) {
    const safeId = (accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    let dir = path.join(this.sessionBasePath, safeId);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    } catch (e) {
      console.warn(`[WaCRM] Session directory error at ${dir} (${e.message}). Falling back to local ./data/wa_sessions`);
      this.sessionBasePath = path.join(__dirname, '..', '..', 'data', 'wa_sessions');
      dir = path.join(this.sessionBasePath, safeId);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e2) {}
      return dir;
    }
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

    if (this.isDuplicateMessage(msgId, accountId)) return null;
    this.recordMessageId(msgId, accountId);

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
      this.destinationJidCache.set(accountId + '|' + (cleanDigits), remoteJid);
      this.destinationJidCache.set(accountId + '|' + (`+${cleanDigits}`), remoteJid);
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

    await store.addMessage(messageRecord, { history: isHistorySync });
    this.emit('message', messageRecord);
    return messageRecord;
  }

  initAccount(accountId) {
    if (!accountId) return Promise.reject(new Error('accountId is required'));
    const running = this.initPromises.get(accountId);
    if (running) return running;
    const p = this._initAccount(accountId).finally(() => this.initPromises.delete(accountId));
    this.initPromises.set(accountId, p);
    return p;
  }

  // WhatsApp rejects outdated client versions; fetch once and reuse for all accounts
  async getWaVersion() {
    if (this.waVersion && Date.now() - this.waVersion.at < 60 * 60 * 1000) return this.waVersion.version;
    const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
    if (version) this.waVersion = { version, at: Date.now() };
    return version;
  }

  async _initAccount(accountId) {

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
    await this.restoreCredsFromDb(accountId, sessionDir);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    session = {
      accountId,
      status: 'CONNECTING',
      sock: null,
      qr: null,
      qrDataUrl: null,
      userInfo: null,
      lastError: null,
      lastConnectedAt: null,
      retries: session?.retries || 0
    };
    this.sessions.set(accountId, session);
    if (await store.getAccount(accountId)) {
      await store.saveAccount({ id: accountId, status: 'CONNECTING', lastError: null, qrDataUrl: null });
    }
    this.emit('status', { accountId, status: 'CONNECTING' });

    try {
      const version = await this.getWaVersion();
      const sock = makeWASocket({
        auth: state,
        ...(version && { version }),
        logger: this.logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        markOnlineOnConnect: true,
        emitOwnEvents: true
      });

      session.sock = sock;

      let pendingSave = Promise.resolve();
      session.credsFlush = () => pendingSave;
      sock.ev.on('creds.update', () => {
        pendingSave = pendingSave
          .then(() => saveCreds())
          .then(() => this.backupCredsToDb(accountId, sessionDir))
          .catch(() => {});
      });

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

          await store.saveAccount({
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

          const bare = (j) => (j || '').split(':')[0].split('@')[0];
          const twin = [...this.sessions.values()].find(
            s => s !== session && s.status === 'CONNECTED' && s.userInfo && bare(s.userInfo.jid) === bare(userJid)
          );
          if (twin) {
            // Same WhatsApp phone number already linked under another account: unlink this duplicate socket
            const twinAcc = await store.getAccount(twin.accountId);
            const twinName = twinAcc?.name || twin.accountId;
            session.status = 'DISCONNECTED';
            session.lastError = `This WhatsApp number (${phone}) is already added as "${twinName}". Each connected account must be a distinct WhatsApp phone number.`;
            try { sock.ev.removeAllListeners(); } catch (e) {}
            try { await sock.logout(); } catch (e) {}
            try { sock.end(undefined); } catch (e) {}
            session.sock = null;
            this.clearSessionFolder(sessionDir);
            await store.saveAccount({
              id: accountId,
              status: 'DISCONNECTED',
              lastError: session.lastError,
              qrDataUrl: null
            });
            this.emit('status', { accountId, status: 'DISCONNECTED', error: session.lastError });
            return;
          }

          session.status = 'CONNECTED';
          session.retries = 0;
          session.qr = null;
          session.qrDataUrl = null;
          session.lastConnectedAt = new Date().toISOString();
          session.lastError = null;
          session.userInfo = { jid: userJid, phone, name };

          await store.saveAccount({
            id: accountId,
            phone,
            status: 'CONNECTED',
            lastConnectedAt: session.lastConnectedAt,
            lastError: null,
            qrDataUrl: null
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
            await store.saveAccount({
              id: accountId,
              status: 'REAUTH_REQUIRED',
              lastError: session.lastError,
              qrDataUrl: null
            });
            this.emit('status', { accountId, status: 'REAUTH_REQUIRED', error: session.lastError });
          } else if (statusCode === DisconnectReason.restartRequired) {
            session.status = 'CONNECTING';
            session.lastError = null;
            this.emit('status', { accountId, status: 'CONNECTING' });
            try { await session.credsFlush?.(); } catch (e) {}
            try { sock.ev.removeAllListeners(); } catch (e) {}
            this.initAccount(accountId).catch(err => {
              console.warn(`[WaCRM] Reconnect after pairing failed for ${accountId}:`, err.message);
            });
          } else {
            const hints = {
              408: 'QR code expired or connection timed out',
              428: 'Connection closed by WhatsApp',
              440: 'This WhatsApp session was opened somewhere else (same account running on another server or device)',
              500: 'Saved session is corrupted',
              411: 'Saved session is out of date',
              515: 'WhatsApp requested a restart (normal right after scanning)'
            };
            const reason = hints[statusCode] || lastDisconnect?.error?.message || 'Connection closed';
            console.warn(`[WaCRM] Account ${accountId} closed: code=${statusCode ?? 'n/a'} ${reason}`);

            // Corrupted/outdated saved session can never reconnect: wipe it so a fresh QR is issued
            if (statusCode === 500 || statusCode === 411) {
              this.clearSessionFolder(sessionDir);
            }

            session.status = 'DISCONNECTED';
            session.lastError = `${reason}${statusCode ? ` (code ${statusCode})` : ''}`;
            await store.saveAccount({
              id: accountId,
              status: 'DISCONNECTED',
              lastError: session.lastError,
              qrDataUrl: null
            });
            this.emit('status', { accountId, status: 'DISCONNECTED', error: session.lastError });

            const shouldReconnect = statusCode !== DisconnectReason.connectionReplaced;
            if (shouldReconnect) {
              // Exponential backoff (4s, 8s, 16s ... capped at 5 min); resets once connected
              session.retries = (session.retries || 0) + 1;
              const delay = statusCode === DisconnectReason.restartRequired ? 300 : Math.min(4000 * 2 ** (session.retries - 1), 300000);
              setTimeout(() => {
                const cur = this.sessions.get(accountId);
                if (cur && cur.status === 'DISCONNECTED') {
                  this.initAccount(accountId).catch(() => {});
                }
              }, delay);
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
              await store.saveContact(accountId, c.id, name);
              const clean = c.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
              if (clean) this.destinationJidCache.set(accountId + '|' + (clean), c.id);
            }
          }
        }

        // Register all chats from phone - cache destination JIDs for routing,
        // but avoid populating hundreds of empty ghost chats without unread messages or real content
        if (Array.isArray(chats)) {
          for (const c of chats) {
            const clean = c.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
            if (clean) this.destinationJidCache.set(accountId + '|' + (clean), c.id);
            if (c.unreadCount > 0) {
              await store.saveChat(accountId, c);
            }
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
      sock.ev.on('chats.upsert', async (newChats) => {
        for (const c of newChats) {
          await store.saveChat(accountId, c).catch(() => {});
        }
        this.emit('chats_updated', { accountId });
      });

      sock.ev.on('chats.update', async (updatedChats) => {
        for (const c of updatedChats) {
          await store.saveChat(accountId, c).catch(() => {});
        }
        this.emit('chats_updated', { accountId });
      });

      // 4. Contact sync updates
      sock.ev.on('contacts.upsert', async (newContacts) => {
        for (const c of newContacts) {
          const name = c.name || c.notify || c.verifiedName;
          if (name && c.id) await store.saveContact(accountId, c.id, name).catch(() => {});
        }
      });

      sock.ev.on('contacts.update', async (updatedContacts) => {
        for (const c of updatedContacts) {
          const name = c.name || c.notify || c.verifiedName;
          if (name && c.id) await store.saveContact(accountId, c.id, name).catch(() => {});
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
      const messages = await store.getMessages(accountId, remoteJid);
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

  resolveDestinationJid(toPhoneOrJid, accountId = '') {
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
    const cached = this.destinationJidCache.get(`${accountId}|${cleanDigits}`);
    if (cached) return cached;
    if (!cleanDigits) {
      throw new Error(`Invalid destination phone number: "${toPhoneOrJid}"`);
    }
    return `${cleanDigits}@s.whatsapp.net`;
  }

  async sendMessage(accountId, toPhoneOrJid, text, { sentBy = null } = {}) {
    if (!accountId) throw new Error('accountId is required');
    if (!toPhoneOrJid) throw new Error('to destination is required');
    if (!text || !text.trim()) throw new Error('text message cannot be empty');

    const session = this.sessions.get(accountId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      throw new Error(`WhatsApp account "${accountId}" is not connected. Scan QR code to connect first.`);
    }

    const jid = this.resolveDestinationJid(toPhoneOrJid, accountId);
    const result = await session.sock.sendMessage(jid, { text });
    const sentMessageId = result?.key?.id;
    if (sentMessageId) {
      this.recordMessageId(sentMessageId, accountId);
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

    if (sentBy) record.sentBy = sentBy; // internal attribution only; never sent to WhatsApp
    await store.addMessage(record);
    this.emit('message', record);
    return record;
  }

  async sendMedia(accountId, toPhoneOrJid, { mediaBuffer, mediaType, mimetype, fileName, caption, sentBy = null }) {
    if (!accountId) throw new Error('accountId is required');
    if (!toPhoneOrJid) throw new Error('to destination is required');
    if (!mediaBuffer || !Buffer.isBuffer(mediaBuffer)) {
      throw new Error('Valid media buffer is required');
    }

    const session = this.sessions.get(accountId);
    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      throw new Error(`WhatsApp account "${accountId}" is not connected. Scan QR code to connect first.`);
    }

    const jid = this.resolveDestinationJid(toPhoneOrJid, accountId);
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
    this.recordMessageId(sentMessageId, accountId);

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

    if (sentBy) record.sentBy = sentBy; // internal attribution only; never sent to WhatsApp
    await store.addMessage(record);
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
    await store.deleteAccount(accountId);
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

  // Encrypted credential backup to database (AES-256-GCM)
  async backupCredsToDb(accountId, sessionDir) {
    try {
      const credsFile = path.join(sessionDir, 'creds.json');
      if (!fs.existsSync(credsFile)) return;
      const raw = fs.readFileSync(credsFile, 'utf8');
      const key = credsKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(raw, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');

      const db = require('../db');
      const acc = await store.getAccount(accountId);
      await db.run(`
        INSERT INTO whatsapp_sessions (account_id, user_id, encrypted_creds, iv, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          user_id = excluded.user_id,
          encrypted_creds = excluded.encrypted_creds,
          iv = excluded.iv,
          updated_at = excluded.updated_at
      `, accountId, acc?.userId || null, `${encrypted}:${authTag}`, iv.toString('hex'), new Date().toISOString());
    } catch (err) {
      // Non-fatal during high frequency auth writes
    }
  }

  // Restore encrypted credentials from database if missing locally
  async restoreCredsFromDb(accountId, sessionDir) {
    try {
      const credsFile = path.join(sessionDir, 'creds.json');
      if (fs.existsSync(credsFile)) return true;

      const db = require('../db');
      const row = await db.get('SELECT encrypted_creds, iv FROM whatsapp_sessions WHERE account_id = ?', accountId);
      if (!row || !row.encrypted_creds || !row.iv) return false;

      const [encrypted, authTag] = row.encrypted_creds.split(':');
      if (!encrypted || !authTag) return false;

      // Current key first; legacy key only so backups written by older versions still restore
      let decrypted = null;
      for (const key of [credsKey(), LEGACY_CREDS_KEY]) {
        try {
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'hex'));
          decipher.setAuthTag(Buffer.from(authTag, 'hex'));
          decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
          break;
        } catch (e) {}
      }
      if (!decrypted) return false;

      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(credsFile, decrypted, 'utf8');
      return true;
    } catch (err) {
      return false;
    }
  }

  isDuplicateMessage(messageId, accountId = '') {
    return this.processedMessageIds.has(`${accountId}:${messageId}`);
  }

  recordMessageId(messageId, accountId = '') {
    this.processedMessageIds.set(`${accountId}:${messageId}`, Date.now());
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
    const accounts = await store.getAccounts();
    for (const acc of accounts) {
      const dir = path.join(this.sessionBasePath, acc.id);
      const credsFile = path.join(dir, 'creds.json');
      if (fs.existsSync(credsFile) || (await this.restoreCredsFromDb(acc.id, dir))) {
        console.log(`[WaCRM] Restoring authenticated WhatsApp session for: ${acc.name} (${acc.id})`);
        this.initAccount(acc.id).catch(err => {
          console.warn(`[WaCRM] Session auto-restore failed for ${acc.id}:`, err.message);
        });
        // Stagger logins; WhatsApp can throttle many simultaneous connections
        await new Promise(r => setTimeout(r, 2000));
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
