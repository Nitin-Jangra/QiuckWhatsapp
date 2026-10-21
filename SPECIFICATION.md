# Multi-Tenant WhatsApp CRM and Branch Management Platform
## Complete Software Requirements and Development Specification

**Version:** 1.1  
**Project type:** Multi-tenant web application  
**Development status:** Ready for phased implementation  
**Primary objective:** Build a secure CRM that allows multiple businesses and their branches to manage employees, customer conversations, WhatsApp accounts, and support workflows from a centralized platform.

---

# 1. Technology Stack

The application must use the following technologies.

| Layer | Technology |
|---|---|
| Frontend | React |
| UI and responsive design | Bootstrap |
| Frontend language | JavaScript |
| Backend runtime | Node.js |
| Backend framework | Express.js |
| Database | Supabase PostgreSQL |
| Authentication | Supabase Auth, integrated with Express |
| API | Express REST APIs |
| WhatsApp integration | Separate Node.js connector module |
| Version control | Git and GitHub |

Do not replace these technologies with Next.js, NestJS, TypeScript, MySQL, or another framework without explicit approval.

## 1.1 Frontend architecture

Use React and JavaScript to build a responsive CRM interface.

Use Bootstrap for:

- Navigation.
- Forms.
- Tables.
- Modals.
- Dropdowns.
- Alerts.
- Responsive layouts.
- Dashboard cards.
- Status indicators.

Use reusable React components for:

- Login.
- Root Admin dashboard.
- Tenant dashboard.
- Branch dashboard.
- Shared inbox.
- Conversation details.
- Customer profile.
- WhatsApp connection panel.
- User management.
- Permission management.
- Reports.

The frontend must not contain privileged database credentials or WhatsApp session secrets.

## 1.2 Backend architecture

Use Node.js and Express.js for the backend.

Express must handle:

- API requests.
- Authentication verification.
- Role and permission validation.
- Tenant and branch isolation.
- Conversation assignment.
- Message processing.
- WhatsApp connector communication.
- Notifications.
- Audit logging.
- Input validation.
- Error handling.

The backend must be the authority for permissions. Hiding buttons in React is not sufficient.

## 1.3 Supabase PostgreSQL

Use Supabase PostgreSQL as the primary database.

Store:

- Tenants.
- Branches.
- Users and roles.
- Permission configurations.
- WhatsApp account metadata.
- Customers.
- Conversations.
- Messages.
- Conversation assignments.
- Internal notes.
- Audit logs.

Use database migrations, foreign keys, indexes, and transactions as appropriate.

Use Supabase Auth for user authentication unless a different authentication design is explicitly approved.

Express must validate the user's authentication token and independently enforce application-level permissions.

**Important:** Supabase's service-role key must remain on the server. Never expose it in React, browser storage, public repositories, or frontend environment variables.

---

# 2. Project Overview

Develop a web-based CRM platform that allows a Root Administrator to manage multiple tenants, their branches, employees, permissions, and WhatsApp account integrations.

Each tenant must operate independently.

The platform must support:

- Root Admin management.
- Multiple tenants and branches.
- Secure login.
- Role-based permissions.
- Feature-level access controls.
- Branch-specific WhatsApp connections.
- QR-based WhatsApp authentication and re-authentication where supported.
- Shared WhatsApp inbox.
- Conversation assignment and transfer.
- Conversation status management.
- Customer profiles and conversation history.
- Internal notes.
- Notifications.
- Reporting.
- Audit logs.
- Secure deployment and recovery.

The application must be developed as a maintainable product with a modular React frontend, Express backend, and PostgreSQL database.

---

# 3. WhatsApp Integration Decision

Before implementing the WhatsApp integration, validate which integration method will be used.

## 3.1 WhatsApp Web-based connector

If using WhatsApp Web automation:

- Branch users may need to scan a QR code.
- Sessions may expire or disconnect.
- The connector must support reconnection where technically possible.
- Session persistence must be tested.
- The integration may be fragile and subject to WhatsApp changes.
- Account restrictions or disconnections are possible.
- Message synchronization and supported features must be documented.

