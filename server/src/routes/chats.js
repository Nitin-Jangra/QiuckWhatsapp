const express = require('express');
const router = express.Router();
const store = require('../store');
const connector = require('../whatsapp/connector-service');
const { canAccess, allowedAccountIds } = require('../auth');

const deny = (res) => res.status(403).json({ success: false, error: 'No access to this account' });

// 1. Get all conversations (optional query ?accountId=...)
router.get('/', (req, res) => {
  const wanted = req.query.accountId || null;
  if (wanted && !canAccess(req.user, wanted)) return deny(res);
  const chats = store.getChats(wanted || allowedAccountIds(req.user, store.getAccounts().map(a => a.id)));
  res.json({ success: true, data: chats });
});

// 2. Get messages for a specific conversation
router.get('/messages', (req, res) => {
  const { accountId, remoteJid } = req.query;
  if (!accountId || !remoteJid) {
    return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  }

  if (!canAccess(req.user, accountId)) return deny(res);
  const messages = store.getMessages(accountId, remoteJid);
  res.json({ success: true, data: messages });
});

// 3. Trigger on-demand sync from mobile phone
router.post('/sync', async (req, res) => {
  try {
    const { accountId, remoteJid } = req.body;
    if (accountId && !canAccess(req.user, accountId)) return deny(res);
    if (accountId && remoteJid) {
      await connector.syncChatFromPhone(accountId, remoteJid);
    }
    const chats = store.getChats(accountId || allowedAccountIds(req.user, store.getAccounts().map(a => a.id)));
    res.json({ success: true, message: 'Chats synchronized', data: chats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Send text message
router.post('/send', async (req, res) => {
  try {
    const { accountId, to, text, remoteJid } = req.body;

    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' });
    }
    if (!to && !remoteJid) {
      return res.status(400).json({ success: false, error: 'Recipient phone or remoteJid is required' });
    }
    if (!canAccess(req.user, accountId)) return deny(res);
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Message text cannot be empty' });
    }

    const destination = remoteJid || to;
    const result = await connector.sendMessage(accountId, destination, text.trim());

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Send media message (Image, Video, Audio, Document)
router.post('/send-media', async (req, res) => {
  try {
    const { accountId, to, remoteJid, mediaBase64, mediaType, mimetype, fileName, caption } = req.body;

    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' });
    }
    if (!to && !remoteJid) {
      return res.status(400).json({ success: false, error: 'Recipient phone or remoteJid is required' });
    }
    if (!canAccess(req.user, accountId)) return deny(res);
    if (!mediaBase64) {
      return res.status(400).json({ success: false, error: 'mediaBase64 content is required' });
    }

    const cleanBase64 = mediaBase64.replace(/^data:.*?;base64,/, '');
    const mediaBuffer = Buffer.from(cleanBase64, 'base64');

    const destination = remoteJid || to;
    const result = await connector.sendMedia(accountId, destination, {
      mediaBuffer,
      mediaType: mediaType || 'image',
      mimetype: mimetype || 'application/octet-stream',
      fileName: fileName || 'file',
      caption: caption || ''
    });

    res.json({
      success: true,
      message: 'Media message sent successfully',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Mark a conversation as read (clears the unread badge)
router.post('/read', (req, res) => {
  const { accountId, remoteJid } = req.body || {};
  if (!accountId || !remoteJid) {
    return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  }
  if (!canAccess(req.user, accountId)) return deny(res);
  store.markRead(accountId, remoteJid);
  res.json({ success: true });
});

module.exports = router;
