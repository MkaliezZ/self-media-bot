import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testApp, until, toolResult, scriptSubmission } from './helpers.js';

describe('真实 DSH + 真实工作台，模型协议夹具验收', () => {
  let app: Awaited<ReturnType<typeof testApp>>;
  let phase = 0; let context: any; let lastSubmission: any;
  beforeAll(async () => {
    app = await testApp(body => {
      const step = phase++ % 4;
      if (step === 0) return { tool: { name: 'media_context', input: {} } };
      if (step === 1) { context = toolResult(body); return { tool: { name: 'media_schema', input: { name: 'script' } } }; }
      if (step === 2) { lastSubmission = scriptSubmission(context, context.heads.script ? '修订稿：先定义目标，再提供材料，并说明边界。' : undefined); return { tool: { name: 'media_request', input: { method: 'POST', path: `/api/agent/v1/projects/${context.project.id}/artifacts`, body_json: JSON.stringify(lastSubmission) } } }; }
      const saved = toolResult(body);
      return { text: saved?.accepted ? '已通过真实工作台接口保存口播稿。时长为估算，请实际试读。' : `测试保存失败：${JSON.stringify(saved)}` };
    });
  }, 90000);
  afterAll(async () => { await app?.close(); }, 30000);

  let pid: string;
  it('接口拒绝无 cookie、无 CSRF、跨来源和越界运行时调用', async () => {
    expect((await fetch(`${app.url}/api/settings`)).status).toBe(401);
    expect((await fetch(`${app.url}/api/projects`, { method: 'POST', headers: { Cookie: app.cookie, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(`${app.url}/api/bootstrap`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    for (const route of ['/%61pi/settings', '/api%2Fsettings', '/api//settings']) {
      const response = await fetch(`${app.url}${route}`); const text = await response.text();
      expect(text).not.toContain('keySource'); expect(text).not.toContain('workbenchRoot');
    }
    expect((await fetch(`${app.url}/internal/runtime/not-a-task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'media_context', args: {} }) })).status).toBe(403);
  });
  it('启动真实工作台，创建任务，经 DSH 工具循环保存结构化文稿', async () => {
    const started = await app.request('/api/tasks', { prompt: '这是自动化测试材料：目标、材料、边界。请只写一份简短口播稿，不编造个人经历。', intent: 'script', uploadIds: [] });
    expect(started.status, JSON.stringify(started.body)).toBe(200); pid = started.body.projectId;
    const result = await until(() => app.request(`/api/projects/${pid}`), r => !['pending', 'running', 'waiting'].includes(r.body.project?.tasks.at(-1)?.status), 120000);
    expect(result.body.project.tasks.at(-1).status, JSON.stringify(result.body.project.tasks.at(-1))).toBe('done');
    expect(result.body.artifacts).toHaveLength(1); expect(result.body.artifacts[0].type).toBe('script');
    const names = app.fixture.requests[0].tools.map((t: any) => t.name);
    expect(names).toContain('media_context'); expect(names).toContain('media_request'); expect(names).toContain('read_image');
    for (const forbidden of ['pwsh', 'bash', 'write', 'read', 'edit', 'working_directory', 'spawn_agent']) expect(names).not.toContain(forbidden);
    expect(app.fixture.requests[0].dsh_session_log).toBeUndefined(); expect(app.fixture.requests[0].dsh_plugin_packages).toBeUndefined();
    expect(result.body.artifacts[0].reviewRequired).toBe(true);
  }, 150000);
  it('重用持久 DSH 会话和同一项目，写出第二个真实版本', async () => {
    const before = app.store.get(pid);
    const started = await app.request('/api/tasks', { projectId: pid, prompt: '开头直接一些，保留上次内容，保存一个修订版本。', intent: 'script', uploadIds: [] });
    expect(started.status).toBe(200);
    const result = await until(() => app.request(`/api/projects/${pid}`), r => !['pending', 'running', 'waiting'].includes(r.body.project?.tasks.at(-1)?.status), 120000);
    expect(result.body.project.tasks.at(-1).status, JSON.stringify(result.body.project.tasks.at(-1))).toBe('done');
    expect(result.body.artifacts).toHaveLength(2); expect(result.body.artifacts.filter((a: any) => a.current)).toHaveLength(1);
    expect(result.body.project.sessionId).toBe(before.sessionId);
  }, 150000);
  it('手动改稿另存第三版，旧稿不覆盖；旧版写入返回409', async () => {
    const current = (await app.request(`/api/projects/${pid}`)).body.artifacts.find((a: any) => a.current);
    const previous = JSON.stringify(current.payload);
    const response = await app.request(`/api/projects/${pid}/artifacts/${current.id}/revise`, { segments: current.payload.segments.map((s: any) => ({ id: s.id, spoken: s.spoken + ' 这是一处用户修订。' })) });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const view = (await app.request(`/api/projects/${pid}`)).body;
    expect(view.artifacts).toHaveLength(3); expect(JSON.stringify(view.artifacts.find((a: any) => a.id === current.id).payload)).toBe(previous);
    const stale = await app.request(`/api/projects/${pid}/artifacts/${current.id}/revise`, { segments: current.payload.segments.map((s: any) => ({ id: s.id, spoken: '不应保存' })) });
    expect(stale.status).toBe(409);
    expect((await app.request(`/api/projects/${pid}`)).body.artifacts).toHaveLength(3);
  });
  it('拒绝不支持的附件，文本上传可下载且支持 Range；拒绝项目路径穿越', async () => {
    const form = new FormData(); form.append('file', new Blob(['测试材料，保留原件。']), '测试文稿.md');
    const uploaded = await fetch(`${app.url}/api/uploads`, { method: 'POST', headers: { Cookie: app.cookie, 'X-CSRF-Token': app.csrfToken }, body: form });
    expect(uploaded.status).toBe(200); const record = await uploaded.json() as any;
    const download = await fetch(`${app.url}/api/uploads/${record.id}/file`, { headers: { Cookie: app.cookie, Range: 'bytes=0-2' } });
    expect(download.status).toBe(206); expect((await download.arrayBuffer()).byteLength).toBe(3);
    const unsupported = new FormData(); unsupported.append('file', new Blob(['x']), 'not-supported.pdf');
    expect((await fetch(`${app.url}/api/uploads`, { method: 'POST', headers: { Cookie: app.cookie, 'X-CSRF-Token': app.csrfToken }, body: unsupported })).status).toBe(415);
    const invalid = new FormData(); invalid.append('file', new Blob([new Uint8Array([255, 254, 253])]), 'invalid-encoding.txt');
    expect((await fetch(`${app.url}/api/uploads`, { method: 'POST', headers: { Cookie: app.cookie, 'X-CSRF-Token': app.csrfToken }, body: invalid })).status).toBe(422);
    const escaped = Buffer.from('../../settings.json').toString('base64url');
    expect((await fetch(`${app.url}/api/projects/${pid}/files/${escaped}`, { headers: { Cookie: app.cookie } })).status).toBe(403);
  });
  it('配置与项目库不含测试 API key 明文', async () => {
    const secret = `sk-${'0'.repeat(32)}`;
    expect(JSON.stringify((await app.request('/api/settings')).body)).not.toContain(secret);
    expect(await readFile(app.store.file, 'utf8')).not.toContain(secret);
  });
});