The WhatsApp connector must be isolated from the main Express CRM logic.

## 3.2 Official WhatsApp Business Platform

If using the official WhatsApp Business Platform:

- Use its supported account onboarding and authorization process.
- Do not assume WhatsApp Web QR login is available.
- Evaluate supported messaging, delivery status, and calling capabilities separately.
- Document account requirements, limitations, and costs.

**The development team must not promise QR reconnection for a connector that does not support it.**

The integration decision must be documented and approved before full WhatsApp development.

---

# 4. User Roles

The application must support the following hierarchy:

Root Administrator  
→ Tenant  
→ Branch  
→ Employees

## 4.1 Root Administrator

Root Admin is the platform administrator.

Root Admin must be able to:

- Create, edit, suspend, and reactivate tenants.
- Manage branches across all tenants.
- Create, edit, suspend, and reactivate users.
- Assign users to tenants and branches.
- Manage roles and permissions.
- Enable or disable features for tenants and branches.
- Configure role-level permissions.
- Configure permitted user-level overrides.
- View platform-level WhatsApp connection health.
- View platform-level audit logs.
- Manage tenant and branch limits.
- Revoke user access.
- Access tenant data only through authorized administrative workflows.

Root Admin must be initialized securely.

Do not hardcode production passwords in the source code or automatically expose a default production account.

## 4.2 Tenant Administrator

Tenant Admin manages a single business.

Tenant Admin must be able to:

- View their own tenant.
- Create and manage branches within platform limits.
- Create and manage employees.
- Assign employees to branches.
- Manage roles within Root Admin restrictions.
- Manage WhatsApp connections for authorized branches.
- View conversations within their authorized tenant.
- Assign or transfer conversations.
- View tenant reports.
- Manage permitted tenant settings.

Tenant Admin must not access another tenant's records.

## 4.3 Branch Administrator

Branch Admin manages an assigned branch.

Branch Admin must be able to:

- View the branch dashboard.
- Manage employees within permitted scope.
- Connect or reconnect the branch WhatsApp account.
- View branch conversations.
- Assign conversations to eligible employees.
- Transfer conversations within authorized scope.
- View branch reports.
- Manage permitted branch settings.

Branch Admin must not access other branches without explicit permission.

## 4.4 Agent / Employee

Agent is the operational CRM user.

Agent must be able to:

- Log in.
- View assigned conversations.
- View unassigned conversations if permitted.
- Reply to customers.
- Change conversation status where permitted.
- Add internal notes.
- View relevant customer information.
- Transfer conversations if permitted.
- Receive assignment and message notifications.

Agents must not manage tenant settings or WhatsApp credentials by default.

## 4.5 Custom Roles

Authorized administrators must be able to create custom roles, such as:

- Sales Agent.
- Customer Support Agent.
- Branch Manager.
- Supervisor.
- Read-Only Analyst.

Each role must have configurable feature and action permissions.

---

# 5. Authentication and Login

**Requirement ID: FR-AUTH-01**

Every user must authenticate before accessing CRM functionality.

Use Supabase Auth for:

- User authentication.
- Login and logout.
- Password recovery.
- Session management.

Express must verify authentication tokens before processing protected API requests.

### Login requirements

- Provide a responsive React login page.
- Support email and password authentication.
- Require a valid user account.
- Support logout.
- Support password recovery.
- Support account suspension.
- Protect against brute-force login attempts.
- Enforce session expiration and revocation where applicable.
- Record successful and failed login events.
- Redirect users to dashboards according to their permissions.

### User provisioning

Root Admin or authorized Tenant Admin must be able to create or invite users.

The application must associate each user with:

- Tenant.
- Branch or branches.
- Role.
- Account status.
- Permissions.

Do not allow users to choose or modify their own tenant or administrative role through ordinary registration.

### First Root Admin

Provide a secure initialization procedure for creating the first Root Admin account.

Do not automatically expose a publicly accessible default Root Admin account.

---

# 6. Multi-Tenant Management

