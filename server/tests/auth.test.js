const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Isolate tests from production data
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wacrm-auth-test-'));
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';

const app = require('../src/app');
const auth = require('../src/auth');
const db = require('../src/db');
test.before(() => app.ready);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function withServer(fn) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const post = (base, path, body, cookie) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...(cookie && { cookie }) },
    body: JSON.stringify(body)
  });

const get = (base, path, cookie) =>
  fetch(`${base}${path}`, {
    headers: { ...(cookie && { cookie }) }
  });

test('Phase 1 - Registration and OTP verification workflow', async () => {
  await withServer(async (base) => {
    // 1. Send OTP for new mobile number
    const sendRes = await post(base, '/api/auth/register/send-otp', {
      phoneNumber: '9876500001',
      username: 'johndoe'
    });
    assert.strictEqual(sendRes.status, 200);
    const sendData = await sendRes.json();
    assert.strictEqual(sendData.success, true);
    assert.ok(sendData.data.devOtp, 'Should include devOtp in test environment');
    const otp = sendData.data.devOtp;

    // 2. Reject registration if terms not accepted
    const rejectTerms = await post(base, '/api/auth/register/verify', {
      fullName: 'John Doe',
      username: 'johndoe',
      phoneNumber: '9876500001',
      otp,
      password: 'StrongPassword123!',
      acceptTerms: false
    });
    assert.strictEqual(rejectTerms.status, 400);

    // 3. Reject registration with invalid OTP
    const rejectOtp = await post(base, '/api/auth/register/verify', {
      fullName: 'John Doe',
      username: 'johndoe',
      phoneNumber: '9876500001',
      otp: '000000',
      password: 'StrongPassword123!',
      acceptTerms: true
    });
    assert.strictEqual(rejectOtp.status, 400);

    // 4. Successful registration with valid OTP
    const registerRes = await post(base, '/api/auth/register/verify', {
      fullName: 'John Doe',
      username: 'johndoe',
      phoneNumber: '9876500001',
      otp,
      password: 'StrongPassword123!',
      acceptTerms: true
    });
    assert.strictEqual(registerRes.status, 200);
    const registerData = await registerRes.json();
    assert.strictEqual(registerData.success, true);
    assert.strictEqual(registerData.data.user.username, 'johndoe');
    assert.strictEqual(registerData.data.user.role, 'user');

    // User is logged in via cookie
    const setCookie = registerRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('wa_session='), 'Should issue wa_session cookie on register');
    const userCookie = setCookie.split(';')[0];

    // Check /api/auth/me
    const meRes = await get(base, '/api/auth/me', userCookie);
    const meData = await meRes.json();
    assert.strictEqual(meData.data.user.username, 'johndoe');
  });
});

test('Phase 1 - Duplicate username and phone number rejection', async () => {
  await withServer(async (base) => {
    // Register first user
    const sendRes1 = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500002', username: 'alice' });
    const otp1 = (await sendRes1.json()).data.devOtp;
    await post(base, '/api/auth/register/verify', {
      fullName: 'Alice Walker',
      username: 'alice',
      phoneNumber: '9876500002',
      otp: otp1,
      password: 'password123',
      acceptTerms: true
    });

    // Attempt to request OTP with existing username (case-insensitive)
    const dupUser = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500003', username: 'ALICE' });
    assert.strictEqual(dupUser.status, 409);
    assert.ok((await dupUser.json()).error.includes('already taken'));

    // Attempt to request OTP with existing phone number
    const dupPhone = await post(base, '/api/auth/register/send-otp', { phoneNumber: '+91 9876500002', username: 'bob' });
    assert.strictEqual(dupPhone.status, 409);
    assert.ok((await dupPhone.json()).error.includes('already registered'));
  });
});

test('Phase 1 - Password validation rules', async () => {
  await withServer(async (base) => {
    const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500004', username: 'shortpass' });
    const otp = (await sendRes.json()).data.devOtp;

    // Password < 8 characters must fail
    const weakRes = await post(base, '/api/auth/register/verify', {
      fullName: 'Short Pass',
      username: 'shortpass',
      phoneNumber: '9876500004',
      otp,
      password: 'short',
      acceptTerms: true
    });
    assert.strictEqual(weakRes.status, 400);
    assert.ok((await weakRes.json()).error.includes('8 characters'));
  });
});

test('Phase 1 - OTP attempt limits and expiration', async () => {
  await withServer(async (base) => {
    const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500005', username: 'maxattempts' });
    const otp = (await sendRes.json()).data.devOtp;

    // 3 failed attempts should burn the OTP
    for (let i = 0; i < 3; i++) {
      const fail = await post(base, '/api/auth/register/verify', {
        fullName: 'Max User',
        username: 'maxattempts',
        phoneNumber: '9876500005',
        otp: '999999',
        password: 'password123',
        acceptTerms: true
      });
      assert.strictEqual(fail.status, 400);
    }

    // Now even correct OTP must fail because max attempts was exceeded
    const burnRes = await post(base, '/api/auth/register/verify', {
      fullName: 'Max User',
      username: 'maxattempts',
      phoneNumber: '9876500005',
      otp,
      password: 'password123',
      acceptTerms: true
    });
    assert.strictEqual(burnRes.status, 400);
  });
});

