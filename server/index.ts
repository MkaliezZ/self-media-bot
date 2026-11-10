import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { errorText } from './errors.js';
import { acquireLock } from './lock.js';
import { execFile } from 'node:child_process';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.basename(sourceRoot) === 'dist' ? path.dirname(sourceRoot) : sourceRoot;
const port = Number(process.env.SELF_MEDIA_BOT_PORT ?? 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SELF_MEDIA_BOT_PORT 必须介于 1024 和 65535。');
const home = path.resolve(process.env.SELF_MEDIA_BOT_HOME ?? path.join(root, '.local'));
const releaseLock = await acquireLock(home);
let instance: Awaited<ReturnType<typeof createApp>>;
try { instance = await createApp({ root, home, dev: process.argv.includes('--dev') }); }
catch (error) { await releaseLock(); throw error; }
instance.app.addHook('onClose', releaseLock);
instance.setOrigin(`http://127.0.0.1:${port}`);
try {
  await instance.app.listen({ host: '127.0.0.1', port });
  console.log(`自媒体 Bot 已启动：http://127.0.0.1:${port}`);
  console.log('DSH 专用运行时 · 仅本机访问 · 私有项目库已隔离');
  if (process.argv.includes('--open')) {
    const url = `http://127.0.0.1:${port}`;
    if (process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true }, () => undefined);
    else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => undefined);
  }
} catch (error) {
  console.error(errorText(error)); await instance.app.close(); process.exitCode = 1;
}
let closing = false;
async function shutdown() { if (closing) return; closing = true; await instance.app.close(); }
process.on('SIGINT', () => { void shutdown(); }); process.on('SIGTERM', () => { void shutdown(); });
