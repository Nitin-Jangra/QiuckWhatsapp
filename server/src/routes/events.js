const express = require('express');
const router = express.Router();
const connector = require('../whatsapp/connector-service');
const auth = require('../auth');

const clients = new Set();

const drop = (client) => {
  try { client.end(); } catch (e) {}
  clients.delete(client);
};

// Re-resolve the client's session from the database: picks up deactivation, revocation and
// permission / access changes immediately, including changes made by other backend instances.
async function refresh(client) {
  if (!auth.isAuthRequired()) return true;
  const resolved = await auth.userFromToken(client.token).catch(() => null);
  if (!resolved) {
    drop(client);
    return false;
  }
  client.user = resolved.user;
  return true;
}

// Keep idle connections alive through proxies, and drop sessions revoked elsewhere
setInterval(async () => {
  for (const client of [...clients]) {
    if (!(await refresh(client))) continue;
    try {
      client.write(': keepalive\n\n');
    } catch (e) {
      clients.delete(client);
    }
  }
}, 25000).unref();

// Same-instance revocation closes streams instantly
auth.events.on('revoked', (userId) => {
  for (const client of [...clients]) if (client.user?.id === userId) drop(client);
});

const CHAT_EVENTS = ['message', 'history_synced', 'chats_updated', 'viewing'];

async function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {
    try {
      if (!(await refresh(client))) continue;
      // Tenant + account-level authorization per recipient
      if (data?.accountId && !(await auth.canAccess(client.user, data.accountId))) continue;
      if (CHAT_EVENTS.includes(eventType) && !auth.can(client.user, 'chats.view')) continue;
      client.write(payload);
    } catch (e) {
      clients.delete(client);
    }
  }
}

// Active-handler presence: `${accountId}|${remoteJid}` -> Map(userId -> { name, at })
const viewing = new Map();
const VIEW_TTL_MS = 30000;
async function markViewing(accountId, remoteJid, who) {
  const key = `${accountId}|${remoteJid}`;
  const now = Date.now();
  const map = viewing.get(key) || new Map();
  if (who) map.set(who.id, { id: who.id, name: who.name, at: now });
  for (const [id, v] of map) if (now - v.at > VIEW_TTL_MS) map.delete(id);
  viewing.set(key, map);
  const viewers = [...map.values()].map(({ id, name }) => ({ id, name }));
  await broadcast('viewing', { accountId, remoteJid, viewers });
  return viewers;
}

// Hook into connector events (errors are logged, never crash the process)
const relay = (type) => (data) => broadcast(type, data).catch(err => console.warn(`[WaCRM] SSE ${type} broadcast failed:`, err.message));
for (const type of ['status', 'qr', 'message', 'history_synced', 'chats_updated']) connector.on(type, relay(type));

router.get('/', async (req, res) => {
  const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE] || req.query.token || null;
  // Support authentication via query param token for native EventSource
  if ((!req.user || typeof req.user.id !== 'number') && req.query.token) {
    const resolved = await auth.userFromToken(req.query.token);
    if (resolved) req.user = resolved.user;
  }

  if (auth.isAuthRequired() && !req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.user = req.user;
  res.token = token;
  clients.add(res);

  // Send initial ping
  res.write(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

router.broadcast = broadcast;
router.markViewing = markViewing;
router.clientCount = () => clients.size;
module.exports = router;
