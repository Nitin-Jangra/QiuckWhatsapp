// Login, signed session cookies, OTP verification and access rules. Uses only Node's built-in crypto.
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'wa_session';
const MAX_AGE_SEC = 7 * 24 * 3600;
const OTP_COOLDOWN_MS = 60 * 1000;      // 60 seconds resend cooldown
const OTP_EXPIRY_MS = 10 * 60 * 1000;    // 10 minutes expiry
const OTP_MAX_ATTEMPTS = 3;

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

// ---- Normalization & Validation ----
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
  return { valid: true };
}

// ---- Cryptographic Helpers ----
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

function createSession(userId, req) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + MAX_AGE_SEC * 1000).toISOString();
  const ipAddress = req?.ip || req?.socket?.remoteAddress || '';
  const userAgent = req?.headers?.['user-agent'] || '';

  try {
    db.prepare(`
      INSERT INTO user_sessions (id, user_id, ip_address, user_agent, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, ipAddress, userAgent, expiresAt, new Date().toISOString());
  } catch (err) {
    // If table missing in tests, fallback to purely signed token
  }

  const payload = Buffer.from(JSON.stringify({ sid: sessionId, uid: userId, exp: Date.now() + MAX_AGE_SEC * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp <= Date.now()) return null;

    // If session ID is present, verify session is still active in database
    if (data.sid) {
      const active = db.prepare('SELECT id FROM user_sessions WHERE id = ? AND expires_at > ?').get(data.sid, new Date().toISOString());
      if (!active) return null;
    }
    return data.uid;
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
  const token = createSession(userId, req);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure ? '; Secure' : ''}`
  );
}

