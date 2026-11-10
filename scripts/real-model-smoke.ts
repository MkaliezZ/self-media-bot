// Explicitly opt-in, bounded paid test. No real account material is read.
import http from 'node:http';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { Config } from '../server/config.js';
import { until } from '../tests/helpers.js';
import { atomicJson, loadJson } from '../server/files.js';
import { acquireLock } from '../server/lock.js';

if (!process.argv.includes('--allow-paid-api')) throw new Error('真实模型验收必须显式传入 --allow-paid-api，可能产生 API 费用。');
const original = new Config(); await original.init();
const settings = original.public(); const key = original.key();
if (!key) throw new Error('没有已授权的 DeepSeek API Key。请在本机设置或环境变量中配置，不要写入代码。');
const verification = path.join(original.home, 'verification'); await mkdir(verification, { recursive: true });
const releaseBudgetLock = await acquireLock(path.join(verification, 'real-model-run'));
const budgetFile = path.join(verification, 'real-budget.json');
const budget = await loadJson<{ used: number; limit: number }>(budgetFile, { used: 0, limit: 20 });
if (budget.used >= 20) { await releaseBudgetLock(); throw new Error('本次授权的20次外部模型请求预算已用完。需要重新获得明确授权后才能重置预算。'); }
const endpoint = new URL(settings.baseUrl);
const originalRoot = endpoint.href.replace(/\/+$/, '');
const upstreamUrl = originalRoot.endsWith('/v1') ? `${originalRoot}/messages` : `${originalRoot}/v1/messages`;
let calls = 0; const MAX_CALLS = 20; const statuses: number[] = []; let lastUsage: unknown;
const relay = http.createServer(async (req, res) => {
  if (!req.url?.endsWith('/messages') || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
  if (budget.used >= MAX_CALLS) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Paid-test request budget exhausted; no upstream request was made.' } })); return; }
  const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  body.max_tokens = Math.min(4096, Number(body.max_tokens) || 4096);
  // Count before forwarding. No SDK retry can exceed this external-call fence.
  calls++; budget.used++; await atomicJson(budgetFile, budget);
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string' && !['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding'].includes(name)) headers.set(name, value);
    headers.set('Content-Type', 'application/json'); headers.set('x-api-key', key); headers.set('anthropic-version', '2023-06-01');
    const response = await fetch(upstreamUrl, { method: 'POST', redirect: 'error', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    statuses.push(response.status);
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
    if (response.body) for await (const part of response.body) res.write(part);
    res.end();
  } catch { res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { type: 'api_error', message: 'Upstream transport failed in bounded real-model acceptance.' } })); }
});
await new Promise<void>(resolve => relay.listen(0, '127.0.0.1', resolve));
const relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
const parent = path.join(os.tmpdir(), 'opencode'); await mkdir(parent, { recursive: true });
const home = await mkdtemp(path.join(parent, 'self-media-bot-real-'));
const instance = await createApp({ root: process.cwd(), home });
await instance.config.save({ model: settings.model, baseUrl: relayUrl, maxTokens: 4096, vision: false, workbenchRoot: settings.workbenchRoot, python: settings.python, apiKey: key });
await instance.app.listen({ host: '127.0.0.1', port: 0 });
const appUrl = `http://127.0.0.1:${(instance.app.server.address() as AddressInfo).port}`; instance.setOrigin(appUrl);
const bootstrap = await fetch(`${appUrl}/api/bootstrap`); const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]; const init = await bootstrap.json() as any;
async function call(route: string, body?: unknown) {
  const response = await fetch(`${appUrl}${route}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'X-CSRF-Token': init.csrfToken, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json() as any; if (!response.ok) throw new Error(result.error ?? 'API request failed'); return result;
}
const report: Record<string, unknown> = { realModel: true, fixture: false, model: settings.model, requestLimit: MAX_CALLS, outputLimitPerRequest: 4096, material: '自编说明性文字；非真实账号资料', startedAt: new Date().toISOString() };
try {
  if (process.argv.includes('--recheck')) {
    const connected = await call('/api/settings/test-model', { consent: true });
    report.pass = connected.ok; report.connectionOnly = true; report.response = connected.response;
  } else {
  const first = await call('/api/tasks', { intent: 'script', uploadIds: [], title: '真实模型技术验收｜自编需求说明', prompt: '只写一份约30秒的口播稿，不做其他环节，不需要再确认。素材：我今天想讲如何把创作需求说清楚。三项信息是目标、材料、边界。目标指想得到什么产物，材料指可以引用的真实原文，边界指不能编造事实和个人经历。不要声称有统计数据或亲身故事。这是软件验收的自编说明性素材。请按现有Skill保存可回看的结构化脚本。' });
  const p1 = await until(() => call(`/api/projects/${first.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.project.tasks.at(-1).status), 420000);
  if (p1.project.tasks.at(-1).status !== 'done' || !p1.artifacts.some((a: any) => a.type === 'script')) throw new Error(`首轮未完成：${p1.project.tasks.at(-1).error ?? p1.project.messages.at(-1).content}`);
  report.firstDraftSaved = true;
  const second = await call('/api/tasks', { projectId: first.projectId, intent: 'script', uploadIds: [], prompt: '请把开场改成一句直接提问，保留目标、材料、边界这三个核心点，不增加新事实。请实际保存为新版本，保留第一版。' });
  const p2 = await until(() => call(`/api/projects/${second.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.project.tasks.at(-1).status), 420000);
  if (p2.project.tasks.at(-1).status !== 'done' || p2.artifacts.filter((a: any) => a.type === 'script').length < 2) throw new Error(`修订轮未完成：${p2.project.tasks.at(-1).error ?? p2.project.messages.at(-1).content}`);
  lastUsage = p2.project.tasks.map((t: any) => t.usage);
  report.pass = true; report.scriptVersions = p2.artifacts.filter((a: any) => a.type === 'script').length; report.preservedSession = p1.project.sessionId === p2.project.sessionId;
  await writeFile(path.join(home, 'generated-script.txt'), p2.artifacts.find((a: any) => a.type === 'script' && a.current).text);
  }
} catch (error) { report.pass = false; report.error = String((error as Error).message).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]'); process.exitCode = 1; }
finally {
  await instance.app.close(); relay.closeAllConnections(); await new Promise<void>(resolve => relay.close(() => resolve()));
  await instance.wb.stopIfIdle();
  report.externalRequests = calls; report.totalAuthorizedRequestsUsed = budget.used; report.httpStatuses = statuses; report.reportedUsage = lastUsage; report.finishedAt = new Date().toISOString();
  await writeFile(path.join(original.home, 'verification', process.argv.includes('--recheck') ? 'real-model-recheck.json' : 'real-model.json'), JSON.stringify(report, null, 2));
  await releaseBudgetLock();
  console.log(JSON.stringify(report, null, 2));
}
