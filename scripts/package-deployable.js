const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const dest = path.join(rootDir, 'temp_deploy_pkg');
const zipFile = path.join(rootDir, 'QuickWhatsApp-deployable.zip');

// Refuse to ship an insecure configuration: without AUTH_REQUIRED=true anyone gets admin access
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) {
  const env = {};
  for (const raw of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (/^[A-Z_]+=/.test(line)) env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (env.AUTH_REQUIRED !== 'true' || env.NODE_ENV !== 'production') {
    throw new Error('.env must set NODE_ENV=production and AUTH_REQUIRED=true before packaging for deployment');
  }
} else {
  console.warn('[package] No .env found: the server will need one created on the host (see .env.example)');
}

// Always ship a fresh frontend build
console.log('[package] Building frontend...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
  fs.rmSync(zipFile, { force: true });
}
fs.mkdirSync(dest, { recursive: true });

function copyFile(relPath) {
  const src = path.join(rootDir, relPath);
  const target = path.join(dest, relPath);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
  }
}

function copyDir(relPath, excludeNames = ['node_modules', '.git']) {
  const src = path.join(rootDir, relPath);
  const target = path.join(dest, relPath);
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(src, target, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source);
      return !excludeNames.includes(base);
    }
  });
}

console.log('[package] Copying root files...');
['app.js', 'index.js', '.env', '.env.example', '.gitignore', 'package.json', 'package-lock.json', 'worker.js', 'wrangler.jsonc',
  'DEPLOY_INSTRUCTIONS.md', 'README.md', '.nvmrc'].forEach(copyFile);

console.log('[package] Copying scripts...');
copyDir('scripts');

console.log('[package] Copying build & dist mirrors...');
copyDir('build');
copyDir('dist');

console.log('[package] Copying client workspace...');
copyFile('client/package.json');
copyFile('client/vite.config.js');
copyFile('client/index.html');
copyFile('client/.env.example');
copyDir('client/src');
copyDir('client/public');
copyDir('client/dist');

console.log('[package] Copying server workspace...');
copyFile('server/package.json');
copyFile('server/package-lock.json');
copyFile('server/schema.sql');
copyDir('server/src');
copyDir('server/scripts');
copyDir('server/tests');

// Create empty runtime directories for database, media and sessions
fs.mkdirSync(path.join(dest, 'server', 'data'), { recursive: true });
fs.mkdirSync(path.join(dest, 'server', 'media'), { recursive: true });
fs.mkdirSync(path.join(dest, 'server', 'wa_sessions'), { recursive: true });

// Sanity check critical files in staging folder
const criticalFiles = [
  path.join(dest, 'app.js'),
  path.join(dest, 'client', 'src', 'App.jsx'),
  path.join(dest, 'client', 'src', 'pages', 'Dashboard.jsx'),
  path.join(dest, 'client', 'dist', 'index.html'),
  path.join(dest, 'server', 'src', 'app.js'),
  path.join(dest, 'server', 'src', 'whatsapp', 'session-manager.js'),
  path.join(dest, 'server', 'src', 'routes', 'team.js'),
  path.join(dest, 'server', 'scripts', 'migrate-sqlite-to-postgres.js'),
  path.join(dest, 'scripts', 'setup-postgres.sh'),
  path.join(dest, 'DEPLOY_INSTRUCTIONS.md')
];

for (const cf of criticalFiles) {
  if (!fs.existsSync(cf)) {
    throw new Error(`CRITICAL FILE MISSING IN STAGING: ${cf}`);
  }
}
console.log('[package] All critical files verified in staging directory!');

console.log('[package] Creating QuickWhatsApp-deployable.zip via .NET ZipFile...');
const psScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem;
[System.IO.Compression.ZipFile]::CreateFromDirectory('${dest.replace(/\\/g, '\\\\')}', '${zipFile.replace(/\\/g, '\\\\')}', [System.IO.Compression.CompressionLevel]::Optimal, $false);
`;

execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'inherit' });

fs.rmSync(dest, { recursive: true, force: true });
const stats = fs.statSync(zipFile);
console.log(`[package] SUCCESS: Created ${zipFile} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
