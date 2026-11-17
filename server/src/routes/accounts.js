const express = require('express');
const router = express.Router();
const store = require('../store');
const connector = require('../whatsapp/connector-service');
const { requireAdmin, canAccess } = require('../auth');

// 1. List all accounts with live session status
router.get('/', (req, res) => {
  const accounts = store.getAccounts().filter(a => canAccess(req.user, a.id));
  const data = accounts.map(acc => {
    const status = connector.getAccountStatus(acc.id);
    return {
      ...acc,
      status: status.status || acc.status || 'DISCONNECTED',
      phone: status.phone || acc.phone || null,
      name: status.name || acc.name,
      qrDataUrl: status.status === 'SCAN_QR' ? status.qrDataUrl : null,
      lastError: status.lastError || acc.lastError || null
    };
  });
  res.json({ success: true, data });
});

// 2. Create new account & initiate QR generation
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Account name is required' });
    }

    const id = `acc_${Date.now()}`;
    const account = store.saveAccount({
      id,
      name: name.trim(),
      status: 'CONNECTING',
      phone: null
    });

    // Start Baileys session asynchronously (skip real socket connection during test suite)
    if (process.env.NODE_ENV !== 'test') {
      connector.initAccount(id).catch(err => {
        console.warn(`[WaCRM] Init account ${id} failed:`, err.message);
      });
    }

    res.json({
      success: true,
      message: 'Account created. Generating WhatsApp QR code...',
      data: account
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get single account status
router.get('/:id/status', (req, res) => {
  if (!canAccess(req.user, req.params.id)) return res.status(403).json({ success: false, error: 'No access to this account' });
  const account = store.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }
  const status = connector.getAccountStatus(req.params.id);
  res.json({
    success: true,
    data: {
      ...account,
      ...status,
      id: account.id,
      name: account.name,
      status: status.status || account.status || 'DISCONNECTED',
      phone: status.phone || account.phone || null,
      qrDataUrl: status.status === 'SCAN_QR' ? status.qrDataUrl : null,
      lastError: status.lastError || account.lastError || null
    }
  });
});

// 4. Reconnect / Refresh QR code
router.post('/:id/connect', requireAdmin, async (req, res) => {
  try {
    const account = store.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    await connector.disconnectAccount(req.params.id, false);
    const status = await connector.initAccount(req.params.id);
    res.json({ success: true, message: 'Connection requested', data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Disconnect account (without deleting)
router.post('/:id/disconnect', requireAdmin, async (req, res) => {
  try {
    const account = store.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    const logout = Boolean(req.body.logout);
    await connector.disconnectAccount(req.params.id, logout);
    res.json({ success: true, message: logout ? 'Account logged out' : 'Account disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Delete account permanently (unlinks and wipes session files)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await connector.deleteAccount(req.params.id);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
