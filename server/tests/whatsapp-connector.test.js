const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const WhatsAppSessionManager = require('../src/whatsapp/session-manager');

test('WhatsAppSessionManager - Multi-branch session directory isolation', (t) => {
  const tempSessionDir = path.join(__dirname, 'temp_sessions');
  const manager = new WhatsAppSessionManager({ sessionBasePath: tempSessionDir });

  try {
    const dir1 = manager.getSessionDir('tenant-1', 'branch-north');
    const dir2 = manager.getSessionDir('tenant-1', 'branch-south');
    const dir3 = manager.getSessionDir('tenant-2', 'branch-north');

    assert.notStrictEqual(dir1, dir2, 'Branches within same tenant must have distinct session directories');
    assert.notStrictEqual(dir1, dir3, 'Same branch name across different tenants must have distinct session directories');
    assert.ok(fs.existsSync(dir1), 'Session directory 1 should be created');
    assert.ok(fs.existsSync(dir2), 'Session directory 2 should be created');
    assert.ok(fs.existsSync(dir3), 'Session directory 3 should be created');
  } finally {
    manager.destroy();
    if (fs.existsSync(tempSessionDir)) {
      fs.rmSync(tempSessionDir, { recursive: true, force: true });
    }
  }
});

test('WhatsAppSessionManager - Message Deduplication', (t) => {
  const manager = new WhatsAppSessionManager();

  try {
    const msgId = '3EB0123456789ABCDEF';
    assert.strictEqual(manager.isDuplicateMessage(msgId), false, 'First occurrence must not be duplicate');

    manager.recordMessageId(msgId);
    assert.strictEqual(manager.isDuplicateMessage(msgId), true, 'Second occurrence of same messageId must be detected as duplicate');

    const differentMsgId = '3EB9876543210FEDCBA';
    assert.strictEqual(manager.isDuplicateMessage(differentMsgId), false, 'Different messageId must not be duplicate');
  } finally {
    manager.destroy();
  }
});

test('WhatsAppSessionManager - Session status reporting when disconnected', (t) => {
  const manager = new WhatsAppSessionManager();

  try {
    const status = manager.getSessionStatus('tenant-demo', 'branch-main');
    assert.strictEqual(status.status, 'DISCONNECTED');
    assert.strictEqual(status.phone, null);
    assert.strictEqual(status.qrDataUrl, null);
  } finally {
    manager.destroy();
  }
});

test('WhatsAppSessionManager - Event emission on manual status change', (t, done) => {
  const manager = new WhatsAppSessionManager();

  manager.on('status', (data) => {
    assert.strictEqual(data.tenantId, 'tenant-test');
    assert.strictEqual(data.branchId, 'branch-1');
    assert.strictEqual(data.status, 'DISCONNECTED');
    manager.destroy();
    done();
  });

  manager.disconnectSession('tenant-test', 'branch-1', false);
});
