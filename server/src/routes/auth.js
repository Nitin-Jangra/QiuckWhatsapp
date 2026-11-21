const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

const findByUsername = (u) => auth.getUserByUsername(u);
const findByPhone = (p) => auth.getUserByPhone(p);
const maskPhone = (p) => (p ? `${p.slice(0, 3)}******${p.slice(-4)}` : null);
const loginDone = async (req, res, user) => {
  (await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), user.id));
  await auth.setSessionCookie(req, res, user.id);
  await auth.audit(req, 'auth.login', { username: user.username }, { userId: user.id, accountId: user.parent_id || user.id });
  res.json({ success: true, data: { user: await auth.publicUser(await auth.getUserById(user.id)) } });
};

// Who am I? Tells the UI whether authentication is active and who the logged-in user is
router.get('/me', async (req, res) => {
  const authRequired = process.env.AUTH_REQUIRED === 'true';
  res.json({
    success: true,
    data: {
      user: req.user,
      needsSetup: authRequired && await auth.countUsers() === 0,
      authRequired
    }
  });
});

// ---- 1. REGISTRATION ----

// Step 1: Request OTP for mobile number verification
router.post('/register/send-otp', async (req, res) => {
  try {
    const { phoneNumber, username } = req.body || {};

    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Mobile phone number is required' });
    }

    const normPhone = auth.normalizePhone(phoneNumber);
    if (!normPhone || normPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Invalid phone number. Include country code (e.g. +91 9876543210)' });
    }

    // Check if phone number is already registered
    const existingPhone = await findByPhone(normPhone);
    if (existingPhone) {
      return res.status(409).json({ success: false, error: 'This phone number is already registered' });
    }

    // Check username availability if provided
    if (username) {
      const uCheck = auth.validateUsername(username);
      if (!uCheck.valid) {
        return res.status(400).json({ success: false, error: uCheck.error });
      }
      const existingUser = await findByUsername(username);
      if (existingUser) {
        return res.status(409).json({ success: false, error: 'This username is already taken' });
      }
    }

    const result = await auth.sendOtp(normPhone, 'registration');
    res.json({
      success: true,
      message: result.message,
      data: {
        phoneNumber: result.phoneNumber,
        expiresAt: result.expiresAt,
        ...(result.devOtp ? { devOtp: result.devOtp } : {})
      }
    });
  } catch (err) {
    const statusCode = err.code === 'OTP_COOLDOWN' ? 429 : 400;
    res.status(statusCode).json({ success: false, error: err.message, retryAfter: err.retryAfter });
  }
});

