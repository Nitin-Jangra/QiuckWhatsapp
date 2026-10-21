const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');

class WhatsAppSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionBasePath = options.sessionBasePath || path.join(process.cwd(), 'wa_sessions');
    this.sessions = new Map(); // key: branchKey -> { sock, status, qr, qrDataUrl, userInfo, lastError }
    this.processedMessageIds = new Map(); // msgId -> timestamp for deduplication
    this.destinationJidCache = new Map(); // phone/digits -> original remoteJid for reliable reply routing
    this.logger = pino({ level: options.logLevel || 'silent' });

    // Periodically clean up message deduplication cache older than 1 hour
    this.cleanupTimer = setInterval(() => this.cleanupDeduplicationCache(), 15 * 60 * 1000);
    if (this.cleanupTimer && this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  getBranchKey(tenantId, branchId) {
    return `${tenantId || 'tenant'}:${branchId}`;
  }

  getSessionDir(tenantId, branchId) {
    const safeTenant = (tenantId || 'tenant').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBranch = branchId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(this.sessionBasePath, safeTenant, safeBranch);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getSessionStatus(tenantId, branchId) {
    const key = this.getBranchKey(tenantId, branchId);
    const session = this.sessions.get(key);
    if (!session) {
      return {
        status: 'DISCONNECTED',
        phone: null,
        qrDataUrl: null,
        lastError: null,
        lastConnectedAt: null
      };
    }
    return {
      status: session.status,
      phone: session.userInfo?.phone || null,
      name: session.userInfo?.name || null,
      qrDataUrl: session.status === 'SCAN_QR' ? session.qrDataUrl : null,
      lastError: session.lastError || null,
      lastConnectedAt: session.lastConnectedAt || null
    };
  }

  async initSession(tenantId, branchId) {
    const key = this.getBranchKey(tenantId, branchId);
    let session = this.sessions.get(key);

    // If already connected, return status
    if (session && session.status === 'CONNECTED' && session.sock) {
      return this.getSessionStatus(tenantId, branchId);
    }

    // Clean up existing socket if any
    if (session && session.sock) {
      try {
        session.sock.ev.removeAllListeners();
        session.sock.end(undefined);
      } catch (err) {
        // ignore close error
      }
    }

    const sessionDir = this.getSessionDir(tenantId, branchId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    session = {
      tenantId,
      branchId,
      status: 'CONNECTING',
      sock: null,
      qr: null,
      qrDataUrl: null,
      userInfo: null,
      lastError: null,
      lastConnectedAt: null
    };
    this.sessions.set(key, session);
    this.emit('status', { tenantId, branchId, status: 'CONNECTING' });

    try {
      const sock = makeWASocket({
        auth: state,
        logger: this.logger,
        printQRInTerminal: false,
        syncFullHistory: false
      });

      session.sock = sock;

      // Handle creds updates for multi-file state persistence
      sock.ev.on('creds.update', saveCreds);

      // Handle connection updates (QR code, connect, disconnect)
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          session.status = 'SCAN_QR';
          session.qr = qr;
          try {
            session.qrDataUrl = await QRCode.toDataURL(qr);
          } catch (e) {
            session.qrDataUrl = null;
          }
          this.emit('qr', {
            tenantId,
            branchId,
            qr,
            qrDataUrl: session.qrDataUrl
          });
          this.emit('status', {
            tenantId,
            branchId,
            status: 'SCAN_QR',
            qrDataUrl: session.qrDataUrl
          });
        }

        if (connection === 'open') {
          const userJid = sock.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0];
          session.status = 'CONNECTED';
          session.qr = null;
          session.qrDataUrl = null;
          session.lastConnectedAt = new Date().toISOString();
          session.userInfo = {
            jid: userJid,
            phone,
            name: sock.user?.name || null
          };
          this.emit('status', {
            tenantId,
            branchId,
            status: 'CONNECTED',
            phone,
            name: session.userInfo.name
          });
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

          session.qr = null;
          session.qrDataUrl = null;

          if (isLoggedOut) {
            session.status = 'REAUTH_REQUIRED';
            session.lastError = 'Session unlinked or logged out from device';
            // Clean up session folder since credentials are no longer valid
            this.clearSessionFolder(sessionDir);
            try {
              sock.ev.removeAllListeners();
            } catch (e) {}
            session.sock = null;
            this.emit('status', { tenantId, branchId, status: 'REAUTH_REQUIRED', error: session.lastError });
          } else {
            session.status = 'DISCONNECTED';
            session.lastError = lastDisconnect?.error?.message || 'Connection closed';
            this.emit('status', { tenantId, branchId, status: 'DISCONNECTED', error: session.lastError });

            // Automatically attempt reconnect after a short delay for transient disconnects
            const shouldReconnect = statusCode !== DisconnectReason.connectionReplaced;
            if (shouldReconnect) {
              setTimeout(() => {
                const currentSession = this.sessions.get(key);
                if (currentSession && currentSession.status === 'DISCONNECTED') {
                  this.initSession(tenantId, branchId).catch(() => {});
                }
              }, 4000);
            }
          }
        }
      });

      // Handle incoming messages
      sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || !m.messages.length) return;

        for (const msg of m.messages) {
          const msgId = msg.key.id;
          if (!msgId) continue;

          // Deduplication check
          if (this.isDuplicateMessage(msgId)) {
            continue;
          }
          this.recordMessageId(msgId);

          const fromMe = msg.key.fromMe || false;
          const remoteJid = msg.key.remoteJid;

          // Ignore status broadcasts
          if (remoteJid === 'status@broadcast') continue;

          const text = msg.message?.conversation ||
                       msg.message?.extendedTextMessage?.text ||
                       msg.message?.imageMessage?.caption || '';

          // Cleanly extract customer phone and user JID without device suffix (:0, :1)
          const rawJid = remoteJid || '';
          const withoutDomain = rawJid.split('@')[0];
          const cleanDigits = withoutDomain.split(':')[0].replace(/[^0-9]/g, '');
          const customerPhone = cleanDigits ? `+${cleanDigits}` : rawJid;

          // Save destination mapping for reliable reply resolution (handles both standard numbers & @lid privacy IDs)
          if (cleanDigits && rawJid) {
            this.destinationJidCache.set(cleanDigits, rawJid);
            this.destinationJidCache.set(`+${cleanDigits}`, rawJid);
          }

          const payload = {
            tenantId,
            branchId,
            messageId: msgId,
            remoteJid: rawJid,
            customerPhone,
            pushName: msg.pushName || '',
            fromMe,
            text,
            timestamp: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()
          };

          this.emit('message', payload);
        }
      });

      return this.getSessionStatus(tenantId, branchId);
    } catch (error) {
      session.status = 'ERROR';
      session.lastError = error.message;
      this.emit('status', { tenantId, branchId, status: 'ERROR', error: error.message });
      throw error;
    }
  }

  async sendMessage(tenantId, branchId, toPhoneOrJid, text) {
    const key = this.getBranchKey(tenantId, branchId);
    const session = this.sessions.get(key);

    if (!session || session.status !== 'CONNECTED' || !session.sock) {
      throw new Error(`WhatsApp session for branch ${branchId} is not connected. Please pair via QR code first.`);
    }

    let jid;
    // 1. Direct JID format (@lid, @s.whatsapp.net, @g.us)
    if (toPhoneOrJid.includes('@lid')) {
      const user = toPhoneOrJid.split('@')[0].split(':')[0];
      jid = `${user}@lid`;
    } else if (toPhoneOrJid.includes('@s.whatsapp.net')) {
      const cleanDigits = toPhoneOrJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      jid = `${cleanDigits}@s.whatsapp.net`;
    } else if (toPhoneOrJid.includes('@g.us')) {
      jid = toPhoneOrJid;
    } else {
      // 2. Phone digits: check if we have a known cached remoteJid for this contact (e.g. from an @lid inbound chat)
      const cleanDigits = toPhoneOrJid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
      if (this.destinationJidCache.has(cleanDigits)) {
        jid = this.destinationJidCache.get(cleanDigits);
      } else if (this.destinationJidCache.has(`+${cleanDigits}`)) {
        jid = this.destinationJidCache.get(`+${cleanDigits}`);
      } else {
        if (!cleanDigits) {
          throw new Error(`Invalid destination phone number: "${toPhoneOrJid}"`);
        }
        jid = `${cleanDigits}@s.whatsapp.net`;
      }
    }

    const result = await session.sock.sendMessage(jid, { text });

    const sentMessageId = result?.key?.id;
    if (sentMessageId) {
      this.recordMessageId(sentMessageId);
    }

    return {
      messageId: sentMessageId,
      jid,
      timestamp: new Date().toISOString()
    };
  }

  async disconnectSession(tenantId, branchId, logout = false) {
    const key = this.getBranchKey(tenantId, branchId);
    const session = this.sessions.get(key);

    if (session && session.sock) {
      try {
        if (logout) {
          await session.sock.logout();
        } else {
          session.sock.end(undefined);
        }
      } catch (err) {
        // ignore
      }
    }

    if (logout) {
      const sessionDir = this.getSessionDir(tenantId, branchId);
      this.clearSessionFolder(sessionDir);
    }

    this.sessions.delete(key);
    this.emit('status', { tenantId, branchId, status: 'DISCONNECTED' });
    return { success: true };
  }

  clearSessionFolder(sessionDir) {
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (e) {
      // ignore
    }
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
}

module.exports = WhatsAppSessionManager;
