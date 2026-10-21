const test = require('node:test');
const assert = require('node:assert');
process.env.NODE_ENV = 'test';
const app = require('../src/app');

test('Phase 1 Auth - Unauthenticated request rejects with 401', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.success, false);
  } finally {
    server.close();
  }
});

test('Phase 1 Auth - Authenticated /api/auth/me loads profile and permissions', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Root Admin
    const rootRes = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Authorization: 'Bearer test-token-root' }
    });
    assert.strictEqual(rootRes.status, 200);
    const rootBody = await rootRes.json();
    assert.strictEqual(rootBody.data.user.role_id, 'ROOT_ADMIN');
    assert.ok(rootBody.data.user.permissions.includes('*'));

    // 2. Tenant Admin
    const tenantRes = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Authorization: 'Bearer test-token-tenant-admin' }
    });
    assert.strictEqual(tenantRes.status, 200);
    const tenantBody = await tenantRes.json();
    assert.strictEqual(tenantBody.data.user.role_id, 'TENANT_ADMIN');
    assert.strictEqual(tenantBody.data.tenant.id, 'tenant-demo');
  } finally {
    server.close();
  }
});

test('Phase 1 RBAC - Tenant Admin cannot access Root Admin tenant list', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Tenant Admin tries to list all tenants
    const res = await fetch(`http://127.0.0.1:${port}/api/tenants`, {
      headers: { Authorization: 'Bearer test-token-tenant-admin' }
    });
    assert.strictEqual(res.status, 403);

    // Root Admin can list all tenants
    const rootRes = await fetch(`http://127.0.0.1:${port}/api/tenants`, {
      headers: { Authorization: 'Bearer test-token-root' }
    });
    assert.strictEqual(rootRes.status, 200);
    const rootBody = await rootRes.json();
    assert.ok(rootBody.data.length >= 2);
  } finally {
    server.close();
  }
});

test('Phase 1 Tenant Isolation - Users cannot access other tenants branches', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Demo Tenant Admin lists branches -> should only receive tenant-demo branches
    const res = await fetch(`http://127.0.0.1:${port}/api/branches`, {
      headers: { Authorization: 'Bearer test-token-tenant-admin' }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.every(b => b.tenant_id === 'tenant-demo'));

    // Demo Tenant Admin explicitly requests retail tenant's branches -> 403 Forbidden
    const crossRes = await fetch(`http://127.0.0.1:${port}/api/branches?tenantId=tenant-retail`, {
      headers: { Authorization: 'Bearer test-token-tenant-admin' }
    });
    assert.strictEqual(crossRes.status, 403);
    const crossBody = await crossRes.json();
    assert.strictEqual(crossBody.success, false);
  } finally {
    server.close();
  }
});

test('Phase 1 Management - Branch & User provisioning with role boundary validation', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Create a new branch under tenant-demo
    const createBranchRes = await fetch(`http://127.0.0.1:${port}/api/branches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-tenant-admin'
      },
      body: JSON.stringify({
        name: 'South Metro Clinic',
        code: 'SMETRO',
        phone: '+15550999'
      })
    });
    assert.strictEqual(createBranchRes.status, 201);
    const branchData = await createBranchRes.json();
    assert.strictEqual(branchData.data.name, 'South Metro Clinic');
    assert.strictEqual(branchData.data.tenant_id, 'tenant-demo');

    // 2. Tenant Admin attempts to create a ROOT_ADMIN account -> Must be rejected with 403
    const illegalUserRes = await fetch(`http://127.0.0.1:${port}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-tenant-admin'
      },
      body: JSON.stringify({
        email: 'hacker@demo.com',
        full_name: 'Hacker User',
        role_id: 'ROOT_ADMIN'
      })
    });
    assert.strictEqual(illegalUserRes.status, 403);

    // 3. Tenant Admin creates a legitimate AGENT account -> 201 Created
    const validUserRes = await fetch(`http://127.0.0.1:${port}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-tenant-admin'
      },
      body: JSON.stringify({
        email: 'agent_new@demo.com',
        full_name: 'Alex Rivera',
        role_id: 'AGENT',
        branch_id: branchData.data.id
      })
    });
    assert.strictEqual(validUserRes.status, 201);
    const userData = await validUserRes.json();
    assert.strictEqual(userData.data.email, 'agent_new@demo.com');
    assert.strictEqual(userData.data.tenant_id, 'tenant-demo');
  } finally {
    server.close();
  }
});
