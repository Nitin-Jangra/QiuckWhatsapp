const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole, enforceTenantScope } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/users
 * Lists users. Scoped to current user's tenant unless ROOT_ADMIN.
 */
router.get('/', enforceTenantScope, async (req, res) => {
  const tenantId = req.user.role_id === 'ROOT_ADMIN' ? (req.query.tenantId || null) : req.user.tenant_id;
  const branchId = req.user.role_id === 'AGENT' ? req.user.branch_id : (req.query.branchId || null);

  try {
    const users = await db.listUsers({ tenant_id: tenantId, branch_id: branchId });
    // Remove sensitive internals if any
    const safeUsers = users.map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role_id: u.role_id,
      tenant_id: u.tenant_id,
      branch_id: u.branch_id,
      is_active: u.is_active,
      created_at: u.created_at
    }));
    return res.json({ success: true, data: safeUsers });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/users
 * Provision a new user.
 */
router.post('/', requireRole('ROOT_ADMIN', 'TENANT_ADMIN'), enforceTenantScope, async (req, res) => {
  const { email, full_name, role_id, branch_id } = req.body;
  const targetTenantId = req.user.role_id === 'ROOT_ADMIN' ? (req.body.tenant_id || null) : req.user.tenant_id;

  if (!email || !full_name || !role_id) {
    return res.status(400).json({ success: false, error: 'email, full_name, and role_id are required' });
  }

  // Tenant Admin cannot create ROOT_ADMIN accounts
  if (req.user.role_id !== 'ROOT_ADMIN' && role_id === 'ROOT_ADMIN') {
    return res.status(403).json({ success: false, error: 'Cannot create Root Administrator account' });
  }

  try {
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, error: 'User with this email already exists' });
    }

    const newUser = await db.createUser({
      email,
      full_name,
      role_id,
      tenant_id: targetTenantId,
      branch_id: branch_id || null
    });

    return res.status(201).json({ success: true, data: newUser });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/users/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Cross-tenant check
    if (req.user.role_id !== 'ROOT_ADMIN' && user.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cross-tenant access' });
    }

    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/users/:id
 */
router.patch('/:id', requireRole('ROOT_ADMIN', 'TENANT_ADMIN'), async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (req.user.role_id !== 'ROOT_ADMIN' && user.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cross-tenant modification' });
    }

    // Cannot elevate to ROOT_ADMIN
    if (req.body.role_id === 'ROOT_ADMIN' && req.user.role_id !== 'ROOT_ADMIN') {
      return res.status(403).json({ success: false, error: 'Cannot grant Root Administrator role' });
    }

    const updated = await db.updateUser(user.id, req.body);
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
