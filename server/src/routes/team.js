// Team management: workspace owners (and permitted administrators) manage child members.
// The workspace is always derived from the authenticated session, never from the request.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const store = require('../store');

const router = express.Router();
const INVITE_TTL_HOURS = Number(process.env.INVITE_TTL_HOURS) > 0 ? Number(process.env.INVITE_TTL_HOURS) : 72;
const ROLES = ['manager', 'agent'];
const now = () => new Date().toISOString();
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const bad = (res, error, code = 400) => res.status(code).json({ success: false, error });

// ---- Public: accept an invitation (no session) ----
router.post('/invitations/accept', async (req, res) => {
  const throttle = auth.loginThrottle(req);
  if (throttle.blocked) return bad(res, 'Too many attempts. Try again in a few minutes.', 429);
  const { token, password } = req.body || {};
  const inv = token && (await db.get("SELECT * FROM invitations WHERE token_hash = ? AND status = 'pending'", hashToken(token)));
  if (!inv || Date.parse(inv.expires_at) < Date.now()) {
    throttle.fail();
    return bad(res, 'This invitation is invalid or has expired');
  }
  const pCheck = auth.validatePassword(password);
  if (!pCheck.valid) return bad(res, pCheck.error);
  const owner = await auth.getUserById(inv.account_id);
  if (!owner || !await auth.isUserUsable(owner)) return bad(res, 'This invitation is invalid or has expired');
  if (await auth.getUserByUsername(inv.username)) return bad(res, 'That username is already taken. Ask for a new invitation.', 409);

  let userId;
  try {
    await db.tx(async () => {
      // Single-use: flip status first so a concurrent accept cannot reuse it
      const claimed = (await db.run("UPDATE invitations SET status = 'accepted' WHERE id = ? AND status = 'pending'", inv.id));
      if (!claimed.changes) throw new Error('This invitation is invalid or has expired');
      userId = await insertMember(owner.id, {
        username: inv.username, fullName: inv.full_name, email: inv.email, phone: inv.phone,
        role: inv.role, permissions: inv.permissions ? JSON.parse(inv.permissions) : null,
        password
      });
      await auth.setUserAccounts(userId, await workspaceAccountIds(owner.id, JSON.parse(inv.account_ids || '[]')));
    });
  } catch (err) {
    return bad(res, db.isUniqueViolation(err) ? 'That username or phone number is already registered' : err.message, 409);
  }
  await auth.audit(req, 'team.invitation_accepted', { username: inv.username }, { userId, accountId: owner.id });
  await auth.setSessionCookie(req, res, userId);
  res.json({ success: true, data: { user: await auth.publicUser(await auth.getUserById(userId)) } });
});

// ---- Everything below requires a signed-in workspace user ----
router.use(async (req, res, next) => {
  if (!req.user || typeof req.user.id !== 'number') return bad(res, 'Please sign in', 401);
  if (req.user.role === 'admin') return bad(res, 'Team management is per workspace. Use the Admin Panel.', 403);
  next();
});

const ws = (req) => req.user.workspaceId;

async function workspaceAccountIds(ownerId, ids) {
  const own = new Set((await store.getAccounts(ownerId)).map(a => a.id));
  return [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(id => own.has(id));
}

async function insertMember(ownerId, { username, fullName, email, phone, role, permissions, password }) {
  const t = now();
  return db.insert(`
    INSERT INTO users (username, name, full_name, email, phone_number, password_hash, role, status, active, parent_id, permissions, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)
  `, username, fullName, fullName, email || null, phone || null, auth.hashPassword(password), role, ownerId,
    permissions ? JSON.stringify(auth.sanitizePermissions(permissions)) : null, t, t);
}

// Validate member profile input; returns { error } or clean values
function validateProfile(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.username !== undefined) {
    const u = auth.validateUsername(body.username);
    if (!u.valid) return { error: u.error };
    out.username = u.username;
  }
  if (!partial || body.fullName !== undefined) {
    const name = String(body.fullName || '').trim();
    if (!name || name.length > 80) return { error: 'Full name is required (max 80 characters)' };
    out.fullName = name;
  }
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email)) || String(body.email).length > 120) return { error: 'Invalid email address' };
    out.email = String(body.email).trim().toLowerCase();
  } else if (body.email !== undefined) out.email = null;
  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    const p = auth.normalizePhone(body.phone);
    if (!/^\+\d{10,15}$/.test(p)) return { error: 'Invalid mobile number. Include the country code.' };
    out.phone = p;
  } else if (body.phone !== undefined) out.phone = null;
  if (!partial || body.role !== undefined) {
    const role = body.role || 'agent';
    if (!ROLES.includes(role)) return { error: 'Role must be manager or agent' };
    out.role = role;
  }
  return out;
}

