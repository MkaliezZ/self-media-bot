import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { modelServer, type ModelReply } from './fixtures/model-server.js';
import { Config } from '../server/config.js';

export async function installedWorkbench() {
  const config = new Config(); await config.init();
  const settings = config.public();
  if (!settings.workbenchRoot) throw new Error('测试前请执行 npm run setup，或提供 SELF_MEDIA_WORKBENCH_ROOT 与 SELF_MEDIA_WORKBENCH_PYTHON。');
  return { workbenchRoot: settings.workbenchRoot, python: settings.python };
}

export async function tempHome(label = 'test') {
  const root = path.join(os.tmpdir(), 'opencode'); await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, `self-media-bot-${label}-`));
}
export async function testApp(reply: (body: any, index: number) => ModelReply | Promise<ModelReply> = () => ({ text: '协议夹具响应' })) {
  const fixture = await modelServer(reply);
  const home = await tempHome('integration');
  const instance = await createApp({ root: process.cwd(), home });
  const s = instance.config.public();
  const dependencies = s.workbenchRoot ? { workbenchRoot: s.workbenchRoot, python: s.python } : await installedWorkbench();
  await instance.config.save({ model: 'deepseek-flash', baseUrl: fixture.url, apiKey: `sk-${'0'.repeat(32)}`, maxTokens: 4096, vision: true, ...dependencies });
  await instance.app.listen({ host: '127.0.0.1', port: 0 });
  const port = (instance.app.server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`; instance.setOrigin(url);
  const bootstrap = await fetch(`${url}/api/bootstrap`);
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]; const { csrfToken } = await bootstrap.json() as any;
  async function request(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${url}${route}`, { method, headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any, response };
  }
  return { ...instance, home, url, cookie, csrfToken, request, fixture, async close() { await instance.app.close(); await fixture.close(); await instance.wb.stopIfIdle(); } };
}
export async function until<T>(fn: () => Promise<T>, accept: (value: T) => boolean, timeout = 90000): Promise<T> {
  const end = Date.now() + timeout; let value: T;
  do { value = await fn(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < end);
  throw new Error(`等待条件未达到：${JSON.stringify(value).slice(0, 2000)}`);
}
export function toolResult(body: any): any {
  for (const message of [...(body.messages ?? [])].reverse()) {
    const contents = Array.isArray(message.content) ? message.content : [];
    for (const block of [...contents].reverse()) {
      if (block.type !== 'tool_result') continue;
      const text = typeof block.content === 'string' ? block.content : (block.content ?? []).filter((v: any) => v.type === 'text').map((v: any) => v.text).join('\n');
      try { return JSON.parse(text); } catch { return { raw: text, error: block.is_error }; }
    }
  }
  return undefined;
}
export function scriptSubmission(context: any, spoken = '先说清楚目标，再提供真实材料，最后说明不能改变的边界。') {
  const source = context.sources.find((s: any) => s.content);
  return { request_id: crypto.randomUUID(), revision: context.project.revision, context_id: context.context_id, stage: 'script', input_artifact_ids: [], standalone_reason: '用户明确只要求独立写稿，不补造诊断或选题历史。', payload: { topic_artifact_id: null, topic_id: null, claims: [{ id: 'claim-1', text: '按用户要求整理一份可试读的文稿。', kind: 'plan', evidence: source ? [{ source_id: source.id, quote: source.content.slice(0, 100) }] : [], limitation: '这是自动化测试夹具，不代表实际试读或运营效果。' }], segments: [{ id: 'segment-1', start: 0, end: 15, spoken, visual: '真人讲述，配合已有材料；本测试不生成视频。', subtitle: spoken, claim_ids: ['claim-1'] }], cta: '用这三个信息整理下一次创作需求。', production_limits: ['时长为估算，尚未人工试读。'] }, declared_status: 'needs_review', unresolved: ['待人工检查'], supersedes: context.heads.script ?? null, revision_reason: context.heads.script ? '根据用户要求保存测试修订版本，旧版保留。' : null };
}
