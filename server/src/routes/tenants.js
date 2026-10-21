const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// All tenant management routes require authentication
router.use(authenticate);

/**
 * GET /api/tenants
 * Only ROOT_ADMIN can list all tenants
 */
router.get('/', requireRole('ROOT_ADMIN'), async (req, res) => {
  try {
    const tenants = await db.listTenants();
    return res.json({ success: true, data: tenants });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/tenants
 * Only ROOT_ADMIN can create new tenants
 */
router.post('/', requireRole('ROOT_ADMIN'), async (req, res) => {
  const { name, slug, status } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Tenant name is required' });
  }

  try {
    const tenant = await db.createTenant({ name, slug, status });
    return res.status(201).json({ success: true, data: tenant });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/tenants/:id
 * ROOT_ADMIN or users belonging to that specific tenant
 */
router.get('/:id', async (req, res) => {
  const tenantId = req.params.id;

  if (req.user.role_id !== 'ROOT_ADMIN' && req.user.tenant_id !== tenantId) {
    return res.status(403).json({ success: false, error: 'Access forbidden: Tenant isolation' });
  }

  try {
    const tenant = await db.getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    return res.json({ success: true, data: tenant });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/tenants/:id
 * Only ROOT_ADMIN can update tenant status or configuration
 */
router.patch('/:id', requireRole('ROOT_ADMIN'), async (req, res) => {
  const tenantId = req.params.id;
  try {
    const updated = await db.updateTenant(tenantId, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