test('Phase 1 - Login with username/password and phone number', async () => {
  await withServer(async (base) => {
    // Register user
    const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500006', username: 'logintest' });
    const otp = (await sendRes.json()).data.devOtp;
    await post(base, '/api/auth/register/verify', {
      fullName: 'Login Test',
      username: 'logintest',
      phoneNumber: '9876500006',
      otp,
      password: 'ValidPassword123!',
      acceptTerms: true
    });

    // 1. Login via username
    const loginUser = await post(base, '/api/auth/login', { username: 'LOGINTEST', password: 'ValidPassword123!' });
    assert.strictEqual(loginUser.status, 200);
    const cookie1 = loginUser.headers.get('set-cookie').split(';')[0];
    const me1 = await (await get(base, '/api/auth/me', cookie1)).json();
    assert.strictEqual(me1.data.user.username, 'logintest');

    // 2. Login via phone number
    const loginPhone = await post(base, '/api/auth/login', { phoneNumber: '+919876500006', password: 'ValidPassword123!' });
    assert.strictEqual(loginPhone.status, 200);

    // 3. Reject wrong password
    const loginFail = await post(base, '/api/auth/login', { username: 'logintest', password: 'wrongpassword' });
    assert.strictEqual(loginFail.status, 401);
  });
});

test('Phase 1 - Forgot password reset workflow', async () => {
  await withServer(async (base) => {
    // Register user
    const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500007', username: 'resetuser' });
    const otp = (await sendRes.json()).data.devOtp;
    await post(base, '/api/auth/register/verify', {
      fullName: 'Reset User',
      username: 'resetuser',
      phoneNumber: '9876500007',
      otp,
      password: 'OldPassword123!',
      acceptTerms: true
    });

    // Request reset OTP
    const forgotRes = await post(base, '/api/auth/forgot-password/send-otp', { identifier: 'resetuser' });
    assert.strictEqual(forgotRes.status, 200);
    const resetOtp = (await forgotRes.json()).data.devOtp;

    // Reset password
    const resetRes = await post(base, '/api/auth/forgot-password/reset', {
      phoneNumber: '+919876500007',
      otp: resetOtp,
      newPassword: 'NewBrandPassword456!'
    });
    assert.strictEqual(resetRes.status, 200);

    // Verify old password fails
    const oldLogin = await post(base, '/api/auth/login', { username: 'resetuser', password: 'OldPassword123!' });
    assert.strictEqual(oldLogin.status, 401);

    // Verify new password succeeds
    const newLogin = await post(base, '/api/auth/login', { username: 'resetuser', password: 'NewBrandPassword456!' });
    assert.strictEqual(newLogin.status, 200);
  });
});

test('Phase 1 - Session management, logout, and logout-all', async () => {
  await withServer(async (base) => {
    // Register user
    const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500008', username: 'logoutuser' });
    const otp = (await sendRes.json()).data.devOtp;
    const regRes = await post(base, '/api/auth/register/verify', {
      fullName: 'Logout User',
      username: 'logoutuser',
      phoneNumber: '9876500008',
      otp,
      password: 'password123',
      acceptTerms: true
    });
    const cookie = regRes.headers.get('set-cookie').split(';')[0];

    // Session is valid
    assert.strictEqual((await get(base, '/api/accounts', cookie)).status, 200);

    // Logout
    const logoutRes = await post(base, '/api/auth/logout', {}, cookie);
    assert.strictEqual(logoutRes.status, 200);

    // The expired cookie returns empty / 401
    const clearedCookie = logoutRes.headers.get('set-cookie').split(';')[0];
    assert.strictEqual((await get(base, '/api/accounts', clearedCookie)).status, 401);
  });
});

test('Phase 1 - Admin Panel authorization and stats', async () => {
  await withServer(async (base) => {
    // Seed test admin for this test
    const now = new Date().toISOString();
    (await db.run(`
      INSERT INTO users (id, username, name, full_name, phone_number, phone_verified_at, password_hash, role, status, active, created_at, updated_at)
      VALUES (9999, 'admin', 'Super Admin', 'Super Admin', '+919999999999', ?, ?, 'admin', 'active', 1, ?, ?)
    `, now, auth.hashPassword('Admin@WaCRM2026!'), now, now));

    // 1. Login as default SuperAdmin
    const adminLogin = await post(base, '/api/auth/login', { username: 'admin', password: 'Admin@WaCRM2026!' });
    assert.strictEqual(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    // 2. Admin can access /api/admin/stats
    const statsRes = await get(base, '/api/admin/stats', adminCookie);
    assert.strictEqual(statsRes.status, 200);
    const stats = (await statsRes.json()).data;
    assert.ok(stats.totalUsers >= 1);

    // 3. Admin can list users
    const usersRes = await get(base, '/api/admin/users', adminCookie);
    assert.strictEqual(usersRes.status, 200);
    const users = (await usersRes.json()).data;
    assert.ok(Array.isArray(users));

    // 4. Regular user is forbidden from admin panel (403)
    const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: '9876500009', username: 'regularuser' });
    const otp = (await sendRes.json()).data.devOtp;
    const regRes = await post(base, '/api/auth/register/verify', {
      fullName: 'Regular User',
      username: 'regularuser',
      phoneNumber: '9876500009',
      otp,
      password: 'password123',
      acceptTerms: true
    });
    const regularCookie = regRes.headers.get('set-cookie').split(';')[0];

    const forbiddenStats = await get(base, '/api/admin/stats', regularCookie);
    assert.strictEqual(forbiddenStats.status, 403);
    const forbiddenUsers = await get(base, '/api/admin/users', regularCookie);
    assert.strictEqual(forbiddenUsers.status, 403);

    // 5. Unauthenticated request is rejected (401)
    const unauthStats = await get(base, '/api/admin/stats');
    assert.strictEqual(unauthStats.status, 401);
  });
});
