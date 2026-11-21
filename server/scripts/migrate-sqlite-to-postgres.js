// One-time copy of an existing SQLite database into PostgreSQL.
//
//   DATABASE_URL=postgresql://user:pass@host:5432/quickwhatsapp \
//   node server/scripts/migrate-sqlite-to-postgres.js [path/to/wacrm.db]
//
// Default source: <DATA_DIR or server>/data/wacrm.db. The SQLite file is opened read-only and never modified.
// Safe to re-run: rows that already exist in PostgreSQL are skipped (ON CONFLICT DO NOTHING).
// Stop the app before migrating so no writes are missed, and back up both databases first.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

process.env.DATABASE_TYPE = 'postgresql';
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to the target PostgreSQL database.');
  process.exit(2);
}
const db = require('../src/db'); // creates the PostgreSQL schema

const source = path.resolve(process.argv[2] || path.join(process.env.DATA_DIR || path.join(__dirname, '..'), 'data', 'wacrm.db'));
if (!fs.existsSync(source)) {
  console.error(`SQLite database not found: ${source}`);
  process.exit(2);
}

// Parents before children so foreign keys hold
const TABLES = [
  ['meta', ''],
  ['users', 'ORDER BY (parent_id IS NOT NULL), id'],
  ['accounts', ''], ['chats', ''], ['contacts', ''], ['messages', ''],
  ['user_accounts', ''], ['user_sessions', ''], ['otp_verifications', ''],
  ['audit_logs', ''], ['user_preferences', ''], ['whatsapp_sessions', ''], ['invitations', '']
];

(async () => {
  await db.ready;
  const lite = new DatabaseSync(source, { readOnly: true });
  const liteTables = new Set(lite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
  const report = [];

  for (const [table, order] of TABLES) {
    if (!liteTables.has(table)) continue;
    // Copy only columns both sides know (older SQLite files may predate some columns)
    const liteCols = lite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    const pgCols = (await db.all('SELECT column_name FROM information_schema.columns WHERE table_name = ? AND table_schema = current_schema()', table)).map(r => r.column_name);
    const cols = liteCols.filter(c => pgCols.includes(c));
    const rows = lite.prepare(`SELECT ${cols.join(', ')} FROM ${table} ${liteCols.includes('parent_id') ? order : ''}`).all();
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`;
    let inserted = 0;
    await db.tx(async () => {
      for (const row of rows) inserted += (await db.run(sql, ...cols.map(c => row[c]))).changes;
    });
    const target = (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n;
    report.push({ table, source: rows.length, inserted, target });
  }

  // Continue user ids after the highest migrated id
  await db.exec("SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM users), 1))");

  console.table(report);
  const short = report.filter(r => r.target < r.source);
  lite.close();
  await db.close();
  if (short.length) {
    console.error('Verification FAILED: PostgreSQL has fewer rows than SQLite for:', short.map(r => r.table).join(', '));
    process.exit(1);
  }
  console.log('Migration verified: every table in PostgreSQL has at least as many rows as the SQLite source.');
})().catch(async (err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
