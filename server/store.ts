import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, loadJson, validId } from './files.js';
import type { BotProject, BotTask, Message, ProjectSummary, UploadRecord } from '../shared/types.js';
import { AppError } from './errors.js';

interface Database { version: 1; projects: Record<string, BotProject>; uploads: Record<string, UploadRecord> }
export class Store {
  private db: Database = { version: 1, projects: {}, uploads: {} };
  private serial: Promise<unknown> = Promise.resolve();
  readonly file: string;
  constructor(readonly home: string) { this.file = path.join(home, 'state.json'); }
  async init() {
    this.db = await loadJson(this.file, this.db);
    if (this.db.version !== 1 || !this.db.projects || !this.db.uploads) throw new Error('不支持的项目库格式，请勿覆盖原文件。');
    for (const project of Object.values(this.db.projects)) {
      for (const task of project.tasks) if (['pending', 'running', 'waiting'].includes(task.status)) {
        task.status = 'interrupted'; task.finishedAt = new Date().toISOString();
        task.error = '上次服务退出时任务尚未完成。历史材料已保留，可以继续。'; delete task.question;
      }
    }
    await atomicJson(this.file, this.db);
  }
  private async change<T>(callback: () => T): Promise<T> {
    const run = this.serial.then(async () => {
      const previous = structuredClone(this.db);
      try { const result = callback(); await atomicJson(this.file, this.db); return structuredClone(result); }
      catch (e) { this.db = previous; throw e; }
    });
    this.serial = run.catch(() => undefined); return run;
  }
  list(): ProjectSummary[] {
    return Object.values(this.db.projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(p => ({
      id: p.id, title: p.title, intent: p.intent, createdAt: p.createdAt, updatedAt: p.updatedAt,
      status: p.tasks.at(-1)?.status ?? 'idle', lastMessage: p.messages.at(-1)?.content.slice(0, 180) ?? '',
    }));
  }
  get(id: string): BotProject {
    validId(id); const p = this.db.projects[id];
    if (!p) throw new AppError(404, '项目不存在。', 'PROJECT_MISSING');
    return structuredClone(p);
  }
  async create(id: string, title: string, intent: BotProject['intent']) {
    validId(id);
    return this.change(() => {
      if (this.db.projects[id]) return this.db.projects[id];
      const at = new Date().toISOString();
      return this.db.projects[id] = { id, title, intent, createdAt: at, updatedAt: at, messages: [], uploads: [], tasks: [], sessionId: randomUUID(), runtimeStarted: false };
    });
  }
  async update<T>(id: string, fn: (project: BotProject) => T): Promise<T> {
    return this.change(() => {
      const p = this.db.projects[id]; if (!p) throw new AppError(404, '项目不存在。');
      const result = fn(p); p.updatedAt = new Date().toISOString(); return result;
    });
  }
  async addUpload(record: UploadRecord) { return this.change(() => this.db.uploads[record.id] = record); }
  upload(id: string): UploadRecord {
    validId(id); const u = this.db.uploads[id]; if (!u) throw new AppError(404, '素材不存在。', 'UPLOAD_MISSING'); return structuredClone(u);
  }
  async bindUploads(projectId: string, ids: string[]) {
    return this.change(() => {
      const project = this.db.projects[projectId]; if (!project) throw new AppError(404, '项目不存在。');
      for (const id of ids) {
        const u = this.db.uploads[id];
        if (!u || (u.projectId && u.projectId !== projectId)) throw new AppError(403, '素材不属于当前项目。', 'UPLOAD_SCOPE');
        u.projectId = projectId;
        if (!project.uploads.some(v => v.id === id)) project.uploads.push({ ...u });
      }
      return project.uploads;
    });
  }
  async beginTask(projectId: string, task: BotTask, message: Message, uploadIds: string[]) {
    return this.change(() => {
      const project = this.db.projects[projectId]; if (!project) throw new AppError(404, '项目不存在。');
      if (project.tasks.some(t => ['pending', 'running', 'waiting'].includes(t.status))) throw new AppError(409, '当前项目已有任务正在进行。');
      for (const id of uploadIds) {
        const u = this.db.uploads[id];
        if (!u || (u.projectId && u.projectId !== projectId)) throw new AppError(403, '素材不属于当前项目。', 'UPLOAD_SCOPE');
        u.projectId = projectId;
        if (!project.uploads.some(item => item.id === id)) project.uploads.push({ ...u });
      }
      project.intent = task.intent; project.tasks.push(task); project.messages.push(message); project.updatedAt = new Date().toISOString();
      return task;
    });
  }
}
