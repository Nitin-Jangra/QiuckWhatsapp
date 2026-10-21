const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole, enforceTenantScope } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/branches
 * Lists branches for tenant. Tenant users can only see their own tenant's branches.
 */
router.get('/', enforceTenantScope, async (req, res) => {
  const tenantId = req.user.role_id === 'ROOT_ADMIN' ? (req.query.tenantId || null) : req.user.tenant_id;

  try {
    const branches = await db.listBranches(tenantId);
    return res.json({ success: true, data: branches });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/branches
 * Creates a new branch for tenant.
 */
router.post('/', requireRole('ROOT_ADMIN', 'TENANT_ADMIN'), enforceTenantScope, async (req, res) => {
  const tenantId = req.user.role_id === 'ROOT_ADMIN' ? (req.body.tenant_id || req.body.tenantId) : req.user.tenant_id;
  const { name, code, phone, status } = req.body;

  if (!tenantId) {
    return res.status(400).json({ success: false, error: 'tenant_id is required' });
  }
  if (!name || !code) {
    return res.status(400).json({ success: false, error: 'Branch name and code are required' });
  }

  try {
    const branch = await db.createBranch({ tenant_id: tenantId, name, code, phone, status });
    return res.status(201).json({ success: true, data: branch });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/branches/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const branch = await db.getBranchById(req.params.id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    // Tenant isolation check
    if (req.user.role_id !== 'ROOT_ADMIN' && branch.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Branch belongs to another tenant' });
    }

    return res.json({ success: true, data: branch });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/branches/:id
 */
router.patch('/:id', requireRole('ROOT_ADMIN', 'TENANT_ADMIN', 'BRANCH_ADMIN'), async (req, res) => {
  try {
    const branch = await db.getBranchById(req.params.id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    // Tenant isolation check
    if (req.user.role_id !== 'ROOT_ADMIN' && branch.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Branch belongs to another tenant' });
    }

    // Branch Admin can only update their own branch
    if (req.user.role_id === 'BRANCH_ADMIN' && req.user.branch_id !== branch.id) {
      return res.status(403).json({ success: false, error: 'Forbidden: Branch Admin can only update their assigned branch' });
    }

    const updated = await db.updateBranch(branch.id, req.body);
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
