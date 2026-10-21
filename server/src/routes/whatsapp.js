const express = require('express');
const router = express.Router();
const connector = require('../whatsapp/connector-service');

// In-memory prototype store for Phase 0 feasibility testing
const messageStore = [];

// Listen for incoming messages from connector
connector.on('message', (msg) => {
  messageStore.unshift(msg);
  // Keep last 100 messages in memory for prototype
  if (messageStore.length > 100) messageStore.pop();
});

// SSE clients map: branchKey -> Set of response objects
const sseClients = new Map();

function sendSseEvent(branchKey, eventType, data) {
  const clients = sseClients.get(branchKey);
  if (!clients) return;
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (e) {
      clients.delete(res);
    }
  }
}

// Forward connector events to SSE clients
connector.on('status', (data) => {
  const branchKey = connector.getBranchKey(data.tenantId, data.branchId);
  sendSseEvent(branchKey, 'status', data);
});

connector.on('qr', (data) => {
  const branchKey = connector.getBranchKey(data.tenantId, data.branchId);
  sendSseEvent(branchKey, 'qr', data);
});

connector.on('message', (data) => {
  const branchKey = connector.getBranchKey(data.tenantId, data.branchId);
  sendSseEvent(branchKey, 'message', data);
});

// 1. Get Connection Status
router.get('/status', (req, res) => {
  const tenantId = req.query.tenantId || 'tenant-demo';
  const branchId = req.query.branchId || 'branch-main';
  const status = connector.getSessionStatus(tenantId, branchId);
  res.json({ success: true, data: status });
});

// 2. Connect / Initialize session
router.post('/connect', async (req, res) => {
  try {
    const tenantId = req.body.tenantId || 'tenant-demo';
    const branchId = req.body.branchId || 'branch-main';
    const status = await connector.initSession(tenantId, branchId);
    res.json({ success: true, message: 'Connection initialized', data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Reconnect session (resets and issues new QR if required)
router.post('/reconnect', async (req, res) => {
  try {
    const tenantId = req.body.tenantId || 'tenant-demo';
    const branchId = req.body.branchId || 'branch-main';
    await connector.disconnectSession(tenantId, branchId, false);
    const status = await connector.initSession(tenantId, branchId);
    res.json({ success: true, message: 'Reconnection triggered', data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Disconnect session
router.post('/disconnect', async (req, res) => {
  try {
    const tenantId = req.body.tenantId || 'tenant-demo';
    const branchId = req.body.branchId || 'branch-main';
    const logout = Boolean(req.body.logout);
    const result = await connector.disconnectSession(tenantId, branchId, logout);
    res.json({ success: true, message: logout ? 'Logged out and session cleared' : 'Disconnected', data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Send WhatsApp Message
router.post('/send', async (req, res) => {
  try {
    const tenantId = req.body.tenantId || 'tenant-demo';
    const branchId = req.body.branchId || 'branch-main';
    const { to, text, remoteJid } = req.body;

    if (!to || !text) {
      return res.status(400).json({ success: false, error: 'Parameters "to" and "text" are required' });
    }

    const targetDestination = remoteJid || to;
    const result = await connector.sendMessage(tenantId, branchId, targetDestination, text);
    const cleanDigits = to.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    const sentMsg = {
      tenantId,
      branchId,
      messageId: result.messageId,
      remoteJid: result.jid,
      customerPhone: cleanDigits ? `+${cleanDigits}` : to,
      fromMe: true,
      text,
      timestamp: result.timestamp
    };
    messageStore.unshift(sentMsg);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Get Messages (Inbox)
router.get('/messages', (req, res) => {
  const tenantId = req.query.tenantId || 'tenant-demo';
  const branchId = req.query.branchId || 'branch-main';
  const filtered = messageStore.filter(
    (m) => m.tenantId === tenantId && m.branchId === branchId && m.text && m.text.trim() && !(m.fromMe && m.remoteJid && m.remoteJid.endsWith('@lid'))
  );
  res.json({ success: true, data: filtered });
});

// Clear Messages (Inbox)
router.delete('/messages', (req, res) => {
  const tenantId = req.query.tenantId || 'tenant-demo';
  const branchId = req.query.branchId || 'branch-main';
  const phone = req.query.phone;
  for (let i = messageStore.length - 1; i >= 0; i--) {
    const m = messageStore[i];
    if (m.tenantId === tenantId && m.branchId === branchId) {
      if (!phone || m.customerPhone === phone || m.remoteJid === phone) {
        messageStore.splice(i, 1);
      }
    }
  }
  res.json({ success: true, message: 'Message history cleared' });
});

// 7. Real-Time Server-Sent Events (SSE) Stream
router.get('/events', (req, res) => {
  const tenantId = req.query.tenantId || 'tenant-demo';
  const branchId = req.query.branchId || 'branch-main';
  const branchKey = connector.getBranchKey(tenantId, branchId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(branchKey)) {
    sseClients.set(branchKey, new Set());
  }
  sseClients.get(branchKey).add(res);

  // Send current status immediately
  const status = connector.getSessionStatus(tenantId, branchId);
  res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);

  req.on('close', () => {
    const clients = sseClients.get(branchKey);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(branchKey);
    }
  });
});

module.exports = router;
