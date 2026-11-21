const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
router.use(auth.requireAdmin);

const list = async () => Promise.all((await db.all('SELECT * FROM users ORDER BY id')).map(auth.publicUser));
const adminCount = async () => (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")).n;

router.get('/', async (req, res) => res.json({ success: true, data: await list() }));

router.post('/', async (req, res) => {
  const { username, name, password, role, accountIds } = req.body || {};
  if (!username?.trim() || !password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Username and a password of at least 8 characters are required' });
  }
  try {
    const id = await db.insert('INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      username.trim(), (name || username).trim(), auth.hashPassword(password), role === 'admin' ? 'admin' : 'agent', new Date().toISOString());
    await auth.setUserAccounts(id, accountIds);
    res.json({ success: true, data: await list() });
  } catch (err) {
    const dup = db.isUniqueViolation(err);
    res.status(dup ? 409 : 500).json({ success: false, error: dup ? 'That username is already taken' : err.message });
  }
});

router.put('/:id', async (req, res) => {
  const user = await auth.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  const { name, password, role, active, accountIds } = req.body || {};

  const nextRole = role ? (role === 'admin' ? 'admin' : 'agent') : user.role;
  const nextActive = active === undefined ? user.active : active ? 1 : 0;
  // Never lock everyone out
  if (user.role === 'admin' && user.active && (nextRole !== 'admin' || !nextActive) && await adminCount() <= 1) {
    return res.status(400).json({ success: false, error: 'At least one active admin is required' });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  }

  (await db.run('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?', (name || user.name).trim(), nextRole, nextActive, password ? auth.hashPassword(password) : user.password_hash, user.id));
  if (Array.isArray(accountIds)) await auth.setUserAccounts(user.id, accountIds);
  res.json({ success: true, data: await list() });
});

router.delete('/:id', async (req, res) => {
  const user = await auth.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ success: false, error: 'You cannot delete yourself' });
  if (user.role === 'admin' && user.active && await adminCount() <= 1) {
    return res.status(400).json({ success: false, error: 'At least one active admin is required' });
  }
  (await db.run('DELETE FROM users WHERE id = ?', user.id));
  res.json({ success: true, data: await list() });
});

module.exports = router;