**Requirement ID: FR-TENANT-01**

The platform must support multiple independent tenants.

Each tenant must have:

- Tenant ID.
- Business name.
- Status.
- Tenant administrator.
- Allowed branch count.
- Allowed user count.
- Enabled features.
- Creation timestamp.
- Modification timestamp.

### Tenant status

Support:

- Active.
- Suspended.
- Archived.

Suspended tenants must not be able to use the CRM normally.

### Tenant isolation

Every tenant-owned record must be associated with a tenant ID or have a validated relationship to a tenant-owned parent record.

The Express backend must verify tenant ownership for every protected request.

A user from Tenant 1 must not access Tenant 2 by changing:

- API request IDs.
- URL parameters.
- Customer IDs.
- Conversation IDs.
- Branch IDs.
- WhatsApp account IDs.

Implement database-level safeguards where appropriate, including Supabase PostgreSQL Row-Level Security.

The application must never rely exclusively on React-side filtering for security.

---

# 7. Branch Management

**Requirement ID: FR-BRANCH-01**

Each tenant must support multiple branches.

Each branch must have:

- Branch ID.
- Tenant ID.
- Branch name.
- Branch code.
- Address, if required.
- Branch status.
- Branch administrator.
- Associated WhatsApp account.
- Employee list.
- Creation timestamp.

Authorized users must be able to:

- Create branches.
- Edit branch details.
- Activate branches.
- Suspend branches.
- Assign employees.
- Configure branch-specific features.
- Configure branch WhatsApp accounts.

Suspending a branch must revoke ordinary branch access but preserve historical conversations and audit records.

Suspending a branch must not automatically delete WhatsApp sessions or customer records.

---

# 8. Feature Toggles and Permissions

**Requirement ID: FR-PERM-01**

Every major feature must support configurable access.

Root Admin must be able to control feature availability at:

1. Platform level.
2. Tenant level.
3. Branch level, where applicable.
4. Role level.
5. Individual user level, where permitted.

### Features

- WhatsApp integration.
- Shared inbox.
- Customer management.
- Conversation assignment.
- Conversation transfer.
- Internal notes.
- Notifications.
- Reports.
- User management.
- Branch management.
- Conversation status management.
- WhatsApp account management.

### Permission evaluation

For every protected request, Express must verify:

- User authentication.
- Account status.
- Tenant status.
- Branch status.
- Tenant ownership.
- Branch membership.
- Feature availability.
- Role permission.
- User-level permission overrides, if allowed.

Disabled features must be blocked by the backend.

Disabling a feature must not delete its existing data.

---

# 9. WhatsApp Account Connection and QR Re-Authentication

**Requirement ID: FR-WA-LOGIN-01**

Every branch must have the ability to connect or re-authenticate its own WhatsApp account using the supported connector authentication process.

For a WhatsApp Web-based connector, this must include QR login and reconnection.

## 9.1 Branch-level connection

Each branch must have its own WhatsApp connection panel.

Authorized Branch Admin or Tenant Admin users must be able to:

- Connect an account.
- Scan a QR code from the branch's mobile WhatsApp account.
- View connection status.
- Reconnect an expired session.
- Disconnect an account.
- View connection errors.
- Retry authentication.

Each connection must be associated with the correct tenant, branch, WhatsApp account, and connector session.

## 9.2 Session expiration

When a WhatsApp session expires or requires re-authentication:

1. The connector detects disconnection where supported.
2. The CRM marks the account as `Disconnected` or `Re-authentication Required`.
3. The authorized branch user selects `Reconnect WhatsApp`.
4. The connector generates a fresh QR code.
5. The React interface displays the QR code and scanning instructions.
6. The branch user scans the QR code from the correct WhatsApp mobile account.
7. The connector confirms authentication.
8. The CRM changes the connection status to `Connected`.
9. Supported message synchronization resumes.

If a QR code expires, the user must be able to generate a fresh one.

If authentication fails, display a useful error and allow retry.

Ordinary reconnection must not require a developer to modify database records or server files.

