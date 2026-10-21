const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Default Roles & Permissions mapping
const DEFAULT_ROLES = [
  { id: 'ROOT_ADMIN', name: 'Root Administrator', description: 'Global cross-tenant administrative access' },
  { id: 'TENANT_ADMIN', name: 'Tenant Administrator', description: 'Administrative access within single tenant' },
  { id: 'BRANCH_ADMIN', name: 'Branch Administrator', description: 'Administrative access restricted to assigned branch' },
  { id: 'AGENT', name: 'Support Agent', description: 'Handles assigned chats and customer workflows' }
];

const DEFAULT_PERMISSIONS = {
  ROOT_ADMIN: ['*'],
  TENANT_ADMIN: [
    'tenants.view', 'branches.manage', 'branches.view',
    'users.manage', 'users.view', 'whatsapp.connect', 'whatsapp.status',
    'conversations.view', 'conversations.send', 'conversations.assign', 'reports.view'
  ],
  BRANCH_ADMIN: [
    'branches.view', 'users.view', 'whatsapp.connect', 'whatsapp.status',
    'conversations.view', 'conversations.send', 'conversations.assign', 'reports.view'
  ],
  AGENT: [
    'branches.view', 'whatsapp.status', 'conversations.view', 'conversations.send'
  ]
};

