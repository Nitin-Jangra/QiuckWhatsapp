const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wacrm-tenant-test-'));
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';

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
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...(cookie && { cookie }) },
    body: JSON.stringify(body)
  });

const get = (base, path, cookie) =>
  fetch(`${base}${path}`, {
    headers: { ...(cookie && { cookie }) }
  });

const put = (base, path, body, cookie) =>
  fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { ...JSON_HEADERS, ...(cookie && { cookie }) },
    body: JSON.stringify(body)
  });

const del = (base, path, cookie) =>
  fetch(`${base}${path}`, {
    method: 'DELETE',
    headers: { ...(cookie && { cookie }) }
  });

async function registerAndLogin(base, username, phone) {
  const sendRes = await post(base, '/api/auth/register/send-otp', { phoneNumber: phone, username });
  const otp = (await sendRes.json()).data.devOtp;
  const regRes = await post(base, '/api/auth/register/verify', {
    fullName: `User ${username}`,
    username,
    phoneNumber: phone,
    otp,
    password: 'Password123!',
    acceptTerms: true
  });
  assert.strictEqual(regRes.status, 200);
  return regRes.headers.get('set-cookie').split(';')[0];
}

test('Multi-Tenant Isolation - WhatsApp Accounts', async () => {
  await withServer(async (base) => {
    const userACookie = await registerAndLogin(base, 'tenant_a', '9870000001');
    const userBCookie = await registerAndLogin(base, 'tenant_b', '9870000002');

    // 1. User A creates WhatsApp Account A
    const createA = await post(base, '/api/accounts', { name: 'Line A (Sales)' }, userACookie);
    assert.strictEqual(createA.status, 200);
    const accAId = (await createA.json()).data.id;

    // 2. User B creates WhatsApp Account B
    const createB = await post(base, '/api/accounts', { name: 'Line B (Support)' }, userBCookie);
    assert.strictEqual(createB.status, 200);
    const accBId = (await createB.json()).data.id;

    // 3. User A requests account list: MUST ONLY contain Account A
    const listA = (await (await get(base, '/api/accounts', userACookie)).json()).data;
    assert.ok(listA.some(a => a.id === accAId), 'User A must see Account A');
    assert.ok(!listA.some(a => a.id === accBId), 'User A MUST NOT see User B Account B');

    // 4. User B requests account list: MUST ONLY contain Account B
    const listB = (await (await get(base, '/api/accounts', userBCookie)).json()).data;
    assert.ok(listB.some(a => a.id === accBId), 'User B must see Account B');
    assert.ok(!listB.some(a => a.id === accAId), 'User B MUST NOT see User A Account A');

    // 5. Cross-tenant access protection (User A attempting to control User B account)
    assert.strictEqual((await get(base, `/api/accounts/${accBId}/status`, userACookie)).status, 403);
    assert.strictEqual((await post(base, `/api/accounts/${accBId}/connect`, {}, userACookie)).status, 403);
    assert.strictEqual((await post(base, `/api/accounts/${accBId}/disconnect`, {}, userACookie)).status, 403);
    assert.strictEqual((await del(base, `/api/accounts/${accBId}`, userACookie)).status, 403);
  });
});

