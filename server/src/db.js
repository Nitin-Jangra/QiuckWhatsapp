// SQLite database (built into Node 22.5+, no native dependency to compile on the host)
const fs = require('fs');
const path = require('path');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error(`[WaCRM] Node ${process.version} is too old. This app needs Node 22.5 or newer (select Node 22 in your hosting panel).`);
  process.exit(1);
}

const dataDir = path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'wacrm.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, last_ts TEXT, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_account ON chats(account_id, last_ts);
  CREATE TABLE IF NOT EXISTS contacts (
    key TEXT PRIMARY KEY, account_id TEXT NOT NULL, jid TEXT NOT NULL, name TEXT NOT NULL
  );
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
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_verifications(phone_number, purpose);
  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    ip_address TEXT,
    details TEXT,
    created_at TEXT NOT NULL
  );
`);

// Ensure any missing columns on existing users table are added safely
try {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!userCols.includes('phone_number')) {
    db.exec('ALTER TABLE users ADD COLUMN phone_number TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL');
  }
  if (!userCols.includes('full_name')) {
    db.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
  }
  if (!userCols.includes('phone_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN phone_verified_at TEXT');
  }
  if (!userCols.includes('status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!userCols.includes('updated_at')) {
    db.exec('ALTER TABLE users ADD COLUMN updated_at TEXT');
  }
} catch (e) {
  // Ignore if already altered
}


// Run several statements atomically (nesting-safe)
let depth = 0;
db.tx = (fn) => {
  if (depth > 0) return fn();
  db.exec('BEGIN');
  depth++;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
};

module.exports = db;
