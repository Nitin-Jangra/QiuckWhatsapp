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
    assert.ok(body.timestamp);
  } finally {
    server.close();
  }
});

test('Express API - WhatsApp Status Endpoint', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/status?tenantId=t1&branchId=b1`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'DISCONNECTED');
  } finally {
    server.close();
  }
});

test('Express API - WhatsApp Send Validation Endpoint', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Missing required fields
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  } finally {
    server.close();
  }
});
