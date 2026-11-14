const express = require('express');
const router = express.Router();
const connector = require('../whatsapp/connector-service');
const store = require('../store');

// Backward-compatible endpoints for Phase 0 tests
router.get('/status', (req, res) => {
  const accountId = req.query.accountId || req.query.branchId || 'default';
  const status = connector.getAccountStatus(accountId);
  res.json({ success: true, data: status });
});

router.post('/connect', async (req, res) => {
  try {
    const accountId = req.body.accountId || req.body.branchId || 'default';
    const status = await connector.initAccount(accountId);
    res.json({ success: true, message: 'Connection initialized', data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reconnect', async (req, res) => {
  try {
    const accountId = req.body.accountId || req.body.branchId || 'default';
    await connector.disconnectAccount(accountId, false);
    const status = await connector.initAccount(accountId);
    res.json({ success: true, message: 'Reconnection triggered', data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    const accountId = req.body.accountId || req.body.branchId || 'default';
    const logout = Boolean(req.body.logout);
    const result = await connector.disconnectAccount(accountId, logout);
    res.json({ success: true, message: logout ? 'Logged out' : 'Disconnected', data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/send', async (req, res) => {
  try {
    const accountId = req.body.accountId || req.body.branchId || 'default';
    const { to, text, remoteJid } = req.body;
    if (!to && !remoteJid) {
      return res.status(400).json({ success: false, error: 'Destination phone number or remoteJid is required' });
    }
    if (!text) {
      return res.status(400).json({ success: false, error: 'Message text is required' });
    }
    const result = await connector.sendMessage(accountId, remoteJid || to, text);
    res.json({ success: true, message: 'Message sent successfully', data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
