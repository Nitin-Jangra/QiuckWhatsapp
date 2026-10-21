const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/auth/me
 * Returns current authenticated user, role, permissions, tenant, and branch.
 */
router.get('/me', authenticate, async (req, res) => {
  let tenant = null;
  let branch = null;

  if (req.user.tenant_id) {
    tenant = await db.getTenantById(req.user.tenant_id);
  }

  if (req.user.branch_id) {
    branch = await db.getBranchById(req.user.branch_id);
  }

  return res.json({
    success: true,
    data: {
      user: {
        id: req.user.id,
        email: req.user.email,
        full_name: req.user.full_name,
        role_id: req.user.role_id,
        tenant_id: req.user.tenant_id,
        branch_id: req.user.branch_id,
        permissions: req.user.permissions
      },
      tenant,
      branch
    }
  });
});

/**
 * POST /api/auth/login
 * Local dev login proxy or test token issuer.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const user = await db.getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid email or credentials' });
  }

  // Issue test token for dev/testing
  const token = `test-token-${user.id}`;

  return res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role_id: user.role_id,
        tenant_id: user.tenant_id,
        branch_id: user.branch_id
      }
    }
  });
});

module.exports = router;