## 9.3 Connection dashboard

Display:

- Connection status.
- WhatsApp phone number, where available.
- Tenant and branch.
- Last successful connection.
- Last synchronization time.
- Connection error.
- Connect or reconnect action.
- Disconnect action.
- QR code while authentication is pending.

Only authorized users may access the QR code or connection controls.

## 9.4 Session isolation and security

- Every branch must have an independent WhatsApp session.
- Reconnecting one branch must not disconnect another.
- Session expiration in one branch must not interrupt other branches.
- Session credentials must be stored securely on the server.
- Never expose session credentials through Express APIs.
- Never commit session files or tokens to GitHub.
- Do not log QR secrets or authentication tokens.
- Session restoration must be attempted after connector restart where supported.
- If restoration fails, show the re-authentication workflow.

---

# 10. Shared WhatsApp Inbox

**Requirement ID: FR-INBOX-01**

Create a shared inbox for authorized employees.

Display:

- Customer name.
- Customer phone number.
- Last message.
- Last message timestamp.
- Assigned agent.
- Conversation status.
- Branch.
- WhatsApp account.
- Unread count.

### Filters

- Assigned to me.
- Unassigned.
- Assigned employee.
- Status.
- Branch.
- WhatsApp account.
- Date range.
- Customer name or phone number.

Users must see only conversations within their authorized tenant and branch scope.

Conversations should be ordered by most recent activity by default.

When a new message arrives, update the inbox ordering and unread count.

---

# 11. Conversation Assignment and Transfer

**Requirement ID: FR-CHAT-01**

Every conversation must support assignment to an eligible employee.

### Rules

- A conversation can have one primary assigned agent at a time.
- A conversation may be unassigned.
- Assignment must be limited to employees belonging to the same tenant.
- Cross-branch assignment requires permission.
- Inactive or suspended employees cannot receive assignments.
- Assignment changes must be recorded.

### Actions

Authorized users must be able to:

- Assign an unassigned conversation.
- Reassign a conversation.
- Transfer a conversation.
- Unassign a conversation.

### Transfer workflow

1. Select an eligible employee.
2. Optionally enter a transfer reason.
3. Confirm the transfer.
4. Update the assigned agent.
5. Record the previous and new agent.
6. Notify the new agent where enabled.

Assignment updates must be atomic so simultaneous requests cannot result in multiple primary agents.

---

# 12. Conversation Status Management

**Requirement ID: FR-CHAT-02**

Support these conversation statuses:

| Status | Description |
|---|---|
| New | Newly created conversation |
| In Progress | Employee actively handling the conversation |
| On Hold | Conversation temporarily waiting |
| Qualified | Customer meets defined qualification criteria |
| Not Interested | Customer declined or is unsuitable |
| Resolved | Conversation completed |

### Status rules

- Status changes require permission.
- On Hold requires a reason.
- On Hold may optionally have a follow-up date and time.
- Qualified and Not Interested may include notes.
- Resolved conversations remain accessible in history.
- Authorized users may reopen resolved conversations.
- Every status change must be recorded.

The status history must include previous status, new status, user, timestamp, and reason where applicable.

---

# 13. Customer Management

**Requirement ID: FR-CUSTOMER-01**

Create a customer profile for each WhatsApp customer.

Customer fields:

- Customer ID.
- Tenant ID.
- Name, where available.
- Phone number.
- Associated branches.
- Conversation history.
- Assigned employee, where relevant.
- Tags.
- Internal notes.
- Creation timestamp.
- Last interaction timestamp.

### Requirements

- Create customer records when new conversations arrive, where supported.
- Avoid duplicate customers for the same normalized phone number within a tenant.
- Never merge customers across tenants.
- Allow authorized users to update customer information.
- Support search by name or phone number.
- Preserve conversation history when customer details change.

---

# 14. Internal Notes

**Requirement ID: FR-NOTES-01**

Authorized users must be able to add internal notes to conversations.

Internal notes must:

