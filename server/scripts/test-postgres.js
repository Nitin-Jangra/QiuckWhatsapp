// Runs the automated test suite against PostgreSQL, one throwaway database per test file.
// Usage: TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm run test:pg --workspace=server
// The user in TEST_DATABASE_URL needs CREATEDB. Test databases are dropped afterwards.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) {
  console.error('Set TEST_DATABASE_URL to a PostgreSQL server URL (e.g. postgresql://postgres:postgres@localhost:5432/postgres)');
  process.exit(2);
}

(async () => {
  const dir = path.join(__dirname, '..', 'tests');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  let failed = 0;
  for (const [i, file] of files.entries()) {
    const name = `wacrm_test_${process.pid}_${i}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    const r = spawnSync(process.execPath, ['--test', path.join(dir, file)], {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_TYPE: 'postgresql', DATABASE_URL: url.toString() }
    });
    if (r.status !== 0) failed++;
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
  await admin.end();
  console.log(failed ? `\n${failed} PostgreSQL test file(s) failed` : '\nAll PostgreSQL test files passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
