# WaCRM — Multi-Tenant WhatsApp CRM & Branch Management Platform

Secure, multi-tenant WhatsApp CRM platform allowing multiple businesses and their branches to manage employees, customer conversations, branch-specific WhatsApp accounts, and customer support workflows.

---

## 🛠 Tech Stack

- **Frontend**: React, Bootstrap (JavaScript)
- **Backend**: Node.js, Express.js
- **WhatsApp Engine**: Separate Node.js Connector Module (`@whiskeysockets/baileys`) with branch-level session isolation
- **Database & Auth**: Supabase PostgreSQL + Supabase Auth
- **Test Runner**: Node.js Native Test Runner (`node:test`, `node:assert`)

---

## 🚀 Quickstart & Verification

### 1. Install & Test
```bash
# Run tests across workspaces
npm test

# Or run server tests directly
npm run test --workspace=server
```

### 2. Run Phase 0 Feasibility Prototype
```bash
# Start server
npm run server
# Server listens on http://localhost:5000
```
Open [http://localhost:5000](http://localhost:5000) to test:
- Generating QR code per tenant/branch
- Disconnect & reconnect workflows
- Multi-branch session directory isolation
- Live message streaming via SSE

---

## 📁 Repository Structure

```
├── .env.example                     # Environment configuration template
├── package.json                     # Root monorepo workspace configuration
├── SPECIFICATION.md                 # Full 27-section product & architectural spec
├── server/
│   ├── package.json                 # Express backend dependencies & test scripts
│   ├── public/                      # Static prototype UI
│   │   └── index.html               # Phase 0 interactive feasibility UI (Bootstrap)
│   ├── src/
│   │   ├── app.js                   # Express application setup & middleware
│   │   ├── routes/
│   │   │   └── whatsapp.js          # REST & SSE endpoints for WhatsApp connector
│   │   └── whatsapp/
│   │       ├── connector-service.js # Singleton connector instance
│   │       └── session-manager.js   # Baileys session management & branch isolation
│   └── tests/
│       ├── api.test.js              # Express API integration tests
│       └── whatsapp-connector.test.js # Session isolation & deduplication tests
└── README.md                        # Documentation & Managed Change Ledger
```

---

## 📜 Managed Change Ledger & Rollback Guide

*This section is updated on every run to track added/removed files and features so that changes can be rolled back safely if needed.*

### Run 1 — Phase 0: WhatsApp Feasibility Prototype (2026-10-21) [Commit: `c0573db`]
- **Objective**: Validate WhatsApp Web multi-device connection, QR re-authentication, branch session isolation, deduplication, and test harness.
- **Status**: Completed & Verified (7/7 tests passing).
- **Added Files**:
  - `server/package.json` — Express, Baileys, QRCode, Pino, CORS dependencies.
  - `server/src/app.js` — Core Express application, CORS, static routes, health checks.
  - `server/src/routes/whatsapp.js` — Connect, disconnect, send, status, and SSE endpoints.
  - `server/src/whatsapp/session-manager.js` — Multi-device auth state manager isolated by `wa_sessions/<tenantId>/<branchId>`.
  - `server/src/whatsapp/connector-service.js` — Default session manager singleton export.
  - `server/public/index.html` — Interactive Phase 0 Bootstrap UI for QR scanning & chat testing.
  - `server/tests/whatsapp-connector.test.js` — Unit tests for session isolation and deduplication.
  - `server/tests/api.test.js` — Integration tests for Express API endpoints.
  - `.env.example` — Configuration template for server & Supabase keys.
  - `SPECIFICATION.md` — Extracted canonical requirements specification.
  - `README.md` — Project documentation and change ledger.
- **Modifications / Fixes**:
  - `server/src/whatsapp/session-manager.js`: Added `.unref()` to the deduplication cleanup interval timer so it does not block Node's test runner process.
- **Rollback Procedure**:
  - To clean up generated session data: `rm -r server/wa_sessions/`
  - To restore repository before this run: `git clean -fd` or remove `server/` directory.

### Run 2 — Phase 1: Authentication & Multi-Tenant Foundation (2026-10-21) [Commit: `6ffe157`]
- **Objective**: Implement Supabase schema migrations, Express authentication middleware, RBAC, tenant & branch management APIs, strict tenant isolation, automated auth tests, and React/Bootstrap frontend client.
- **Status**: Completed & Verified (12/12 tests passing, Vite frontend bundle built).
- **Added Files**:
  - `server/src/db/migrations/20261021_phase1_schema.sql` — Supabase PostgreSQL schema with RLS policies, tables (`tenants`, `branches`, `roles`, `permissions`, `role_permissions`, `users`, `feature_toggles`), and seed data.
  - `server/src/db/index.js` — Database service supporting Supabase client with local zero-config mock store fallback.
  - `server/src/middleware/auth.js` — Express auth middleware (`authenticate`, `requireRole`, `requirePermission`, `enforceTenantScope`).
  - `server/src/routes/auth.js` — `/api/auth/me` and `/api/auth/login`.
  - `server/src/routes/tenants.js` — Root Admin tenant CRUD routes.
  - `server/src/routes/branches.js` — Tenant-isolated branch CRUD routes.
  - `server/src/routes/users.js` — Tenant user management & role boundary validation routes.
  - `server/src/routes/roles.js` — System roles and permission matrix listing route.
  - `server/tests/auth-tenant.test.js` — Automated tests covering token authentication, role validation, cross-tenant boundary security, branch and user provisioning.
  - `client/package.json` — Frontend workspace dependencies (React, Bootstrap 5, Bootstrap Icons, Vite).
  - `client/vite.config.js` — Vite configuration with port 3000 and `/api` proxy to port 5000.
  - `client/index.html` — HTML5 entry template.
  - `client/src/main.jsx` — React root bootstrap with Bootstrap styles.
  - `client/src/App.jsx` — Router shell switching between Login and Dashboard.
  - `client/src/context/AuthContext.jsx` — Authentication state, token persistence, role/permission checkers.
  - `client/src/pages/Login.jsx` — Responsive Bootstrap login screen with one-click persona switcher for evaluation.
  - `client/src/pages/Dashboard.jsx` — Multi-tenant management shell (Branches, Users, Roles, WhatsApp channels).
- **Modifications**:
  - `package.json`: Added `client` (`npm run dev --workspace=client`) and `client:build` workspace scripts.
  - `server/src/app.js`: Mounted `/api/auth`, `/api/tenants`, `/api/branches`, `/api/users`, and `/api/roles` routes.
- **Rollback Procedure**:
  - To revert to Phase 0 baseline: `git reset --hard c0573db && git clean -fd`

### Run 3 — M Square Professionals UI & Helpdesk Integration (2026-10-21)
- **Objective**: Integrate exact design system, branding, color tokens, typography, and 3-column helpdesk layout from [M Square Professionals — WhatsApp Helpdesk](https://msquarehelpdesk.netlify.app/).
- **Status**: Completed & Verified (12/12 tests passing, Vite frontend bundle built).
- **Added Files**:
  - `client/src/msquare-theme.css` — Complete M Square Professionals design system with `--bg-primary` (`#0c0c10`), `--brand-orange` (`#ff6b00`), `.msquare-logo-badge` (M²), `.msquare-brand-stacked`, `.msquare-navbar`, `.btn-msquare-primary`, `.btn-msquare-outline`, chat bubbles, and dual dark/light theme tokens.
  - `client/public/favicon.svg` — M² orange badge vector favicon.
- **Modifications**:
  - `client/index.html`: Added Google Fonts (`Plus Jakarta Sans` & `JetBrains Mono`), dark theme initialization, and M² brand title.
  - `client/src/main.jsx`: Imported `msquare-theme.css`.
  - `client/src/pages/Login.jsx`: Redesigned with M² logo, dark card theme, and M Square team personas (`Aarav Sharma`, `Diya Patel`, `Vikram Mehta`, `System Super Admin`).
  - `client/src/pages/Dashboard.jsx`: Replaced basic shell with full 3-column M Square WhatsApp Helpdesk (Conversation List Pane, Active Chat Thread with WhatsApp message dispatch & quick replies, Customer CRM Context Panel with tags & notes, and Branch/Channel operations).
  - `server/src/db/index.js`: Seeded M Square Professionals tenant (`11111111-1111-4000-8000-000000000001`), branches (`Greater Noida Hub`, `Noida HQ`, `Jaipur Hub`), and team members.
- **Rollback Procedure**:
  - To revert to Phase 1 baseline: `git reset --hard 6ffe157 && git clean -fd`

---

### How to Rollback If Stuck

1. **Check Current Status**:
   ```bash
   git status
   ```
2. **Revert Uncommitted File Modifications**:
   ```bash
   git checkout -- <file-path>
   ```
3. **Remove Newly Added Untracked Files**:
   ```bash
   git clean -fd
   ```
4. **Discard Specific Folder Changes**:
   ```bash
   git checkout HEAD -- <directory-path>
   ```
