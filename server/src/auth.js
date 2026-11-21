// Login, signed session cookies, OTP verification and access rules. Uses only Node's built-in crypto.
// All database-touching helpers are async (see db.js).
const crypto = require('crypto');
const { EventEmitter } = require('events');
const db = require('./db');

// Emits 'revoked' (userId) so live SSE streams on this instance close immediately.
// Other instances detect revocation through the shared user_sessions table.
const events = new EventEmitter();

const COOKIE = 'wa_session';
const MAX_AGE_SEC = 7 * 24 * 3600;
const OTP_COOLDOWN_MS = 60 * 1000;      // 60 seconds resend cooldown
const OTP_EXPIRY_MS = 10 * 60 * 1000;    // 10 minutes expiry
const OTP_MAX_ATTEMPTS = 3;

// Signing key: env var, or generated once and kept in the database (set by init())
let SECRET = null;
async function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = await db.get("SELECT value FROM meta WHERE key = 'session_secret'");
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  // Another instance may have raced us: keep whichever was stored first
  await db.run("INSERT INTO meta (key, value) VALUES ('session_secret', ?) ON CONFLICT DO NOTHING", secret);
  return (await db.get("SELECT value FROM meta WHERE key = 'session_secret'")).value;
}

// ---- Normalization & Validation ----
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function validateEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return { valid: false, error: 'Email address is required' };
  if (norm.length > 254) return { valid: false, error: 'Email address is too long' };
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(norm)) {
    return { valid: false, error: 'Please enter a valid email address' };
  }
  return { valid: true, email: norm };
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const norm = normalizeEmail(email);
  const parts = norm.split('@');
  if (parts.length !== 2) return norm;
  const [user, domain] = parts;
  const maskedUser = user.length <= 2
    ? `${user[0]}*`
    : `${user.slice(0, 2)}***${user.slice(-1)}`;
  return `${maskedUser}@${domain}`;
}

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return { valid: false, error: 'Username is required' };
  const u = username.trim();
  if (u.length < 4 || u.length > 30) return { valid: false, error: 'Username must be between 4 and 30 characters' };
  if (!/^[a-zA-Z0-9_.]+$/.test(u)) {
    return { valid: false, error: 'Username may only contain letters, numbers, underscores, and periods' };
  }
  return { valid: true, username: u };
}

function validatePassword(password) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (password.length > 128) return { valid: false, error: 'Password must be at most 128 characters' };
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter and one number' };
  }
  return { valid: true };
}

// ---- Cryptographic Helpers ----
// Argon2id (native in Node 24.7+). Older Node falls back to scrypt; both formats verify.
const ARGON = { parallelism: 1, tagLength: 32, memory: 19456, passes: 2 };
const hasArgon = typeof crypto.argon2Sync === 'function';
const argon = (password, nonce) => crypto.argon2Sync('argon2id', { ...ARGON, message: password, nonce });

