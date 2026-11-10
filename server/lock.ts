import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function acquireLock(home: string) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, 'server.lock'); const nonce = randomUUID();
  const record = { application: 'self-media-bot', pid: process.pid, nonce };
  try { await writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const old = JSON.parse(await readFile(file, 'utf8'));
    if (old.application !== record.application || !Number.isSafeInteger(old.pid) || !old.nonce) throw new Error('发现不属于本程序的锁文件，请保留原文件并检查数据目录。');
    let running = true; try { process.kill(old.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') running = false; }
    if (running) throw new Error('同一数据目录的自媒体 Bot 已经启动。请打开已有页面，不要重复运行。');
    await unlink(file); await writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  }
  return async () => { const current = JSON.parse(await readFile(file, 'utf8').catch(() => '{}')); if (current.nonce === nonce) await unlink(file); };
}