// Privilege rules: only the owner assigns the manager role or edits managers;
// nobody grants permissions they do not hold; nobody edits themselves here.
function guardPrivileges(req, { role, permissions }) {
  if (req.user.isOwner) return null;
  if (role === 'manager') return 'Only the account owner can assign the Administrator role';
  if (permissions && auth.sanitizePermissions(permissions).some(p => !req.user.permissions.includes(p))) {
    return 'You cannot grant permissions you do not have';
  }
  return null;
}

// Load a member of the caller's workspace (never the owner, never another tenant)
async function loadMember(req, res, { forWrite = true } = {}) {
  const m = (await db.get('SELECT * FROM users WHERE id = ? AND parent_id = ?', Number(req.params.id), ws(req)));
  if (!m) { bad(res, 'Member not found', 404); return null; }
  if (forWrite) {
    if (m.id === req.user.id) { bad(res, 'You cannot change your own membership. Ask the account owner.', 403); return null; }
    if (!req.user.isOwner && m.role === 'manager') { bad(res, 'Only the account owner can manage administrators', 403); return null; }
  }
  return m;
}

const sessionCount = async (id) => (await db.get('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ? AND expires_at > ?', id, now())).n;
const memberView = async (m) => ({
  ...(await auth.publicUser(m)),
  status: m.active && m.status === 'active' ? 'active' : 'inactive',
  customPermissions: Boolean(m.permissions),
  activeSessions: await sessionCount(m.id)
});

// ---- Members ----
router.get('/members', auth.requirePerm('team.view'), async (req, res) => {
  const members = await Promise.all((await db.all('SELECT * FROM users WHERE parent_id = ? ORDER BY created_at DESC', ws(req))).map(memberView));
  const pending = (await db.get("SELECT COUNT(*) AS n FROM invitations WHERE account_id = ? AND status = 'pending' AND expires_at > ?", ws(req), now())).n;
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  res.json({
    success: true,
    data: members,
    stats: {
      total: members.length,
      active: members.filter(m => m.status === 'active').length,
      inactive: members.filter(m => m.status !== 'active').length,
      pendingInvitations: pending,
      recentlyActive: members.filter(m => m.lastActiveAt && m.lastActiveAt > dayAgo).length
    },
    permissionKeys: auth.PERMISSIONS,
    roleDefaults: auth.ROLE_DEFAULTS
  });
});

router.post('/members', auth.requirePerm('team.manage'), async (req, res) => {
  const body = req.body || {};
  const v = validateProfile(body);
  if (v.error) return bad(res, v.error);
  const pCheck = auth.validatePassword(body.password);
  if (!pCheck.valid) return bad(res, pCheck.error);
  const denied = guardPrivileges(req, { role: v.role, permissions: body.permissions });
  if (denied) return bad(res, denied, 403);
  if (await auth.getUserByUsername(v.username)) return bad(res, 'That username is already taken', 409);

  let id;
  try {
    await db.tx(async () => {
      id = await insertMember(ws(req), { ...v, permissions: Array.isArray(body.permissions) ? body.permissions : null, password: body.password });
      await auth.setUserAccounts(id, await workspaceAccountIds(ws(req), body.accountIds));
    });
  } catch (err) {
    return bad(res, db.isUniqueViolation(err) ? 'That username or phone number is already registered' : 'Could not create member', 409);
  }
  await auth.audit(req, 'team.member_created', { memberId: id, username: v.username, role: v.role });
  res.json({ success: true, data: await memberView(await auth.getUserById(id)) });
});

router.get('/members/:id', auth.requirePerm('team.view'), async (req, res) => {
  const m = await loadMember(req, res, { forWrite: false });
  if (!m) return;
  const recent = (await db.all('SELECT action, details, ip_address, created_at FROM audit_logs WHERE account_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50', ws(req), m.id));
  res.json({ success: true, data: { ...(await memberView(m)), recentActivity: recent.map(r => ({ ...r, details: JSON.parse(r.details || '{}') })) } });
});