const hashPassword = (password) => {
  if (hasArgon) {
    const nonce = crypto.randomBytes(16);
    return ['argon2id', nonce.toString('hex'), argon(password, nonce).toString('hex')].join('$');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};

const verifyPassword = (password, stored) => {
  if (String(stored).startsWith('argon2id$')) {
    if (!hasArgon) return false;
    const [, nonce, hash] = String(stored).split('$');
    const real = Buffer.from(hash, 'hex');
    const test = argon(password, Buffer.from(nonce, 'hex'));
    return real.length === test.length && crypto.timingSafeEqual(real, test);
  }
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
};

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

async function createSession(userId, req) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + MAX_AGE_SEC * 1000).toISOString();
  const ipAddress = req?.ip || req?.socket?.remoteAddress || '';
  const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 300);

  await db.run(
    'INSERT INTO user_sessions (id, user_id, ip_address, user_agent, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    sessionId, userId, ipAddress, userAgent, expiresAt, new Date().toISOString()
  );

  const payload = Buffer.from(JSON.stringify({ sid: sessionId, uid: userId, exp: Date.now() + MAX_AGE_SEC * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

async function readSession(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch (e) {
    return null;
  }
  if (!data || data.exp <= Date.now()) return null;
  // Sessions must still exist in the database (revocation works across instances)
  if (data.sid) {
    const active = await db.get('SELECT id FROM user_sessions WHERE id = ? AND expires_at > ?', data.sid, new Date().toISOString());
    if (!active) return null;
  }
  return { uid: data.uid, sid: data.sid || null };
}
const readToken = async (token) => (await readSession(token))?.uid || null;

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(c => c.trim().split('=')).filter(p => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

async function setSessionCookie(req, res, userId) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const token = await createSession(userId, req);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure ? '; Secure' : ''}`
  );
}

async function clearSessionCookie(req, res) {
  const token = parseCookies(req?.headers?.cookie || '')[COOKIE];
  if (token) {
    try {
      const data = JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString());
      if (data.sid) await db.run('DELETE FROM user_sessions WHERE id = ?', data.sid);
    } catch (e) {}
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function revokeAllUserSessions(userId) {
  await db.run('DELETE FROM user_sessions WHERE user_id = ?', userId);
  events.emit('revoked', userId);
}

// ---- OTP Management ----
function hashOtp(otp) {
  return crypto.createHmac('sha256', SECRET).update(String(otp)).digest('hex');
}

async function sendOtp(target, purpose) {
  if (!target) throw new Error('Recipient email or phone number is required');
  const isEmail = typeof target === 'string' && target.includes('@');
  let email = null;
  let phone = null;

  if (isEmail) {
    const eCheck = validateEmail(target);
    if (!eCheck.valid) throw new Error(eCheck.error);
    email = eCheck.email;
  } else {
    phone = normalizePhone(target);
    if (!phone || phone.length < 10) throw new Error('A valid mobile phone number is required');
  }

  // Cooldown check: Has an active OTP been issued in the last 60 seconds?
  const recent = isEmail
    ? await db.get(
        'SELECT created_at FROM otp_verifications WHERE (email = ? OR phone_number = ?) AND purpose = ? ORDER BY created_at DESC LIMIT 1',
        email, email, purpose
      )
    : await db.get(
        'SELECT created_at FROM otp_verifications WHERE phone_number = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
        phone, purpose
      );
  if (recent) {
    const elapsed = Date.now() - new Date(recent.created_at).getTime();
    if (elapsed < OTP_COOLDOWN_MS) {
      const remainingSec = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
      const err = new Error(`Please wait ${remainingSec} seconds before requesting a new OTP`);
      err.code = 'OTP_COOLDOWN';
      err.retryAfter = remainingSec;
      throw err;
    }
  }

  // Generate cryptographically secure 6-digit numeric code
  const otp = crypto.randomInt(100000, 1000000).toString();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS).toISOString();

  await db.tx(async () => {
    if (isEmail) {
      await db.run('DELETE FROM otp_verifications WHERE (email = ? OR phone_number = ?) AND purpose = ?', email, email, purpose);
      await db.run(
        `INSERT INTO otp_verifications (id, phone_number, email, otp_hash, purpose, attempts, max_attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        crypto.randomUUID(), email, email, hashOtp(otp), purpose, OTP_MAX_ATTEMPTS, expiresAt, now.toISOString()
      );
    } else {
      // Invalidate any existing unused OTPs for this phone/purpose
      await db.run('DELETE FROM otp_verifications WHERE phone_number = ? AND purpose = ?', phone, purpose);
      await db.run(
        `INSERT INTO otp_verifications (id, phone_number, otp_hash, purpose, attempts, max_attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        crypto.randomUUID(), phone, hashOtp(otp), purpose, OTP_MAX_ATTEMPTS, expiresAt, now.toISOString()
      );
    }
  });

  // Log delivery in dev/production
  if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_OTP === 'true') {
    if (isEmail) {
      console.log(`[Email Service Mock] Sent OTP ${otp} to ${email} for ${purpose}`);
    } else {
      console.log(`[SMS Gateway Mock] Sent OTP ${otp} to ${phone} for ${purpose}`);
    }
  }

  return {
    success: true,
    message: isEmail ? `OTP sent to ${maskEmail(email)}` : `OTP sent to ${phone}`,
    email: email || undefined,
    phoneNumber: phone || undefined,
    expiresAt,
    // devOtp is populated outside production for automated validation
    ...(process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {})
  };
}

async function verifyOtp(target, purpose, candidateOtp) {
  if (!target || !candidateOtp) throw new Error('Recipient and OTP code are required');
  const isEmail = typeof target === 'string' && target.includes('@');
  const normTarget = isEmail ? normalizeEmail(target) : normalizePhone(target);

  const record = await db.get(
    'SELECT * FROM otp_verifications WHERE (email = ? OR phone_number = ?) AND purpose = ? ORDER BY created_at DESC LIMIT 1',
    normTarget, normTarget, purpose
  );
  if (!record) throw new Error('No active OTP found. Please request a new code.');

  if (new Date(record.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM otp_verifications WHERE id = ?', record.id);
    throw new Error('OTP has expired. Please request a new code.');
  }
  if (record.attempts >= record.max_attempts) {
    await db.run('DELETE FROM otp_verifications WHERE id = ?', record.id);
    throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
  }

  const candidateHash = hashOtp(String(candidateOtp).trim());
  const expectedHash = record.otp_hash;
  const isMatch = candidateHash.length === expectedHash.length &&
                  crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(expectedHash));

  if (!isMatch) {
    const nextAttempts = record.attempts + 1;
    const remaining = record.max_attempts - nextAttempts;
    await db.run('UPDATE otp_verifications SET attempts = ? WHERE id = ?', nextAttempts, record.id);
    if (remaining <= 0) {
      await db.run('DELETE FROM otp_verifications WHERE id = ?', record.id);
      throw new Error('Invalid OTP. Maximum attempts exceeded. Request a new OTP.');
    }
    throw new Error(`Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Successfully verified: delete atomically so a parallel replay cannot also succeed
  const used = await db.run('DELETE FROM otp_verifications WHERE id = ?', record.id);
  if (!used.changes) throw new Error('No active OTP found. Please request a new code.');
  return true;
}

// ---- Permissions (default deny) ----
// Roles: 'admin' = platform SuperAdmin, 'user' = workspace owner, 'manager' = workspace administrator, 'agent' = member.
const PERMISSIONS = [
  'accounts.manage',   // connect / disconnect / delete WhatsApp numbers, pause sending
  'chats.view',        // view conversations and message history
  'chats.send',        // send messages and media
  'chats.organize',    // pin / archive / mark read
  'media.view',        // open / download attachments
  'team.view',         // see members and their activity
  'team.manage',       // add / edit / activate / deactivate / remove members
  'audit.view'         // workspace activity log
];
const ROLE_DEFAULTS = {
  manager: ['chats.view', 'chats.send', 'chats.organize', 'media.view', 'team.view', 'team.manage', 'audit.view'],
  agent: ['chats.view', 'chats.send', 'chats.organize', 'media.view']
};
const sanitizePermissions = (list) => [...new Set((Array.isArray(list) ? list : []).filter(p => PERMISSIONS.includes(p)))];
const isOwnerRow = (u) => u.role === 'user' && !u.parent_id;
function effectivePermissions(u) {
  if (u.role === 'admin' || isOwnerRow(u)) return [...PERMISSIONS];
  if (u.permissions) {
    try { return sanitizePermissions(JSON.parse(u.permissions)); } catch (e) { return []; }
  }
  return [...(ROLE_DEFAULTS[u.role] || [])];
}

// ---- Users ----
async function publicUser(u) {
  if (!u) return u;
  const grants = await db.all('SELECT account_id FROM user_accounts WHERE user_id = ?', u.id);
  return {
    id: u.id,
    username: u.username,
    email: u.email || null,
    parentId: u.parent_id || null,
    workspaceId: u.parent_id || u.id,
    isOwner: isOwnerRow(u),
    permissions: effectivePermissions(u),
    lastLoginAt: u.last_login_at || null,
    lastActiveAt: u.last_active_at || null,
    name: u.name || u.full_name,
    fullName: u.full_name || u.name,
    emailVerified: Boolean(u.email_verified_at),
    phoneNumber: u.phone_number || null,
    phoneVerified: Boolean(u.phone_verified_at),
    role: u.role,
    status: u.status || (u.active ? 'active' : 'disabled'),
    active: Boolean(u.active),
    createdAt: u.created_at,
    accountIds: grants.map(r => r.account_id)
  };
}

const getUserById = async (id) => (await db.get('SELECT * FROM users WHERE id = ?', id)) || null;
const getUserByUsername = async (username) =>
  (await db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', String(username || '').trim())) || null;
const getUserByEmail = async (email) =>
  (await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', normalizeEmail(email))) || null;
const getUserByPhone = async (phone) => (await db.get('SELECT * FROM users WHERE phone_number = ?', normalizePhone(phone))) || null;
const countUsers = async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n;

async function setUserAccounts(userId, accountIds = []) {
  await db.tx(async () => {
    await db.run('DELETE FROM user_accounts WHERE user_id = ?', userId);
    for (const id of new Set(accountIds)) {
      await db.run('INSERT INTO user_accounts (user_id, account_id) VALUES (?, ?)', userId, String(id));
    }
  });
}

// Seed default SuperAdmin if no admin exists
async function ensureSuperAdmin() {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const adminExists = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n > 0;
    if (adminExists) return;
    const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@WaCRM2026!';
    const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO users (username, name, full_name, phone_number, phone_verified_at, password_hash, role, status, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', 1, ?, ?)`,
      defaultUsername, 'Super Administrator', 'Super Administrator', '+919999999999', now, hashPassword(defaultPassword), now, now
    );
    // Never log the password itself
    console.log(`[WaCRM] Seeded SuperAdmin "${defaultUsername}" (password from ADMIN_PASSWORD${process.env.ADMIN_PASSWORD ? '' : ', default: CHANGE IT NOW'})`);
  } catch (err) {
    // Ignore during concurrent startups
  }
}

// Called once at startup, after db.ready
async function init() {
  SECRET = await loadSecret();
  await ensureSuperAdmin();
}

// ---- Middleware ----
function isAuthRequired() {
  return process.env.AUTH_REQUIRED === 'true';
}

// A user may act only while they and (for members) their workspace owner are active
const statusOk = (u) => Boolean(u && u.active && (!u.status || u.status === 'active'));
async function isUserUsable(u) {
  if (!statusOk(u)) return false;
  return !u.parent_id || statusOk(await getUserById(u.parent_id));
}

// Resolve a session token to a fully re-checked public user (used by HTTP and SSE)
async function userFromToken(token) {
  const s = await readSession(token);
  const u = s ? await getUserById(s.uid) : null;
  return (await isUserUsable(u)) ? { user: await publicUser(u), sid: s.sid } : null;
}

async function attachUser(req, res, next) {
  try {
    const resolved = await userFromToken(parseCookies(req.headers.cookie)[COOKIE]);
    if (resolved) {
      req.user = resolved.user;
      req.sessionId = resolved.sid;
      // Track last activity, at most once per minute per user
      const last = resolved.user.lastActiveAt ? Date.parse(resolved.user.lastActiveAt) : 0;
      if (Date.now() - last > 60000) {
        await db.run('UPDATE users SET last_active_at = ? WHERE id = ?', new Date().toISOString(), resolved.user.id);
      }
    } else if (!isAuthRequired()) {
      // Open single-user bypass mode
      req.user = { id: 'admin', username: 'admin', name: 'Admin', role: 'admin', active: true, accountIds: [] };
    } else {
      req.user = null;
    }
    next();
  } catch (err) {
    next(err);
  }
}

const requireAuth = (req, res, next) => {
  if (!isAuthRequired()) return next();
  return req.user ? next() : res.status(401).json({ success: false, error: 'Please sign in' });
};

const requireAdmin = (req, res, next) => {
  if (!isAuthRequired()) return next();
  return req.user?.role === 'admin' ? next() : res.status(403).json({ success: false, error: 'Admin access required' });
};

// Permission check. Owners and SuperAdmins hold every permission.
const can = (user, perm) => {
  if (!isAuthRequired()) return true;
  return Boolean(user && (user.role === 'admin' || user.isOwner || user.permissions?.includes(perm)));
};
const requirePerm = (perm) => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ success: false, error: 'You do not have permission for this action' });

// Pure access rule given the account's owner (null when unknown/legacy)
function canAccessOwned(user, accountId, ownerId) {
  if (!isAuthRequired()) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (ownerId) {
    if (ownerId === user.workspaceId && user.isOwner) return true;
    // Team members are confined to their own workspace even if a stale grant exists
    if (user.parentId && ownerId !== user.workspaceId) return false;
  }
  // Members (and legacy SuperAdmin-assigned agents) need an explicit per-number grant
  return Boolean(user?.accountIds?.includes(accountId));
}

// WhatsApp account access: must belong to the caller's workspace; members also need an explicit grant
async function canAccess(user, accountId) {
  if (!isAuthRequired()) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const row = await db.get('SELECT user_id FROM accounts WHERE id = ?', accountId);
  return canAccessOwned(user, accountId, row?.user_id || null);
}

// Filters account ids in one query instead of one lookup per id
async function allowedAccountIds(user, allIds) {
  if (!isAuthRequired()) return allIds;
  if (!user) return [];
  if (user.role === 'admin') return allIds;
  const owners = new Map((await db.all('SELECT id, user_id FROM accounts')).map(r => [r.id, r.user_id]));
  return allIds.filter(id => canAccessOwned(user, id, owners.get(id) || null));
}

// Audit trail. Never pass passwords, OTPs or tokens in details.
async function audit(req, action, details = {}, { userId, accountId } = {}) {
  try {
    const actor = req?.user && typeof req.user.id === 'number' ? req.user : null;
    await db.run(
      'INSERT INTO audit_logs (id, user_id, account_id, action, ip_address, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(),
      userId ?? actor?.id ?? null,
      accountId ?? actor?.workspaceId ?? null,
      action,
      req?.ip || req?.socket?.remoteAddress || '',
      JSON.stringify(details),
      new Date().toISOString()
    );
  } catch (e) {}
}

// Slow down password guessing: 10 failures per IP per 10 minutes
const failures = new Map();
function loginThrottle(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const list = (failures.get(ip) || []).filter(t => now - t < 600000);
  failures.set(ip, list);
  return {
    blocked: list.length >= 10,
    fail: () => failures.set(ip, [...list, now]),
    clear: () => failures.delete(ip)
  };
}

module.exports = {
  init,
  secret: () => SECRET,
  hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, revokeAllUserSessions,
  publicUser, getUserById, getUserByUsername, getUserByEmail, getUserByPhone, countUsers,
  setUserAccounts, attachUser, requireAuth, requireAdmin, canAccess, canAccessOwned, allowedAccountIds,
  loginThrottle, readToken, readSession, userFromToken, isUserUsable, parseCookies, COOKIE,
  can, requirePerm, audit, events, PERMISSIONS, ROLE_DEFAULTS, sanitizePermissions, effectivePermissions, isAuthRequired,
  normalizeEmail, validateEmail, maskEmail, normalizePhone, validateUsername, validatePassword,
  sendOtp, verifyOtp, hashOtp
};
