import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = spawnSync(process.execPath, ['scripts/check-release.mjs'], { cwd: root, stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);
const python = process.env.SELF_MEDIA_WORKBENCH_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['scripts/package_release.py', root, path.join(root, 'release', 'self-media-bot-0.1.0.zip')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
