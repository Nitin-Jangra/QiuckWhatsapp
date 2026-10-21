-- ==============================================================================
-- WaCRM Phase 1: Authentication, Multi-Tenancy & Authorization Schema
-- Supabase PostgreSQL with Row Level Security (RLS)
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants Table
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Branches Table
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    phone VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_branch_code UNIQUE (tenant_id, code)
);

-- 3. Roles Table
CREATE TABLE IF NOT EXISTS public.roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Permissions Table
CREATE TABLE IF NOT EXISTS public.permissions (
    id VARCHAR(100) PRIMARY KEY,
    module VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Role Permissions Junction
CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id VARCHAR(50) NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(100) NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 6. Users Profile Table (links to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY, -- Matches auth.users.id
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    role_id VARCHAR(50) NOT NULL REFERENCES public.roles(id),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE, -- NULL only for ROOT_ADMIN
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Feature Toggles Table
CREATE TABLE IF NOT EXISTS public.feature_toggles (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    feature_key VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, feature_key)
);

-- 8. Seed Default Roles
INSERT INTO public.roles (id, name, description, is_system) VALUES
('ROOT_ADMIN', 'Root Administrator', 'Global cross-tenant administrative access', true),
('TENANT_ADMIN', 'Tenant Administrator', 'Full administrative access within single tenant', true),
('BRANCH_ADMIN', 'Branch Administrator', 'Administrative access restricted to assigned branch', true),
('AGENT', 'Support Agent', 'Handles assigned chats and customer workflows', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- 9. Seed Core Permissions
INSERT INTO public.permissions (id, module, action, description) VALUES
('tenants.manage', 'tenants', 'manage', 'Create, update, and suspend tenants'),
('tenants.view', 'tenants', 'view', 'View tenant configuration'),
('branches.manage', 'branches', 'manage', 'Create and update branches'),
('branches.view', 'branches', 'view', 'View branches'),
('users.manage', 'users', 'manage', 'Invite, update, and manage users'),
('users.view', 'users', 'view', 'View users list'),
('whatsapp.connect', 'whatsapp', 'connect', 'Connect or disconnect WhatsApp QR'),
('whatsapp.status', 'whatsapp', 'status', 'Check WhatsApp session status'),
('conversations.view', 'conversations', 'view', 'View conversations and messages'),
('conversations.send', 'conversations', 'send', 'Send messages to customers'),
('conversations.assign', 'conversations', 'assign', 'Assign conversations to agents'),
('reports.view', 'reports', 'view', 'View dashboards and reports')
ON CONFLICT (id) DO NOTHING;

-- 10. Map Roles to Permissions
-- ROOT_ADMIN has all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'ROOT_ADMIN', id FROM public.permissions
ON CONFLICT DO NOTHING;

-- TENANT_ADMIN has all tenant-level permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'TENANT_ADMIN', id FROM public.permissions 
WHERE id NOT IN ('tenants.manage')
ON CONFLICT DO NOTHING;

-- BRANCH_ADMIN has branch & messaging permissions
INSERT INTO public.role_permissions (role_id, permission_id) VALUES
('BRANCH_ADMIN', 'branches.view'),
('BRANCH_ADMIN', 'users.view'),
('BRANCH_ADMIN', 'whatsapp.connect'),
('BRANCH_ADMIN', 'whatsapp.status'),
('BRANCH_ADMIN', 'conversations.view'),
('BRANCH_ADMIN', 'conversations.send'),
('BRANCH_ADMIN', 'conversations.assign'),
('BRANCH_ADMIN', 'reports.view')
ON CONFLICT DO NOTHING;

-- AGENT has conversation permissions
INSERT INTO public.role_permissions (role_id, permission_id) VALUES
('AGENT', 'branches.view'),
('AGENT', 'whatsapp.status'),
('AGENT', 'conversations.view'),
('AGENT', 'conversations.send')
ON CONFLICT DO NOTHING;

-- 11. Enable Row Level Security (RLS)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_toggles ENABLE ROW LEVEL SECURITY;

-- Tenants Policy: Root admin sees all; tenant users see their own tenant
CREATE POLICY tenants_isolation_policy ON public.tenants
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role_id = 'ROOT_ADMIN')
    OR id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())
);

-- Branches Policy: Isolated by tenant
CREATE POLICY branches_isolation_policy ON public.branches
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role_id = 'ROOT_ADMIN')
    OR tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())
);

-- Users Policy: Isolated by tenant
CREATE POLICY users_isolation_policy ON public.users
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role_id = 'ROOT_ADMIN')
    OR tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())
);
