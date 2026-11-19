const express = require('express');
const router = express.Router();
const connector = require('../whatsapp/connector-service');
const auth = require('../auth');

const clients = new Set();

// Keep idle connections alive through proxies / Cloudflare (which drop silent streams)
setInterval(() => {
  for (const client of clients) {
    try {
      client.write(': keepalive\n\n');
    } catch (e) {
      clients.delete(client);
    }
  }
}, 25000).unref();

function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    // Multi-tenant check: User only receives events for accounts they own or have access to
    if (data?.accountId && !auth.canAccess(client.user, data.accountId)) continue;
    try {
      client.write(payload);
    } catch (e) {
      clients.delete(client);
    }
  }
}

// Hook into connector events
connector.on('status', (data) => broadcast('status', data));
connector.on('qr', (data) => broadcast('qr', data));
connector.on('message', (data) => broadcast('message', data));
connector.on('history_synced', (data) => broadcast('history_synced', data));
connector.on('chats_updated', (data) => broadcast('chats_updated', data));

router.get('/', (req, res) => {
  // Support authentication via query param token for native EventSource
  if (!req.user && req.query.token) {
    const uid = auth.readToken(req.query.token);
    if (uid) {
      const u = auth.getUserById(uid);
      if (u && u.active && u.status !== 'suspended') {
        req.user = auth.publicUser(u);
      }
    }
  }

  // Require auth if system requires auth
  if (auth.isAuthRequired && process.env.AUTH_REQUIRED === 'true' && !req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.user = req.user;
  clients.add(res);

  // Send initial ping
  res.write(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

module.exports = router;
