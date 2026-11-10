import { DeepSeekHarness, type HarnessNotification } from '@deepseek-ai/dsh-sdk-client';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Config } from './config.js';
import { Store } from './store.js';
import { Workbench, type Json } from './workbench.js';
import { AppError, errorText } from './errors.js';
import type { BotTask, PendingQuestion } from '../shared/types.js';

export const DSH_VERSION = '0.2.2-rc.1';
const SAFE_ENV = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMFILES', 'ProgramFiles(x86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
export function runtimeEnvironment(key: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SAFE_ENV) if (process.env[name]) env[name] = process.env[name];
  env.DEEPSEEK_API_KEY = key; env.NODE_NO_WARNINGS = '1'; return env;
}

export function restrictedPatch(options: { baseUrl: string; model: string; maxTokens: number; vision: boolean; plugin?: string; persona: string }) {
  return [
    ...['persistent-pwsh', 'persistent-bash', 'tool-working-directory', 'session-log-deepseek', 'plugin-package-inventory-deepseek'].map(id => ({ id, disabled: true })),
    { id: 'tool-fs', config: { read: false, readImage: !!options.plugin, write: false, edit: false } },
    { id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: options.baseUrl, maxTokens: options.maxTokens, thinking: 'disabled', reasoningEffort: 'off', streamIdleTimeoutMs: 120000, models: [{ id: options.model, contextWindow: 1000000, maxTokens: options.maxTokens, inputModalities: options.vision ? ['text', 'image'] : ['text'] }] } },
    { id: 'system-prompt', config: { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: options.persona } },
    ...(options.plugin ? [{ insert: [{ id: 'media-bot', name: options.plugin }] }] : []),
  ];
}

interface LiveRun {
  taskId: string; projectId: string; token: string; harness?: DeepSeekHarness;
  cancelled: boolean; steps: number;
  completion?: Promise<void>;
  question?: { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void };
}