// Step 2: Complete registration with verified OTP
router.post('/register/verify', async (req, res) => {
  try {
    const { fullName, username, phoneNumber, email, otp, password, acceptTerms } = req.body || {};
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    if (!acceptTerms) {
      return res.status(400).json({ success: false, error: 'You must accept the terms of service and privacy policy' });
    }

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ success: false, error: 'Full name is required' });
    }

    const uCheck = auth.validateUsername(username);
    if (!uCheck.valid) {
      return res.status(400).json({ success: false, error: uCheck.error });
    }

    const pCheck = auth.validatePassword(password);
    if (!pCheck.valid) {
      return res.status(400).json({ success: false, error: pCheck.error });
    }

    const normPhone = auth.normalizePhone(phoneNumber);
    if (!normPhone || normPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'Invalid phone number' });
    }

    if (!otp) {
      return res.status(400).json({ success: false, error: 'Verification OTP is required' });
    }

    // Check uniqueness
    if (await findByUsername(username)) {
      return res.status(409).json({ success: false, error: 'That username is already taken' });
    }
    if (await findByPhone(normPhone)) {
      return res.status(409).json({ success: false, error: 'That phone number is already registered' });
    }

    // Verify OTP
    await auth.verifyOtp(normPhone, 'registration', otp);

    // Create user
    const now = new Date().toISOString();
    const userId = await db.insert(`
      INSERT INTO users (username, name, full_name, email, phone_number, phone_verified_at, password_hash, role, status, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'active', 1, ?, ?)
    `, uCheck.username,
      fullName.trim(),
      fullName.trim(),
      email ? String(email).trim().toLowerCase() : null,
      normPhone,
      now,
      auth.hashPassword(password),
      now,
      now);

    const user = await auth.getUserById(userId);

    // The new user owns a fresh, isolated workspace (workspace id = owner user id)
    await auth.audit(req, 'auth.registered', { username: uCheck.username }, { userId, accountId: userId });
    // Auto-login newly registered user
    await auth.setSessionCookie(req, res, userId);

    res.json({
      success: true,
      message: 'Registration successful',
      data: { user: await auth.publicUser(user) }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 2. LOGIN ----

router.post('/login', async (req, res) => {
  const throttle = auth.loginThrottle(req);
  if (throttle.blocked) {
    return res.status(429).json({ success: false, error: 'Too many attempts. Try again in a few minutes.' });
  }

  const { username, phoneNumber, password } = req.body || {};
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  let user = null;
  if (username) {
    user = await findByUsername(username);
  } else if (phoneNumber) {
    user = await findByPhone(phoneNumber);
  } else {
    return res.status(400).json({ success: false, error: 'Username or phone number is required' });
  }

  if (!user || !auth.verifyPassword(String(password), user.password_hash) || !await auth.isUserUsable(user)) {
    throttle.fail();
    await auth.audit(req, 'auth.login_failed', { username: String(username || phoneNumber).slice(0, 60) },
      { userId: user?.id ?? null, accountId: user ? user.parent_id || user.id : null });
    return res.status(401).json({ success: false, error: 'Invalid username/phone number or password' });
  }

  throttle.clear();
  await loginDone(req, res, user);
});

// Login via OTP: Send OTP
router.post('/login/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ success: false, error: 'Phone number is required' });

    const normPhone = auth.normalizePhone(phoneNumber);
    const user = await findByPhone(normPhone);
    if (!user || !await auth.isUserUsable(user)) {
      return res.json({ success: true, message: 'If this number is registered, a code has been sent', data: { phoneNumber: normPhone } });
    }

    const result = await auth.sendOtp(normPhone, 'login');
    res.json({
      success: true,
      message: result.message,
      data: {
        phoneNumber: result.phoneNumber,
        expiresAt: result.expiresAt,
        ...(result.devOtp ? { devOtp: result.devOtp } : {})
      }
    });
  } catch (err) {
    const statusCode = err.code === 'OTP_COOLDOWN' ? 429 : 400;
    res.status(statusCode).json({ success: false, error: err.message, retryAfter: err.retryAfter });
  }
});

// Login via OTP: Verify
router.post('/login/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body || {};
    if (!phoneNumber || !otp) {
      return res.status(400).json({ success: false, error: 'Phone number and OTP are required' });
    }

    const normPhone = auth.normalizePhone(phoneNumber);
    const user = await findByPhone(normPhone);
    if (!user || !await auth.isUserUsable(user)) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    await auth.verifyOtp(normPhone, 'login', otp);
    await loginDone(req, res, user);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 3. FORGOT PASSWORD & RESET ----

router.post('/forgot-password/send-otp', async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) return res.status(400).json({ success: false, error: 'Username or phone number is required' });

    let user = await findByUsername(identifier);
    if (!user) user = await findByPhone(identifier);

    if (!user || !user.phone_number) {
      return res.json({ success: true, message: 'If this account exists, a reset code has been sent to its mobile number', data: {} });
    }

    const result = await auth.sendOtp(user.phone_number, 'reset_password');
    res.json({
      success: true,
      message: `Reset code sent to ${maskPhone(result.phoneNumber)}`,
      data: {
        phoneNumber: maskPhone(result.phoneNumber),
        expiresAt: result.expiresAt,
        ...(result.devOtp ? { devOtp: result.devOtp } : {})
      }
    });
  } catch (err) {
    const statusCode = err.code === 'OTP_COOLDOWN' ? 429 : 400;
    res.status(statusCode).json({ success: false, error: err.message, retryAfter: err.retryAfter });
  }
});