function clearSessionCookie(req, res) {
  const cookies = parseCookies(req?.headers?.cookie || '');
  const token = cookies[COOKIE];
  if (token) {
    const [payload] = String(token).split('.');
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (data.sid) {
        db.prepare('DELETE FROM user_sessions WHERE id = ?').run(data.sid);
      }
    } catch (e) {}
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function revokeAllUserSessions(userId) {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}

// ---- OTP Management ----
function hashOtp(otp) {
  return crypto.createHmac('sha256', SECRET).update(String(otp)).digest('hex');
}

function sendOtp(phoneNumber, purpose) {
  const phone = normalizePhone(phoneNumber);
  if (!phone || phone.length < 10) throw new Error('A valid mobile phone number is required');

  // Cooldown check: Has an active OTP been issued in the last 60 seconds?
  const recent = db.prepare(`
    SELECT created_at FROM otp_verifications
    WHERE phone_number = ? AND purpose = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(phone, purpose);

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
  const otpHash = hashOtp(otp);
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS).toISOString();

  // Invalidate any existing unused OTPs for this phone/purpose
  db.prepare('DELETE FROM otp_verifications WHERE phone_number = ? AND purpose = ?').run(phone, purpose);

  db.prepare(`
    INSERT INTO otp_verifications (id, phone_number, otp_hash, purpose, attempts, max_attempts, expires_at, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, phone, otpHash, purpose, OTP_MAX_ATTEMPTS, expiresAt, now.toISOString());

  // Log SMS delivery in dev/production
  if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_OTP === 'true') {
    console.log(`[SMS Gateway Mock] Sent OTP ${otp} to ${phone} for ${purpose}`);
  }

  return {
    success: true,
    message: `OTP sent to ${phone}`,
    phoneNumber: phone,
    expiresAt,
    // devOtp is populated in test/development environment for automated validation
    ...(process.env.NODE_ENV === 'test' || process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {})
  };
}

function verifyOtp(phoneNumber, purpose, candidateOtp) {
  const phone = normalizePhone(phoneNumber);
  if (!phone || !candidateOtp) throw new Error('Phone number and OTP code are required');

  const record = db.prepare(`
    SELECT * FROM otp_verifications
    WHERE phone_number = ? AND purpose = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(phone, purpose);

  if (!record) {
    throw new Error('No active OTP found. Please request a new code.');
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(record.id);
    throw new Error('OTP has expired. Please request a new code.');
  }

  if (record.attempts >= record.max_attempts) {
    db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(record.id);
    throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
  }

  const candidateHash = hashOtp(candidateOtp.trim());
  const expectedHash = record.otp_hash;
  const isMatch = candidateHash.length === expectedHash.length &&
                  crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(expectedHash));

  if (!isMatch) {
    const nextAttempts = record.attempts + 1;
    const remaining = record.max_attempts - nextAttempts;
    db.prepare('UPDATE otp_verifications SET attempts = ? WHERE id = ?').run(nextAttempts, record.id);
    if (remaining <= 0) {
      db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(record.id);
      throw new Error('Invalid OTP. Maximum attempts exceeded. Request a new OTP.');
    }
    throw new Error(`Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  // Successfully verified: remove the OTP so it cannot be re-used
  db.prepare('DELETE FROM otp_verifications WHERE id = ?').run(record.id);
  return true;
}

// ---- Users ----
const publicUser = (u) => u && {
  id: u.id,
  username: u.username,
  name: u.name || u.full_name,
  fullName: u.full_name || u.name,
  phoneNumber: u.phone_number || null,
  phoneVerified: Boolean(u.phone_verified_at),
  role: u.role,
  status: u.status || (u.active ? 'active' : 'disabled'),
  active: Boolean(u.active),
  createdAt: u.created_at,
  accountIds: db.prepare('SELECT account_id FROM user_accounts WHERE user_id = ?').all(u.id).map(r => r.account_id)
};

const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
const getUserByUsername = (username) => db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim()) || null;
const getUserByPhone = (phone) => db.prepare('SELECT * FROM users WHERE phone_number = ?').get(normalizePhone(phone)) || null;
const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

function setUserAccounts(userId, accountIds = []) {
  db.tx(() => {
    db.prepare('DELETE FROM user_accounts WHERE user_id = ?').run(userId);
    for (const id of new Set(accountIds)) {
      db.prepare('INSERT INTO user_accounts (user_id, account_id) VALUES (?, ?)').run(userId, String(id));
    }
  });
}

// Seed default SuperAdmin if no admin exists (in production and development)
function ensureSuperAdmin() {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const adminExists = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n > 0;
    if (!adminExists) {
      const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@WaCRM2026!';
      const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO users (username, name, full_name, phone_number, phone_verified_at, password_hash, role, status, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', 1, ?, ?)
      `).run(
        defaultUsername,
        'Super Administrator',
        'Super Administrator',
        '+919999999999',
        now,
        hashPassword(defaultPassword),
        now,
        now
      );
      console.log(`[WaCRM] Seeded default SuperAdmin: username="${defaultUsername}", password="${defaultPassword}"`);
    }
  } catch (err) {
    // Ignore during concurrent startups
  }
}
ensureSuperAdmin();

// ---- Middleware ----
function isAuthRequired() {
  return process.env.AUTH_REQUIRED === 'true';
}

function attachUser(req, res, next) {
  const uid = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  const user = uid ? getUserById(uid) : null;
  if (user && user.active && user.status !== 'suspended') {
    req.user = publicUser(user);
  } else if (!isAuthRequired()) {
    // Open single-user bypass mode
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

const canAccess = (user, accountId) => {
  if (!isAuthRequired()) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const store = require('./store');
  const acc = store.getAccount(accountId);
  if (acc && acc.userId && acc.userId === user.id) return true;
  return Boolean(user?.accountIds?.includes(accountId));
};

const allowedAccountIds = (user, allIds) => {
  if (!isAuthRequired()) return allIds;
  if (!user) return [];
  if (user.role === 'admin') return allIds;
  return allIds.filter(id => canAccess(user, id));
};

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
  hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, revokeAllUserSessions,
  publicUser, getUserById, getUserByUsername, getUserByPhone, countUsers,
  setUserAccounts, attachUser, requireAuth, requireAdmin, canAccess, allowedAccountIds,
  loginThrottle, readToken, parseCookies, COOKIE,
  normalizePhone, validateUsername, validatePassword,
  sendOtp, verifyOtp, hashOtp
};

