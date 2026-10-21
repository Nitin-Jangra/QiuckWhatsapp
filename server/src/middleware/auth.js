const db = require('../db');

/**
 * Express Authentication Middleware
 * Resolves user from Supabase JWT Bearer token or test tokens.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or malformed Authorization header. Expected Bearer token.'
      });
    }

    const token = authHeader.split(' ')[1];
    let user = null;

    // 1. Support Test / Development Tokens (e.g. test-token-root, test-token-tenant-admin)
    if (token.startsWith('test-token-') || process.env.NODE_ENV === 'test') {
      const tokenIdentifier = token.replace('test-token-', '');
      // Look up by email or by user id
      if (tokenIdentifier === 'root') {
        user = await db.getUserById('user-root');
      } else if (tokenIdentifier === 'tenant-admin') {
        user = await db.getUserById('user-tenant-admin');
      } else if (tokenIdentifier === 'retail-admin') {
        user = await db.getUserById('user-retail-admin');
      } else if (tokenIdentifier === 'agent-1') {
        user = await db.getUserById('user-agent-1');
      } else {
        user = await db.getUserByEmail(tokenIdentifier) || await db.getUserById(tokenIdentifier);
      }
    } else if (db.isLiveSupabase) {
      // 2. Live Supabase Auth verification
      const { data: { user: authUser }, error } = await db.client.auth.getUser(token);
      if (error || !authUser) {
        return res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
      }
      user = await db.getUserById(authUser.id) || await db.getUserByEmail(authUser.email);
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'User account not found or access revoked.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, error: 'User account has been deactivated.' });
    }

    // Attach user profile with permissions to request
    req.user = {
      ...user,
      permissions: db.getPermissionsForRole(user.role_id)
    };

    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Authentication internal error: ' + error.message });
  }
}

/**
 * Role-Based Access Control (RBAC) Middleware
 * Restricts route to specific role IDs. ROOT_ADMIN always has global bypass.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthenticated' });
    }

    if (req.user.role_id === 'ROOT_ADMIN') {
      return next();
    }

    if (allowedRoles.includes(req.user.role_id)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Forbidden: Action requires one of [${allowedRoles.join(', ')}] role.`
    });
  };
}

/**
 * Permission-Based Access Control Middleware
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthenticated' });
    }

    if (db.hasPermission(req.user.role_id, permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Forbidden: Missing required permission [${permission}]`
    });
  };
}

/**
 * Multi-Tenant Isolation Middleware
 * Guarantees a tenant user cannot query or mutate another tenant's data.
 */
function enforceTenantScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Unauthenticated' });
  }

  // ROOT_ADMIN can access any tenant
  if (req.user.role_id === 'ROOT_ADMIN') {
    return next();
  }

  // Extract requested tenantId from params, query, or body
  const targetTenantId = req.params.tenantId || req.query.tenantId || req.body?.tenant_id || req.body?.tenantId;

  if (targetTenantId && targetTenantId !== req.user.tenant_id) {
    return res.status(403).json({
      success: false,
      error: 'Security violation: Cross-tenant data access is strictly forbidden.'
    });
  }

  // Force tenant_id scope onto request for handlers
  req.tenantId = req.user.tenant_id;
  next();
}

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  enforceTenantScope
};
