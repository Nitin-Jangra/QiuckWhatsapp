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
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_accounts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    PRIMARY KEY (user_id, account_id)
  );
`);

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
