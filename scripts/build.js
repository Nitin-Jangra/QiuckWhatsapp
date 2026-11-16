const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const clientDist = path.join(root, 'client', 'dist');
const rootBuild = path.join(root, 'build');
const rootDist = path.join(root, 'dist');

// Clean previous outputs
for (const dir of [clientDist, rootBuild, rootDist]) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
  }
}

// Build client workspace
console.log('[build] Compiling client workspace via Vite...');
execSync('npm run build --workspace=client', { stdio: 'inherit', cwd: root });

// Mirror output into root/build and root/dist for platforms expecting build/ or dist/
if (fs.existsSync(clientDist)) {
  fs.cpSync(clientDist, rootBuild, { recursive: true });
  fs.cpSync(clientDist, rootDist, { recursive: true });
  console.log('[build] Successfully generated client/dist, build/, and dist/');
}