router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { phoneNumber, identifier, otp, newPassword } = req.body || {};
    if ((!phoneNumber && !identifier) || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Account, OTP, and new password are required' });
    }

    const pCheck = auth.validatePassword(newPassword);
    if (!pCheck.valid) return res.status(400).json({ success: false, error: pCheck.error });

    // phoneNumber may be the masked value echoed by the UI, so fall back to the identifier
    const user = (phoneNumber && !String(phoneNumber).includes('*') && await findByPhone(phoneNumber))
      || (identifier && (await findByUsername(identifier) || await findByPhone(identifier)));
    if (!user || !user.phone_number) return res.status(400).json({ success: false, error: 'Invalid or expired code' });

    await auth.verifyOtp(user.phone_number, 'reset_password', otp);

    const now = new Date().toISOString();
    (await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', auth.hashPassword(newPassword),
      now,
      user.id));

    // Invalidate existing sessions across all devices
    await auth.revokeAllUserSessions(user.id);
    await auth.audit(req, 'auth.password_reset', {}, { userId: user.id, accountId: user.parent_id || user.id });

    res.json({ success: true, message: 'Password reset successful. Please sign in with your new password.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 4. LOGOUT ----

router.post('/logout', async (req, res) => {
  if (req.user && typeof req.user.id === 'number') await auth.audit(req, 'auth.logout');
  await auth.clearSessionCookie(req, res);
  res.json({ success: true, message: 'Signed out successfully' });
});

router.post('/logout-all', async (req, res) => {
  if (req.user?.id) {
    await auth.audit(req, 'auth.logout_all');
    await auth.revokeAllUserSessions(req.user.id);
  }
  await auth.clearSessionCookie(req, res);
  res.json({ success: true, message: 'Signed out from all devices' });
});

// Change own password (requires current password); signs out every other device
router.post('/change-password', async (req, res) => {
  if (!req.user || typeof req.user.id !== 'number') return res.status(401).json({ success: false, error: 'Please sign in' });
  const { currentPassword, newPassword } = req.body || {};
  const user = await auth.getUserById(req.user.id);
  if (!auth.verifyPassword(String(currentPassword || ''), user.password_hash)) {
    return res.status(400).json({ success: false, error: 'Current password is incorrect' });
  }
  const pCheck = auth.validatePassword(newPassword);
  if (!pCheck.valid) return res.status(400).json({ success: false, error: pCheck.error });
  (await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', auth.hashPassword(newPassword), new Date().toISOString(), user.id));
  await auth.revokeAllUserSessions(user.id);
  await auth.setSessionCookie(req, res, user.id);
  await auth.audit(req, 'auth.password_changed');
  res.json({ success: true, message: 'Password changed. Other devices have been signed out.' });
});

// ---- 5. LEGACY FIRST-RUN SETUP (Backward compatibility) ----

router.post('/setup', async (req, res) => {
  if (await auth.countUsers() > 0) return res.status(403).json({ success: false, error: 'Setup already completed' });
  const { username, name, password, setupKey } = req.body || {};
  if (process.env.SETUP_KEY && setupKey !== process.env.SETUP_KEY) {
    return res.status(403).json({ success: false, error: 'Invalid setup key' });
  }
  if (!username?.trim() || !password || password.length < 8) {
    return res.status(400).json({ success: false, error: 'Username and a password of at least 8 characters are required' });
  }
  const id = await db.insert('INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    username.trim(), (name || username).trim(), auth.hashPassword(password), 'admin', new Date().toISOString());
  await auth.setSessionCookie(req, res, id);
  res.json({ success: true, data: { user: await auth.publicUser(await auth.getUserById(id)) } });
});

module.exports = router;