async function persistedSession(home: string, id: string) {
  const root = path.join(home, 'sessions');
  // DSH JSONL persistence groups sessions into workspace buckets. Do not
  // mistake a missing flat path for missing history, or overwrite the log.
  const direct = await stat(path.join(root, id)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (direct?.isDirectory()) return true;
  const buckets = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const bucket of buckets) if (bucket.isDirectory()) {
    const found = await stat(path.join(root, bucket.name, id)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (found?.isDirectory()) return true;
  }
  return false;
}

export class Runtime {
  private runs = new Map<string, LiveRun>();
  private clients = new Map<string, DeepSeekHarness>();
  private resumed = new Set<string>();
  private listeners = new Set<(projectId: string) => void>();
  private origin = '';
  constructor(readonly config: Config, readonly store: Store, readonly wb: Workbench, readonly root: string) {}
  setOrigin(origin: string) { this.origin = origin; }
  onChange(fn: (projectId: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(pid: string) { for (const fn of this.listeners) fn(pid); }
  active() { return this.runs.size; }
  questionProject(taskId: string, questionId?: string) {
    const live = this.runs.get(taskId);
    if (!live?.question || live.cancelled || (questionId !== undefined && live.question.id !== questionId)) throw new AppError(409, '这个问题已失效，请刷新当前任务。');
    return live.projectId;
  }
  async progress(pid: string, taskId: string, label: string, detail?: string, error = false) {
    await this.store.update(pid, p => {
      const t = p.tasks.find(t => t.id === taskId); if (!t) return;
      t.progress.push({ at: new Date().toISOString(), label, detail, error });
      if (t.progress.length > 120) t.progress.splice(0, t.progress.length - 120);
    });
    this.emit(pid);
  }
  private async harness(pid: string, live: LiveRun): Promise<DeepSeekHarness> {
    const settings = this.config.public(); const key = this.config.key();
    if (!key) throw new AppError(400, '请先在设置中配置模型 API Key。', 'MODEL_NOT_CONFIGURED');
    const fingerprint = createHash('sha256').update(`${settings.baseUrl}\n${settings.model}\n${settings.vision}`).digest('hex');
    const project = this.store.get(pid);
    if (project.runtimeFingerprint && project.runtimeFingerprint !== fingerprint) {
      await this.clients.get(pid)?.close(); this.clients.delete(pid); this.resumed.delete(pid);
      await this.store.update(pid, p => { p.sessionId = randomUUID(); p.runtimeStarted = false; p.runtimeFingerprint = fingerprint; });
    }
    const home = path.join(this.config.home, 'dsh', pid); await mkdir(home, { recursive: true });
    const persona = await readFile(path.join(this.root, 'skills', 'media-bot', 'SKILL.md'), 'utf8');
    const patchFile = path.join(home, 'media.patch.json');
    const plugin = pathToFileURL(path.join(this.root, 'runtime', 'media-plugin.mjs')).href;
    await writeFile(patchFile, JSON.stringify(restrictedPatch({ ...settings, plugin, persona }), null, 2));
    const env = runtimeEnvironment(key);
    env.MEDIA_BOT_BRIDGE = `${this.origin}/internal/runtime/${live.taskId}`;
    env.MEDIA_BOT_TOKEN = live.token;
    env.MEDIA_BOT_IMAGE_ROOTS = JSON.stringify([this.wb.projectFolder(pid), ...this.store.get(pid).uploads.map(u => u.path), home]);
    // A fresh owned process per turn gives the bridge a single project/task fence.
    await this.clients.get(pid)?.close(); this.clients.delete(pid); this.resumed.delete(pid);
    const instance = new DeepSeekHarness({ profile: 'sdk-minimal', dshHome: home, cwd: this.wb.projectFolder(pid), processCwd: this.wb.projectFolder(pid), patches: [patchFile], provider: 'deepseek-official', model: settings.model, maxTokens: settings.maxTokens, env, initializeTimeoutMs: 60000, disposeEofGraceMs: 2000 });
    this.clients.set(pid, instance); live.harness = instance;
    const latest = this.store.get(pid);
    const persisted = await persistedSession(home, latest.sessionId);
    if (latest.runtimeStarted && !persisted) throw new AppError(409, '此项目的历史 DSH 会话文件缺失。项目资料仍保留，请保留数据目录并检查备份，不会静默覆盖历史。', 'SESSION_FILES_MISSING');
    if (persisted) { await instance.resumeSession(latest.sessionId); this.resumed.add(pid); }
    else await instance.start();
    await this.store.update(pid, p => { p.runtimeStarted = persisted; p.runtimeFingerprint = fingerprint; });
    return instance;
  }
  async start(pid: string, task: BotTask, intake: Json | (() => Promise<Json>)) {
    const prior = [...this.runs.values()].find(r => r.projectId === pid);
    if (prior) {
      const status = this.store.get(pid).tasks.find(t => t.id === prior.taskId)?.status;
      if (status && ['done', 'failed', 'interrupted'].includes(status) && prior.completion) await prior.completion;
      else throw new AppError(409, '当前项目已有任务正在进行。', 'PROJECT_BUSY');
    }
    if (this.runs.size >= 2) throw new AppError(429, '最多同时处理两个项目，请等待一个任务完成。', 'RUNTIME_BUSY');
    const live: LiveRun = { projectId: pid, taskId: task.id, token: randomBytes(32).toString('hex'), cancelled: false, steps: 0 };
    this.runs.set(task.id, live);
    live.completion = this.execute(live, task, intake);
    void live.completion.catch(error => console.error('自媒体任务清理未完成：', errorText(error)));
  }
  private async execute(live: LiveRun, task: BotTask, preparation: Json | (() => Promise<Json>)) {
    const pid = live.projectId;
    let watcher: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.store.update(pid, p => { p.tasks.find(t => t.id === task.id)!.status = 'running'; });
      await this.progress(pid, task.id, '正在登记素材并恢复项目上下文');
      const intake = typeof preparation === 'function' ? await preparation() : preparation;
      if (live.cancelled) return;
      await this.progress(pid, task.id, '正在启动自媒体专用 DSH', '只开放工作台工具，未开放通用终端或其他 Bot。');
      const harness = await this.harness(pid, live);
      if (live.cancelled) { await harness.close(); return; }
      watcher = setTimeout(() => { void this.cancel(task.id, '本轮已达到 30 分钟运行边界；历史内容保留，可继续。'); }, 30 * 60 * 1000);
      const project = this.store.get(pid);
      const declarations = project.uploads.map(u => ({ name: u.name, nature: u.nature, declarationOnly: true }));
      const prompt = `当前项目 ID：${pid}\n当前项目：${project.title}\n本轮任务类型：${task.intent}\n用户本轮要求：\n${task.prompt}\n\n附件性质（用户声明，未经独立核验）：${JSON.stringify(declarations)}\n\n统一入口已完成：${JSON.stringify({ start_at: intake.start_at, plan: intake.plan, workflow_status: intake.workflow_status })}\n\n项目已固定，不要另建项目。先调用 media_context 读取真实材料，再按需读取 SKILL.md 和当前环节说明。内容完成后通过工作台 API 实际保存。没有附件但用户提供了文字需求时，可将其中的原始材料登记为当前项目来源；不能捏造证据。`;
      const result = await harness.run(prompt, { sessionId: project.sessionId, onNotification: notification => { void this.notification(live, notification).catch(error => console.error('DSH 进度记录失败：', errorText(error))); } });
      if (live.cancelled) return;
      const response = result.finalResponse.trim();
      const failed = result.finishReason === 'error' || result.finishReason === 'max-tokens' || result.finishReason === 'aborted';
      await this.store.update(pid, p => {
        const t = p.tasks.find(t => t.id === task.id)!;
        t.status = failed ? 'failed' : 'done'; t.finishedAt = new Date().toISOString();
        if (failed) t.error = response || `模型任务未正常完成：${result.finishReason}`;
        p.messages.push({ id: randomUUID(), role: 'assistant', content: response || (failed ? '任务未能完成，请检查连接后继续。' : '本轮处理已结束，请查看成果或继续补充要求。'), at: new Date().toISOString(), taskId: task.id, error: failed });
      });
      await this.progress(pid, task.id, failed ? '本轮未完成' : '本轮处理结束', '实际成果、后台作业和人工审阅状态分别展示。', failed);
    } catch (error) {
      if (!live.cancelled) {
        const message = errorText(error);
        await this.store.update(pid, p => {
          const t = p.tasks.find(t => t.id === task.id)!; t.status = 'failed'; t.error = message; t.finishedAt = new Date().toISOString(); delete t.question;
          p.messages.push({ id: randomUUID(), role: 'assistant', content: `本轮没有完成：${message}\n\n已保存的项目和素材仍保留。`, at: new Date().toISOString(), taskId: task.id, error: true });
        });
      }
    } finally {
      if (watcher) clearTimeout(watcher);
      live.question?.reject(new Error('任务已结束。'));
      await live.harness?.close().catch(() => undefined);
      const project = this.store.get(pid);
      const persisted = await persistedSession(path.join(this.config.home, 'dsh', pid), project.sessionId);
      await this.store.update(pid, p => { if (persisted || !p.runtimeStarted) p.runtimeStarted = persisted; });
      if (this.clients.get(pid) === live.harness) this.clients.delete(pid);
      this.runs.delete(task.id); this.emit(pid);
    }
  }
  private async notification(live: LiveRun, notification: HarnessNotification) {
    if (live.cancelled) return;
    const event = (notification.params as Json).event as Json | undefined;
    const type = event?.type ?? event?.kind;
    const data = event?.data ?? event;
    if (type === 'step/start') {
      live.steps++;
      if (live.steps > 60) { await this.cancel(live.taskId, '已达到单轮 60 次模型请求的安全边界，请查看当前成果后继续。'); return; }
    }
    if (type === 'tool/call') {
      const call = data?.call ?? data?.toolCall ?? data;
      const name = call?.name ?? call?.toolName;
      if (typeof name === 'string') await this.progress(live.projectId, live.taskId, toolLabel(name));
    }
    if (type === 'tool/result' && data?.message?.isError) await this.progress(live.projectId, live.taskId, '正在核对工具反馈', undefined, true);
    if (data?.usage) {
      const u = data.usage;
      await this.store.update(live.projectId, p => {
        const t = p.tasks.find(t => t.id === live.taskId)!;
        const old = t.usage ?? { input: 0, output: 0, cacheRead: 0 };
        t.usage = { input: old.input + Number(u.inputTokens ?? u.input_tokens ?? 0), output: old.output + Number(u.outputTokens ?? u.output_tokens ?? 0), cacheRead: old.cacheRead + Number(u.cacheReadTokens ?? u.cache_read_input_tokens ?? 0) };
      });
    }
  }
  async cancel(taskId: string, reason = '已停止 Bot 继续处理。已经启动的工作台渲染可能仍在运行，其状态在成果区单独显示。') {
    const live = this.runs.get(taskId); if (!live) throw new AppError(409, '任务已经结束。');
    live.cancelled = true; live.question?.reject(new Error('用户已中断任务。')); live.question = undefined;
    await this.store.update(live.projectId, p => {
      const t = p.tasks.find(t => t.id === taskId)!; t.status = 'interrupted'; t.error = reason; t.finishedAt = new Date().toISOString(); delete t.question;
    });
    this.emit(live.projectId); await live.harness?.close().catch(() => undefined);
  }
  async close() {
    const current = [...this.runs.values()];
    for (const live of current) { live.cancelled = true; live.question?.reject(new Error('服务正在退出。')); }
    await Promise.allSettled([...this.clients.values()].map(c => c.close()));
    await Promise.allSettled(current.flatMap(r => r.completion ? [r.completion] : []));
    this.clients.clear();
  }
  async tool(taskId: string, token: string, name: string, args: Json) {
    const live = this.runs.get(taskId);
    if (!live || live.cancelled || token !== live.token) throw new AppError(403, '运行时授权已失效。', 'RUNTIME_SCOPE');
    const pid = live.projectId;
    await this.progress(pid, taskId, toolLabel(name));
    if (name === 'media_context') {
      const context = await this.wb.context(pid);
      return { ...context, skill: { entry: 'SKILL.md', references: Object.keys(context.skill.files).filter(n => n.startsWith('references/')), bundle_sha256: context.skill.bundle_sha256 } };
    }
    if (name === 'media_reference') return this.wb.reference(String(args.name));
    if (name === 'media_doctor') {
      const d = await this.wb.doctor();
      return { platform: d.platform, model_present: d.model_present, mlx_model_present: d.mlx_model_present, asr_backend: d.asr_backend, requested_device: d.requested_device, gpu_hardware: d.gpu_hardware, asr_attempt_plan: d.asr_attempt_plan, asr_plan_error: d.asr_plan_error, require_gpu: d.require_gpu, dependencies: d.dependencies, executables: Object.fromEntries(Object.entries(d.executables ?? {}).map(([k, v]) => [k, !!v])), visual_editing: d.visual_editing, shot_library: d.shot_library, gpu_setup_guide: 'docs/accelerators.md', limitation: '这是环境检测，不是本轮ASR/GPU/渲染验收。不得自动安装或下载模型。' };
    }
    if (name === 'media_schema') return this.wb.request('GET', args.name === 'capabilities' ? '/api/agent/v1/capabilities' : `/api/agent/v1/schemas/${String(args.name).replace(/[^a-z_-]/g, '')}`);
    if (name === 'media_request') {
      const body = args.body_json === undefined ? undefined : JSON.parse(args.body_json);
      const result = await this.wb.callForProject(pid, String(args.method), String(args.path), body, this.store.get(pid).uploads.map(u => u.path));
      this.emit(pid); return result;
    }
    if (name === 'media_frame') return this.wb.frame(pid, String(args.media_id), Number(args.seconds), args.export_id);
    if (name === 'media_ask_user') return this.ask(live, String(args.question), Array.isArray(args.options) ? args.options.map(String) : []);
    if (name === 'media_wait_job') {
      const end = Date.now() + Math.max(1, Math.min(60, Number(args.seconds) || 30)) * 1000;
      while (!live.cancelled) {
        const job = await this.wb.request('GET', `/api/projects/${pid}/jobs/${String(args.job_id).replace(/[^a-z0-9_-]/gi, '')}`) as Json;
        this.emit(pid);
        if (['done', 'failed'].includes(job.status) || Date.now() > end) return job;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new AppError(409, '任务已中断。');
    }
    throw new AppError(403, '未开放此工具。', 'UNKNOWN_TOOL');
  }
  private async ask(live: LiveRun, question: string, options: string[]) {
    if (!question.trim() || question.length > 6000) throw new AppError(400, '无效的问题。');
    if (live.question) throw new AppError(409, '已有一个问题正在等待回答。');
    const id = randomUUID();
    const pending: PendingQuestion = { id, kind: 'question', title: question, questions: [{ id: 'answer', question, options: options.slice(0, 10).map(label => ({ label })) }] };
    const result = new Promise((resolve, reject) => { live.question = { id, resolve, reject }; });
    await this.store.update(live.projectId, p => { const t = p.tasks.find(t => t.id === live.taskId)!; t.status = 'waiting'; t.question = pending; });
    this.emit(live.projectId); return result;
  }
  async answer(taskId: string, questionId: string, answer: string, attachmentIds: string[] = []) {
    const live = this.runs.get(taskId);
    if (!live?.question || live.question.id !== questionId) throw new AppError(409, '这个问题已失效，请刷新当前任务。');
    const pending = live.question; live.question = undefined;
    await this.store.update(live.projectId, p => {
      const t = p.tasks.find(t => t.id === taskId)!; t.status = 'running'; delete t.question;
      p.messages.push({ id: randomUUID(), role: 'user', content: answer, at: new Date().toISOString(), taskId, attachmentIds });
    });
    pending.resolve({ answer, materialsAdded: attachmentIds.length > 0, next: '用户补充后请重新读取 media_context。' }); this.emit(live.projectId);
  }
}

function toolLabel(name: string) {
  return ({ media_context: '正在核对项目与版本', media_reference: '正在读取当前环节的方法', media_schema: '正在核对工作台接口', media_doctor: '正在检查真实媒体运行环境', media_request: '正在执行自媒体工作台操作', media_frame: '正在提取实际视频帧', read_image: '正在查看图片', media_ask_user: '需要你补充一个信息', media_wait_job: '正在等待后台处理' } as Record<string, string>)[name] ?? '正在处理自媒体任务';
}

export async function testModel(config: Config, root: string) {
  if (!config.key()) throw new AppError(400, '请先配置 API Key。');
  const settings = config.public(); const home = path.join(config.home, 'connection-check'); await mkdir(home, { recursive: true });
  const patchFile = path.join(home, 'check.patch.json');
  await writeFile(patchFile, JSON.stringify(restrictedPatch({ ...settings, maxTokens: 128, vision: false, persona: '只回复“连接成功”，不调用工具。' })));
  await using harness = new DeepSeekHarness({ profile: 'sdk-minimal', dshHome: home, cwd: home, processCwd: home, patches: [patchFile], env: runtimeEnvironment(config.key()), provider: 'deepseek-official', model: settings.model, maxTokens: 128, initializeTimeoutMs: 60000, requestTimeoutMs: 120000 });
  const response = await harness.run('请回复连接成功。');
  if (response.finishReason === 'error' || !response.finalResponse) throw new AppError(502, response.finalResponse || '模型没有返回有效文本。', 'MODEL_TEST_FAILED');
  return { ok: true, response: response.finalResponse, note: '已通过官方 DSH 运行时发起一次真实模型请求，可能产生费用。' };
}