test('Multi-Tenant Isolation - Chats, Messages and Sending', async () => {
  await withServer(async (base) => {
    const userACookie = await registerAndLogin(base, 'tenant_c', '9870000003');
    const userBCookie = await registerAndLogin(base, 'tenant_d', '9870000004');

    // Create accounts
    const accAId = (await (await post(base, '/api/accounts', { name: 'Customer Line C' }, userACookie)).json()).data.id;
    const accBId = (await (await post(base, '/api/accounts', { name: 'Customer Line D' }, userBCookie)).json()).data.id;

    // Ingest messages into both lines
    await store.addMessage({
      id: 'msg_a_1',
      accountId: accAId,
      remoteJid: '919876543210@s.whatsapp.net',
      customerPhone: '+919876543210',
      customerName: 'Client Alpha',
      text: 'Confidential message for User C',
      fromMe: false,
      timestamp: new Date().toISOString()
    });

    await store.addMessage({
      id: 'msg_b_1',
      accountId: accBId,
      remoteJid: '919123456789@s.whatsapp.net',
      customerPhone: '+919123456789',
      customerName: 'Client Beta',
      text: 'Secret inquiry for User D',
      fromMe: false,
      timestamp: new Date().toISOString()
    });

    // Verify User A only sees chats for line A
    const chatsA = (await (await get(base, '/api/chats', userACookie)).json()).data;
    assert.ok(chatsA.some(c => c.accountId === accAId), 'User A must see chat on line A');
    assert.ok(!chatsA.some(c => c.accountId === accBId), 'User A MUST NOT see chat on line B');

    // Verify User B only sees chats for line B
    const chatsB = (await (await get(base, '/api/chats', userBCookie)).json()).data;
    assert.ok(chatsB.some(c => c.accountId === accBId), 'User B must see chat on line B');
    assert.ok(!chatsB.some(c => c.accountId === accAId), 'User B MUST NOT see chat on line A');

    // User A attempting to read User B's message history: 403 Forbidden
    const crossRead = await get(base, `/api/chats/messages?accountId=${accBId}&remoteJid=919123456789@s.whatsapp.net`, userACookie);
    assert.strictEqual(crossRead.status, 403);

    // User A attempting to send message via User B's account: 403 Forbidden
    const crossSend = await post(base, '/api/messages/send', {
      accountId: accBId,
      to: '919123456789',
      text: 'Impersonated message'
    }, userACookie);
    assert.strictEqual(crossSend.status, 403);

    // User A attempting to send media via User B's account: 403 Forbidden
    const crossSendMedia = await post(base, '/api/messages/send-media', {
      accountId: accBId,
      to: '919123456789',
      mediaBase64: 'data:image/png;base64,iVBORw0KGgo='
    }, userACookie);
    assert.strictEqual(crossSendMedia.status, 403);
  });
});

test('Unified Inbox - Pin, Archive, and Filtering', async () => {
  await withServer(async (base) => {
    const userCookie = await registerAndLogin(base, 'tenant_inbox', '9870000005');
    const accId = (await (await post(base, '/api/accounts', { name: 'Support Inbox' }, userCookie)).json()).data.id;

    await store.addMessage({
      id: 'msg_pin_1',
      accountId: accId,
      remoteJid: '919999000001@s.whatsapp.net',
      customerPhone: '+919999000001',
      customerName: 'Important VIP',
      text: 'High priority request',
      fromMe: false,
      timestamp: new Date().toISOString()
    });

    await store.addMessage({
      id: 'msg_arc_1',
      accountId: accId,
      remoteJid: '919999000002@s.whatsapp.net',
      customerPhone: '+919999000002',
      customerName: 'Old Lead',
      text: 'Archived inquiry',
      fromMe: false,
      timestamp: new Date().toISOString()
    });

    // 1. Pin chat
    const pinRes = await post(base, '/api/chats/pin', {
      accountId: accId,
      remoteJid: '919999000001@s.whatsapp.net',
      isPinned: true
    }, userCookie);
    assert.strictEqual(pinRes.status, 200);

    // 2. Archive chat
    const arcRes = await post(base, '/api/chats/archive', {
      accountId: accId,
      remoteJid: '919999000002@s.whatsapp.net',
      isArchived: true
    }, userCookie);
    assert.strictEqual(arcRes.status, 200);

    // 3. Filter by Pinned
    const pinnedChats = (await (await get(base, '/api/chats?filterType=pinned', userCookie)).json()).data;
    assert.strictEqual(pinnedChats.length, 1);
    assert.strictEqual(pinnedChats[0].remoteJid, '919999000001@s.whatsapp.net');

    // 4. Filter by Archived
    const archivedChats = (await (await get(base, '/api/chats?filterType=archived', userCookie)).json()).data;
    assert.strictEqual(archivedChats.length, 1);
    assert.strictEqual(archivedChats[0].remoteJid, '919999000002@s.whatsapp.net');

    // 5. Default feed hides archived
    const mainFeed = (await (await get(base, '/api/chats', userCookie)).json()).data;
    assert.ok(mainFeed.some(c => c.remoteJid === '919999000001@s.whatsapp.net'));
    assert.ok(!mainFeed.some(c => c.remoteJid === '919999000002@s.whatsapp.net'));

    // 6. WhatsApp Groups are visible with group title and isGroup: true
    await store.saveChat(accId, {
      id: '120363000000000001@g.us',
      name: 'Marketing Team Group',
      isGroup: true
    });
    await store.addMessage({
      id: 'msg_grp_1',
      accountId: accId,
      remoteJid: '120363000000000001@g.us',
      text: 'Hello marketing team!',
      fromMe: false,
      timestamp: new Date().toISOString()
    });

    const feedWithGroup = (await (await get(base, '/api/chats', userCookie)).json()).data;
    const groupChat = feedWithGroup.find(c => c.remoteJid === '120363000000000001@g.us');
    assert.ok(groupChat, 'Group chat must be visible in inbox');
    assert.strictEqual(groupChat.customerName, 'Marketing Team Group');
    assert.strictEqual(groupChat.customerPhone, 'Group');
    assert.strictEqual(groupChat.isGroup, true);
  });
});

