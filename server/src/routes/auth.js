const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

const findByUsername = (u) => db.prepare('SELECT * FROM users WHERE username = ?').get(String(u || '').trim());

// Who am I? Also tells the UI whether authentication or first-time setup is needed
router.get('/me', (req, res) => {
  const authRequired = process.env.AUTH_REQUIRED === 'true';
  res.json({
    success: true,
    data: {
      user: req.user,
      needsSetup: authRequired && auth.countUsers() === 0,
      authRequired
    }
  });
});

// First run only: create the admin. Set SETUP_KEY to require a key so nobody else can claim it.
router.post('/setup', (req, res) => {
  if (auth.countUsers() > 0) return res.status(403).json({ success: false, error: 'Setup already completed' });
  const { username, name, password, setupKey } = req.body || {};
  if (process.env.SETUP_KEY && setupKey !== process.env.SETUP_KEY) {
    return res.status(403).json({ success: false, error: 'Invalid setup key' });
  }
  if (!username?.trim() || !password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Username and a password of at least 8 characters are required' });
  }
  const info = db
    .prepare('INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username.trim(), (name || username).trim(), auth.hashPassword(password), 'admin', new Date().toISOString());
  auth.setSessionCookie(req, res, Number(info.lastInsertRowid));
  res.json({ success: true, data: { user: auth.publicUser(auth.getUserById(Number(info.lastInsertRowid))) } });
});

router.post('/login', (req, res) => {
  const throttle = auth.loginThrottle(req);
  if (throttle.blocked) {
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { username, password } = req.body || {};
  const user = findByUsername(username);
  if (!user || !user.active || !auth.verifyPassword(String(password || ''), user.password_hash)) {
    throttle.fail();
    return res.status(401).json({ success: false, error: 'Wrong username or password' });
  }
  auth.setSessionCookie(req, res, user.id);
  res.json({ success: true, data: { user: auth.publicUser(user) } });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ success: true });
});

module.exports = router;
