const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wacrm-team-test-'));
process.env.NODE_ENV = 'test';
process.env.AUTH_REQUIRED = 'true';

const app = require('../src/app');
const store = require('../src/store');
const db = require('../src/db');
const auth = require('../src/auth');
const connector = require('../src/whatsapp/connector-service');
const guard = require('../src/send-guard');

let server, base;
test.before(async () => {
  await app.ready;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const req = (method, p, body, cookie, headers = {}) =>
  fetch(`${base}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
const cookieOf = (r) => r.headers.get('set-cookie').split(';')[0];

let phoneSeq = 9800000100;
async function registerOwner(username) {
  const phone = String(phoneSeq++);
  const otp = (await (await req('POST', '/api/auth/register/send-otp', { phoneNumber: phone, username })).json()).data.devOtp;
  const r = await req('POST', '/api/auth/register/verify', {
    fullName: `Owner ${username}`, username, phoneNumber: phone, email: `${username}@example.com`, otp, password: 'OwnerPass123', acceptTerms: true
  });
  assert.strictEqual(r.status, 200);
  return cookieOf(r);
}
async function login(username, password) {
  const r = await req('POST', '/api/auth/login', { username, password });
  return { status: r.status, cookie: r.status === 200 ? cookieOf(r) : null, body: await r.json() };
}
async function createAccount(cookie, name) {
  const r = await json(await req('POST', '/api/accounts', { name }, cookie));
  assert.strictEqual(r.status, 200);
  return r.body.data.id;
}
async function addMember(cookie, body) {
  return json(await req('POST', '/api/team/members', { password: 'MemberPass123', role: 'agent', ...body }, cookie));
}
// Fake a connected WhatsApp socket so send paths run end-to-end without WhatsApp
function fakeConnect(accountId) {
  let n = 0;
  const sent = [];
  connector.sessions.set(accountId, {
    accountId, status: 'CONNECTED',
    sock: { sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: `FAKE_${accountId}_${++n}` } }; } }
  });
  return sent;
}

test('Owner creates members; members log in to the shared workspace with only granted numbers', async () => {
  const owner = await registerOwner('team_owner1');
  const accA = await createAccount(owner, 'Number A');
  const accB = await createAccount(owner, 'Number B');
  await store.addMessage({ id: 'tm1', accountId: accA, remoteJid: '911@s.whatsapp.net', text: 'hello A', fromMe: false });
  await store.addMessage({ id: 'tm2', accountId: accB, remoteJid: '912@s.whatsapp.net', text: 'hello B', fromMe: false });

  const m1 = await addMember(owner, { username: 'member_one', fullName: 'Member One', email: 'm1@example.com', accountIds: [accA] });
  assert.strictEqual(m1.status, 200, JSON.stringify(m1.body));
  assert.strictEqual(m1.body.data.parentId, m1.body.data.workspaceId);
  const m2 = await addMember(owner, { username: 'member_two', fullName: 'Member Two', accountIds: [accA, accB] });
  assert.strictEqual(m2.status, 200);

  // Unique usernames across the whole platform
  assert.strictEqual((await addMember(owner, { username: 'MEMBER_ONE', fullName: 'Dup' })).status, 409);
  // Backend validation
  assert.strictEqual((await addMember(owner, { username: 'x', fullName: 'Bad' })).status, 400);
  assert.strictEqual((await addMember(owner, { username: 'weakpass', fullName: 'Weak', password: 'onlyletters' })).status, 400);

  const s1 = await login('member_one', 'MemberPass123');
  assert.strictEqual(s1.status, 200);
  assert.strictEqual(s1.body.data.user.isOwner, false);

  const chats1 = (await json(await req('GET', '/api/chats', undefined, s1.cookie))).body.data;
  assert.deepStrictEqual(chats1.map(c => c.accountId), [accA]);
  assert.strictEqual((await req('GET', `/api/chats/messages?accountId=${accB}&remoteJid=912@s.whatsapp.net`, undefined, s1.cookie)).status, 403);
  assert.strictEqual((await req('GET', `/api/chats?accountId=${accB}`, undefined, s1.cookie)).status, 403);

  const s2 = await login('member_two', 'MemberPass123');
  const chats2 = (await json(await req('GET', '/api/chats', undefined, s2.cookie))).body.data;
  assert.strictEqual(chats2.length, 2);

  // Access change takes effect immediately on the existing session
  const put = await req('PUT', `/api/team/members/${m1.body.data.id}/whatsapp-access`, { accountIds: [accB] }, owner);
  assert.strictEqual(put.status, 200);
  const after = (await json(await req('GET', '/api/chats', undefined, s1.cookie))).body.data;
  assert.deepStrictEqual(after.map(c => c.accountId), [accB]);

  // Stats
  const list = await json(await req('GET', '/api/team/members', undefined, owner));
  assert.strictEqual(list.body.stats.total, 2);
  assert.strictEqual(list.body.stats.active, 2);
});

test('Agents are denied team management, account connections and privilege escalation', async () => {
  const owner = await registerOwner('team_owner2');
  const acc = await createAccount(owner, 'Line');
  const agent = await addMember(owner, { username: 'agent_two', fullName: 'Agent', accountIds: [acc] });
  const mgr = await addMember(owner, { username: 'manager_two', fullName: 'Manager', role: 'manager', accountIds: [acc] });
  assert.strictEqual(mgr.status, 200);
  const a = (await login('agent_two', 'MemberPass123')).cookie;
  const m = (await login('manager_two', 'MemberPass123')).cookie;

  assert.strictEqual((await req('GET', '/api/team/members', undefined, a)).status, 403);
  assert.strictEqual((await req('POST', '/api/team/members', { username: 'sneaky1', fullName: 'S', password: 'Sneaky1234' }, a)).status, 403);
  assert.strictEqual((await req('POST', '/api/accounts', { name: 'Nope' }, a)).status, 403);
  assert.strictEqual((await req('POST', `/api/accounts/${acc}/disconnect`, {}, a)).status, 403);
  assert.strictEqual((await req('GET', '/api/team/activity', undefined, a)).status, 403);

  // Managers can manage agents but cannot create managers, grant what they lack, or edit themselves/managers
  assert.strictEqual((await addMember(m, { username: 'mgr_made', fullName: 'Made' })).status, 200);
  assert.strictEqual((await addMember(m, { username: 'mgr_admin', fullName: 'X', role: 'manager' })).status, 403);
  assert.strictEqual((await req('PUT', `/api/team/members/${agent.body.data.id}/permissions`, { permissions: ['accounts.manage'] }, m)).status, 403);
  assert.strictEqual((await req('PUT', `/api/team/members/${mgr.body.data.id}/permissions`, { permissions: ['chats.view'] }, m)).status, 403);
  assert.strictEqual((await req('PATCH', `/api/team/members/${mgr.body.data.id}/status`, { status: 'inactive' }, m)).status, 403);
  // The owner is not a member and can never be targeted
  const ownerId = mgr.body.data.parentId;
  assert.strictEqual((await req('PATCH', `/api/team/members/${ownerId}/status`, { status: 'inactive' }, m)).status, 404);
  assert.strictEqual((await req('DELETE', `/api/team/members/${ownerId}`, undefined, m)).status, 404);

  // Owner can revoke an agent's send permission; it applies at once
  const perm = await req('PUT', `/api/team/members/${agent.body.data.id}/permissions`, { permissions: ['chats.view'] }, owner);
  assert.strictEqual(perm.status, 200);
  assert.strictEqual((await req('POST', '/api/messages/send', { accountId: acc, to: '9199', text: 'hi' }, a)).status, 403);
  assert.strictEqual((await req('GET', '/api/chats', undefined, a)).status, 200);
  // Frontend-supplied permissions are ignored: unknown keys are dropped
  await req('PUT', `/api/team/members/${agent.body.data.id}/permissions`, { permissions: ['chats.view', 'superuser'] }, owner);
  assert.deepStrictEqual(auth.effectivePermissions(await auth.getUserById(agent.body.data.id)), ['chats.view']);
});

test('Deactivation immediately blocks login, existing sessions, sending and SSE; reactivation restores', async () => {
  const owner = await registerOwner('team_owner3');
  const acc = await createAccount(owner, 'Line');
  const m = await addMember(owner, { username: 'deact_me', fullName: 'Deact', accountIds: [acc] });
  const s = (await login('deact_me', 'MemberPass123')).cookie;
  assert.strictEqual((await req('GET', '/api/chats', undefined, s)).status, 200);

  // Open an SSE stream as an "open browser tab"
  const sse = await fetch(`${base}/api/events`, { headers: { cookie: s } });
  assert.strictEqual(sse.status, 200);
  const reader = sse.body.getReader();
  await reader.read(); // initial ping

  const r = await req('PATCH', `/api/team/members/${m.body.data.id}/status`, { status: 'inactive' }, owner);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body === undefined, false);

  const end = await Promise.race([reader.read(), new Promise(res => setTimeout(() => res('timeout'), 2000))]);
  assert.notStrictEqual(end, 'timeout', 'SSE stream should be closed on deactivation');
  assert.strictEqual(end.done, true);

  assert.strictEqual((await req('GET', '/api/chats', undefined, s)).status, 401);
  assert.strictEqual((await req('POST', '/api/messages/send', { accountId: acc, to: '9199', text: 'x' }, s)).status, 401);
  assert.strictEqual((await login('deact_me', 'MemberPass123')).status, 401);

  await req('PATCH', `/api/team/members/${m.body.data.id}/status`, { status: 'active' }, owner);
  const again = await login('deact_me', 'MemberPass123');
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await req('GET', '/api/chats', undefined, again.cookie)).status, 200);

  // Suspending the owner (SuperAdmin action) locks out the whole workspace
  (await db.run("UPDATE users SET status = 'suspended', active = 0 WHERE id = ?", m.body.data.parentId));
  assert.strictEqual((await req('GET', '/api/chats', undefined, again.cookie)).status, 401);
  (await db.run("UPDATE users SET status = 'active', active = 1 WHERE id = ?", m.body.data.parentId));

  // Audit trail captured the events
  const log = (await json(await req('GET', '/api/team/activity', undefined, owner))).body.data.map(e => e.action);
  assert.ok(log.includes('team.member_deactivated'));
  assert.ok(log.includes('team.member_activated'));
  assert.ok(log.includes('auth.login_failed'));
});

test('Tenant isolation: owners cannot see or manage other workspaces members or numbers', async () => {
  const o1 = await registerOwner('iso_owner1');
  const o2 = await registerOwner('iso_owner2');
  const acc2 = await createAccount(o2, 'Other line');
  const m2 = await addMember(o2, { username: 'iso_member2', fullName: 'Other', accountIds: [acc2] });
  const id = m2.body.data.id;

  assert.strictEqual((await req('GET', `/api/team/members/${id}`, undefined, o1)).status, 404);
  assert.strictEqual((await req('PUT', `/api/team/members/${id}`, { fullName: 'Hacked' }, o1)).status, 404);
  assert.strictEqual((await req('PATCH', `/api/team/members/${id}/status`, { status: 'inactive' }, o1)).status, 404);
  assert.strictEqual((await req('DELETE', `/api/team/members/${id}`, undefined, o1)).status, 404);
  assert.strictEqual((await json(await req('GET', '/api/team/members', undefined, o1))).body.data.length, 0);

  // Granting another tenant's number to my member is silently dropped
  const mine = await addMember(o1, { username: 'iso_member1', fullName: 'Mine', accountIds: [acc2] });
  assert.deepStrictEqual(mine.body.data.accountIds, []);
  // Even a stale DB grant cannot cross tenants
  await auth.setUserAccounts(mine.body.data.id, [acc2]);
  const s = (await login('iso_member1', 'MemberPass123')).cookie;
  assert.strictEqual((await req('GET', `/api/chats?accountId=${acc2}`, undefined, s)).status, 403);
  assert.strictEqual((await req('GET', `/api/media/${acc2}/x.jpg`, undefined, s)).status, 403);
});

test('Invitations: hashed single-use tokens, acceptance, expiry and reuse protection', async () => {
  const owner = await registerOwner('inv_owner');
  const acc = await createAccount(owner, 'Line');
  const inv = await json(await req('POST', '/api/team/invitations', { username: 'invited_one', fullName: 'Invited', role: 'agent', accountIds: [acc] }, owner));
  assert.strictEqual(inv.status, 200);
  const token = inv.body.data.token;
  assert.ok(inv.body.data.inviteUrl.includes(token));
  // Only the hash is stored
  assert.strictEqual((await db.get('SELECT COUNT(*) AS n FROM invitations WHERE token_hash = ?', token)).n, 0);

  assert.strictEqual((await req('POST', '/api/team/invitations/accept', { token, password: 'weak' })).status, 400);
  const ok = await req('POST', '/api/team/invitations/accept', { token, password: 'Invited123' });
  assert.strictEqual(ok.status, 200);
  const user = (await ok.json()).data.user;
  assert.strictEqual(user.workspaceId, user.parentId);
  assert.deepStrictEqual(user.accountIds, [acc]);
  assert.strictEqual((await req('POST', '/api/team/invitations/accept', { token, password: 'Invited123' })).status, 400, 'reuse blocked');
  assert.strictEqual((await login('invited_one', 'Invited123')).status, 200);

  // Expired invitation
  const inv2 = await json(await req('POST', '/api/team/invitations', { username: 'invited_two', fullName: 'Late' }, owner));
  (await db.run('UPDATE invitations SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), inv2.body.data.id));
  assert.strictEqual((await req('POST', '/api/team/invitations/accept', { token: inv2.body.data.token, password: 'Invited123' })).status, 400);
  assert.strictEqual((await req('POST', '/api/team/invitations/accept', { token: 'garbage', password: 'Invited123' })).status, 400);
});

test('Deleting a member keeps workspace data and audit history; password reset revokes sessions', async () => {
  const owner = await registerOwner('del_owner');
  const acc = await createAccount(owner, 'Line');
  await store.addMessage({ id: 'del1', accountId: acc, remoteJid: '933@s.whatsapp.net', text: 'keep me', fromMe: false });
  const m = await addMember(owner, { username: 'del_member', fullName: 'Del', accountIds: [acc] });
  const s = (await login('del_member', 'MemberPass123')).cookie;

  const reset = await req('POST', `/api/team/members/${m.body.data.id}/reset-password`, { newPassword: 'NewMember456' }, owner);
  assert.strictEqual(reset.status, 200);
  assert.strictEqual((await req('GET', '/api/chats', undefined, s)).status, 401);
  assert.strictEqual((await login('del_member', 'NewMember456')).status, 200);

  const sessions = await json(await req('GET', `/api/team/members/${m.body.data.id}/sessions`, undefined, owner));
  assert.strictEqual(sessions.body.data.length, 1);
  assert.strictEqual(sessions.body.data[0].ref.length, 8);

  assert.strictEqual((await req('DELETE', `/api/team/members/${m.body.data.id}`, undefined, owner)).status, 200);
  assert.strictEqual(await auth.getUserById(m.body.data.id), null);
  assert.strictEqual((await store.getMessages(acc, '933@s.whatsapp.net')).length, 1);
  assert.ok(await store.getAccount(acc));
  const log = (await json(await req('GET', '/api/team/activity', undefined, owner))).body.data.map(e => e.action);
  assert.ok(log.includes('team.member_deleted'));
});

test('Shared number: attribution, idempotent sends, duplicate guard, pause and rate limits', async () => {
  guard.reset();
  const owner = await registerOwner('send_owner');
  const acc = await createAccount(owner, 'Shared');
  await addMember(owner, { username: 'send_m1', fullName: 'Sender One', accountIds: [acc] });
  const s = (await login('send_m1', 'MemberPass123')).cookie;
  const sent = fakeConnect(acc);

  // Two concurrent requests with the same idempotency key send once
  const body = { accountId: acc, to: '919000000001', text: 'Hello there', clientMessageId: 'k-1' };
  const [r1, r2] = await Promise.all([req('POST', '/api/messages/send', body, s), req('POST', '/api/messages/send', body, s)]);
  const [j1, j2] = [await r1.json(), await r2.json()];
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(j1.data.id, j2.data.id);
  assert.strictEqual(sent.length, 1);
  // Internal attribution stored; WhatsApp payload untouched
  assert.deepStrictEqual(sent[0].payload, { text: 'Hello there' });
  const stored = (await store.getMessages(acc, sent[0].jid)).find(m => m.id === j1.data.id);
  assert.strictEqual(stored.sentBy.name, 'Sender One');

  // Identical content right after (new key) is blocked as a duplicate
  assert.strictEqual((await req('POST', '/api/messages/send', { ...body, clientMessageId: 'k-2' }, s)).status, 429);

  // Owner pauses outgoing messages on the number
  assert.strictEqual((await req('POST', `/api/accounts/${acc}/sending`, { paused: true }, owner)).status, 200);
  assert.strictEqual((await req('POST', '/api/messages/send', { ...body, text: 'other', clientMessageId: 'k-3' }, s)).status, 423);
  assert.strictEqual((await req('POST', `/api/accounts/${acc}/sending`, { paused: true }, s)).status, 403);
  await req('POST', `/api/accounts/${acc}/sending`, { paused: false }, owner);

  // Per-member limit
  guard.reset();
  let last;
  for (let i = 0; i <= guard.LIMITS.perMemberPerMinute; i++) {
    last = await req('POST', '/api/messages/send', { accountId: acc, to: '919000000001', text: `msg ${i}` }, s);
  }
  assert.strictEqual(last.status, 429);
  connector.sessions.delete(acc);
});

test('Security: Argon2id hashing, legacy scrypt hashes, cross-site requests, masked reset phone', async () => {
  const h = auth.hashPassword('Secret123');
  if (typeof require('crypto').argon2Sync === 'function') assert.ok(h.startsWith('argon2id$'));
  assert.ok(auth.verifyPassword('Secret123', h));
  assert.ok(!auth.verifyPassword('Wrong123', h));
  const crypto = require('crypto');
  const salt = 'abcd';
  assert.ok(auth.verifyPassword('legacy123', `${salt}:${crypto.scryptSync('legacy123', salt, 64).toString('hex')}`));

  const blocked = await req('POST', '/api/auth/login', { username: 'x', password: 'y' }, null, { Origin: 'https://evil.example' });
  assert.strictEqual(blocked.status, 403);

  await registerOwner('mask_owner');
  const fp = await json(await req('POST', '/api/auth/forgot-password/send-otp', { identifier: 'mask_owner' }));
  assert.ok(fp.body.data.phoneNumber.includes('******'));
  const unknown = await json(await req('POST', '/api/auth/forgot-password/send-otp', { identifier: 'nobody_here' }));
  assert.strictEqual(unknown.status, 200, 'does not reveal whether an account exists');
  // Reset still works with the masked number echoed back plus the identifier
  const r = await req('POST', '/api/auth/forgot-password/reset', { identifier: 'mask_owner', phoneNumber: fp.body.data.phoneNumber, otp: fp.body.data.devOtp, newPassword: 'Changed123' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await login('mask_owner', 'Changed123')).status, 200);
});
