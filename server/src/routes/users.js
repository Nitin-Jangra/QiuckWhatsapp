const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(auth.requireAdmin);

const list = () => db.prepare('SELECT * FROM users ORDER BY id').all().map(auth.publicUser);
const adminCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;

router.get('/', (req, res) => res.json({ success: true, data: list() }));

router.post('/', (req, res) => {
  const { username, name, password, role, accountIds } = req.body || {};
  if (!username?.trim() || !password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Username and a password of at least 8 characters are required' });
  }
  try {
    const info = db
      .prepare('INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(username.trim(), (name || username).trim(), auth.hashPassword(password), role === 'admin' ? 'admin' : 'agent', new Date().toISOString());
    auth.setUserAccounts(Number(info.lastInsertRowid), accountIds);
    res.json({ success: true, data: list() });
  } catch (err) {
    const dup = /UNIQUE/i.test(err.message);
    res.status(dup ? 409 : 500).json({ success: false, error: dup ? 'That username is already taken' : err.message });
  }
});

router.put('/:id', (req, res) => {
  const user = auth.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  const { name, password, role, active, accountIds } = req.body || {};

  const nextRole = role ? (role === 'admin' ? 'admin' : 'agent') : user.role;
  const nextActive = active === undefined ? user.active : active ? 1 : 0;
  // Never lock everyone out
  if (user.role === 'admin' && user.active && (nextRole !== 'admin' || !nextActive) && adminCount() <= 1) {
    return res.status(400).json({ success: false, error: 'At least one active admin is required' });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  }

  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?').run(
    (name || user.name).trim(), nextRole, nextActive, password ? auth.hashPassword(password) : user.password_hash, user.id
  );
  if (Array.isArray(accountIds)) auth.setUserAccounts(user.id, accountIds);
  res.json({ success: true, data: list() });
});

router.delete('/:id', (req, res) => {
  const user = auth.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ success: false, error: 'You cannot delete yourself' });
  if (user.role === 'admin' && user.active && adminCount() <= 1) {
    return res.status(400).json({ success: false, error: 'At least one active admin is required' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ success: true, data: list() });
});

module.exports = router;
