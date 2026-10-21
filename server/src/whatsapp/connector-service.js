const path = require('path');
const WhatsAppSessionManager = require('./session-manager');

const sessionBasePath = process.env.WA_SESSION_PATH || path.join(process.cwd(), 'wa_sessions');

const connector = new WhatsAppSessionManager({
  sessionBasePath,
  logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'warn'
});

module.exports = connector;
