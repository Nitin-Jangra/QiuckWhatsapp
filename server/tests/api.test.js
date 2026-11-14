const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
const app = require('../src/app');

test('Express API - Health Check Endpoint', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(typeof body.accountsCount === 'number');
    assert.ok(body.timestamp);
  } finally {
    server.close();
  }
});

test('Express API - Accounts Endpoint', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Get Accounts list
    const res = await fetch(`http://127.0.0.1:${port}/api/accounts`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));

    // 2. Create Account
    const createRes = await fetch(`http://127.0.0.1:${port}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Integration Test Account' })
    });
    assert.strictEqual(createRes.status, 200);
    const createBody = await createRes.json();
    assert.strictEqual(createBody.success, true);
    assert.ok(createBody.data.id);
    assert.strictEqual(createBody.data.name, 'Integration Test Account');
  } finally {
    server.close();
  }
});

test('Express API - Chats & Send Message Validation', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Get chats
    const res = await fetch(`http://127.0.0.1:${port}/api/chats`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data));

    // 2. Send validation (missing fields)
    const sendRes = await fetch(`http://127.0.0.1:${port}/api/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(sendRes.status, 400);
    const sendBody = await sendRes.json();
    assert.strictEqual(sendBody.success, false);

    // 3. Send media validation (missing mediaBase64)
    const mediaRes = await fetch(`http://127.0.0.1:${port}/api/messages/send-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc_1', to: '919876543210' })
    });
    assert.strictEqual(mediaRes.status, 400);
    const mediaBody = await mediaRes.json();
    assert.strictEqual(mediaBody.success, false);
  } finally {
    server.close();
  }
});