- Be visible only to authorized CRM users.
- Never be sent to customers.
- Include author and timestamp.
- Support basic text.
- Remain in conversation history.
- Respect tenant and branch permissions.

React must visually distinguish internal notes from WhatsApp messages.

---

# 15. Message Synchronization

**Requirement ID: FR-MSG-01**

The WhatsApp connector must receive and send supported messages and synchronize them with the CRM.

## Incoming messages

When a message arrives:

1. Identify the WhatsApp account.
2. Identify tenant and branch.
3. Identify the customer.
4. Find or create the conversation.
5. Save the message.
6. Update last activity.
7. Update unread count.
8. Notify appropriate employees.

## Outgoing messages

When an employee sends a message:

1. Validate authentication.
2. Validate permissions.
3. Validate conversation ownership.
4. Validate WhatsApp account ownership.
5. Submit the message through the connector.
6. Save the message and connector identifier.
7. Update delivery status where available.

## Duplicate prevention

Prevent duplicate message creation during:

- Connector retries.
- Duplicate events.
- Session reconnection.
- Application restarts.

Use connector message IDs or idempotency keys.

## Message status

Where supported, track:

- Pending.
- Sent.
- Delivered.
- Read.
- Failed.

Do not invent delivery statuses that the connector cannot provide.

---

# 16. Notifications

**Requirement ID: FR-NOTIFY-01**

Provide in-app notifications for:

- New conversations.
- Incoming customer messages.
- Conversation assignments.
- Conversation transfers.
- On Hold conversations.
- Follow-up due dates.
- WhatsApp disconnections.
- WhatsApp re-authentication requirements.

Notifications must respect tenant and branch permissions.

Additional notification channels may be added later.

---

# 17. Reporting and Dashboards

**Requirement ID: FR-REPORT-01**

## Root Admin dashboard

Show:

- Total tenants.
- Active and suspended tenants.
- Total branches.
- Active users.
- Connected WhatsApp accounts.
- Disconnected WhatsApp accounts.
- Integration errors.
- Tenant activity overview.

## Tenant Admin dashboard

Show:

- Total conversations.
- New conversations.
- In-progress conversations.
- On-hold conversations.
- Qualified conversations.
- Not Interested conversations.
- Resolved conversations.
- Conversations by branch.
- Conversations by employee.
- WhatsApp connection status.

## Branch dashboard

Show:

- Branch conversation counts.
- Unassigned conversations.
- Assigned conversations.
- Conversation status distribution.
- Employee workload.
- WhatsApp connection status.

Reports must be scoped to authorized tenant and branch records.

---

# 18. Audit Logs

**Requirement ID: FR-AUDIT-01**

Maintain audit logs for:

- Login and logout.
- Failed login attempts.
- Tenant creation and suspension.
- Branch creation and suspension.
- User creation and suspension.
- Permission changes.
- Feature enablement and disablement.
- WhatsApp connection and disconnection.
- QR authentication attempts and results.
- Conversation assignment and transfer.
- Status changes.
- Customer updates.
- Administrative access to tenant data.

Each audit event must include:

- Event ID.
- Tenant ID, where applicable.
- Branch ID, where applicable.
- User ID.
- Action.
- Target record.
- Timestamp.
- Success or failure.
- Relevant metadata.

Never store passwords, QR secrets, or authentication tokens in audit logs.

---

# 19. Database Design

Use Supabase PostgreSQL.

Recommended tables:

| Table | Purpose |
|---|---|
| tenants | Business records |
| branches | Branch records |
| profiles | Application user profile linked to Supabase Auth |
| roles | Role definitions |
| permissions | Permission definitions |
| role_permissions | Role permissions |
| user_permission_overrides | Individual overrides |
| tenant_features | Tenant feature configuration |
| branch_features | Branch feature configuration |
| whatsapp_accounts | WhatsApp account metadata |
| whatsapp_sessions | Connector session metadata |
| customers | Customer profiles |
| conversations | Conversation records |
| conversation_assignments | Assignment history |
| messages | Incoming and outgoing messages |
| conversation_events | Status and activity history |
| internal_notes | CRM-only notes |
| notifications | User notifications |
| audit_logs | Security and administrative events |

