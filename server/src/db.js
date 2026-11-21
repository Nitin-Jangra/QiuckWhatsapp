// Database adapter. Select with DATABASE_TYPE:
//   sqlite (default)  built into Node 22.5+, file at DATABASE_URL or <DATA_DIR>/data/wacrm.db
//   postgresql        DATABASE_URL=postgresql://user:pass@host:5432/quickwhatsapp
// Every call is async and uses `?` placeholders; the adapter translates for PostgreSQL.
//   get(sql, ...p) -> row | undefined     all(sql, ...p) -> rows
//   run(sql, ...p) -> { changes }         insert(sql, ...p) -> new integer id
//   exec(sql)                             tx(async fn) -> fn result, atomic
// SQL must stay in the shared subset: no COLLATE NOCASE (use LOWER()), no INSERT OR IGNORE
// (use ON CONFLICT DO NOTHING), no rowid.
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const TYPE = /^postgres(ql)?$/i.test(process.env.DATABASE_TYPE || '') ? 'postgresql' : 'sqlite';
const als = new AsyncLocalStorage();

// ---------------- Schemas ----------------
// SQLite keeps its historical CREATE statements plus additive column migrations for old files.
const SQLITE_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, last_ts TEXT, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_chats_account ON chats(account_id, last_ts);
  CREATE TABLE IF NOT EXISTS contacts (key TEXT PRIMARY KEY, account_id TEXT NOT NULL, jid TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    account_id TEXT NOT NULL, id TEXT NOT NULL, remote_jid TEXT NOT NULL, ts TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (account_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(account_id, remote_jid, ts);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    full_name TEXT,
    phone_number TEXT UNIQUE,
    phone_verified_at TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    status TEXT NOT NULL DEFAULT 'active',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS user_accounts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    PRIMARY KEY (user_id, account_id)
  );
  CREATE TABLE IF NOT EXISTS otp_verifications (
    id TEXT PRIMARY KEY, phone_number TEXT NOT NULL, email TEXT, otp_hash TEXT NOT NULL, purpose TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_verifications(phone_number, purpose);
  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT, user_agent TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
  CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, ip_address TEXT, details TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'light', sound_enabled INTEGER NOT NULL DEFAULT 1, enter_is_send INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    account_id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    encrypted_creds TEXT NOT NULL, iv TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`;
const SQLITE_COLUMNS = [
  ['users', 'phone_number', 'TEXT'], ['users', 'full_name', 'TEXT'], ['users', 'phone_verified_at', 'TEXT'],
  ['users', 'status', "TEXT NOT NULL DEFAULT 'active'"], ['users', 'updated_at', 'TEXT'],
  ['accounts', 'user_id', 'INTEGER'],
  ['chats', 'user_id', 'INTEGER'], ['chats', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0'], ['chats', 'is_archived', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'user_id', 'INTEGER'], ['messages', 'delivery_status', "TEXT NOT NULL DEFAULT 'sent'"],
  ['contacts', 'user_id', 'INTEGER'],
  // v2: team workspaces
  ['users', 'parent_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE'],
  ['users', 'email', 'TEXT'], ['users', 'email_verified_at', 'TEXT'], ['users', 'permissions', 'TEXT'], ['users', 'last_login_at', 'TEXT'], ['users', 'last_active_at', 'TEXT'],
  ['otp_verifications', 'email', 'TEXT'],
  ['audit_logs', 'account_id', 'INTEGER']
];

// Shared by both engines (runs after the base schema)
const COMMON_SCHEMA = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email, purpose);
  CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, last_ts);
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, ts);
  CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
  CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_logs(account_id, created_at);
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by INTEGER,
    username TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT, phone TEXT,
    role TEXT NOT NULL,
    permissions TEXT, account_ids TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invitations_account ON invitations(account_id, status);
`;

// PostgreSQL gets the full current schema in one go. Types mirror SQLite so business logic is identical
// (timestamps are ISO-8601 TEXT, flags are INTEGER 0/1).
const PG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT,
    email TEXT,
    email_verified_at TEXT,
    phone_number TEXT,
    phone_verified_at TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    status TEXT NOT NULL DEFAULT 'active',
    active INTEGER NOT NULL DEFAULT 1,
    parent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT,
    last_login_at TEXT,
    last_active_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(LOWER(username));
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, user_id INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, user_id INTEGER, last_ts TEXT,
    is_pinned INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_account ON chats(account_id, last_ts);
  CREATE TABLE IF NOT EXISTS contacts (key TEXT PRIMARY KEY, account_id TEXT NOT NULL, user_id INTEGER, jid TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    account_id TEXT NOT NULL, id TEXT NOT NULL, user_id INTEGER, remote_jid TEXT NOT NULL, ts TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'sent', data TEXT NOT NULL,
    PRIMARY KEY (account_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(account_id, remote_jid, ts);
  CREATE TABLE IF NOT EXISTS user_accounts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    PRIMARY KEY (user_id, account_id)
  );
  CREATE TABLE IF NOT EXISTS otp_verifications (
    id TEXT PRIMARY KEY, phone_number TEXT NOT NULL, email TEXT, otp_hash TEXT NOT NULL, purpose TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_verifications(phone_number, purpose);
  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT, user_agent TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, user_id INTEGER, account_id INTEGER, action TEXT NOT NULL, ip_address TEXT, details TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'light', sound_enabled INTEGER NOT NULL DEFAULT 1, enter_is_send INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    account_id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    encrypted_creds TEXT NOT NULL, iv TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`;

// ---------------- SQLite engine ----------------
// Driver: Node's built-in node:sqlite (22.5+), else the optional better-sqlite3 package (works on Node 20).
// WACRM_SQLITE_DRIVER=better-sqlite3 forces the fallback (used by tests).
function openSqlite(file) {
  if (process.env.WACRM_SQLITE_DRIVER !== 'better-sqlite3') {
    try {
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(file);
    } catch (e) {
      if (e.code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && e.code !== 'MODULE_NOT_FOUND' && !/sqlite/i.test(e.message)) throw e;
    }
  }
  try {
    const Database = require('better-sqlite3');
    return new Database(file);
  } catch (e) {
    const err = new Error(`Node ${process.version} has no built-in SQLite and the better-sqlite3 fallback is not installed (${e.message.split('\n')[0]}). Select Node.js 22 or newer, or set DATABASE_TYPE=postgresql.`);
    err.code = 'NO_SQLITE_DRIVER';
    throw err;
  }
}

function sqliteEngine() {
  const file = process.env.DATABASE_TYPE && process.env.DATABASE_URL
    ? path.resolve(process.env.DATABASE_URL)
    : path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'data', 'wacrm.db');
  let conn = null; // opened in init() so a missing driver becomes a reported startup error, not a crash
  const cache = new Map();
  const bind = (p) => p.map(v => (v === undefined ? null : v));
  const stmt = (sql) => {
    if (!cache.has(sql)) cache.set(sql, conn.prepare(sql));
    return cache.get(sql);
  };

  // One connection: while a transaction is open, statements from other async flows wait for it.
  let current = null; // { done: Promise }
  const outsideTx = async () => {
    while (current && als.getStore() !== current) await current.done;
  };

  return {
    type: 'sqlite',
    get raw() { return conn; },
    async init() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      conn = openSqlite(file);
      conn.exec(SQLITE_SCHEMA);
      for (const [table, col, def] of SQLITE_COLUMNS) {
        const cols = conn.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
        if (!cols.includes(col)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      }
      conn.exec(COMMON_SCHEMA);
    },
    async get(sql, ...p) { await outsideTx(); return stmt(sql).get(...bind(p)); },
    async all(sql, ...p) { await outsideTx(); return stmt(sql).all(...bind(p)); },
    async run(sql, ...p) { await outsideTx(); return { changes: Number(stmt(sql).run(...bind(p)).changes) }; },
    async insert(sql, ...p) { await outsideTx(); return Number(stmt(sql).run(...bind(p)).lastInsertRowid); },
    async exec(sql) { await outsideTx(); conn.exec(sql); },
    async tx(fn) {
      if (current && als.getStore() === current) return fn(); // nested
      while (current) await current.done;
      let release;
      const token = { done: new Promise(r => { release = r; }) };
      current = token;
      try {
        conn.exec('BEGIN');
        const out = await als.run(token, fn);
        conn.exec('COMMIT');
        return out;
      } catch (err) {
        try { conn.exec('ROLLBACK'); } catch (e) {}
        throw err;
      } finally {
        current = null;
        release();
      }
    },
    async close() { conn?.close(); }
  };
}

// ---------------- PostgreSQL engine ----------------
function pgEngine() {
  const pg = require('pg');
  pg.types.setTypeParser(20, (v) => Number(v)); // COUNT(*) and BIGINT as numbers
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when DATABASE_TYPE=postgresql');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
  });
  pool.on('error', (err) => console.error('[WaCRM] PostgreSQL pool error:', err.message));

  // `?` -> $1, $2 ... (skips quoted literals)
  const cache = new Map();
  const translate = (sql) => {
    if (cache.has(sql)) return cache.get(sql);
    let n = 0, out = '', quote = null;
    for (const ch of sql) {
      if (quote) { if (ch === quote) quote = null; out += ch; continue; }
      if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
      out += ch === '?' ? `$${++n}` : ch;
    }
    cache.set(sql, out);
    return out;
  };
  const client = () => als.getStore() || pool;
  const q = (sql, p) => client().query(translate(sql), p.map(v => (v === undefined ? null : v)));

  return {
    type: 'postgresql',
    raw: pool,
    async init() {
      await pool.query(PG_SCHEMA);
      await pool.query(COMMON_SCHEMA);
    },
    async get(sql, ...p) { return (await q(sql, p)).rows[0]; },
    async all(sql, ...p) { return (await q(sql, p)).rows; },
    async run(sql, ...p) { return { changes: (await q(sql, p)).rowCount }; },
    async insert(sql, ...p) { return (await q(`${sql} RETURNING id`, p)).rows[0].id; },
    async exec(sql) { await client().query(sql); },
    async tx(fn) {
      if (als.getStore()) return fn(); // nested
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await als.run(c, fn);
        await c.query('COMMIT');
        return out;
      } catch (err) {
        try { await c.query('ROLLBACK'); } catch (e) {}
        throw err;
      } finally {
        c.release();
      }
    },
    async close() { await pool.end(); }
  };
}

let active = TYPE === 'postgresql' ? pgEngine() : sqliteEngine();

const db = {
  get type() { return active.type; },
  get raw() { return active.raw; },
  async init() {
    try {
      await active.init();
    } catch (err) {
      if (active.type === 'postgresql') {
        console.warn(`[WaCRM] PostgreSQL connection failed (${err.message}). Falling back to built-in SQLite...`);
        active = sqliteEngine();
        await active.init();
      } else {
        throw err;
      }
    }
  },
  async get(sql, ...p) { return active.get(sql, ...p); },
  async all(sql, ...p) { return active.all(sql, ...p); },
  async run(sql, ...p) { return active.run(sql, ...p); },
  async insert(sql, ...p) { return active.insert(sql, ...p); },
  async exec(sql) { return active.exec(sql); },
  async tx(fn) { return active.tx(fn); },
  async close() { return active.close(); }
};

// Unique-constraint violation on either engine (SQLite message / PostgreSQL code 23505)
db.isUniqueViolation = (err) => err?.code === '23505' || /UNIQUE constraint/i.test(err?.message || '');

// Health check used by /api/health
db.ping = async () => {
  try { await db.get('SELECT 1 AS ok'); return true; } catch (e) { return false; }
};

// Schema is created/migrated once; everything else awaits db.ready
db.ready = db.init().catch((err) => {
  console.error(`[WaCRM] Database (${db.type}) initialisation failed:`, err.message);
  throw err;
});

module.exports = db;
