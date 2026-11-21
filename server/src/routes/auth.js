const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

const findByUsername = (u) => auth.getUserByUsername(u);
const findByPhone = (p) => auth.getUserByPhone(p);
const findByEmail = (e) => auth.getUserByEmail(e);
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

// Step 1: Request OTP for email verification (or mobile fallback)
router.post('/register/send-otp', async (req, res) => {
  try {
    const { email, phoneNumber, username } = req.body || {};

    if (!email && !phoneNumber) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    let target = '';
    if (email) {
      const eCheck = auth.validateEmail(email);
      if (!eCheck.valid) {
        return res.status(400).json({ success: false, error: eCheck.error });
      }
      target = eCheck.email;

      // Check if email is already registered
      const existingEmail = await findByEmail(target);
      if (existingEmail) {
        return res.status(409).json({ success: false, error: 'This email is already registered' });
      }
    } else {
      // Fallback for mobile phone if email is not provided
      const normPhone = auth.normalizePhone(phoneNumber);
      if (!normPhone || normPhone.length < 10) {
        return res.status(400).json({ success: false, error: 'Invalid phone number. Include country code (e.g. +91 9876543210)' });
      }
      target = normPhone;
      const existingPhone = await findByPhone(normPhone);
      if (existingPhone) {
        return res.status(409).json({ success: false, error: 'This phone number is already registered' });
      }
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

    const result = await auth.sendOtp(target, 'registration');
    res.json({
      success: true,
      message: result.message,
      data: {
        ...(result.email ? { email: result.email } : {}),
        ...(result.phoneNumber ? { phoneNumber: result.phoneNumber } : {}),
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
    const { fullName, username, email, phoneNumber, otp, password, acceptTerms } = req.body || {};

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

    if (!otp) {
      return res.status(400).json({ success: false, error: 'Verification OTP is required' });
    }

    if (!email && !phoneNumber) {
      return res.status(400).json({ success: false, error: 'Email address is required' });
    }

    let normEmail = null;
    let normPhone = null;

    if (email) {
      const eCheck = auth.validateEmail(email);
      if (!eCheck.valid) {
        return res.status(400).json({ success: false, error: eCheck.error });
      }
      normEmail = eCheck.email;
    }

    if (phoneNumber) {
      normPhone = auth.normalizePhone(phoneNumber);
      if (normPhone && normPhone.length < 10 && !normEmail) {
        return res.status(400).json({ success: false, error: 'Invalid phone number' });
      }
    }

    // Determine which identifier holds the pending registration OTP
    let targetForOtp = null;
    if (normEmail && await db.get('SELECT id FROM otp_verifications WHERE (email = ? OR phone_number = ?) AND purpose = ?', normEmail, normEmail, 'registration')) {
      targetForOtp = normEmail;
    } else if (normPhone && await db.get('SELECT id FROM otp_verifications WHERE phone_number = ? AND purpose = ?', normPhone, 'registration')) {
      targetForOtp = normPhone;
    } else {
      targetForOtp = normEmail || normPhone;
    }

    // Check uniqueness
    if (await findByUsername(username)) {
      return res.status(409).json({ success: false, error: 'That username is already taken' });
    }
    if (normEmail && await findByEmail(normEmail)) {
      return res.status(409).json({ success: false, error: 'That email is already registered' });
    }
    if (normPhone && await findByPhone(normPhone)) {
      return res.status(409).json({ success: false, error: 'That phone number is already registered' });
    }

    // Verify OTP
    await auth.verifyOtp(targetForOtp, 'registration', otp);

    // Create user
    const now = new Date().toISOString();
    const isEmailVerified = targetForOtp === normEmail || Boolean(normEmail && !normPhone);
    const isPhoneVerified = targetForOtp === normPhone;
    const userId = await db.insert(`
      INSERT INTO users (username, name, full_name, email, email_verified_at, phone_number, phone_verified_at, password_hash, role, status, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', 'active', 1, ?, ?)
    `, uCheck.username,
      fullName.trim(),
      fullName.trim(),
      normEmail,
      isEmailVerified ? now : null,
      normPhone,
      isPhoneVerified ? now : null,
      auth.hashPassword(password),
      now,
      now);

    const user = await auth.getUserById(userId);

    // The new user owns a fresh, isolated workspace (workspace id = owner user id)
    await auth.audit(req, 'auth.registered', { username: uCheck.username, email: normEmail }, { userId, accountId: userId });
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

  const { username, email, phoneNumber, identifier, password } = req.body || {};
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  const lookup = identifier || username || email || phoneNumber;
  if (!lookup) {
    return res.status(400).json({ success: false, error: 'Username, email, or phone number is required' });
  }

  let user = null;
  const strLookup = String(lookup).trim();
  if (strLookup.includes('@')) {
    user = await findByEmail(strLookup);
  } else {
    user = await findByUsername(strLookup);
    if (!user) user = await findByPhone(strLookup);
  }

  if (!user || !auth.verifyPassword(String(password), user.password_hash) || !await auth.isUserUsable(user)) {
    throttle.fail();
    await auth.audit(req, 'auth.login_failed', { identifier: strLookup.slice(0, 60) },
      { userId: user?.id ?? null, accountId: user ? user.parent_id || user.id : null });
    return res.status(401).json({ success: false, error: 'Invalid credentials or password' });
  }

  throttle.clear();
  await loginDone(req, res, user);
});

// Login via OTP: Send OTP
router.post('/login/send-otp', async (req, res) => {
  try {
    const { email, phoneNumber, identifier } = req.body || {};
    const lookup = identifier || email || phoneNumber;
    if (!lookup) return res.status(400).json({ success: false, error: 'Email or phone number is required' });

    const strLookup = String(lookup).trim();
    let user = null;
    if (strLookup.includes('@')) {
      user = await findByEmail(strLookup);
    } else {
      user = await findByUsername(strLookup) || await findByPhone(strLookup);
    }

    if (!user || !await auth.isUserUsable(user)) {
      return res.json({ success: true, message: 'If this account is registered, a code has been sent', data: {} });
    }

    const target = user.email || user.phone_number;
    const isEmail = Boolean(user.email);
    const result = await auth.sendOtp(target, 'login');
    res.json({
      success: true,
      message: result.message,
      data: {
        ...(isEmail ? { email: auth.maskEmail(user.email) } : {}),
        ...(user.phone_number ? { phoneNumber: maskPhone(user.phone_number) } : {}),
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
    const { email, phoneNumber, identifier, otp } = req.body || {};
    const lookup = identifier || email || phoneNumber;
    if (!lookup || !otp) {
      return res.status(400).json({ success: false, error: 'Account identifier and OTP are required' });
    }

    const strLookup = String(lookup).trim();
    let user = null;
    if (strLookup.includes('@')) {
      user = await findByEmail(strLookup);
    } else {
      user = await findByUsername(strLookup) || await findByPhone(strLookup);
    }

    if (!user || !await auth.isUserUsable(user)) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    const target = user.email || user.phone_number;
    await auth.verifyOtp(target, 'login', otp);
    await loginDone(req, res, user);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- 3. FORGOT PASSWORD & RESET ----

router.post('/forgot-password/send-otp', async (req, res) => {
  try {
    const { identifier, email, phoneNumber } = req.body || {};
    const lookup = identifier || email || phoneNumber;
    if (!lookup) return res.status(400).json({ success: false, error: 'Username, email, or phone number is required' });

    let user = null;
    const strLookup = String(lookup).trim();
    if (strLookup.includes('@')) {
      user = await findByEmail(strLookup);
    } else {
      user = await findByUsername(strLookup);
      if (!user) user = await findByPhone(strLookup);
    }

    if (!user || (!user.email && !user.phone_number)) {
      return res.json({ success: true, message: 'If this account exists, a reset code has been sent', data: {} });
    }

    const target = user.email || user.phone_number;
    const isEmail = Boolean(user.email);
    const result = await auth.sendOtp(target, 'reset_password');
    res.json({
      success: true,
      message: isEmail ? `Reset code sent to ${auth.maskEmail(user.email)}` : `Reset code sent to ${maskPhone(result.phoneNumber)}`,
      data: {
        ...(isEmail ? { email: auth.maskEmail(user.email) } : {}),
        ...(user.phone_number ? { phoneNumber: maskPhone(user.phone_number) } : {}),
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
    const { phoneNumber, identifier, email, otp, newPassword } = req.body || {};
    const lookup = identifier || email || phoneNumber;
    if (!lookup || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Account, OTP, and new password are required' });
    }

    const pCheck = auth.validatePassword(newPassword);
    if (!pCheck.valid) return res.status(400).json({ success: false, error: pCheck.error });

    let user = null;
    const strLookup = String(lookup).trim();
    if (strLookup.includes('@') && !strLookup.includes('*')) {
      user = await findByEmail(strLookup);
    }
    if (!user) user = await findByUsername(strLookup);
    if (!user && !strLookup.includes('*')) user = await findByPhone(strLookup);

    // Fallback if lookup was masked
    if (!user && email && !String(email).includes('*')) user = await findByEmail(email);
    if (!user && phoneNumber && !String(phoneNumber).includes('*')) user = await findByPhone(phoneNumber);

    if (!user || (!user.email && !user.phone_number)) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    const target = user.email || user.phone_number;
    await auth.verifyOtp(target, 'reset_password', otp);

    const now = new Date().toISOString();
    await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', auth.hashPassword(newPassword), now, user.id);

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

