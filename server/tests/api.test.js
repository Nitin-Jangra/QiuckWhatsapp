const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs0 = require('fs');
const nodePath = require('path');
// Isolate tests from the real data store
process.env.DATA_DIR = fs0.mkdtempSync(nodePath.join(os.tmpdir(), 'wacrm-test-'));
process.env.NODE_ENV = 'test';
const app = require('../src/app');
const store = require('../src/store');
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
  fetch(`${base}${path}`, { method: 'POST', headers: { ...JSON_HEADERS, ...(cookie && { cookie }) }, body: JSON.stringify(body) });

// First call creates the admin; later calls just sign in
async function adminCookie(base) {
  let res = await post(base, '/api/auth/setup', { username: 'admin', name: 'Admin', password: 'password123' });
  if (res.status !== 200) res = await post(base, '/api/auth/login', { username: 'admin', password: 'password123' });
  assert.strictEqual(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('Health check is public', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).status, 'ok');
  });
});

test('Public access by default without login', async () => {
  delete process.env.AUTH_REQUIRED;
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/accounts`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));

    const me = await (await fetch(`${base}/api/auth/me`)).json();
    assert.strictEqual(me.data.authRequired, false);
    assert.strictEqual(me.data.user.role, 'admin');
  });
});

test('API requires sign-in when AUTH_REQUIRED=true', async () => {
  process.env.AUTH_REQUIRED = 'true';
  try {
    await withServer(async (base) => {
      assert.strictEqual((await fetch(`${base}/api/accounts`)).status, 401);
      assert.strictEqual((await fetch(`${base}/api/chats`)).status, 401);
      assert.strictEqual((await fetch(`${base}/api/events`)).status, 401);

      const me = await (await fetch(`${base}/api/auth/me`)).json();
      assert.strictEqual(me.data.needsSetup, true);

      const weak = await post(base, '/api/auth/setup', { username: 'admin', password: 'short' });
      assert.strictEqual(weak.status, 400);

      const cookie = await adminCookie(base);
      const me2 = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
      assert.strictEqual(me2.data.user.role, 'admin');
      assert.strictEqual(me2.data.needsSetup, false);

      // Setup cannot be repeated, wrong password is rejected
      assert.strictEqual((await post(base, '/api/auth/setup', { username: 'x', password: 'password123' })).status, 403);
      assert.strictEqual((await post(base, '/api/auth/login', { username: 'admin', password: 'wrongpass' })).status, 401);
    });
  } finally {
    delete process.env.AUTH_REQUIRED;
  }
});

test('Accounts, chats and send validation (admin)', async () => {
  await withServer(async (base) => {
    const cookie = await adminCookie(base);
    const get = (p) => fetch(`${base}${p}`, { headers: { cookie } });

    const list = await (await get('/api/accounts')).json();
    assert.ok(Array.isArray(list.data));

    const created = await post(base, '/api/accounts', { name: 'Integration Test Account' }, cookie);
    assert.strictEqual(created.status, 200);
    const createdBody = await created.json();
    assert.strictEqual(createdBody.data.name, 'Integration Test Account');

    assert.strictEqual((await get('/api/chats')).status, 200);
    assert.strictEqual((await post(base, '/api/messages/send', {}, cookie)).status, 400);
    assert.strictEqual((await post(base, '/api/messages/send-media', { accountId: 'acc_1', to: '919876543210' }, cookie)).status, 400);
  });
});

test('Staff only see and use accounts assigned to them', async () => {
  process.env.AUTH_REQUIRED = 'true';
  try {
    await withServer(async (base) => {
      const admin = await adminCookie(base);
      await store.saveAccount({ id: 'acc_a', name: 'Sales' });
      await store.saveAccount({ id: 'acc_b', name: 'Support' });
      await store.addMessage({ id: 'm1', accountId: 'acc_a', remoteJid: '911@s.whatsapp.net', text: 'hi A', timestamp: new Date().toISOString() });
      await store.addMessage({ id: 'm2', accountId: 'acc_b', remoteJid: '922@s.whatsapp.net', text: 'hi B', timestamp: new Date().toISOString() });

      const made = await post(base, '/api/users', { username: 'agent1', name: 'Agent One', password: 'agentpass1', role: 'agent', accountIds: ['acc_a'] }, admin);
      assert.strictEqual(made.status, 200);
      const login = await post(base, '/api/auth/login', { username: 'agent1', password: 'agentpass1' });
      const agent = login.headers.get('set-cookie').split(';')[0];
      const get = (p) => fetch(`${base}${p}`, { headers: { cookie: agent } });

      const accounts = (await (await get('/api/accounts')).json()).data;
      assert.deepStrictEqual(accounts.map(a => a.id), ['acc_a']);

      const chats = (await (await get('/api/chats')).json()).data;
      assert.ok(chats.length >= 1 && chats.every(c => c.accountId === 'acc_a'));

      assert.strictEqual((await get('/api/chats?accountId=acc_b')).status, 403);
      assert.strictEqual((await get('/api/chats/messages?accountId=acc_b&remoteJid=922@s.whatsapp.net')).status, 403);
      assert.strictEqual((await post(base, '/api/messages/send', { accountId: 'acc_b', to: '922', text: 'x' }, agent)).status, 403);

      // Staff cannot manage accounts or users
      assert.strictEqual((await post(base, '/api/accounts', { name: 'Nope' }, agent)).status, 403);
      assert.strictEqual((await get('/api/users')).status, 403);

      // Mark read clears the unread badge
      assert.strictEqual((await post(base, '/api/chats/read', { accountId: 'acc_a', remoteJid: '911@s.whatsapp.net' }, agent)).status, 200);
      const after = (await (await get('/api/chats')).json()).data.find(c => c.remoteJid === '911@s.whatsapp.net');
      assert.strictEqual(after.unreadCount, 0);

      // Admin cannot be locked out
      const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: admin } })).json()).data.user;
      const demote = await fetch(`${base}/api/users/${me.id}`, { method: 'PUT', headers: { ...JSON_HEADERS, cookie: admin }, body: JSON.stringify({ role: 'agent' }) });
      assert.strictEqual(demote.status, 400);
    });
  } finally {
    delete process.env.AUTH_REQUIRED;
  }
});

