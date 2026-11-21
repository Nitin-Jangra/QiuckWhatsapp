# QuickWhatsApp Deployment Guide

This package is a self-contained, multi-tenant, multi-user WhatsApp Web CRM and team inbox. The recommended production target is a single VPS (for example Hostinger VPS). Cloudflare is optional.

---

## Quick Start (Run Locally or on a Server)

### 1. Extract the ZIP
Unzip the archive to any directory on your computer or server.

### 2. Install Dependencies
In the root directory, run:
```bash
npm install
```

### 3. Check `.env` Configuration
The included `.env` file is pre-configured with recommended defaults:
```env
PORT=5000
NODE_ENV=production
CORS_ORIGIN=*
WA_SESSION_PATH=./server/wa_sessions
```

### 4. Build & Start
```bash
npm run build
npm start
```
Open **`http://localhost:5000`** in your browser.
The backend serves both the full React dashboard UI and the WhatsApp connector on the same port!

---

## Output Directories for Hosting Platforms

Different platforms expect different output directories. The build script automatically mirrors the compiled files into all three common directories:
- **`build/`** (used by Hostinger, AWS Amplify, default React presets)
- **`dist/`** (used by standard static site hosts)
- **`client/dist/`** (used by Cloudflare Workers & Pages)

So whichever output directory your platform is configured for, it will succeed!

---

## Hostinger Node.js hosting (hPanel "Node.js" web app)

The ZIP is preconfigured for this plan: SQLite database, data stored in `~/wacrm-data` outside the app folder, sign-in required.

1. In hPanel open **Node.js**, then **Settings**, and select **Node.js 22** or newer. On Node 20 the app cannot start, and you get a 503 page.
2. Upload `QuickWhatsApp-deployable.zip`. Keep the detected defaults: build command `npm run build`, entry file `index.js`.
3. Open the site and sign in as `admin` with `ADMIN_PASSWORD` from `.env`, then change the password.
4. Registration codes appear in **hPanel > Node.js > Logs** until an SMS provider is connected.

Limits of this plan: there is no PostgreSQL, and the process may be restarted or put to sleep, which disconnects WhatsApp until it reconnects. For PostgreSQL, either point `DATABASE_URL` at a hosted PostgreSQL (Neon, Supabase and similar, with `DATABASE_SSL=true`) or use a VPS (below).

## Recommended: Complete Hostinger VPS Deployment (no Cloudflare required)

The whole app (React UI, Express API, WhatsApp engine and media) runs as **one persistent Node process** behind Nginx on one domain, with **PostgreSQL** as the database. SQLite remains available for local development and small installs. Do not use shared or managed "Node.js hosting" plans that stop idle processes, because Baileys needs a process that stays running. Use a VPS.

