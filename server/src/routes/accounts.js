const express = require('express');
const router = express.Router();
const store = require('../store');
const connector = require('../whatsapp/connector-service');
const { canAccess, allowedAccountIds, can, audit } = require('../auth');
const noManage = (req) => !can(req.user, 'accounts.manage');

// 1. List all accounts with live session status (strictly tenant-scoped)
router.get('/', async (req, res) => {
  const isSuperAdmin = req.user?.role === 'admin' && req.query.all === 'true';
  const allAccounts = await store.getAccounts();
  const allowed = new Set(isSuperAdmin ? allAccounts.map(a => a.id) : await allowedAccountIds(req.user, allAccounts.map(a => a.id)));
  const accounts = allAccounts.filter(a => allowed.has(a.id));
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

// 2. Create new account & initiate QR generation (Admins & Tenant Workspace Owners)
router.post('/', async (req, res) => {
  try {
    // Staff/Agents cannot create accounts
    if (noManage(req)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to connect WhatsApp accounts' });
    }

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Account name is required' });
    }

    const id = `acc_${Date.now()}`;
    const account = await store.saveAccount({
      id,
      name: name.trim(),
      status: 'CONNECTING',
      phone: null
    }, typeof req.user?.id === 'number' ? req.user.workspaceId : null);
    await audit(req, 'whatsapp.account_created', { accountId: id, name: account.name });

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
router.get('/:id/status', async (req, res) => {
  if (!await canAccess(req.user, req.params.id)) return res.status(403).json({ success: false, error: 'No access to this account' });
  const account = await store.getAccount(req.params.id);
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
router.post('/:id/connect', async (req, res) => {
  try {
    if (noManage(req)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to manage WhatsApp connections' });
    }
    if (!await canAccess(req.user, req.params.id)) {
      return res.status(403).json({ success: false, error: 'No access to this account' });
    }

    const account = await store.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    await connector.disconnectAccount(req.params.id, false);
    const status = await connector.initAccount(req.params.id);
    await audit(req, 'whatsapp.account_connect', { accountId: req.params.id });
    res.json({ success: true, message: 'Connection requested', data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Disconnect account (without deleting)
router.post('/:id/disconnect', async (req, res) => {
  try {
    if (noManage(req)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to manage WhatsApp connections' });
    }
    if (!await canAccess(req.user, req.params.id)) {
      return res.status(403).json({ success: false, error: 'No access to this account' });
    }

    const account = await store.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    const logout = Boolean(req.body.logout);
    await connector.disconnectAccount(req.params.id, logout);
    await audit(req, 'whatsapp.account_disconnect', { accountId: req.params.id, logout });
    res.json({ success: true, message: logout ? 'Account logged out' : 'Account disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Delete account permanently (unlinks and wipes session files)
router.delete('/:id', async (req, res) => {
  try {
    if (noManage(req)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to delete WhatsApp accounts' });
    }
    if (!await canAccess(req.user, req.params.id)) {
      return res.status(403).json({ success: false, error: 'No access to this account' });
    }

    await connector.deleteAccount(req.params.id);
    await audit(req, 'whatsapp.account_deleted', { accountId: req.params.id });
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Pause / resume all outgoing messages on a number (shared-number protection)
router.post('/:id/sending', async (req, res) => {
  if (noManage(req)) return res.status(403).json({ success: false, error: 'You do not have permission to manage WhatsApp accounts' });
  if (!await canAccess(req.user, req.params.id)) return res.status(403).json({ success: false, error: 'No access to this account' });
  if (!await store.getAccount(req.params.id)) return res.status(404).json({ success: false, error: 'Account not found' });
  const paused = Boolean(req.body?.paused);
  const account = await store.saveAccount({ id: req.params.id, sendingPaused: paused });
  await audit(req, paused ? 'whatsapp.sending_paused' : 'whatsapp.sending_resumed', { accountId: req.params.id });
  res.json({ success: true, data: account });
});

module.exports = router;