### Database requirements

- Use UUID primary keys where appropriate.
- Use foreign keys.
- Include tenant ownership.
- Validate branch ownership.
- Use appropriate indexes.
- Use transactions for assignment and status changes.
- Use idempotency mechanisms for messages.
- Preserve historical conversations.
- Implement appropriate retention policies.

### Supabase security

Configure PostgreSQL Row-Level Security where appropriate.

Express must validate tenant ownership and permissions before performing protected operations.

Do not expose unrestricted database access to the frontend.

If the frontend accesses Supabase directly for any feature, that access must have appropriate RLS policies and must not bypass application permissions.

---

# 20. Express API Requirements

Create REST APIs in Express.

## Authentication

- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/password-reset`

Supabase Auth should handle the underlying login and password recovery flows.

## Tenants and branches

- `GET /api/tenants`
- `POST /api/tenants`
- `GET /api/tenants/:tenantId`
- `PATCH /api/tenants/:tenantId`
- `GET /api/tenants/:tenantId/branches`
- `POST /api/tenants/:tenantId/branches`
- `PATCH /api/branches/:branchId`

## Users and permissions

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:userId`
- `GET /api/roles`
- `POST /api/roles`
- `PATCH /api/roles/:roleId`
- `GET /api/permissions`
- `PATCH /api/roles/:roleId/permissions`

## WhatsApp connections

- `GET /api/branches/:branchId/whatsapp`
- `POST /api/branches/:branchId/whatsapp/connect`
- `GET /api/branches/:branchId/whatsapp/connection-status`
- `POST /api/branches/:branchId/whatsapp/reconnect`
- `POST /api/branches/:branchId/whatsapp/disconnect`

Connection endpoints must validate the user's branch permissions.

Raw WhatsApp session credentials must never be returned to the frontend.

## Conversations

- `GET /api/conversations`
- `GET /api/conversations/:conversationId`
- `POST /api/conversations/:conversationId/assign`
- `POST /api/conversations/:conversationId/transfer`
- `PATCH /api/conversations/:conversationId/status`
- `GET /api/conversations/:conversationId/messages`
- `POST /api/conversations/:conversationId/messages`
- `POST /api/conversations/:conversationId/notes`

These endpoints may be adjusted during implementation, but their functional and security requirements must remain.

---

# 21. React and Bootstrap UI

Build a responsive application with the following navigation:

- Dashboard.
- Inbox.
- Customers.
- Branches.
- Employees.
- WhatsApp Accounts.
- Reports.
- Settings.
- Audit Logs, where permitted.

## Shared inbox

The inbox must contain:

1. Conversation list.
2. Conversation details.
3. Message history.
4. Customer information.
5. Assignment and transfer controls.
6. Status controls.
7. Internal notes.
8. Branch and WhatsApp account details.

## WhatsApp connection page

Display:

- Connection status.
- Account details.
- Connect or reconnect action.
- QR code during authentication.
- QR refresh option when expired.
- Scanning instructions.
- Connection errors.
- Last successful connection.

Do not expose QR codes to unauthorized agents.

---

# 22. Recommended Project Structure

Use a modular folder structure.

```text
whatsapp-crm/
│
├── client/
│   ├── public/
│   └── src/
│       ├── assets/
│       ├── components/
│       │   ├── common/
│       │   ├── inbox/
│       │   ├── whatsapp/
│       │   └── dashboard/
│       ├── pages/
│       │   ├── auth/
│       │   ├── root/
│       │   ├── tenant/
│       │   ├── branch/
│       │   ├── inbox/
│       │   └── customers/
│       ├── services/
│       ├── hooks/
│       ├── context/
│       ├── utils/
│       ├── App.js
│       └── index.js
│
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── permissions/
│   │   ├── whatsapp/
│   │   ├── jobs/
│   │   ├── utils/
│   │   └── app.js
│   └── migrations/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── .env.example
├── .gitignore
└── README.md
```

