const express = require('express');
const router = express.Router();
const store = require('../store');
const auth = require('../auth');

router.use(auth.requireAuth);

router.get('/', async (req, res) => {
  const userId = req.user?.id;
  const prefs = await store.getUserPreferences(userId);
  res.json({ success: true, data: prefs });
});

router.put('/', async (req, res) => {
  const userId = req.user?.id;
  const { theme, soundEnabled, enterIsSend } = req.body || {};
  const updated = await store.setUserPreferences(userId, { theme, soundEnabled, enterIsSend });
  res.json({ success: true, message: 'Preferences updated', data: updated });
});

module.exports = router;
