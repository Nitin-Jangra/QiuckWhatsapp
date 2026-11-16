const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs0 = require('fs');
const nodePath = require('path');
// Isolate tests from the real data store
process.env.DATA_DIR = fs0.mkdtempSync(nodePath.join(os.tmpdir(), 'wacrm-test-'));
const path = require('path');
const fs = require('fs');
const WhatsAppSessionManager = require('../src/whatsapp/session-manager');
const store = require('../src/store');

test('WhatsAppSessionManager - Multi-account session directory isolation', (t) => {
  const tempSessionDir = path.join(__dirname, 'temp_sessions');
  const manager = new WhatsAppSessionManager({ sessionBasePath: tempSessionDir });

  try {
    const dir1 = manager.getAccountSessionDir('acc_personal');
    const dir2 = manager.getAccountSessionDir('acc_sales');
    const dir3 = manager.getAccountSessionDir('acc_support');

    assert.notStrictEqual(dir1, dir2, 'Distinct accounts must have isolated session directories');
    assert.notStrictEqual(dir1, dir3, 'Distinct accounts must have isolated session directories');
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

test('WhatsAppSessionManager - Account status reporting when disconnected', (t) => {
  const manager = new WhatsAppSessionManager();

  try {
    const status = manager.getAccountStatus('acc_test');
    assert.strictEqual(status.status, 'DISCONNECTED');
    assert.strictEqual(status.phone, null);
    assert.strictEqual(status.qrDataUrl, null);
  } finally {
    manager.destroy();
  }
});

test('Store - Multi-account chat filtering and message storage', (t) => {
  // Save two accounts
  store.saveAccount({ id: 'acc_sales', name: 'Sales Account' });
  store.saveAccount({ id: 'acc_support', name: 'Support Account' });

  // Add messages for both
  store.addMessage({
    id: 'msg_1',
    accountId: 'acc_sales',
    remoteJid: '919876543210@s.whatsapp.net',
    customerPhone: '+919876543210',
    customerName: 'Customer A',
    text: 'Interested in product pricing',
    fromMe: false,
    timestamp: new Date().toISOString()
  });

  store.addMessage({
    id: 'msg_2',
    accountId: 'acc_support',
    remoteJid: '919123456789@s.whatsapp.net',
    customerPhone: '+919123456789',
    customerName: 'Customer B',
    text: 'Need help with login',
    fromMe: false,
    timestamp: new Date().toISOString()
  });

  // Verify all chats
  const allChats = store.getChats();
  assert.ok(allChats.length >= 2, 'Should have at least 2 chats');

  // Verify filtered chats
  const salesChats = store.getChats('acc_sales');
  assert.strictEqual(salesChats.every(c => c.accountId === 'acc_sales'), true);
  assert.ok(salesChats.some(c => c.remoteJid === '919876543210@s.whatsapp.net'));

  const supportChats = store.getChats('acc_support');
  assert.strictEqual(supportChats.every(c => c.accountId === 'acc_support'), true);
  assert.ok(supportChats.some(c => c.remoteJid === '919123456789@s.whatsapp.net'));
});

test('WhatsAppSessionManager - Multi-account simultaneous tracking and twin detection', (t) => {
  const manager = new WhatsAppSessionManager();

  try {
    // 1. Initialize two distinct accounts in session manager
    manager.sessions.set('acc_sales', {
      accountId: 'acc_sales',
      status: 'CONNECTED',
      userInfo: { jid: '919876543210:1@s.whatsapp.net', phone: '+919876543210', name: 'Sales Phone' },
      sock: { user: { id: '919876543210:1@s.whatsapp.net' } }
    });

    manager.sessions.set('acc_support', {
      accountId: 'acc_support',
      status: 'CONNECTED',
      userInfo: { jid: '919123456789:1@s.whatsapp.net', phone: '+919123456789', name: 'Support Phone' },
      sock: { user: { id: '919123456789:1@s.whatsapp.net' } }
    });

    const status1 = manager.getAccountStatus('acc_sales');
    const status2 = manager.getAccountStatus('acc_support');

    assert.strictEqual(status1.status, 'CONNECTED');
    assert.strictEqual(status1.phone, '+919876543210');
    assert.strictEqual(status2.status, 'CONNECTED');
    assert.strictEqual(status2.phone, '+919123456789');

    // 2. Verify twin detection logic: if user attempts to pair the exact same phone number twice
    const bare = (j) => (j || '').split(':')[0].split('@')[0];
    const userJidDuplicate = '919876543210:2@s.whatsapp.net';
    const twin = [...manager.sessions.values()].find(
      s => s.status === 'CONNECTED' && s.userInfo && bare(s.userInfo.jid) === bare(userJidDuplicate)
    );
    assert.ok(twin, 'Twin account detection must identify already linked phone number');
    assert.strictEqual(twin.accountId, 'acc_sales');
  } finally {
    manager.destroy();
  }
});
