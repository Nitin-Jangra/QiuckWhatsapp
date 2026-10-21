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
