const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/roles
 * Lists system roles with their associated permissions
 */
router.get('/', (req, res) => {
  const roles = db.getRoles().map(r => ({
    ...r,
    permissions: db.getPermissionsForRole(r.id)
  }));
  return res.json({ success: true, data: roles });
});

module.exports = router;
