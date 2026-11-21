const express = require('express');
const router = express.Router();
const store = require('../store');
const connector = require('../whatsapp/connector-service');
const { canAccess, allowedAccountIds, can, audit } = require('../auth');
const guard = require('../send-guard');
const events = require('./events');

const need = (perm) => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ success: false, error: 'You do not have permission for this action' });
const actor = (req) => (typeof req.user?.id === 'number' ? { id: req.user.id, name: req.user.name || req.user.username } : null);

// Shared pre-send checks: paused number, rate limits, duplicate content. Returns an error response or null.
async function preSend(req, res, accountId, destination, text) {
  const account = await store.getAccount(accountId);
  if (account?.sendingPaused) {
    res.status(423).json({ success: false, error: 'Outgoing messages are paused for this WhatsApp number by the account owner' });
    return true;
  }
  try {
    guard.check({ accountId, userId: req.user?.id ?? 'anon', jid: destination, text });
  } catch (err) {
    await audit(req, 'security.send_limited', { accountId, reason: err.message });
    res.status(err.status || 429).json({ success: false, error: err.message });
    return true;
  }
  return false;
}

const deny = (res) => res.status(403).json({ success: false, error: 'No access to this account' });

// 1. Get all conversations (with account, unread, pinned, archived, search filters & tenant scoping)
router.get('/', need('chats.view'), async (req, res) => {
  const wanted = req.query.accountId || null;

  if (wanted && !await canAccess(req.user, wanted)) return deny(res);

  const allAccountIds = (await store.getAccounts()).map(a => a.id);
  const allowedIds = wanted ? [wanted] : await allowedAccountIds(req.user, allAccountIds);
  let chats = await store.getChats(allowedIds);

  const filterType = req.query.filterType || req.query.filter || 'all';
  if (filterType === 'unread') {
    chats = chats.filter(c => c.unreadCount > 0);
  } else if (filterType === 'pinned') {
    chats = chats.filter(c => c.isPinned);
  } else if (filterType === 'archived') {
    chats = chats.filter(c => c.isArchived);
  } else if (filterType === 'all' && !req.query.includeArchived) {
    // Hide archived by default in standard feed
    chats = chats.filter(c => !c.isArchived);
  }

  const q = (req.query.search || req.query.q || '').trim().toLowerCase();
  if (q) {
    chats = chats.filter(c =>
      (c.customerName && c.customerName.toLowerCase().includes(q)) ||
      (c.customerPhone && c.customerPhone.toLowerCase().includes(q)) ||
      (c.lastMessage && c.lastMessage.toLowerCase().includes(q)) ||
      (c.accountName && c.accountName.toLowerCase().includes(q))
    );
  }

  res.json({ success: true, data: chats });
});

// 2. Get messages for a specific conversation
router.get('/messages', need('chats.view'), async (req, res) => {
  const { accountId, remoteJid } = req.query;
  if (!accountId || !remoteJid) {
    return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  }

  if (!await canAccess(req.user, accountId)) return deny(res);
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 2000) : 1000;
  const messages = await store.getMessages(accountId, remoteJid, limit);
  res.json({ success: true, data: messages });
});

// 3. Pin / Unpin conversation
router.post('/pin', need('chats.organize'), async (req, res) => {
  const { accountId, remoteJid, isPinned } = req.body || {};
  if (!accountId || !remoteJid) {
    return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  }
  if (!await canAccess(req.user, accountId)) return deny(res);
  const chat = await store.pinChat(accountId, remoteJid, isPinned !== false);
  res.json({ success: true, data: chat });
});

// 4. Archive / Unarchive conversation
router.post('/archive', need('chats.organize'), async (req, res) => {
  const { accountId, remoteJid, isArchived } = req.body || {};
  if (!accountId || !remoteJid) {
    return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  }
  if (!await canAccess(req.user, accountId)) return deny(res);
  const chat = await store.archiveChat(accountId, remoteJid, isArchived !== false);
  res.json({ success: true, data: chat });
});

