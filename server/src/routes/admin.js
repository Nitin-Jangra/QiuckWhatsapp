const express = require('express');
const db = require('../db');
const auth = require('../auth');
const store = require('../store');

const router = express.Router();

// Require both authentication and admin role for all admin routes
router.use(auth.requireAuth);
router.use(auth.requireAdmin);

// 1. System & Platform Stats
router.get('/stats', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const activeUsers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND status = 'active'").get().n;
    const verifiedUsers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE phone_verified_at IS NOT NULL').get().n;
    const activeSessions = db.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE expires_at > ?').get(new Date().toISOString()).n;
    const totalAccounts = store.getAccounts().length;
    const connectedAccounts = store.getAccounts().filter(a => a.status === 'CONNECTED').length;
    const totalChats = db.prepare('SELECT COUNT(*) AS n FROM chats').get().n;
    const totalMessages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;

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
router.get('/users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, name, full_name, phone_number, phone_verified_at, role, status, active, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `).all().map(u => ({
      ...auth.publicUser(u),
      phoneVerifiedAt: u.phone_verified_at,
      status: u.status || (u.active ? 'active' : 'disabled'),
      sessionsCount: db.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?').get(u.id)?.n || 0
    }));

    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Update user status (active / suspended)
router.put('/users/:id/status', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { status } = req.body || {};

    if (!['active', 'suspended', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be active, suspended, or disabled' });
    }

    const user = auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    // Protect self-lockout
    if (user.id === req.user.id && status !== 'active') {
      return res.status(400).json({ success: false, error: 'You cannot suspend or disable your own admin account' });
    }

    const active = status === 'active' ? 1 : 0;
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET status = ?, active = ?, updated_at = ? WHERE id = ?').run(status, active, now, targetId);

    if (status !== 'active') {
      auth.revokeAllUserSessions(targetId);
    }

    res.json({ success: true, message: `User status updated to ${status}`, data: auth.publicUser(auth.getUserById(targetId)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update user role (admin / user / agent)
router.put('/users/:id/role', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { role } = req.body || {};

    if (!['admin', 'user', 'agent'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Role must be admin, user, or agent' });
    }

    const user = auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    if (user.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ success: false, error: 'You cannot demote your own account' });
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, now, targetId);

    res.json({ success: true, message: `User role updated to ${role}`, data: auth.publicUser(auth.getUserById(targetId)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Admin reset password
router.post('/users/:id/reset-password', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { newPassword } = req.body || {};

    const pCheck = auth.validatePassword(newPassword);
    if (!pCheck.valid) return res.status(400).json({ success: false, error: pCheck.error });

    const user = auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      auth.hashPassword(newPassword),
      now,
      targetId
    );

    auth.revokeAllUserSessions(targetId);

    res.json({ success: true, message: `Password reset successfully for ${user.username}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Delete user
router.delete('/users/:id', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const user = auth.getUserById(targetId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot delete yourself' });
    }

    auth.revokeAllUserSessions(targetId);
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

    res.json({ success: true, message: `User ${user.username} deleted successfully` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
