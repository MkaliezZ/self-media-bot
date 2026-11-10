import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { modelServer } from './fixtures/model-server.js';
import { scriptSubmission, tempHome, toolResult, until, testApp } from './helpers.js';

describe('完整主服务重启后的续做', () => {
  it('重建主服务，保留对话、项目、DSH会话与旧稿，再保存修订版', async () => {
    let phase = 0; let context: any;
    const fixture = await modelServer(body => {
      const stage = phase++ % 3;
      if (stage === 0) return { tool: { name: 'media_context', input: {} } };
      if (stage === 1) { context = toolResult(body); return { tool: { name: 'media_request', input: { method: 'POST', path: `/api/agent/v1/projects/${context.project.id}/artifacts`, body_json: JSON.stringify(scriptSubmission(context)) } } }; }
      return { text: '已保存测试稿件，待人工试读。' };
    });
    const home = await tempHome('restart'); let host: Awaited<ReturnType<typeof createApp>> | undefined;
    async function start() {
      host = await createApp({ root: process.cwd(), home });
      const s = host.config.public();
      await host.config.save({ model: 'deepseek-flash', baseUrl: fixture.url, maxTokens: 4096, vision: false, workbenchRoot: s.workbenchRoot, python: s.python, apiKey: `sk-${'0'.repeat(32)}` });
      await host.app.listen({ host: '127.0.0.1', port: 0 });
      const url = `http://127.0.0.1:${(host.app.server.address() as AddressInfo).port}`; host.setOrigin(url);
      const init = await fetch(`${url}/api/bootstrap`); const cookie = init.headers.get('set-cookie')!.split(';')[0]; const csrf = (await init.json() as any).csrfToken;
      return async (route: string, body?: unknown) => {
        const response = await fetch(`${url}${route}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<any>;
      };
    }
    try {
      let call = await start();
      const first = await call('/api/tasks', { prompt: '主服务重启前的独立写稿验收。素材：目标、材料、边界。', intent: 'script', uploadIds: [] });
      const before = await until(() => call(`/api/projects/${first.projectId}`), p => !['pending', 'running', 'waiting'].includes(p.project.tasks.at(-1).status));
      expect(before.project.tasks.at(-1).status, JSON.stringify(before.project.tasks.at(-1))).toBe('done');
      const sid = before.project.sessionId; const oldArtifact = before.artifacts[0].id;
      await host!.app.close();
      call = await start();
      const restored = await call(`/api/projects/${first.projectId}`);
      expect(restored.project.messages).toHaveLength(before.project.messages.length);
      expect(restored.artifacts[0].id).toBe(oldArtifact);
      await call('/api/tasks', { projectId: first.projectId, prompt: '主服务重启后继续改稿，保留旧版。', intent: 'script', uploadIds: [] });
      const after = await until(() => call(`/api/projects/${first.projectId}`), p => !['pending', 'running', 'waiting'].includes(p.project.tasks.at(-1).status));
      expect(after.project.tasks.at(-1).status, JSON.stringify(after.project.tasks.at(-1))).toBe('done');
      expect(after.project.sessionId).toBe(sid); expect(after.artifacts).toHaveLength(2);
      expect(after.artifacts.some((a: any) => a.id === oldArtifact)).toBe(true);
      expect(JSON.stringify(fixture.requests[3].messages)).toContain('主服务重启前的独立写稿验收');
    } finally { await host?.app.close(); await host?.wb.stopIfIdle(); await fixture.close(); }
  }, 150000);
  it('在初始化完成但尚未提交首条模型输入时中断，不会留下无法续做的假会话', async () => {
    const app = await testApp(() => ({ text: '冷启动中断后已恢复，本回合为协议测试。' }));
    let signalReady!: () => void; let release!: () => void;
    const ready = new Promise<void>(resolve => { signalReady = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const target = app.runtime as any; const original = target.harness.bind(app.runtime);
    target.harness = async (...args: any[]) => { const value = await original(...args); signalReady(); await barrier; return value; };
    try {
      const first = (await app.request('/api/tasks', { prompt: '冷启动中断窗口测试。', intent: 'script', uploadIds: [] })).body;
      await ready;
      expect((await app.request(`/api/tasks/${first.taskId}/cancel`, {})).status).toBe(200);
      release(); await until(async () => app.runtime.active(), n => n === 0);
      expect(app.store.get(first.projectId).runtimeStarted).toBe(false);
      target.harness = original;
      expect((await app.request('/api/tasks', { projectId: first.projectId, prompt: '中断后继续处理技术测试，不丢失项目。', intent: 'script', uploadIds: [] })).status).toBe(200);
      const after = await until(() => app.request(`/api/projects/${first.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.body.project.tasks.at(-1).status));
      expect(after.body.project.tasks.at(-1).status, JSON.stringify(after.body.project.tasks.at(-1))).toBe('done');
    } finally { release(); await app.close(); }
  }, 150000);
});
