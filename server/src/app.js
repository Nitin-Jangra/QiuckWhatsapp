require('dotenv').config();
// DATA_DIR may start with "~" (home directory). Managed hosts that deploy each build into a fresh
// version folder need data stored outside the app folder, or every redeploy wipes it.
if (process.env.DATA_DIR?.startsWith('~')) {
  process.env.DATA_DIR = require('path').join(require('os').homedir(), process.env.DATA_DIR.slice(1));
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Express 4 does not catch rejected promises from async handlers; forward them to the error handler.
const Layer = require('express/lib/router/layer');
const handleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  if (this.handle.length > 3) return handleRequest.call(this, req, res, next);
  try {
    const out = this.handle(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

const db = require('./db');
const auth = require('./auth');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const preferencesRoutes = require('./routes/preferences');
const accountsRoutes = require('./routes/accounts');
const chatsRoutes = require('./routes/chats');
const eventsRoutes = require('./routes/events');
const whatsappRoutes = require('./routes/whatsapp');
const teamRoutes = require('./routes/team');
const connector = require('./whatsapp/connector-service');
const store = require('./store');

const app = express();

// Database schema, session secret, SuperAdmin seed and legacy import complete before any request is served
const ready = db.ready.then(() => auth.init()).then(() => store.init());

// If startup fails, stay up and say why (instead of exiting, which managed hosts only show as a
// generic 503). The reason shown is a fixed hint per failure type: no secrets, hosts or stack traces.
let startupError = null;
ready.catch((err) => {
  startupError = err;
  console.error('[WaCRM] Startup failed:', err);
});
function startupHint(err) {
  const code = err?.code || '';
  if (code === 'NO_SQLITE_DRIVER') return `Node.js ${process.version} cannot run the built-in database. Select Node.js 22 or newer in your hosting panel (Hostinger: hPanel > Node.js > Settings), then redeploy.`;
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(code)) return 'The PostgreSQL server in DATABASE_URL cannot be reached. Check the host and port, or remove DATABASE_TYPE from .env to use the built-in SQLite database.';
  if (code === '28P01' || code === '28000') return 'PostgreSQL rejected the username or password in DATABASE_URL.';
  if (code === '3D000') return 'The database named in DATABASE_URL does not exist on the PostgreSQL server.';
  if (/DATABASE_URL is required/.test(err?.message || '')) return 'DATABASE_TYPE=postgresql is set but DATABASE_URL is missing in .env.';
  if (code === 'EACCES' || code === 'EROFS') return 'The app cannot write to its data folder. Check DATA_DIR in .env points to a writable folder.';
  return 'Startup failed. The full error is in the application log (Hostinger: hPanel > Node.js > Logs).';
}
app.use(async (req, res, next) => {
  try {
    await ready;
    return next();
  } catch (err) {
    const hint = startupHint(err || startupError);
    if (req.path.startsWith('/api')) return res.status(503).json({ success: false, error: hint });
    return res.status(200).type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QuickWhatsApp Setup</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.5">
<h2>QuickWhatsApp: Node.js 22 Required</h2>
<p style="font-size:16px;color:#d9534f"><strong>${hint.replace(/[<>&]/g, '')}</strong></p>
<p>In your Hostinger hPanel dashboard, change the <strong>Node.js version</strong> setting from <strong>20</strong> to <strong>22</strong>, then click Save and Restart.</p>
</body></html>`);
  }
});
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.includes('*') ? '*' : allowedOrigins, credentials: !allowedOrigins.includes('*') }));

// Security headers (no dependency needed)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CSRF defence in depth (on top of SameSite=Lax cookies): browsers always send Origin on
// cross-site state-changing requests, so reject any Origin that is neither this host nor allow-listed.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // The wildcard CORS default does not disable this check: cookies only ride same-site requests.
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) return next();
  try {
    const host = new URL(origin).host;
    if (host === req.headers.host || host === req.headers['x-forwarded-host']) return next();
  } catch (e) {}
  return res.status(403).json({ success: false, error: 'Cross-site request blocked' });
});

// Never let browsers, proxies or CDNs cache API data (QR codes and chat state change constantly)
app.disable('etag');
app.use((req, res, next) => {
  if (!req.path.startsWith('/media') && !req.path.startsWith('/api/media')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// Payload limit covers base64 media uploads (base64 adds ~33%). MAX_UPLOAD_MB caps the decoded file.
const bodyLimit = `${Math.ceil((Number(process.env.MAX_UPLOAD_MB) || 32) * 1.4)}mb`;
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Normalize duplicate /api prefixes
app.use((req, res, next) => {
  if (req.url.startsWith('/api/api/')) {
    req.url = req.url.replace('/api/api/', '/api/');
  }
  next();
});

// Behind Hostinger/Cloudflare proxies: trust X-Forwarded-* so cookies and rate limits work
app.set('trust proxy', 1);
app.use(auth.attachUser);

// Ensure media storage folder exists and serve media files statically
const mediaDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}
// Media access guard (active when AUTH_REQUIRED=true)
const mediaGuard = async (req, res, next) => {
  if (process.env.AUTH_REQUIRED !== 'true') return next();
  if (!req.user) return res.status(401).json({ success: false, error: 'Please sign in' });
  if (!auth.can(req.user, 'media.view')) return res.status(403).json({ success: false, error: 'No access' });
  const accountId = decodeURIComponent(req.path.split('/')[1] || '');
  return (await auth.canAccess(req.user, accountId)) ? next() : res.status(403).json({ success: false, error: 'No access' });
};
// dotfiles denied, no directory listing; express.static already rejects path traversal
const mediaStatic = express.static(mediaDir, { dotfiles: 'deny', index: false, fallthrough: false });
app.use('/api/media', mediaGuard, mediaStatic);
app.use('/media', mediaGuard, mediaStatic);

// Core API Routes (supporting both /api/path and /path). Everything except /auth requires sign-in.
for (const prefix of ['/api', '']) {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/admin`, adminRoutes);
  app.use(`${prefix}/team`, teamRoutes); // invitation acceptance is public; everything else checks auth inside
  app.use(`${prefix}/user/preferences`, preferencesRoutes);
  app.use(`${prefix}/users`, auth.requireAuth, usersRoutes);
  app.use(`${prefix}/accounts`, auth.requireAuth, accountsRoutes);
  app.use(`${prefix}/chats`, auth.requireAuth, chatsRoutes);
  app.use(`${prefix}/messages`, auth.requireAuth, chatsRoutes);
  app.use(`${prefix}/events`, auth.requireAuth, eventsRoutes);
  app.use(`${prefix}/whatsapp`, auth.requireAuth, auth.requireAdmin, whatsappRoutes);
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const database = await db.ping();
  res.status(database ? 200 : 503).json({
    status: database ? 'ok' : 'degraded',
    database: { type: db.type, connected: database },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});
app.get('/health', (req, res) => res.redirect('/api/health'));

// Production: serve built React frontend if present
const possibleStaticDirs = [
  path.join(__dirname, '../../client/dist'),
  path.join(__dirname, '../../build'),
  path.join(__dirname, '../../dist'),
  path.join(__dirname, '../public')
];
const staticDir = possibleStaticDirs.find(d => fs.existsSync(path.join(d, 'index.html')));

if (staticDir) {
  app.use(express.static(staticDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media') || req.path.startsWith('/events') || req.path.startsWith('/accounts') || req.path.startsWith('/chats')) {
      return next();
    }
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// Errors: log details server-side, never leak internals to clients
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[WaCRM] Request failed:', req.method, req.path, err);
  res.status(status).json({ success: false, error: status >= 500 ? 'Internal server error' : err.message });
});

let server = null;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, async () => {
    try {
      await ready;
    } catch (err) {
      console.error(`[WaCRM] Serving a startup-error page on port ${PORT} until this is fixed:`, startupHint(err));
      return;
    }
    console.log(`[WaCRM] Multi-Account WhatsApp Platform running on http://localhost:${PORT} (database: ${db.type})`);
    try {
      await connector.autoRestore();
    } catch (err) {
      console.warn('[WaCRM] Error during auto-restore:', err.message);
    }
  });
}

// Graceful cleanup on process exit
function cleanup() {
  console.log('\n[WaCRM] Cleaning up WhatsApp sessions and shutting down...');
  connector.destroy();
  const exit = () => db.close().catch(() => {}).finally(() => process.exit(0));
  if (server) server.close(exit);
  else exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  if (msg.includes('Connection Closed') || err?.isBoom || err?.output?.statusCode === 428 || err?.output?.statusCode === 401) {
    return;
  }
  console.error('[WaCRM Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (msg.includes('Connection Closed') || reason?.isBoom || reason?.output?.statusCode === 428 || reason?.output?.statusCode === 401) {
    return;
  }
  console.error('[WaCRM Unhandled Rejection]:', reason);
});

app.ready = ready;
module.exports = app;
