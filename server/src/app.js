require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const whatsappRoutes = require('./routes/whatsapp');
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenants');
const branchRoutes = require('./routes/branches');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const connector = require('./whatsapp/connector-service');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static prototype UI
app.use(express.static(path.join(__dirname, '../public')));

// Phase 1: Authentication and Management Routes
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);

// WhatsApp connector routes
app.use('/api/whatsapp', whatsappRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`[WaCRM Server] Running on http://localhost:${PORT}`);
    console.log(`[WaCRM Phase 0] WhatsApp Feasibility prototype available at http://localhost:${PORT}`);
  });
}

// Graceful cleanup on process exit
function cleanup() {
  console.log('\n[WaCRM Server] Cleaning up WhatsApp sessions and shutting down...');
  connector.destroy();
  if (server) {
    server.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Prevent unhandled Baileys socket closure rejections from terminating the server process
process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  if (msg.includes('Connection Closed') || err?.isBoom || err?.output?.statusCode === 428 || err?.output?.statusCode === 401) {
    console.warn('[WaCRM Baileys Warning] Handled socket connection close:', msg);
    return;
  }
  console.error('[WaCRM Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (msg.includes('Connection Closed') || reason?.isBoom || reason?.output?.statusCode === 428 || reason?.output?.statusCode === 401) {
    console.warn('[WaCRM Baileys Warning] Handled unhandled rejection on closed socket:', msg);
    return;
  }
  console.error('[WaCRM Unhandled Rejection]:', reason);
});

module.exports = app;