This is a recommended structure. Adapt it if the repository already has a suitable architecture.

---

# 23. Development Roadmap

Complete the application in phases.

## Phase 0 — WhatsApp Feasibility

Build a prototype with:

- One tenant.
- One branch.
- One WhatsApp account.
- One administrator.
- Two agents.

Validate:

- QR login, if supported.
- Incoming messages.
- Outgoing messages.
- Session persistence.
- Session expiration.
- Reconnection.
- Mobile WhatsApp behavior.
- Duplicate messages.
- Connector recovery.

Deliverables:

- Integration decision.
- Working prototype.
- Documented limitations.
- Test results.

## Phase 1 — Authentication and Tenant Foundation

Build:

- React login.
- Supabase Auth integration.
- Express authentication middleware.
- Root Admin initialization.
- Tenant management.
- Branch management.
- User management.
- Roles and permissions.
- Tenant and branch isolation.
- Feature toggle foundation.

Test authentication and security before continuing.

## Phase 2 — WhatsApp Connector

Build:

- Branch-specific account records.
- Connector service.
- Connection status.
- QR login where supported.
- Re-authentication.
- Session persistence.
- Connector restart recovery.
- Incoming and outgoing messaging.
- Message deduplication.

Test two separate branches with two separate WhatsApp accounts.

## Phase 3 — Inbox and Conversations

Build:

- Shared inbox.
- Customer profiles.
- Conversation assignment.
- Conversation transfer.
- Status management.
- Internal notes.
- Search and filters.
- Conversation history.

Test assignment, permissions, status transitions, and tenant isolation.

## Phase 4 — Administration and Audit

Build:

- Root feature controls.
- Tenant settings.
- Branch settings.
- Role permissions.
- User overrides.
- Audit logs.
- Tenant limits.

Test backend enforcement and unauthorized access.

## Phase 5 — Notifications and Reliability

Build:

- In-app notifications.
- Employee workload dashboard.
- Branch reports.
- Tenant reports.
- Connector monitoring.
- Retry processing.
- Background jobs.
- Error recovery.

Test notifications, retries, connector restarts, and reporting scope.

## Phase 6 — Deployment and Pilot

Deploy to a secure environment.

Configure:

- Supabase PostgreSQL.
- Supabase Auth.
- Express server.
- React frontend.
- HTTPS.
- Persistent connector session storage.
- Secure secrets.
- Backups.
- Monitoring.

Pilot with:

- Tenant 1.
- Two branches.
- Separate WhatsApp accounts.
- Tenant Admin.
- Branch Admins.
- Agents.

Validate the full workflow from connection through customer conversation management and session reconnection.

## Phase 7 — Multi-Tenant Expansion

After pilot acceptance:

- Add more tenants.
- Add more branches.
- Increase connector capacity.
- Improve reporting.
- Optimize PostgreSQL queries.
- Improve tenant configuration.
- Add supported WhatsApp features.

---

# 24. Testing Requirements

## Unit tests

Test:

- Permission evaluation.
- Tenant ownership.
- Branch ownership.
- Feature toggles.
- Status transitions.
- Assignment rules.
- Message deduplication.

## Integration tests

Test:

- Supabase Auth with Express.
- PostgreSQL persistence.
- WhatsApp connector events.
- Conversation creation.
- Message sending.
- Branch reconnection.
- Session recovery.
- Notifications.

## End-to-end tests

Test the complete workflow:

1. Root Admin creates a tenant.
2. Tenant Admin creates branches.
3. Branch Admin connects WhatsApp.
4. Agent receives a message.
5. Agent replies.
6. Conversation is assigned or transferred.
7. Agent changes status.
8. WhatsApp session expires.
9. Branch Admin reconnects using a fresh QR code where supported.
10. Conversation history remains intact.

## Security tests

Verify:

- Tenant 1 cannot access Tenant 2.
- Branch 1 cannot access Branch 2 without permission.
- Agent cannot access administrative APIs.
- Unauthorized users cannot access QR codes.
- Suspended users cannot use protected APIs.
- Disabled features cannot be accessed directly.
- Users cannot send messages through another branch's WhatsApp account.
- Session credentials are not exposed.

