import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError } from './errors.js';

export async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, file);
}
export async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
export function isInside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export async function confinedFile(file: string, roots: string[]): Promise<string> {
  const actual = await realpath(file).catch(() => { throw new AppError(404, '文件不存在。', 'FILE_MISSING'); });
  for (const root of roots) {
    const resolved = await realpath(root).catch(() => path.resolve(root));
    if (isInside(resolved, actual)) return actual;
  }
  throw new AppError(403, '只能访问当前项目的文件。', 'FILE_OUTSIDE_PROJECT');
}
export function validId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new AppError(400, '无效的记录标识。', 'BAD_ID');
  return id;
}
export function fileName(name: string) {
  const base = path.basename(name.replaceAll('\\', '/')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return base.slice(0, 160) || 'material';
}