// 5. Trigger on-demand sync from mobile phone
router.post('/sync', need('chats.view'), async (req, res) => {
  try {
    const { accountId, remoteJid } = req.body || {};
    if (accountId && !await canAccess(req.user, accountId)) return deny(res);
    if (accountId && remoteJid) {
      await connector.syncChatFromPhone(accountId, remoteJid);
    } else {
      const allAccountIds = accountId ? [accountId] : (await store.getAccounts()).map(a => a.id);
      for (const accId of allAccountIds) {
        await connector.syncGroups(accId).catch(() => {});
      }
    }
    const chats = await store.getChats(accountId || await allowedAccountIds(req.user, (await store.getAccounts()).map(a => a.id)));
    res.json({ success: true, message: 'Chats synchronized', data: chats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Send text message
router.post('/send', need('chats.send'), async (req, res) => {
  try {
    const { accountId, to, text, remoteJid } = req.body || {};

    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' });
    }
    if (!to && !remoteJid) {
      return res.status(400).json({ success: false, error: 'Recipient phone or remoteJid is required' });
    }
    if (!await canAccess(req.user, accountId)) return deny(res);
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Message text cannot be empty' });
    }

    const destination = remoteJid || to;
    const key = req.body.clientMessageId || req.get('Idempotency-Key');
    const result = await guard.once(req.user?.id, key, async () => {
      if (await preSend(req, res, accountId, destination, text.trim())) return null;
      const sent = await connector.sendMessage(accountId, destination, text.trim(), { sentBy: actor(req) });
      await audit(req, 'message.sent', { accountId, messageId: sent.id, type: 'text' });
      return sent;
    });
    if (res.headersSent) return;
    if (!result) return res.status(429).json({ success: false, error: 'Message was not sent' });

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Send media message (Image, Video, Audio, Document)
router.post('/send-media', need('chats.send'), async (req, res) => {
  try {
    const { accountId, to, remoteJid, mediaBase64, mediaType, mimetype, fileName, caption } = req.body || {};

    if (!accountId) {
      return res.status(400).json({ success: false, error: 'accountId is required' });
    }
    if (!to && !remoteJid) {
      return res.status(400).json({ success: false, error: 'Recipient phone or remoteJid is required' });
    }
    if (!await canAccess(req.user, accountId)) return deny(res);
    if (!mediaBase64) {
      return res.status(400).json({ success: false, error: 'mediaBase64 content is required' });
    }

    const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];
    if (mediaType && !MEDIA_TYPES.includes(mediaType)) {
      return res.status(400).json({ success: false, error: 'Unsupported media type' });
    }
    if (mimetype && !/^[a-z]+\/[a-z0-9.+-]+$/i.test(mimetype)) {
      return res.status(400).json({ success: false, error: 'Invalid mimetype' });
    }
    const cleanBase64 = String(mediaBase64).replace(/^data:.*?;base64,/, '');
    const mediaBuffer = Buffer.from(cleanBase64, 'base64');
    const maxBytes = (Number(process.env.MAX_UPLOAD_MB) || 32) * 1024 * 1024;
    if (!mediaBuffer.length || mediaBuffer.length > maxBytes) {
      return res.status(413).json({ success: false, error: `File must be between 1 byte and ${maxBytes / 1048576} MB` });
    }

    const destination = remoteJid || to;
    const key = req.body.clientMessageId || req.get('Idempotency-Key');
    const result = await guard.once(req.user?.id, key, async () => {
      if (await preSend(req, res, accountId, destination, null)) return null;
      const sent = await connector.sendMedia(accountId, destination, {
        mediaBuffer,
        mediaType: mediaType || 'image',
        mimetype: mimetype || 'application/octet-stream',
        fileName: String(fileName || 'file').replace(/[\\/]/g, '_').slice(0, 120),
        caption: caption || '',
        sentBy: actor(req)
      });
      await audit(req, 'message.sent', { accountId, messageId: sent.id, type: mediaType || 'image' });
      return sent;
    });
    if (res.headersSent) return;
    if (!result) return res.status(429).json({ success: false, error: 'Message was not sent' });

    res.json({
      success: true,
      message: 'Media message sent successfully',
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Mark a conversation as read (clears the unread badge)
router.post('/read', need('chats.view'), async (req, res) => {
  const { accountId, remoteJid } = req.body || {};
  if (!accountId || !remoteJid) {
    return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  }
  if (!await canAccess(req.user, accountId)) return deny(res);
  await store.markRead(accountId, remoteJid);
  res.json({ success: true });
});

// 9. Active-handler indicator: who else currently has this conversation open
router.post('/viewing', need('chats.view'), async (req, res) => {
  const { accountId, remoteJid } = req.body || {};
  if (!accountId || !remoteJid) return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
  if (!await canAccess(req.user, accountId)) return deny(res);
  const viewers = await events.markViewing(accountId, remoteJid, actor(req));
  res.json({ success: true, data: viewers });
});

// 10. Delete a conversation and its messages
router.delete('/:accountId/:remoteJid', need('chats.organize'), async (req, res) => {
  try {
    const { accountId, remoteJid } = req.params;
    if (!accountId || !remoteJid) {
      return res.status(400).json({ success: false, error: 'accountId and remoteJid are required' });
    }
    if (!await canAccess(req.user, accountId)) return deny(res);
    await store.deleteChat(accountId, remoteJid);
    await audit(req, 'chat.deleted', { accountId, remoteJid });
    res.json({ success: true, message: 'Chat deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Clear all empty phone-synced conversations (placeholder chats with 0 messages)
router.post('/clear-empty', need('chats.organize'), async (req, res) => {
  try {
    const { accountId } = req.body || {};
    if (accountId && !await canAccess(req.user, accountId)) return deny(res);
    const clearedCount = await store.clearEmptySyncedChats(accountId || null);
    await audit(req, 'chats.cleared_empty', { accountId: accountId || 'all', clearedCount });
    res.json({ success: true, clearedCount, message: `Cleared ${clearedCount} empty synced chat(s)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
