const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

const findByUsername = (u) => auth.getUserByUsername(u);
const findByPhone = (p) => auth.getUserByPhone(p);

// Who am I? Tells the UI whether authentication is active and who the logged-in user is
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

// ---- 1. REGISTRATION ----

// Step 1: Request OTP for mobile number verification
router.post('/register/send-otp', (req, res) => {
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
    const existingPhone = findByPhone(normPhone);
    if (existingPhone) {
      return res.status(409).json({ success: false, error: 'This phone number is already registered' });
    }

    // Check username availability if provided
    if (username) {
      const uCheck = auth.validateUsername(username);
      if (!uCheck.valid) {
        return res.status(400).json({ success: false, error: uCheck.error });
      }
      const existingUser = findByUsername(username);
      if (existingUser) {
        return res.status(409).json({ success: false, error: 'This username is already taken' });
      }
    }

    const result = auth.sendOtp(normPhone, 'registration');
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
router.post('/register/verify', (req, res) => {
  try {
    const { fullName, username, phoneNumber, otp, password, acceptTerms } = req.body || {};

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
    if (findByUsername(username)) {
      return res.status(409).json({ success: false, error: 'That username is already taken' });
    }
    if (findByPhone(normPhone)) {
      return res.status(409).json({ success: false, error: 'That phone number is already registered' });
    }

    // Verify OTP
    auth.verifyOtp(normPhone, 'registration', otp);

    // Create user
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO users (username, name, full_name, phone_number, phone_verified_at, password_hash, role, status, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'user', 'active', 1, ?, ?)
    `).run(
      uCheck.username,
      fullName.trim(),
      fullName.trim(),
      normPhone,
      now,
      auth.hashPassword(password),
      now,
      now
    );

    const userId = Number(info.lastInsertRowid);
    const user = auth.getUserById(userId);

    // Auto-login newly registered user
    auth.setSessionCookie(req, res, userId);

    res.json({
      success: true,
      message: 'Registration successful',
      data: { user: auth.publicUser(user) }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 2. LOGIN ----

router.post('/login', (req, res) => {
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
    user = findByUsername(username);
  } else if (phoneNumber) {
    user = findByPhone(phoneNumber);
  } else {
    return res.status(400).json({ success: false, error: 'Username or phone number is required' });
  }

  if (!user || !user.active || user.status === 'suspended' || !auth.verifyPassword(String(password), user.password_hash)) {
    throttle.fail();
    return res.status(401).json({ success: false, error: 'Invalid username/phone number or password' });
  }

  throttle.clear();
  auth.setSessionCookie(req, res, user.id);
  res.json({ success: true, data: { user: auth.publicUser(user) } });
});

// Login via OTP: Send OTP
router.post('/login/send-otp', (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ success: false, error: 'Phone number is required' });

    const normPhone = auth.normalizePhone(phoneNumber);
    const user = findByPhone(normPhone);
    if (!user) {
      return res.status(404).json({ success: false, error: 'No account found with this phone number' });
    }
    if (!user.active || user.status === 'suspended') {
      return res.status(403).json({ success: false, error: 'Account is deactivated or suspended' });
    }

    const result = auth.sendOtp(normPhone, 'login');
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
router.post('/login/verify-otp', (req, res) => {
  try {
    const { phoneNumber, otp } = req.body || {};
    if (!phoneNumber || !otp) {
      return res.status(400).json({ success: false, error: 'Phone number and OTP are required' });
    }

    const normPhone = auth.normalizePhone(phoneNumber);
    const user = findByPhone(normPhone);
    if (!user || !user.active) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    auth.verifyOtp(normPhone, 'login', otp);
    auth.setSessionCookie(req, res, user.id);
    res.json({ success: true, data: { user: auth.publicUser(user) } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 3. FORGOT PASSWORD & RESET ----

router.post('/forgot-password/send-otp', (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) return res.status(400).json({ success: false, error: 'Username or phone number is required' });

    let user = findByUsername(identifier);
    if (!user) user = findByPhone(identifier);

    if (!user || !user.phone_number) {
      return res.status(404).json({ success: false, error: 'Account not found or no mobile number linked' });
    }

    const result = auth.sendOtp(user.phone_number, 'reset_password');
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

router.post('/forgot-password/reset', (req, res) => {
  try {
    const { phoneNumber, otp, newPassword } = req.body || {};
    if (!phoneNumber || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Phone number, OTP, and new password are required' });
    }

    const pCheck = auth.validatePassword(newPassword);
    if (!pCheck.valid) return res.status(400).json({ success: false, error: pCheck.error });

    const normPhone = auth.normalizePhone(phoneNumber);
    const user = findByPhone(normPhone);
    if (!user) return res.status(404).json({ success: false, error: 'Account not found' });

    auth.verifyOtp(normPhone, 'reset_password', otp);

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      auth.hashPassword(newPassword),
      now,
      user.id
    );

    // Invalidate existing sessions across all devices
    auth.revokeAllUserSessions(user.id);

    res.json({ success: true, message: 'Password reset successful. Please sign in with your new password.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 4. LOGOUT ----

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.json({ success: true, message: 'Signed out successfully' });
});

router.post('/logout-all', (req, res) => {
  if (req.user?.id) {
    auth.revokeAllUserSessions(req.user.id);
  }
  auth.clearSessionCookie(req, res);
  res.json({ success: true, message: 'Signed out from all devices' });
});

// ---- 5. LEGACY FIRST-RUN SETUP (Backward compatibility) ----

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

module.exports = router;

