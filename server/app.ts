import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { Config } from './config.js';
import { Store } from './store.js';
import { Workbench, type Json } from './workbench.js';
import { Runtime, DSH_VERSION, testModel } from './runtime.js';
import { AppError, errorText } from './errors.js';
import { checkBrowserRequest, sameSecret } from './security.js';
import { confinedFile, fileName, validId } from './files.js';
import { buildProjectView } from './artifacts.js';
import type { BotTask, Nature, UploadRecord } from '../shared/types.js';

const intent = z.enum(['auto', 'full', 'diagnose', 'topics', 'script', 'lighting', 'edit', 'publish', 'review']);
const TaskInput = z.object({ prompt: z.string().trim().min(1).max(10000), intent: intent.default('auto'), projectId: z.string().optional(), title: z.string().trim().min(1).max(120).optional(), uploadIds: z.array(z.string()).max(30).default([]) }).strict();
const SUPPORTED = new Set(['.txt', '.md', '.json', '.csv', '.png', '.jpg', '.jpeg', '.mp4', '.mov', '.mkv', '.webm', '.wav', '.mp3', '.m4a']);
const MIME: Record<string, string> = { '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.srt': 'text/plain; charset=utf-8' };

export interface AppOptions { root: string; home?: string; dev?: boolean }
export async function createApp(options: AppOptions) {
  const config = new Config(options.home); await config.init();
  const store = new Store(config.home); await store.init();
  const wb = new Workbench(config, options.root);
  const runtime = new Runtime(config, store, wb, options.root);
  const csrf = randomBytes(32).toString('hex'); const cookie = randomBytes(32).toString('hex');
  let origin = '';
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, requestTimeout: 120000, routerOptions: { maxParamLength: 3000 } });
  await app.register(multipart, { limits: { files: 1, fileSize: 1024 * 1024 * 1024, fields: 3 } });
  const events = new Set<{ projectId?: string; send: (text: string) => void; end: () => void }>();
  runtime.onChange(pid => { for (const client of events) if (!client.projectId || client.projectId === pid) client.send(`event: change\ndata: ${JSON.stringify({ projectId: pid })}\n\n`); });

  app.addHook('onRequest', async (request, reply) => {
    if (!origin) return;
    // Authorize the matched route, not its possibly non-canonical raw URL.
    const pathname = request.routeOptions.url ?? request.url.split('?')[0];
    if (pathname.startsWith('/internal/runtime/')) return;
    checkBrowserRequest(request.headers, origin, false, csrf);
    if (!pathname.startsWith('/api/')) return;
    if (pathname === '/api/bootstrap') return;
    const session = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('media_session='))?.slice('media_session='.length);
    if (!sameSecret(session, cookie)) throw new AppError(401, '本机会话已失效，请刷新页面。', 'SESSION_EXPIRED');
    checkBrowserRequest(request.headers, origin, !['GET', 'HEAD', 'OPTIONS'].includes(request.method), csrf);
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff'); reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', options.dev ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:*; object-src 'none'; frame-ancestors 'none'" : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    if (_request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: '请检查输入内容。', code: 'INVALID_INPUT', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    const status = error instanceof AppError ? error.status : (error as any).statusCode ?? 500;
    return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: errorText(error), code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', ...(error instanceof AppError && error.details ? { details: error.details } : {}) });
  });

  app.get('/api/bootstrap', async (_request, reply) => {
    reply.header('Set-Cookie', `media_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
    return { csrfToken: csrf, name: '自媒体 Bot', version: '0.1.0', settings: config.public() };
  });
  app.get('/api/settings', async () => config.public());
  app.put('/api/settings', async request => {
    if (runtime.active()) throw new AppError(409, '请先等待或停止正在运行的任务，再修改连接设置。');
    return config.save(request.body);
  });
  app.post('/api/settings/test-model', async request => {
    const { consent } = z.object({ consent: z.literal(true) }).strict().parse(request.body);
    if (!consent) throw new AppError(400, '需要明确同意一次模型测试调用。');
    return testModel(config, options.root);
  });
  app.get('/api/health', async () => {
    try {
      await wb.ensure();
      return { ready: config.public().hasKey, workbench: { ok: true }, model: { configured: config.public().hasKey, model: config.public().model }, runtime: { name: 'DeepSeek Harness', version: DSH_VERSION, restricted: true } };
    } catch (error) { return { ready: false, workbench: { ok: false, error: errorText(error) }, model: { configured: config.public().hasKey, model: config.public().model }, runtime: { name: 'DeepSeek Harness', version: DSH_VERSION, restricted: true } }; }
  });
  app.post('/api/diagnostics', async () => {
    const doctor = await wb.doctor();
    return { platform: doctor.platform, dependencies: doctor.dependencies, executables: Object.fromEntries(Object.entries(doctor.executables ?? {}).map(([k, v]) => [k, !!v])), modelPresent: doctor.model_present, asrBackend: doctor.asr_backend, requestedDevice: doctor.requested_device, gpu: doctor.gpu_hardware, asrAttemptPlan: doctor.asr_attempt_plan, asrPlanError: doctor.asr_plan_error, visualEditing: doctor.visual_editing?.available, shotLibrary: doctor.shot_library, modelAutoDownload: false, note: '环境检查不等于本轮 GPU 推理或音视频验收。项目数据与原工作台隔离。' };
  });
  app.get('/api/projects', async () => store.list());
  app.post('/api/projects', async request => {
    const { title } = z.object({ title: z.string().trim().min(1).max(120) }).strict().parse(request.body);
    const project = await wb.request('POST', '/api/projects', { title }) as Json;
    return store.create(project.id, title, 'auto');
  });
  app.get('/api/projects/:pid', async request => buildProjectView(store.get((request.params as any).pid), wb));
  app.get('/api/projects/:pid/sources', async request => {
    const pid = (request.params as any).pid; store.get(pid); const context = await wb.context(pid);
    return context.sources.map((s: Json) => ({ id: s.id, label: s.label, nature: s.nature, content: s.content, integrity: s.integrity }));
  });

  app.post('/api/uploads', async request => {
    const part = await request.file(); if (!part) throw new AppError(400, '请选择一个素材文件。');
    const name = fileName(part.filename); const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED.has(ext)) { part.file.resume(); throw new AppError(415, '支持 TXT/MD/JSON/CSV、PNG/JPEG 和常见音视频；暂不支持 Word/PDF/Excel 原生导入。', 'UNSUPPORTED_FILE'); }
    const id = randomUUID(); const folder = path.join(config.home, 'uploads', id); await mkdir(folder, { recursive: true });
    const full = path.join(folder, name);
    try {
      await pipeline(part.file, createWriteStream(full, { flags: 'wx', mode: 0o600 }));
      const info = await stat(full);
      if (part.file.truncated) throw new AppError(413, '文件超出 1 GiB 上传限制。');
      if (!info.size) throw new AppError(422, '文件为空。');
      if (['.txt', '.md', '.json', '.csv'].includes(ext)) {
        if (info.size > 1000000) throw new AppError(413, '文本/数据文件不能超过 1,000,000 字节。');
        const bytes = await readFile(full);
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new AppError(422, '文本文件不是有效的 UTF-8 编码，请转换编码后再上传。', 'INVALID_TEXT_ENCODING'); }
        if (!text.trim()) throw new AppError(422, '文本文件没有可用内容。', 'EMPTY_TEXT');
      }
      if (['.png', '.jpg', '.jpeg'].includes(ext) && info.size > 10 * 1024 * 1024) throw new AppError(413, '图片最多 10 MiB。');
      const record: UploadRecord = { id, name, path: full, bytes: info.size, mime: MIME[ext] ?? 'application/octet-stream', nature: 'unknown', createdAt: new Date().toISOString() };
      await store.addUpload(record);
      const { path: _private, ...safe } = record; return safe;
    } catch (error) { await unlink(full).catch(() => undefined); throw error; }
  });
  app.patch('/api/uploads/:id', async request => {
    const { nature } = z.object({ nature: z.enum(['unknown', 'recorded', 'generated', 'restored', 'mixed']) }).strict().parse(request.body);
    const upload = store.upload((request.params as any).id);
    if (upload.projectId) throw new AppError(409, '素材已登记到项目。请通过 Bot 更新其说明，避免前后不一致。');
    upload.nature = nature; await store.addUpload(upload); return { id: upload.id, nature };
  });

  app.post('/api/tasks', async request => {
    const body = TaskInput.parse(request.body);
    if (!config.public().hasKey) throw new AppError(400, '请先在设置中配置模型 API Key。', 'MODEL_NOT_CONFIGURED');
    if (runtime.active() >= 2) throw new AppError(429, '最多同时处理两个项目，请稍后再试。');
    const uploads = body.uploadIds.map(id => store.upload(id));
    for (const u of uploads) if (u.projectId && u.projectId !== body.projectId) throw new AppError(403, '素材已属于其他项目。');
    let pid = body.projectId;
    if (pid) store.get(pid);
    else {
      const title = body.title ?? body.prompt.replace(/\s+/g, ' ').slice(0, 40);
      const p = await wb.request('POST', '/api/projects', { title }) as Json; pid = p.id;
      await store.create(pid!, title, body.intent);
    }
    const projectId = pid!;
    const task: BotTask = { id: randomUUID(), projectId, intent: body.intent, prompt: body.prompt, status: 'pending', startedAt: new Date().toISOString(), progress: [] };
    await store.beginTask(projectId, task, { id: randomUUID(), role: 'user', content: body.prompt, at: task.startedAt, attachmentIds: body.uploadIds, taskId: task.id }, body.uploadIds);
    try { await runtime.start(projectId, task, async () => {
      const natures = [...new Set(uploads.map(u => u.nature))];
      const result = await wb.intake({ task: body.prompt, intent: body.intent, project: projectId, new_project: false, input_paths: uploads.map(u => u.path), source_nature: 'provided', media_nature: natures.length === 1 ? natures[0] : 'unknown', source_note: '用户通过自媒体 Bot 提供；性质为用户声明，未经独立核验。', usage_scope: '', simulation: false, session_key: `self-media-bot:${projectId}`, request_id: task.id });
      await wb.applyUploadDeclarations(projectId, uploads, result.registered ?? []);
      // Preserve the exact user instruction as a declared source, not an observed fact.
      const ctx = await wb.context(projectId);
      await wb.request('POST', `/api/agent/v1/projects/${projectId}/sources`, { revision: ctx.project.revision, label: '本轮用户要求', nature: 'provided', origin: '自媒体 Bot 对话', content: body.prompt });
      return result;
    }); } catch (error) {
      await store.update(projectId, p => {
        const t = p.tasks.find(t => t.id === task.id)!; t.status = 'failed'; t.error = errorText(error); t.finishedAt = new Date().toISOString();
        p.messages.push({ id: randomUUID(), role: 'assistant', content: `任务暂未启动：${errorText(error)}。材料已保留，稍后可在此项目继续。`, at: t.finishedAt, taskId: t.id, error: true });
      }); runtime.emit(projectId); throw error;
    }
    return { projectId, taskId: task.id };
  });
  app.post('/api/tasks/:id/cancel', async request => { await runtime.cancel((request.params as any).id); return { stopped: true, note: '已停止 Bot；后台渲染是否结束请查看实际作业状态。' }; });
  app.post('/api/tasks/:id/answer', async request => {
    const body = z.object({ questionId: z.string(), answer: z.string().trim().min(1).max(6000), uploadIds: z.array(z.string()).max(30).default([]) }).strict().parse(request.body);
    const taskId = (request.params as any).id; const pid = runtime.questionProject(taskId, body.questionId);
    if (body.uploadIds.length) {
      const uploads = body.uploadIds.map(id => store.upload(id));
      if (uploads.some(u => u.projectId && u.projectId !== pid)) throw new AppError(403, '素材不属于当前项目。');
      const result = await wb.intake({ task: `用户补充：${body.answer}`, intent: 'auto', project: pid, new_project: false, input_paths: uploads.map(u => u.path), source_nature: 'provided', media_nature: 'unknown', simulation: false, session_key: `self-media-bot:${pid}`, request_id: randomUUID() });
      await wb.applyUploadDeclarations(pid, uploads, result.registered ?? []);
      await store.bindUploads(pid, body.uploadIds);
    }
    const fresh = await wb.context(pid);
    await wb.request('POST', `/api/agent/v1/projects/${pid}/sources`, { revision: fresh.project.revision, label: '用户补充回答', nature: 'provided', origin: '自媒体 Bot 对话，用户声明', content: body.answer });
    await runtime.answer(taskId, body.questionId, body.answer, body.uploadIds); return { accepted: true };
  });

  app.post('/api/projects/:pid/artifacts/:aid/revise', async request => {
    const { pid, aid } = request.params as { pid: string; aid: string }; store.get(pid);
    const body = z.object({ segments: z.array(z.object({ id: z.string(), spoken: z.string().trim().min(1).max(30000) }).strict()).min(1).max(150) }).strict().parse(request.body);
    const context = await wb.context(pid); const old = (context.artifacts as Json[]).find(a => a.id === aid && a.stage === 'script');
    if (!old) throw new AppError(404, '未找到脚本。');
    if (context.heads.script !== aid || old.dependency_stale) throw new AppError(409, '文稿或上游已更新，请重新载入，或让 Bot 核对后修改。', 'ARTIFACT_STALE');
    if (old.payload.segments.length !== body.segments.length || old.payload.segments.some((s: Json, i: number) => s.id !== body.segments[i].id)) throw new AppError(409, '文稿分段已变更，请重新载入。');
    const changed = body.segments.filter((s, i) => s.spoken !== old.payload.segments[i].spoken);
    if (!changed.length) throw new AppError(400, '文稿没有变化，无需生成重复版本。');
    const userText = body.segments.map(s => s.spoken).join('\n\n');
    const sourceResponse = await wb.request('POST', `/api/agent/v1/projects/${pid}/sources`, { revision: context.project.revision, label: '用户手动修订文稿', nature: 'provided', origin: '成果面板手动修改；未经独立核实', content: userText }) as Json;
    const fresh = await wb.context(pid);
    const payload = structuredClone(old.payload); const claimId = `edit-${randomUUID()}`;
    payload.claims.push({ id: claimId, text: '用户提供的修订文稿，涉及事实仍待核对。', kind: 'plan', evidence: [{ source_id: sourceResponse.source.id, quote: userText.slice(0, 2000) }], limitation: '手动修改；未进行独立事实核验或实际试读。' });
    let clock = 0;
    payload.segments = payload.segments.map((s: Json, i: number) => { const spoken = body.segments[i].spoken; const start = clock; clock = Math.round((clock + Math.max(1, spoken.replace(/\s/g, '').length / 270 * 60)) * 10) / 10; return { ...s, spoken, subtitle: spoken, start, end: clock, claim_ids: [claimId] }; });
    const saved = await wb.request('POST', `/api/agent/v1/projects/${pid}/artifacts`, { request_id: randomUUID(), revision: fresh.project.revision, context_id: fresh.context_id, stage: 'script', input_artifact_ids: old.input_artifact_ids, standalone_reason: old.standalone_reason, payload, declared_status: 'needs_review', unresolved: ['用户修订内容待事实核对与实际试读；分段时间按270字/分钟估算。'], supersedes: aid, revision_reason: `用户手动修改 ${changed.length} 个分段，保留历史版本并重新估算时长。` });
    runtime.emit(pid); return saved;
  });
  app.post('/api/projects/:pid/lighting/:lid/select', async request => {
    const { pid, lid } = request.params as any; store.get(pid); validId(lid);
    const { tier } = z.object({ tier: z.enum(['simple', 'standard', 'ideal']) }).strict().parse(request.body);
    const context = await wb.context(pid);
    const result = await wb.request('POST', `/api/projects/${pid}/lighting/plans/${lid}/select`, { project_revision: context.project.revision, tier });
    runtime.emit(pid); return result;
  });

  async function serveFile(request: any, reply: any, file: string, name: string) {
    const info = await stat(file); if (!info.isFile()) throw new AppError(404, '文件不存在。');
    let type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    if (path.extname(file) === '.image') {
      const head = (await readFile(file)).subarray(0, 12);
      type = head[0] === 137 ? 'image/png' : head[0] === 255 ? 'image/jpeg' : 'image/webp';
    }
    reply.header('Content-Type', type); reply.header('Accept-Ranges', 'bytes');
    if (request.query?.download === '1' || ['application/octet-stream', 'text/html'].includes(type)) reply.header('Content-Disposition', `attachment; filename="download${path.extname(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
      const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      const end = match[1] ? (match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1) : info.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(file, { start, end }));
    }
    return reply.header('Content-Length', info.size).send(createReadStream(file));
  }
  app.get('/api/uploads/:id/file', async (request, reply) => {
    const u = store.upload((request.params as any).id); const actual = await confinedFile(u.path, [path.join(config.home, 'uploads', u.id)]);
    return serveFile(request, reply, actual, u.name);
  });
  app.get('/api/projects/:pid/files/:encoded', async (request, reply) => {
    const { pid, encoded } = request.params as any; store.get(pid);
    if (!/^[a-zA-Z0-9_-]{1,2500}$/.test(encoded)) throw new AppError(400, '无效的文件引用。');
    const relative = Buffer.from(encoded, 'base64url').toString('utf8');
    // Session logs, credentials, executable pages and arbitrary binary files are never downloads.
    if (!/\.(mp4|mov|mkv|webm|wav|mp3|m4a|srt|json|txt|md|csv|png|jpe?g|svg|image)$/i.test(relative)) throw new AppError(403, '不能下载此类型的项目文件。');
    return serveFile(request, reply, await wb.projectFile(pid, relative), path.basename(relative));
  });
  app.get('/api/events', async (request, reply) => {
    const pid = z.object({ projectId: z.string().optional() }).parse(request.query).projectId; if (pid) store.get(pid);
    if (events.size >= 30) throw new AppError(429, '打开的实时连接过多，请关闭多余页面。');
    reply.hijack(); const response = reply.raw;
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    const client = { projectId: pid, send: (text: string) => { if (!response.destroyed && !response.writableEnded) response.write(text); }, end: () => response.end() }; events.add(client); client.send(': connected\n\n');
    const timer = setInterval(() => client.send(': keepalive\n\n'), 15000);
    response.on('close', () => { clearInterval(timer); events.delete(client); });
  });
  app.post('/internal/runtime/:id', async request => {
    const body = z.object({ tool: z.string().max(100), args: z.record(z.string(), z.unknown()) }).strict().parse(request.body);
    return runtime.tool((request.params as any).id, String(request.headers['x-runtime-token'] ?? ''), body.tool, body.args);
  });

  if (options.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: path.join(options.root, 'web'), configFile: path.join(options.root, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/internal/')) return reply.code(404).send({ error: '接口不存在。' });
      reply.hijack(); vite.middlewares(request.raw, reply.raw, () => { if (!reply.raw.headersSent) reply.raw.writeHead(404).end(); });
    });
    app.addHook('onClose', () => vite.close());
  } else {
    const webRoot = path.join(options.root, 'dist', 'web');
    if ((await stat(webRoot).catch(() => null))?.isDirectory()) {
      const index = () => readFile(path.join(webRoot, 'index.html'));
      app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(await index()));
      app.get('/assets/:name', async (request, reply) => {
        const name = (request.params as { name: string }).name;
        if (!/^[a-zA-Z0-9._-]{1,180}\.(js|css|png|jpe?g|svg|woff2?)$/.test(name)) throw new AppError(404, '静态文件不存在。');
        const file = await confinedFile(path.join(webRoot, 'assets', name), [path.join(webRoot, 'assets')]);
        const type = name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : MIME[path.extname(name)] ?? 'application/octet-stream';
        return reply.type(type).header('Cache-Control', 'public, max-age=31536000, immutable').send(createReadStream(file));
      });
      app.setNotFoundHandler(async (request, reply) => request.url.startsWith('/api/') || request.url.startsWith('/internal/') ? reply.code(404).send({ error: '接口不存在。' }) : reply.type('text/html; charset=utf-8').send(await index()));
    }
  }
  app.addHook('preClose', async () => { for (const client of events) { client.send('event: closing\ndata: {}\n\n'); client.end(); } events.clear(); await runtime.close(); });
  return { app, config, store, wb, runtime, setOrigin(value: string) { origin = value; runtime.setOrigin(value); } };
}
