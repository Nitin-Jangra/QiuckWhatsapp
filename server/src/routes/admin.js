const express = require('express');
const db = require('../db');
const auth = require('../auth');
const store = require('../store');

const router = express.Router();

// Require both authentication and admin role for all admin routes
router.use(auth.requireAuth);
router.use(auth.requireAdmin);

// 1. System & Platform Stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
    const activeUsers = (await db.get("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND status = 'active'")).n;
    const verifiedUsers = (await db.get('SELECT COUNT(*) AS n FROM users WHERE phone_verified_at IS NOT NULL')).n;
    const activeSessions = (await db.get('SELECT COUNT(*) AS n FROM user_sessions WHERE expires_at > ?', new Date().toISOString())).n;
    const allAccounts = await store.getAccounts();
    const totalAccounts = allAccounts.length;
    const connectedAccounts = allAccounts.filter(a => a.status === 'CONNECTED').length;
    const totalChats = (await db.get('SELECT COUNT(*) AS n FROM chats')).n;
    const totalMessages = (await db.get('SELECT COUNT(*) AS n FROM messages')).n;

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        verifiedUsers,
        activeSessions,
        totalAccounts,
        connectedAccounts,
        totalChats,
        totalMessages,
        serverTime: new Date().toISOString(),
        uptime: process.uptime()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. List all platform users with detail
router.get('/users', async (req, res) => {
  try {
    const users = await Promise.all((await db.all(`
      SELECT id, username, name, full_name, phone_number, phone_verified_at, role, status, active, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `)).map(async u => ({
      ...(await auth.publicUser(u)),
      phoneVerifiedAt: u.phone_verified_at,
      status: u.status || (u.active ? 'active' : 'disabled'),
      sessionsCount: (await db.get('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?', u.id))?.n || 0
    })));

    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Update user status (active / suspended)
router.put('/users/:id/status', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { status } = req.body || {};

    if (!['active', 'suspended', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be active, suspended, or disabled' });
    }

    const user = await auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Protect self-lockout
    if (user.id === req.user.id && status !== 'active') {
      return res.status(400).json({ success: false, error: 'You cannot suspend or disable your own admin account' });
    }

    const active = status === 'active' ? 1 : 0;
    const now = new Date().toISOString();
    (await db.run('UPDATE users SET status = ?, active = ?, updated_at = ? WHERE id = ?', status, active, now, targetId));

    if (status !== 'active') {
      await auth.revokeAllUserSessions(targetId);
    }

    res.json({ success: true, message: `User status updated to ${status}`, data: await auth.publicUser(await auth.getUserById(targetId)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update user role (admin / user / agent)
router.put('/users/:id/role', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { role } = req.body || {};

    if (!['admin', 'user', 'agent'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be admin, user, or agent' });
    }

    const user = await auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    if (user.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ success: false, error: 'You cannot demote your own account' });
    }

    const now = new Date().toISOString();
    (await db.run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', role, now, targetId));

    res.json({ success: true, message: `User role updated to ${role}`, data: await auth.publicUser(await auth.getUserById(targetId)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Admin reset password
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { newPassword } = req.body || {};

    const pCheck = auth.validatePassword(newPassword);
    if (!pCheck.valid) return res.status(400).json({ success: false, error: pCheck.error });

    const user = await auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const now = new Date().toISOString();
    (await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', auth.hashPassword(newPassword),
      now,
      targetId));

    await auth.revokeAllUserSessions(targetId);

    res.json({ success: true, message: `Password reset successfully for ${user.username}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const user = await auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot delete yourself' });
    }

    await auth.revokeAllUserSessions(targetId);
    (await db.run('DELETE FROM users WHERE id = ?', targetId));

    res.json({ success: true, message: `User ${user.username} deleted successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