class DatabaseService {
  constructor() {
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.isLiveSupabase = Boolean(
      this.supabaseUrl &&
      this.supabaseKey &&
      !this.supabaseUrl.includes('your-project') &&
      process.env.NODE_ENV !== 'test'
    );

    if (this.isLiveSupabase) {
      this.client = createClient(this.supabaseUrl, this.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }

    // Initialize mock / local memory store for tests and local development
    this.resetMemoryStore();
  }

  resetMemoryStore() {
    this.tenants = new Map([
      ['11111111-1111-4000-8000-000000000001', {
        id: '11111111-1111-4000-8000-000000000001',
        name: 'M Square Professionals',
        slug: 'msquare-professionals',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['22222222-2222-4000-8000-000000000002', {
        id: '22222222-2222-4000-8000-000000000002',
        name: 'M Square Enterprise',
        slug: 'msquare-enterprise',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['tenant-demo', {
        id: 'tenant-demo',
        name: 'Demo Healthcare Enterprise',
        slug: 'demo-health',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['tenant-retail', {
        id: 'tenant-retail',
        name: 'Retail Global Mart',
        slug: 'retail-mart',
        status: 'active',
        created_at: new Date().toISOString()
      }]
    ]);

    this.branches = new Map([
      ['aaaaaaaa-0001-4000-8000-000000000001', {
        id: 'aaaaaaaa-0001-4000-8000-000000000001',
        tenant_id: '11111111-1111-4000-8000-000000000001',
        name: 'Greater Noida Hub',
        code: 'GNOIDA',
        phone: '+919876543210',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['aaaaaaaa-0002-4000-8000-000000000002', {
        id: 'aaaaaaaa-0002-4000-8000-000000000002',
        tenant_id: '11111111-1111-4000-8000-000000000001',
        name: 'Noida HQ',
        code: 'NOIDAHQ',
        phone: '+919876543211',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['bbbbbbbb-0001-4000-8000-000000000001', {
        id: 'bbbbbbbb-0001-4000-8000-000000000001',
        tenant_id: '22222222-2222-4000-8000-000000000002',
        name: 'Jaipur Hub',
        code: 'JAIPUR',
        phone: '+919876543212',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['branch-main', {
        id: 'branch-main',
        tenant_id: 'tenant-demo',
        name: 'North Downtown Branch',
        code: 'NORTH',
        phone: '+15550100',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['branch-secondary', {
        id: 'branch-secondary',
        tenant_id: 'tenant-demo',
        name: 'Westside Clinic Branch',
        code: 'WEST',
        phone: '+15550200',
        status: 'active',
        created_at: new Date().toISOString()
      }],
      ['branch-retail-1', {
        id: 'branch-retail-1',
        tenant_id: 'tenant-retail',
        name: 'Mall Flagship Branch',
        code: 'MALL',
        phone: '+15550300',
        status: 'active',
        created_at: new Date().toISOString()
      }]
    ]);

    this.users = new Map([
      ['alpha_branch_admin', {
        id: 'alpha_branch_admin',
        email: 'aarav@msquare.com',
        full_name: 'Aarav Sharma (Branch Lead)',
        role_id: 'BRANCH_ADMIN',
        tenant_id: '11111111-1111-4000-8000-000000000001',
        branch_id: 'aaaaaaaa-0001-4000-8000-000000000001',
        badge: 'Greater Noida Hub',
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['alpha_employee', {
        id: 'alpha_employee',
        email: 'diya@msquare.com',
        full_name: 'Diya Patel (Helpdesk Specialist)',
        role_id: 'AGENT',
        tenant_id: '11111111-1111-4000-8000-000000000001',
        branch_id: 'aaaaaaaa-0001-4000-8000-000000000001',
        badge: 'Greater Noida Support',
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['alpha_tenant_admin', {
        id: 'alpha_tenant_admin',
        email: 'vikram@msquare.com',
        full_name: 'Vikram Mehta (VP Operations)',
        role_id: 'TENANT_ADMIN',
        tenant_id: '11111111-1111-4000-8000-000000000001',
        branch_id: null,
        badge: 'Corporate HQ',
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['super_admin', {
        id: 'super_admin',
        email: 'superadmin@msquare.com',
        full_name: 'System Super Admin',
        role_id: 'ROOT_ADMIN',
        tenant_id: null,
        branch_id: null,
        badge: 'Global Admin',
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['beta_branch_admin', {
        id: 'beta_branch_admin',
        email: 'karan@msquare.com',
        full_name: 'Karan Mehra (Branch Lead)',
        role_id: 'BRANCH_ADMIN',
        tenant_id: '22222222-2222-4000-8000-000000000002',
        branch_id: 'bbbbbbbb-0001-4000-8000-000000000001',
        badge: 'Jaipur Hub',
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['user-root', {
        id: 'user-root',
        email: 'root@wacrm.com',
        full_name: 'Root Administrator',
        role_id: 'ROOT_ADMIN',
        tenant_id: null,
        branch_id: null,
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['user-tenant-admin', {
        id: 'user-tenant-admin',
        email: 'admin@demo.com',
        full_name: 'Demo Tenant Admin',
        role_id: 'TENANT_ADMIN',
        tenant_id: 'tenant-demo',
        branch_id: null,
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['user-agent-1', {
        id: 'user-agent-1',
        email: 'agent1@demo.com',
        full_name: 'Sarah Connor',
        role_id: 'AGENT',
        tenant_id: 'tenant-demo',
        branch_id: 'branch-main',
        is_active: true,
        created_at: new Date().toISOString()
      }],
      ['user-retail-admin', {
        id: 'user-retail-admin',
        email: 'admin@retail.com',
        full_name: 'Retail Tenant Admin',
        role_id: 'TENANT_ADMIN',
        tenant_id: 'tenant-retail',
        branch_id: null,
        is_active: true,
        created_at: new Date().toISOString()
      }]
    ]);

    this.featureToggles = new Map([
      ['tenant-demo:multi_branch', true],
      ['tenant-demo:audio_transcription', true]
    ]);
  }

  // --- Auth & Users ---
  async getUserByEmail(email) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('users').select('*').eq('email', email).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) return { ...user };
    }
    return null;
  }

  async getUserById(id) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('users').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }
    return this.users.get(id) ? { ...this.users.get(id) } : null;
  }

  async createUser(userData) {
    const id = userData.id || `user-${crypto.randomUUID()}`;
    const user = {
      id,
      email: userData.email,
      full_name: userData.full_name,
      role_id: userData.role_id,
      tenant_id: userData.tenant_id || null,
      branch_id: userData.branch_id || null,
      is_active: userData.is_active !== undefined ? userData.is_active : true,
      created_at: new Date().toISOString()
    };

    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('users').insert(user).select().single();
      if (error) throw error;
      return data;
    }

    this.users.set(id, user);
    return { ...user };
  }

  async updateUser(id, updates) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('users').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    const existing = this.users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    this.users.set(id, updated);
    return { ...updated };
  }

  async listUsers(filter = {}) {
    if (this.isLiveSupabase) {
      let query = this.client.from('users').select('*');
      if (filter.tenant_id) query = query.eq('tenant_id', filter.tenant_id);
      if (filter.branch_id) query = query.eq('branch_id', filter.branch_id);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    let list = Array.from(this.users.values());
    if (filter.tenant_id) {
      list = list.filter(u => u.tenant_id === filter.tenant_id);
    }
    if (filter.branch_id) {
      list = list.filter(u => u.branch_id === filter.branch_id);
    }
    return list;
  }

  // --- Tenants ---
  async getTenantById(id) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('tenants').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }
    return this.tenants.get(id) ? { ...this.tenants.get(id) } : null;
  }

  async listTenants() {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('tenants').select('*');
      if (error) throw error;
      return data;
    }
    return Array.from(this.tenants.values());
  }

  async createTenant(data) {
    const id = data.id || `tenant-${crypto.randomUUID()}`;
    const tenant = {
      id,
      name: data.name,
      slug: data.slug || data.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      status: data.status || 'active',
      created_at: new Date().toISOString()
    };

    if (this.isLiveSupabase) {
      const { data: result, error } = await this.client.from('tenants').insert(tenant).select().single();
      if (error) throw error;
      return result;
    }

    this.tenants.set(id, tenant);
    return { ...tenant };
  }

  async updateTenant(id, updates) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('tenants').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    const existing = this.tenants.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    this.tenants.set(id, updated);
    return { ...updated };
  }

  // --- Branches ---
  async getBranchById(id) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('branches').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data;
    }
    return this.branches.get(id) ? { ...this.branches.get(id) } : null;
  }

  async listBranches(tenantId = null) {
    if (this.isLiveSupabase) {
      let query = this.client.from('branches').select('*');
      if (tenantId) query = query.eq('tenant_id', tenantId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    let list = Array.from(this.branches.values());
    if (tenantId) {
      list = list.filter(b => b.tenant_id === tenantId);
    }
    return list;
  }

  async createBranch(data) {
    const id = data.id || `branch-${crypto.randomUUID()}`;
    const branch = {
      id,
      tenant_id: data.tenant_id,
      name: data.name,
      code: data.code.toUpperCase(),
      phone: data.phone || null,
      status: data.status || 'active',
      created_at: new Date().toISOString()
    };

    if (this.isLiveSupabase) {
      const { data: result, error } = await this.client.from('branches').insert(branch).select().single();
      if (error) throw error;
      return result;
    }

    this.branches.set(id, branch);
    return { ...branch };
  }

  async updateBranch(id, updates) {
    if (this.isLiveSupabase) {
      const { data, error } = await this.client.from('branches').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    const existing = this.branches.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
    this.branches.set(id, updated);
    return { ...updated };
  }

  // --- Roles & Permissions ---
  getRoles() {
    return DEFAULT_ROLES;
  }

  getPermissionsForRole(roleId) {
    return DEFAULT_PERMISSIONS[roleId] || [];
  }

  hasPermission(roleId, permission) {
    const perms = this.getPermissionsForRole(roleId);
    if (perms.includes('*')) return true;
    return perms.includes(permission);
  }
}

module.exports = new DatabaseService();