---

# 25. Deployment and Security

The production environment must include:

- HTTPS.
- Supabase Auth.
- Secure Express middleware.
- Backend permission enforcement.
- Environment-based configuration.
- Secure secrets management.
- PostgreSQL backups.
- Persistent WhatsApp session storage.
- Error monitoring.
- Audit logging.
- Rate limiting.
- Input validation.
- Secure CORS configuration.
- Dependency updates.
- Recovery documentation.

Do not commit production credentials or WhatsApp session files to GitHub.

Do not expose the Supabase service-role key to the React frontend.

Do not use real customer WhatsApp data in development without appropriate authorization and protection.

---

# 26. Definition of Done

The initial pilot is complete only when:

- Root Admin can manage tenants and branches.
- Tenant Admin can manage only their own tenant.
- Branch users access only authorized branches.
- Users authenticate before accessing the CRM.
- Permissions are enforced by Express.
- Supabase PostgreSQL stores CRM records correctly.
- WhatsApp accounts connect through the supported integration.
- Branches can independently re-authenticate expired sessions using QR where supported.
- Reconnecting one branch does not disconnect another.
- Messages appear in the correct branch inbox.
- Authorized employees can send supported messages.
- Agents can assign, transfer, and update conversation status.
- Internal notes are not sent to customers.
- Conversation history is preserved.
- Duplicate messages are prevented.
- Tenant isolation tests pass.
- Deployment, backup, and recovery procedures are documented.
- WhatsApp limitations are documented.

---

# 27. Instructions for the AI Development Agent

Act as the lead software architect and senior full-stack developer responsible for implementing this application.

Your task is to develop the CRM using:

- React.
- Bootstrap.
- JavaScript.
- Node.js.
- Express.
- Supabase PostgreSQL.
- Supabase Auth.

## Development process

1. Inspect the existing repository before making changes.
2. Identify the existing architecture, code, database, and environment configuration.
3. Determine which requirements are already implemented.
4. Create a phase-by-phase implementation plan.
5. Preserve working functionality.
6. Implement one complete phase at a time.
7. Run tests after every meaningful change.
8. Fix errors before proceeding.
9. Update the README and `.env.example`.
10. Maintain a record of completed and pending tasks.
11. Never claim implementation is complete without testing.
12. Never bypass security requirements to make the application appear functional.

## Development constraints

- Use JavaScript as the primary application language.
- Use React and Bootstrap for the frontend.
- Use Express for backend APIs.
- Use Supabase PostgreSQL for CRM data.
- Use Supabase Auth for authentication.
- Keep the WhatsApp connector isolated.
- Use database migrations.
- Do not hardcode production credentials.
- Do not commit WhatsApp session files.
- Do not simulate successful WhatsApp authentication in production.
- Do not silently ignore test failures.
- Document features that cannot be implemented because of connector limitations.

## Phase completion report

After each phase, provide:

- Implemented functionality.
- Files changed.
- Database changes.
- Tests executed.
- Test results.
- Known limitations.
- Remaining tasks.
- Instructions for running locally.

## Final deliverables

The finished application must include:

1. React and Bootstrap frontend.
2. Express backend.
3. Supabase PostgreSQL schema and migrations.
4. Supabase Auth integration.
5. WhatsApp connector.
6. Branch-specific connection and re-authentication.
7. Tenant and branch management.
8. Role and permission management.
9. Shared inbox.
10. Conversation assignment and status management.
11. Customer management.
12. Audit logs.
13. Automated tests.
14. `.env.example`.
15. Installation guide.
16. Local development guide.
17. Production deployment guide.
18. Database backup and recovery guide.
19. WhatsApp connection and reconnection guide.
20. Troubleshooting documentation.

**Start with Phase 0. Validate the WhatsApp connector and branch-level QR reconnection before building the full CRM. Then implement the secure tenant foundation and proceed phase by phase until all acceptance criteria are satisfied.**