### 1. Server setup (Ubuntu 22.04/24.04)
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx postgresql
sudo npm install -g pm2
sudo adduser --system --group wacrm && sudo mkdir -p /var/lib/wacrm && sudo chown wacrm:wacrm /var/lib/wacrm
```
Node 24.7+ is recommended because it provides native Argon2id password hashing. Node 22.5+ still works and falls back to scrypt.

Create the database and a dedicated user (use a long random password):
```bash
sudo -u postgres psql -c "CREATE USER wacrm WITH PASSWORD 'change-me'"
sudo -u postgres psql -c "CREATE DATABASE quickwhatsapp OWNER wacrm"
```
The app creates its tables on first start. A managed PostgreSQL (Hostinger, Neon, Supabase, RDS and similar) works the same way: point `DATABASE_URL` at it and set `DATABASE_SSL=true` if the provider requires TLS.

### 2. App install

**From `QuickWhatsApp-deployable.zip`** (includes a ready production `.env` and the built frontend). Upload it with hPanel's File Manager or `scp`, then:
```bash
sudo apt install -y unzip
sudo mkdir -p /opt/wacrm && sudo unzip -o QuickWhatsApp-deployable.zip -d /opt/wacrm && sudo chown -R wacrm:wacrm /opt/wacrm
cd /opt/wacrm
sudo chmod 600 .env
bash scripts/setup-postgres.sh          # creates the PostgreSQL user + database from .env
sudo -u wacrm npm install --omit=dev
```
The SuperAdmin password is `ADMIN_PASSWORD` in `.env`. Sign in once and change it.

**Or from git:**
```bash
sudo -u wacrm git clone <your-repo> /opt/wacrm && cd /opt/wacrm
sudo -u wacrm npm install && sudo -u wacrm npm run build
sudo -u wacrm cp .env.example .env   # then edit, see "Production .env" below
```

### 3. Production `.env`
```env
NODE_ENV=production
PORT=5000
AUTH_REQUIRED=true
DATABASE_TYPE=postgresql
DATABASE_URL=postgresql://wacrm:change-me@127.0.0.1:5432/quickwhatsapp
DATA_DIR=/var/lib/wacrm                # media and WhatsApp session files live here
PUBLIC_URL=https://yourdomain.com      # used in invitation links
CORS_ORIGIN=https://yourdomain.com
SESSION_SECRET=<64 random hex chars>   # openssl rand -hex 32
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong password>
```

### 4. Run with PM2 (survives crashes and reboots)
```bash
sudo -u wacrm pm2 start server/src/app.js --name wacrm --cwd /opt/wacrm
sudo -u wacrm pm2 save
sudo env PATH=$PATH pm2 startup systemd -u wacrm --hp /home/wacrm
```
Run **exactly one instance**. Do not use `-i max` cluster mode. Each WhatsApp number must have a single authoritative session manager, and the send limits and live event streams are held in that process.

### 5. Nginx + HTTPS
`/etc/nginx/sites-available/wacrm`:
```nginx
server {
  server_name yourdomain.com;
  client_max_body_size 50m;
  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # required for live updates (Server-Sent Events)
    proxy_read_timeout 1h;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/wacrm /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.com
```

### 6. Backups and restore
Back up the PostgreSQL database plus `media/` and `wa_sessions/` inside `DATA_DIR`. Nightly via cron (as the `wacrm` user, with the password in `~/.pgpass`):
```bash
0 3 * * * pg_dump -Fc -h 127.0.0.1 -U wacrm quickwhatsapp > /var/backups/wacrm-$(date +\%F).dump && tar czf /var/backups/wacrm-media-$(date +\%F).tgz -C /var/lib/wacrm media wa_sessions
```
To restore: run `pm2 stop wacrm`, then `pg_restore --clean --if-exists -h 127.0.0.1 -U wacrm -d quickwhatsapp /var/backups/wacrm-<date>.dump`, extract the media archive, and run `pm2 start wacrm`. WhatsApp sessions are also stored encrypted in the database, so numbers reconnect on start even if `wa_sessions/` is lost.

On SQLite installs, back up with `sqlite3 data/wacrm.db ".backup <file>"` instead.

### 7. Moving existing data from SQLite to PostgreSQL
Stop the app, back up `data/wacrm.db`, then copy everything across. The SQLite file is opened read-only, and running the script again only adds missing rows:
```bash
pm2 stop wacrm
DATABASE_URL=postgresql://wacrm:change-me@127.0.0.1:5432/quickwhatsapp \
  node server/scripts/migrate-sqlite-to-postgres.js /var/lib/wacrm/data/wacrm.db
```
The script prints row counts per table and fails if PostgreSQL ends up with fewer rows than SQLite. Then set `DATABASE_TYPE=postgresql` and `DATABASE_URL` in `.env` and run `pm2 start wacrm`. Users keep their passwords and sessions, because the session secret is copied too. To roll back, remove `DATABASE_TYPE` from `.env` and restart: the SQLite file is untouched.

### Separate infrastructure
The frontend in `client/dist` can be hosted on any static host. Point it at the API with `VITE_API_URL` or the in-app "Set Backend URL", and list the frontend origin in `CORS_ORIGIN`. The API and WhatsApp engine must stay on a persistent Node server. The Cloudflare gateway below is optional.

---

## Database migrations

Migrations run automatically on start in `server/src/db.js`, for both SQLite and PostgreSQL. They are **additive only**: no table is dropped and no data is rewritten. Back up the database before upgrading.

| Variable | Values | Notes |
|---|---|---|
| `DATABASE_TYPE` | `sqlite` (default) or `postgresql` | |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db`, or a SQLite file path | SQLite defaults to `<DATA_DIR>/data/wacrm.db` |
| `DATABASE_SSL` | `true` | TLS to managed PostgreSQL. `DATABASE_SSL_REJECT_UNAUTHORIZED=false` accepts self-signed certificates. |
| `DATABASE_POOL_MAX` | number, default 10 | PostgreSQL connection pool size |

`/api/health` reports the database type and returns HTTP 503 if the database is unreachable.

| Version | Change |
|---|---|
| v3 (PostgreSQL) | No schema change for SQLite. PostgreSQL gets the same tables with identical column types, plus a case-insensitive unique index on `users.username`. |
| v2 (team workspaces) | `users` gains `parent_id` (NULL means workspace owner, otherwise the owner's id), `email`, `permissions` (JSON, NULL means role defaults), `last_login_at` and `last_active_at`. `audit_logs` gains `account_id` (the workspace). New table `invitations` stores only a SHA-256 hash of each token. The existing `user_accounts` table is reused as per-member WhatsApp number access. |

Rollback: stop the app, restore the pre-upgrade database backup, and deploy the previous commit. Older code ignores the new columns, so rolling back without restoring also works.

Existing users keep working. Registered users become workspace owners, and SuperAdmin-created agents keep their number grants. Old scrypt password hashes still verify, and new or changed passwords use Argon2id.

---

## Team workspaces: roles and permissions

| Role | Who | Default permissions |
|---|---|---|
| SuperAdmin (`admin`) | Platform operator | Everything, through the Admin Panel |
| Account Owner (`user`, no parent) | Whoever registers | Everything in their own workspace. Members cannot remove or deactivate the owner. |
| Administrator (`manager`) | Created by the owner | View, send and organize chats, media, view and manage team, activity log |
| Agent (`agent`) | Created by the owner or an administrator | View, send and organize chats, media |

Members only see WhatsApp numbers explicitly granted to them. Owners can customise each member's permissions. Administrators cannot create or edit administrators, cannot edit themselves, and cannot grant permissions they do not hold. Deactivating, deleting, or resetting a member's password revokes all of their sessions and closes their live event streams immediately. Chats, messages, media and audit history always stay with the workspace.

## Messaging safeguards and WhatsApp risk

This app uses **Baileys, an unofficial WhatsApp Web client**. WhatsApp may restrict or ban numbers used with unofficial clients, and **no setting in this app can guarantee a number will not be restricted**. Use it only for legitimate conversations with customers who contacted you or opted in, honour opt-out requests, and do not send unsolicited bulk messages. For high volume or regulated use, migrate to the official WhatsApp Business Platform (Cloud API). The WhatsApp provider is isolated behind `server/src/whatsapp/connector-service.js` to make that migration possible.

Built-in guard rails are configurable. They are not "safe" thresholds.

| Variable | Default | Meaning |
|---|---|---|
| `WA_SEND_LIMIT_PER_NUMBER_MIN` | 30 | Messages per number per minute, shared by all members |
| `WA_SEND_LIMIT_PER_NUMBER_HOUR` | 600 | Messages per number per hour |
| `WA_SEND_LIMIT_PER_MEMBER_MIN` | 20 | Messages per member per minute |
| `WA_DUPLICATE_WINDOW_SEC` | 10 | Blocks identical text to the same chat inside this window |
| `MAX_UPLOAD_MB` | 32 | Largest media file accepted |
| `INVITE_TTL_HOURS` | 72 | Invitation link lifetime |

Owners can also pause all outgoing messages on a number from the Accounts screen. Each send carries an idempotency key, so double-clicks and concurrent members cannot send duplicates. Reconnects use exponential backoff, from 4 seconds up to 5 minutes.

---

## Optional: Deploying on Cloudflare (Workers & Edge Gateway)

Because WhatsApp Web (Baileys) requires a continuous WebSocket TCP connection to WhatsApp's servers, the application uses a **hybrid edge architecture**:
1. **Frontend & Edge Gateway**: Hosted globally on Cloudflare Workers / Pages (ultra-fast CDN, DDoS shield, free custom domain SSL).
2. **Backend Engine**: Runs on a persistent Node.js host (Hostinger, Render, Railway, VPS, or even your PC via Cloudflare Tunnel).

### Step 1: Login to Cloudflare
In your terminal, authenticate Wrangler with your Cloudflare account:
```bash
npx wrangler login
```
A browser tab will open asking you to click **"Authorize"**.

### Step 2: Build the Frontend
Compile the production assets:
```bash
npm run build
```

### Step 3: Configure Your Backend URL
Tell Cloudflare where your persistent WhatsApp backend is running:
```bash
npx wrangler secret put BACKEND_URL
```
When prompted, paste your backend URL (e.g. `https://your-backend.onrender.com` or your Hostinger/VPS API URL).

### Step 4: Deploy to Cloudflare
Deploy your Worker and static assets to Cloudflare:
```bash
npm run deploy
```
Wrangler will publish your app and give you a live Cloudflare URL (e.g. `https://qiuckwhatsapp.<your-subdomain>.workers.dev`).

### (Optional) Hosting Backend via Cloudflare Tunnel
If you want to host your backend on your own server or PC without public IP or port forwarding:
1. Install `cloudflared` from Cloudflare Zero Trust.
2. Run:
   ```bash
   cloudflared tunnel --url http://localhost:5000
   ```
3. Use the provided tunnel URL as your `BACKEND_URL`!