router.put('/members/:id', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  const body = { ...(req.body || {}) };
  delete body.username; // usernames are login identities; keep stable
  const v = validateProfile(body, { partial: true });
  if (v.error) return bad(res, v.error);
  const denied = guardPrivileges(req, { role: v.role, permissions: body.permissions });
  if (denied) return bad(res, denied, 403);
  try {
    await db.tx(async () => {
      (await db.run('UPDATE users SET name = ?, full_name = ?, email = ?, phone_number = ?, role = ?, updated_at = ? WHERE id = ?', v.fullName ?? m.name, v.fullName ?? m.full_name, v.email !== undefined ? v.email : m.email,
        v.phone !== undefined ? v.phone : m.phone_number, v.role ?? m.role, now(), m.id));
      if (body.permissions !== undefined) await setPermissions(m.id, body.permissions);
      if (body.accountIds !== undefined) await auth.setUserAccounts(m.id, await workspaceAccountIds(ws(req), body.accountIds));
    });
  } catch (err) {
    return bad(res, db.isUniqueViolation(err) ? 'That phone number is already registered' : 'Could not update member', 409);
  }
  await auth.audit(req, 'team.member_updated', { memberId: m.id, fields: Object.keys(body) });
  res.json({ success: true, data: await memberView(await auth.getUserById(m.id)) });
});

router.delete('/members/:id', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  // Sessions, access grants and preferences cascade; chats, messages, media and audit history stay with the workspace.
  await auth.revokeAllUserSessions(m.id);
  (await db.run('DELETE FROM users WHERE id = ?', m.id));
  await auth.audit(req, 'team.member_deleted', { memberId: m.id, username: m.username });
  res.json({ success: true, message: `Member @${m.username} removed` });
});

// ---- Status ----
router.patch('/members/:id/status', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  const { status } = req.body || {};
  if (!['active', 'inactive'].includes(status)) return bad(res, 'Status must be active or inactive');
  (await db.run('UPDATE users SET status = ?, active = ?, updated_at = ? WHERE id = ?', status, status === 'active' ? 1 : 0, now(), m.id));
  if (status === 'inactive') await auth.revokeAllUserSessions(m.id);
  await auth.audit(req, status === 'active' ? 'team.member_activated' : 'team.member_deactivated', { memberId: m.id, username: m.username });
  res.json({ success: true, data: await memberView(await auth.getUserById(m.id)) });
});

router.post('/members/:id/reset-password', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  const pCheck = auth.validatePassword(req.body?.newPassword);
  if (!pCheck.valid) return bad(res, pCheck.error);
  (await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', auth.hashPassword(req.body.newPassword), now(), m.id));
  await auth.revokeAllUserSessions(m.id);
  await auth.audit(req, 'team.member_password_reset', { memberId: m.id });
  res.json({ success: true, message: 'Password reset. The member has been signed out everywhere.' });
});

// ---- Permissions ----
async function setPermissions(userId, list) {
  (await db.run('UPDATE users SET permissions = ?, updated_at = ? WHERE id = ?', list === null ? null : JSON.stringify(auth.sanitizePermissions(list)), now(), userId));
}

router.get('/members/:id/permissions', auth.requirePerm('team.view'), async (req, res) => {
  const m = await loadMember(req, res, { forWrite: false });
  if (!m) return;
  res.json({ success: true, data: { role: m.role, permissions: auth.effectivePermissions(m), custom: Boolean(m.permissions), available: auth.PERMISSIONS } });
});

router.put('/members/:id/permissions', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  const list = req.body?.permissions === null ? null : req.body?.permissions;
  if (list !== null && !Array.isArray(list)) return bad(res, 'permissions must be an array (or null for role defaults)');
  const denied = guardPrivileges(req, { permissions: list || [] });
  if (denied) return bad(res, denied, 403);
  await setPermissions(m.id, list);
  await auth.audit(req, 'team.permissions_changed', { memberId: m.id, permissions: list });
  res.json({ success: true, data: { permissions: auth.effectivePermissions(await auth.getUserById(m.id)) } });
});

// ---- Sessions ----
router.get('/members/:id/sessions', auth.requirePerm('team.view'), async (req, res) => {
  const m = await loadMember(req, res, { forWrite: false });
  if (!m) return;
  const rows = (await db.all('SELECT id, ip_address, user_agent, created_at, expires_at FROM user_sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC', m.id, now()));
  // Session ids are bearer secrets inside signed cookies: expose only a short reference
  res.json({ success: true, data: rows.map(r => ({ ref: r.id.slice(0, 8), ipAddress: r.ip_address, userAgent: r.user_agent, createdAt: r.created_at, expiresAt: r.expires_at })) });
});

