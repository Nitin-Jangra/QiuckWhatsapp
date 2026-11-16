const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const dest = path.join(rootDir, 'temp_deploy_pkg');
const zipFile = path.join(rootDir, 'QuickWhatsApp-deployable.zip');

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
  fs.rmSync(zipFile, { force: true });
}
fs.mkdirSync(dest, { recursive: true });

// Helper to copy files
function copyFile(srcRel, destRel) {
  const src = path.join(rootDir, srcRel);
  const target = path.join(dest, destRel || srcRel);
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(src, target);
  }
}

// Helper to copy directory excluding node_modules, data, wa_sessions
function copyDir(srcRel, destRel, excludePatterns = []) {
  const src = path.join(rootDir, srcRel);
  const target = path.join(dest, destRel || srcRel);
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (excludePatterns.some(p => entry.name === p || entry.name.includes(p))) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDir(path.relative(rootDir, srcPath), path.relative(rootDir, destPath), excludePatterns);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('[package] Assembling deployment files...');
// Root files
['app.js', 'index.js', '.env', '.env.example', '.gitignore', 'package.json', 'package-lock.json', 'worker.js', 'wrangler.jsonc'].forEach(f => copyFile(f));

// Scripts
copyDir('scripts', 'scripts');

// Build & Dist
copyDir('build', 'build');
copyDir('dist', 'dist');

// Client
copyFile('client/package.json');
copyFile('client/vite.config.js');
copyFile('client/index.html');
copyFile('client/.env.example');
copyDir('client/src', 'client/src');
copyDir('client/public', 'client/public');
copyDir('client/dist', 'client/dist');

// Server
copyFile('server/package.json');
copyFile('server/package-lock.json');
copyDir('server/src', 'server/src');
copyDir('server/tests', 'server/tests');

// Empty runtime directories
fs.mkdirSync(path.join(dest, 'server', 'data'), { recursive: true });
fs.mkdirSync(path.join(dest, 'server', 'media'), { recursive: true });
fs.mkdirSync(path.join(dest, 'server', 'wa_sessions'), { recursive: true });

console.log('[package] Compressing to QuickWhatsApp-deployable.zip via PowerShell .NET ZipFile...');
const psScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem;
[System.IO.Compression.ZipFile]::CreateFromDirectory('${dest.replace(/\\/g, '\\\\')}', '${zipFile.replace(/\\/g, '\\\\')}', [System.IO.Compression.CompressionLevel]::Optimal, $false);
`;

execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'inherit' });

fs.rmSync(dest, { recursive: true, force: true });
const stats = fs.statSync(zipFile);
console.log(`[package] Created ${zipFile} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
