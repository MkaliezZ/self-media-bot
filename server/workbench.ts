import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { Config } from './config.js';
import { AppError, errorText } from './errors.js';
import { confinedFile, isInside, validId } from './files.js';
import { runtimePath } from './security.js';
import type { UploadRecord } from '../shared/types.js';

const execute = promisify(execFile);
export type Json = Record<string, any>;
export class Workbench {
  private base?: string;
  private pending?: Promise<string>;
  private configSignature = '';
  readonly state: string;
  readonly projectsRoot: string;
  constructor(readonly config: Config, readonly root: string) {
    this.state = path.join(config.home, 'workbench'); this.projectsRoot = path.join(this.state, 'projects');
  }
  private async bridge(doctor = false) {
    const settings = this.config.public();
    if (!settings.workbenchRoot) throw new AppError(503, '尚未找到自媒体工作台，请在设置中选择已安装的工作台目录。', 'WORKBENCH_MISSING');
    const args = ['-B', '-X', 'utf8', path.join(this.root, 'scripts', 'workbench_bridge.py'), '--root', settings.workbenchRoot, '--state', this.state];
    if (doctor) args.push('--doctor');
    try {
      const { stdout } = await execute(settings.python, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      const result = JSON.parse(stdout.trim());
      if (result.error) throw new Error(result.error);
      return result;
    } catch (error) { throw new AppError(503, `自媒体工作台暂不可用：${errorText(error)}`, 'WORKBENCH_UNAVAILABLE'); }
  }
  async ensure(): Promise<string> {
    const settings = this.config.public();
    const signature = `${settings.workbenchRoot}\n${settings.python}`;
    if (signature !== this.configSignature) { this.base = undefined; this.configSignature = signature; }
    if (this.base) {
      try {
        const response = await fetch(`${this.base}/api/status`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
        const status = await response.json() as Json;
        if (response.ok && path.resolve(status.root) === path.resolve(settings.workbenchRoot)) return this.base;
      } catch { /* Restart only this adapter's isolated service through the official entry. */ }
      this.base = undefined;
    }
    if (!this.pending) this.pending = (async () => {
      const result = await this.bridge();
      const url = new URL(result.base_url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.username || url.password) throw new AppError(503, '工作台返回了非本机地址。', 'INVALID_WORKBENCH');
      this.base = url.origin; return this.base;
    })().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async request(method: string, route: string, body?: unknown, signal?: AbortSignal): Promise<Json | any[]> {
    const base = await this.ensure();
    const response = await fetch(`${base}${route}`, {
      method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let data: any; try { data = JSON.parse(raw); } catch { throw new AppError(502, '工作台返回了无法读取的响应。', 'INVALID_WORKBENCH_RESPONSE'); }
    if (!response.ok) throw new AppError(response.status, typeof data.detail === 'string' ? data.detail : `工作台操作未通过（${response.status}）`, 'WORKBENCH_REQUEST_FAILED', data);
    return data;
  }
  async context(pid: string) { validId(pid); return await this.request('GET', `/api/agent/v1/projects/${pid}/context`) as Json; }
  async intake(body: Json) { return await this.request('POST', '/api/agent/v1/tasks', body) as Json; }
  async applyUploadDeclarations(pid: string, uploads: UploadRecord[], registered: Json[]) {
    for (let i = 0; i < uploads.length; i++) {
      const item = registered[i]; const upload = uploads[i];
      if (item?.kind !== 'media' || upload.nature === 'unknown') continue;
      const context = await this.context(pid); const media = context.media.find((m: Json) => m.id === item.id);
      if (!media || media.media_nature === upload.nature) continue;
      await this.request('PUT', `/api/projects/${pid}/media/${item.id}/metadata`, { revision: context.project.revision, media_nature: upload.nature, source_note: '用户在上传界面明确声明；未经独立核验。', usage_scope: '' });
    }
  }
  async doctor() { return this.bridge(true); }
  async stopIfIdle(): Promise<boolean> {
    // Test/embedding cleanup only. Never start a service just to stop it, and
    // never signal a PID without verifying its live service and command line.
    const entries = await readdir(path.join(this.state, 'services')).catch(() => []);
    for (const entry of entries.filter(e => e.endsWith('.json'))) {
      try {
        const info = JSON.parse(await readFile(path.join(this.state, 'services', entry), 'utf8'));
        if (!Number.isSafeInteger(info.pid) || info.pid < 1 || path.resolve(info.root) !== path.resolve(this.config.public().workbenchRoot)) continue;
        const url = new URL(info.base_url);
        if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') continue;
        const status = await fetch(`${url.origin}/api/status`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()) as Json;
        if (path.resolve(status.root) !== path.resolve(info.root)) continue;
        const projects = await fetch(`${url.origin}/api/projects`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()) as Json[];
        let busy = false;
        for (const project of projects) {
          const jobs = await fetch(`${url.origin}/api/projects/${validId(project.id)}/jobs`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()) as Json[];
          if (jobs.some(j => ['queued', 'running'].includes(j.status))) busy = true;
        }
        if (busy) continue;
        const command = process.platform === 'win32'
          ? (await execute('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${info.pid}').CommandLine`], { timeout: 5000, windowsHide: true })).stdout
          : process.platform === 'linux' ? (await readFile(`/proc/${info.pid}/cmdline`, 'utf8')).replaceAll('\0', ' ') : (await execute('ps', ['-p', String(info.pid), '-o', 'command='], { timeout: 5000 })).stdout;
        const script = path.join(info.root, 'workbench.py');
        if (!command.includes(script) || !command.includes('serve') || !command.includes(`--port ${url.port}`)) continue;
        process.kill(info.pid, 'SIGTERM'); return true;
      } catch { /* Gone, busy, changed, or unverifiable means do not touch it. */ }
    }
    return false;
  }
  projectFolder(pid: string) { return path.join(this.projectsRoot, validId(pid)); }
  async reference(name: string) {
    const root = this.config.public().workbenchRoot;
    if (!root) throw new AppError(503, '尚未配置工作台。');
    const normalized = name.replaceAll('\\', '/');
    if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes(':')) throw new AppError(403, '只能读取自媒体方法文档。');
    let target: string;
    if (normalized === 'AGENTS.md') target = path.join(root, 'AGENTS.md');
    else if (normalized === 'SKILL.md' || normalized.startsWith('references/')) target = path.join(root, 'skills', 'self-media-workflow', normalized);
    else if (normalized.startsWith('docs/')) target = path.join(root, normalized);
    else throw new AppError(403, '只能读取自媒体方法文档。');
    if (!/\.md$/i.test(target)) throw new AppError(403, '只读取 Markdown 方法文档。');
    const actual = await confinedFile(target, [path.join(root, 'skills', 'self-media-workflow'), path.join(root, 'docs'), path.join(root, 'AGENTS.md')]);
    const info = await stat(actual); if (info.size > 500000) throw new AppError(413, '方法文档过大，请选择具体环节。');
    return { name: normalized, text: await readFile(actual, 'utf8') };
  }
  async callForProject(pid: string, method: string, route: string, body: unknown, uploadPaths: string[], signal?: AbortSignal) {
    runtimePath(method, route, pid);
    await this.validatePaths(body, pid, uploadPaths);
    // The legacy unversioned document endpoint would bypass structured artifacts.
    if (/\/documents\//.test(route)) throw new AppError(403, '请使用有来源和版本检查的 artifacts 接口保存成果。', 'UNSTRUCTURED_WRITE');
    return this.request(method, route, body, signal);
  }
  private async validatePaths(value: unknown, pid: string, uploaded: string[], key = ''): Promise<void> {
    if (Array.isArray(value)) { for (const child of value) await this.validatePaths(child, pid, uploaded, key); return; }
    if (value && typeof value === 'object') { for (const [k, child] of Object.entries(value)) await this.validatePaths(child, pid, uploaded, k); return; }
    if (typeof value !== 'string' || !/(^path$|_path$)/i.test(key)) return;
    if (!value) return;
    const roots = [this.projectFolder(pid), ...uploaded];
    if (key === 'font_path') {
      roots.push(process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Fonts') : '/usr/share/fonts');
      if (!/\.(ttf|ttc|otf)$/i.test(value)) throw new AppError(403, '只允许字体文件。');
    }
    if (!path.isAbsolute(value) || value.startsWith('\\\\') || value.startsWith('//')) throw new AppError(403, '文件必须属于当前项目或用户上传的材料。', 'TOOL_FILE_SCOPE');
    await confinedFile(value, roots);
  }
  async exportFiles(pid: string, eid: string) {
    validId(eid); const folder = path.join(this.projectFolder(pid), 'exports', eid);
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    return entries.filter(e => e.isFile() && /\.(mp4|srt|json|wav|mp3|png|jpg)$/i.test(e.name)).map(e => e.name);
  }
  async projectFile(pid: string, relative: string) {
    if (relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new AppError(403, '无效的项目文件。');
    const root = this.projectFolder(pid); const full = path.resolve(root, relative);
    if (!isInside(root, full)) throw new AppError(403, '无效的项目文件。');
    return confinedFile(full, [root]);
  }
  async frame(pid: string, mediaId: string, seconds: number, exportId?: string) {
    const context = await this.context(pid);
    let relative: string | undefined;
    if (exportId) {
      const job = (context.jobs as Json[]).find(j => j.status === 'done' && j.result?.export_id === exportId);
      if (!job) throw new AppError(404, '成片尚未完成。');
      relative = `exports/${validId(exportId)}/${job.result.primary_video ?? (job.kind === 'timeline_export' ? 'timeline.mp4' : 'reviewed_cut.mp4')}`;
    } else relative = (context.media as Json[]).find(m => m.id === mediaId)?.relative_path;
    if (!relative || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new AppError(400, '请指定当前项目的视频与有效秒数。');
    const input = await this.projectFile(pid, relative);
    const folder = path.join(this.projectFolder(pid), 'bot-previews'); await mkdir(folder, { recursive: true });
    const output = path.join(folder, `${validId(exportId ?? mediaId)}-${seconds.toFixed(3).replace('.', '-')}.jpg`);
    await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', input, '-frames:v', '1', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease', '-update', '1', output], { timeout: 30000, windowsHide: true });
    if (!(await stat(output)).size) throw new AppError(422, '没有提取到视频画面，请检查时间点。');
    return { path: output, seconds, next: '使用 read_image 查看这个实际帧；生成文件并不等于完成审图。' };
  }
}