router.post('/members/:id/revoke-sessions', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  await auth.revokeAllUserSessions(m.id);
  await auth.audit(req, 'team.sessions_revoked', { memberId: m.id });
  res.json({ success: true, message: 'All sessions revoked' });
});

// ---- WhatsApp account access ----
router.get('/members/:id/whatsapp-access', auth.requirePerm('team.view'), async (req, res) => {
  const m = await loadMember(req, res, { forWrite: false });
  if (!m) return;
  const granted = new Set((await auth.publicUser(m)).accountIds);
  res.json({ success: true, data: (await store.getAccounts(ws(req))).map(a => ({ accountId: a.id, name: a.name, phone: a.phone || null, granted: granted.has(a.id) })) });
});

router.put('/members/:id/whatsapp-access', auth.requirePerm('team.manage'), async (req, res) => {
  const m = await loadMember(req, res);
  if (!m) return;
  if (!Array.isArray(req.body?.accountIds)) return bad(res, 'accountIds must be an array');
  const ids = await workspaceAccountIds(ws(req), req.body.accountIds);
  await auth.setUserAccounts(m.id, ids);
  await auth.audit(req, 'team.whatsapp_access_changed', { memberId: m.id, accountIds: ids });
  res.json({ success: true, data: { accountIds: ids } });
});

// ---- Invitations ----
router.get('/invitations', auth.requirePerm('team.view'), async (req, res) => {
  const rows = (await db.all("SELECT id, username, full_name, email, phone, role, status, expires_at, created_at FROM invitations WHERE account_id = ? ORDER BY created_at DESC LIMIT 100", ws(req)));
  res.json({ success: true, data: rows.map(r => ({ ...r, status: r.status === 'pending' && Date.parse(r.expires_at) < Date.now() ? 'expired' : r.status })) });
});

router.post('/invitations', auth.requirePerm('team.manage'), async (req, res) => {
  const body = req.body || {};
  const v = validateProfile(body);
  if (v.error) return bad(res, v.error);
  const denied = guardPrivileges(req, { role: v.role, permissions: body.permissions });
  if (denied) return bad(res, denied, 403);
  if (await auth.getUserByUsername(v.username) ||
      (await db.get("SELECT 1 FROM invitations WHERE LOWER(username) = LOWER(?) AND status = 'pending' AND expires_at > ?", v.username, now()))) {
    return bad(res, 'That username is already taken', 409);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600000).toISOString();
  (await db.run(`
    INSERT INTO invitations (id, account_id, invited_by, username, full_name, email, phone, role, permissions, account_ids, token_hash, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `, id, ws(req), req.user.id, v.username, v.fullName, v.email || null, v.phone || null, v.role,
    Array.isArray(body.permissions) ? JSON.stringify(auth.sanitizePermissions(body.permissions)) : null,
    JSON.stringify(await workspaceAccountIds(ws(req), body.accountIds)), hashToken(token), expiresAt, now()));
  await auth.audit(req, 'team.invitation_created', { invitationId: id, username: v.username, role: v.role });
  const origin = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  // The raw token is returned once and never stored
  res.json({ success: true, data: { id, expiresAt, token, inviteUrl: `${origin.replace(/\/$/, '')}/?invite=${token}` } });
});

router.delete('/invitations/:id', auth.requirePerm('team.manage'), async (req, res) => {
  const r = (await db.run("UPDATE invitations SET status = 'revoked' WHERE id = ? AND account_id = ? AND status = 'pending'", req.params.id, ws(req)));
  if (!r.changes) return bad(res, 'Invitation not found', 404);
  await auth.audit(req, 'team.invitation_revoked', { invitationId: req.params.id });
  res.json({ success: true });
});

// ---- Activity (read-only for everyone; audit rows are never editable through the API) ----
router.get('/activity', auth.requirePerm('audit.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const params = [ws(req)];
  let where = 'a.account_id = ?';
  if (req.query.userId) { where += ' AND a.user_id = ?'; params.push(Number(req.query.userId)); }
  if (req.query.before) { where += ' AND a.created_at < ?'; params.push(String(req.query.before)); }
  const rows = (await db.all(`
    SELECT a.id, a.user_id, a.action, a.ip_address, a.details, a.created_at, u.username, u.full_name
    FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE ${where} ORDER BY a.created_at DESC LIMIT ?
  `, ...params, limit));
  res.json({ success: true, data: rows.map(r => ({ ...r, details: JSON.parse(r.details || '{}') })) });
});

module.exports = router;
