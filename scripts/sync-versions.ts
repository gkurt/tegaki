import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..');
const rendererPath = resolve(root, 'packages/renderer/package.json');
const rendererPkg = JSON.parse(readFileSync(rendererPath, 'utf-8'));
const version: string = rendererPkg.version;

const allPackages = globSync('**/package.json', { cwd: root, exclude: ['**/node_modules/**'] });

for (const pkgPath of allPackages) {
  const fullPath = resolve(root, pkgPath);
  if (fullPath === rendererPath) continue;

  const raw = readFileSync(fullPath, 'utf-8');
  const pkg = JSON.parse(raw);
  if (pkg.version !== version) {
    pkg.version = version;
    writeFileSync(fullPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`Synced ${pkgPath} to v${version}`);
  }
}
