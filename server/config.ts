import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { atomicJson, loadJson } from './files.js';
import type { PublicSettings } from '../shared/types.js';
import { AppError } from './errors.js';

export const SettingsInput = z.object({
  model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:/-]+$/),
  baseUrl: z.string().url().max(1000),
  maxTokens: z.number().int().min(2048).max(65536),
  vision: z.boolean().default(true),
  apiKey: z.string().trim().max(2000).optional(),
  clearKey: z.boolean().optional(),
  workbenchRoot: z.string().trim().max(2000),
  python: z.string().trim().min(1).max(2000),
}).strict();
type StoredConfig = Omit<PublicSettings, 'hasKey' | 'keySource' | 'dataHome'> & { keyCipher?: string };

export function modelBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw new AppError(400, '模型地址不能包含凭据、查询参数或片段。', 'BAD_MODEL_URL');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new AppError(400, '非本机模型服务必须使用 HTTPS。', 'INSECURE_MODEL_URL');
  return url.href.replace(/\/+$/, '');
}

export class Config {
  readonly home: string;
  private saved!: StoredConfig;
  private secret!: Buffer;
  constructor(home?: string) { this.home = path.resolve(home ?? process.env.SELF_MEDIA_BOT_HOME ?? '.local'); }
  async init() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const locationPath = path.join(os.homedir(), '.codex', 'skills', 'media-workbench', 'location.json');
    const location = await loadJson<{ root?: string; python?: string }>(locationPath, {});
    const defaults: StoredConfig = {
      model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/anthropic',
      protocol: 'deepseek-messages', maxTokens: 32768, vision: true,
      workbenchRoot: process.env.SELF_MEDIA_WORKBENCH_ROOT ?? location.root ?? '',
      python: process.env.SELF_MEDIA_WORKBENCH_PYTHON ?? location.python ?? (process.platform === 'win32' ? 'python' : 'python3'),
    };
    this.saved = { ...defaults, ...await loadJson<Partial<StoredConfig>>(path.join(this.home, 'settings.json'), {}) };
    this.saved.baseUrl = modelBaseUrl(this.saved.baseUrl);
    const keyPath = path.join(this.home, 'credential-key.bin');
    try { this.secret = await readFile(keyPath); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.secret = randomBytes(32); await writeFile(keyPath, this.secret, { mode: 0o600, flag: 'wx' });
    }
    if (this.secret.length !== 32) throw new Error('本机凭据存储损坏，请保留文件并联系维护者。');
  }
  public(): PublicSettings {
    const { keyCipher: _private, ...publicFields } = this.saved;
    return { ...publicFields, dataHome: this.home, hasKey: !!(this.saved.keyCipher || process.env.DEEPSEEK_API_KEY), keySource: this.saved.keyCipher ? 'saved' : process.env.DEEPSEEK_API_KEY ? 'environment' : 'none' };
  }
  key(): string {
    if (!this.saved.keyCipher) return process.env.DEEPSEEK_API_KEY?.trim() ?? '';
    const data = Buffer.from(this.saved.keyCipher, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.secret, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
  async save(raw: unknown) {
    const next = SettingsInput.parse(raw);
    const baseUrl = modelBaseUrl(next.baseUrl);
    if (next.workbenchRoot) {
      const script = path.join(path.resolve(next.workbenchRoot), 'workbench.py');
      if (!(await stat(script).catch(() => null))?.isFile()) throw new AppError(400, '工作台目录中未找到 workbench.py。', 'WORKBENCH_MISSING');
    }
    let keyCipher = next.clearKey ? undefined : this.saved.keyCipher;
    if (next.apiKey) {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.secret, iv);
      const encrypted = Buffer.concat([cipher.update(next.apiKey), cipher.final()]);
      keyCipher = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    }
    const candidate: StoredConfig = { model: next.model, baseUrl, maxTokens: next.maxTokens, vision: next.vision, protocol: 'deepseek-messages', workbenchRoot: next.workbenchRoot ? path.resolve(next.workbenchRoot) : '', python: next.python, keyCipher };
    await atomicJson(path.join(this.home, 'settings.json'), candidate);
    this.saved = candidate;
    return this.public();
  }
}
