import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 9)) throw new Error('需要 Node.js 24.9 或更新版本，请先安装兼容的 Node.js。');
function run(command, args, shell = false) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell });
  if (result.error || result.status !== 0) { console.error(result.error?.message ?? '上一步未完成，请保留错误信息。'); process.exit(result.status || 1); }
}
const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean).find(file => fs.existsSync(file));
function npm(args) { if (!npmCli) throw new Error('未找到 npm CLI，请使用包含 npm 的官方 Node.js 安装。'); run(process.execPath, [npmCli, ...args]); }
if (!fs.existsSync(path.join(root, 'node_modules'))) npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
const home = path.resolve(process.env.SELF_MEDIA_BOT_HOME ?? path.join(root, '.local'));
if (!fs.existsSync(path.join(home, 'settings.json'))) run(process.execPath, [path.join(root, 'scripts', 'setup.mjs')]);
if (!fs.existsSync(path.join(root, 'dist', 'web', 'index.html'))) npm(['run', 'build']);
const child = spawn(process.execPath, [path.join(root, 'dist', 'server', 'index.js'), '--open'], { cwd: root, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
