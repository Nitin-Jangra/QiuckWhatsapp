// Login, signed session cookies and access rules. Uses only Node's built-in crypto.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'wa_session';
const MAX_AGE_SEC = 7 * 24 * 3600;

// Signing key: env var, or generated once and kept in the database
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'session_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO meta (key, value) VALUES ('session_secret', ?)").run(secret);
  return secret;
}
const SECRET = getSecret();

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};

const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
};

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE_SEC * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data.uid : null;
  } catch (e) {
    return null;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(c => c.trim().split('=')).filter(p => p.length === 2).map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function setSessionCookie(req, res, userId) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${createToken(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure ? '; Secure' : ''}`
  );
}

const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

// ---- Users ----
const publicUser = (u) => u && {
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  active: Boolean(u.active),
  accountIds: db.prepare('SELECT account_id FROM user_accounts WHERE user_id = ?').all(u.id).map(r => r.account_id)
};

const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

function setUserAccounts(userId, accountIds = []) {
  db.tx(() => {
    db.prepare('DELETE FROM user_accounts WHERE user_id = ?').run(userId);
    for (const id of new Set(accountIds)) {
      db.prepare('INSERT INTO user_accounts (user_id, account_id) VALUES (?, ?)').run(userId, String(id));
    }
  });
}

// ---- Middleware ----
function isAuthRequired() {
  return process.env.AUTH_REQUIRED === 'true';
}

function attachUser(req, res, next) {
  const uid = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  const user = uid ? getUserById(uid) : null;
  if (user && user.active) {
    req.user = publicUser(user);
  } else if (!isAuthRequired()) {
    // Single-user / open mode: full admin privileges without login
    req.user = { id: 'admin', username: 'admin', name: 'Admin', role: 'admin', active: true, accountIds: [] };
  } else {
    req.user = null;
  }
  next();
}

const requireAuth = (req, res, next) => {
  if (!isAuthRequired()) return next();
  return req.user ? next() : res.status(401).json({ success: false, error: 'Please sign in' });
};

const requireAdmin = (req, res, next) => {
  if (!isAuthRequired()) return next();
  return req.user?.role === 'admin' ? next() : res.status(403).json({ success: false, error: 'Admin access required' });
};

// Admins see every account; staff only the ones assigned to them
const canAccess = (user, accountId) => {
  if (!isAuthRequired()) return true;
  return user?.role === 'admin' || Boolean(user?.accountIds?.includes(accountId));
};

const allowedAccountIds = (user, allIds) => {
  if (!isAuthRequired()) return allIds;
  return user?.role === 'admin' ? allIds : allIds.filter(id => user?.accountIds?.includes(id));
};

// Slow down password guessing: 10 failures per IP per 10 minutes
const failures = new Map();
function loginThrottle(req) {
  const ip = req.ip;
  const now = Date.now();
  const list = (failures.get(ip) || []).filter(t => now - t < 600000);
  failures.set(ip, list);
  return {
    blocked: list.length >= 10,
    fail: () => failures.set(ip, [...list, now])
  };
}

module.exports = {
  hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, publicUser, getUserById, countUsers,
  setUserAccounts, attachUser, requireAuth, requireAdmin, canAccess, allowedAccountIds, loginThrottle, readToken, parseCookies, COOKIE
};
