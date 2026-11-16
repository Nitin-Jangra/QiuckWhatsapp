require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const accountsRoutes = require('./routes/accounts');
const chatsRoutes = require('./routes/chats');
const eventsRoutes = require('./routes/events');
const whatsappRoutes = require('./routes/whatsapp');
const connector = require('./whatsapp/connector-service');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Increase payload limit to 50MB to support high-resolution photos and video sharing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Normalize duplicate /api prefixes
app.use((req, res, next) => {
  if (req.url.startsWith('/api/api/')) {
    req.url = req.url.replace('/api/api/', '/api/');
  }
  next();
});

// Ensure media storage folder exists and serve media files statically
const mediaDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}
app.use('/api/media', express.static(mediaDir));
app.use('/media', express.static(mediaDir));

// Core API Routes (supporting both /api/path and /path)
app.use('/api/accounts', accountsRoutes);
app.use('/accounts', accountsRoutes);

app.use('/api/chats', chatsRoutes);
app.use('/chats', chatsRoutes);

app.use('/api/messages', chatsRoutes);
app.use('/messages', chatsRoutes);

app.use('/api/events', eventsRoutes);
app.use('/events', eventsRoutes);

app.use('/api/whatsapp', whatsappRoutes);
app.use('/whatsapp', whatsappRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    accountsCount: store.getAccounts().length,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
app.get('/health', (req, res) => res.redirect('/api/health'));

// Production: serve built React frontend from client/dist if present
const clientDist = path.join(__dirname, '../../client/dist');
const prototypePublic = path.join(__dirname, '../public');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else if (fs.existsSync(prototypePublic)) {
  app.use(express.static(prototypePublic));
}

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, async () => {
    console.log(`[WaCRM] Single-User Multi-Account WhatsApp Hub running on http://localhost:${PORT}`);
    try {
      await connector.autoRestore();
    } catch (err) {
      console.warn('[WaCRM] Error during auto-restore:', err.message);
    }
  });
}

// Graceful cleanup on process exit
function cleanup() {
  console.log('\n[WaCRM] Cleaning up WhatsApp sessions and shutting down...');
  connector.destroy();
  if (server) {
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  if (msg.includes('Connection Closed') || err?.isBoom || err?.output?.statusCode === 428 || err?.output?.statusCode === 401) {
    return;
  }
  console.error('[WaCRM Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (msg.includes('Connection Closed') || reason?.isBoom || reason?.output?.statusCode === 428 || reason?.output?.statusCode === 401) {
    return;
  }
  console.error('[WaCRM Unhandled Rejection]:', reason);
});

module.exports = app;
