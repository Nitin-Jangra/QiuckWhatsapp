const WhatsAppSessionManager = require('./session-manager');

// Session folder defaults to <DATA_DIR or server>/wa_sessions; override with WA_SESSION_PATH
const connector = new WhatsAppSessionManager({
  sessionBasePath: process.env.WA_SESSION_PATH || undefined,
  logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'warn'
});

module.exports = connector;