test('Multi-Tenant Media and File Protection', async () => {
  await withServer(async (base) => {
    const userACookie = await registerAndLogin(base, 'tenant_media_a', '9870000006');
    const userBCookie = await registerAndLogin(base, 'tenant_media_b', '9870000007');

    const accAId = (await (await post(base, '/api/accounts', { name: 'Line A' }, userACookie)).json()).data.id;

    // Create a dummy file in Line A's media directory
    const accMediaDir = path.join(process.env.DATA_DIR, 'media', accAId);
    fs.mkdirSync(accMediaDir, { recursive: true });
    fs.writeFileSync(path.join(accMediaDir, 'statement.pdf'), 'CONFIDENTIAL_FINANCIAL_DOC');

    // User A can access media
    const userAGet = await get(base, `/api/media/${accAId}/statement.pdf`, userACookie);
    assert.strictEqual(userAGet.status, 200);

    // User B attempting to access User A's media file: 403 Forbidden
    const userBGet = await get(base, `/api/media/${accAId}/statement.pdf`, userBCookie);
    assert.strictEqual(userBGet.status, 403);

    // Unauthenticated user attempting to access: 401 Unauthorized
    const unauthGet = await get(base, `/api/media/${accAId}/statement.pdf`);
    assert.strictEqual(unauthGet.status, 401);
  });
});

test('User Preferences API (Theme, Sound, Enter-is-send)', async () => {
  await withServer(async (base) => {
    const userACookie = await registerAndLogin(base, 'tenant_pref_a', '9870000008');
    const userBCookie = await registerAndLogin(base, 'tenant_pref_b', '9870000009');

    // Default preferences
    const defaultA = (await (await get(base, '/api/user/preferences', userACookie)).json()).data;
    assert.strictEqual(defaultA.theme, 'light');

    // User A sets theme to dark
    const updateA = await put(base, '/api/user/preferences', { theme: 'dark', soundEnabled: false }, userACookie);
    assert.strictEqual(updateA.status, 200);
    const updatedA = (await updateA.json()).data;
    assert.strictEqual(updatedA.theme, 'dark');
    assert.strictEqual(updatedA.soundEnabled, false);

    // User B preferences remain independent
    const prefB = (await (await get(base, '/api/user/preferences', userBCookie)).json()).data;
    assert.strictEqual(prefB.theme, 'light');
    assert.strictEqual(prefB.soundEnabled, true);
  });
});
