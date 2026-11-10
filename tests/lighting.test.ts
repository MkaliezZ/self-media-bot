import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { testApp, until, toolResult } from './helpers.js';

const execute = promisify(execFile);
describe('图片链路、三档布光与真实SVG', () => {
  let app: Awaited<ReturnType<typeof testApp>>; let context: any; let stage = 0; let sawImage = false;
  beforeAll(async () => {
    app = await testApp(body => {
      const current = stage++;
      if (current === 0) return { tool: { name: 'media_context', input: {} } };
      if (current === 1) { context = toolResult(body); return { tool: { name: 'read_image', input: { file_path: context.project.image_assets[0].path } } }; }
      if (current === 2) {
        sawImage = JSON.stringify(body.messages).includes('image');
        return { tool: { name: 'media_request', input: { method: 'POST', path: `/api/projects/${context.project.id}/lighting/plans`, body_json: JSON.stringify({ request_id: crypto.randomUUID(), project_revision: context.project.revision, supersedes: null, revision_reason: '合成色块图片仅用于接口验收；不表示现场已审阅。', scene: { image_ids: [context.project.image_assets[0].id], assessment: 'assumed', assumptions: ['这是程序生成的图片，不是真实房间；仅验证图片传输和三档方案保存。'] } }) } } };
      }
      return { text: '三档方案已保存。这是合成图片的协议/技术测试，不是现场布光验收。' };
    });
  }, 90000);
  afterAll(async () => { await app?.close(); }, 30000);
  it('DSH实际读取图片，再保存三档方案；SVG可在浏览器安全预览', async () => {
    const image = path.join(app.home, 'synthetic-room.png');
    await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xeeeecc:s=640x360', '-frames:v', '1', '-update', '1', image], { timeout: 30000, windowsHide: true });
    const form = new FormData(); form.append('file', new Blob([await readFile(image)], { type: 'image/png' }), '合成房间测试.png');
    const uploaded = await fetch(`${app.url}/api/uploads`, { method: 'POST', headers: { Cookie: app.cookie, 'X-CSRF-Token': app.csrfToken }, body: form });
    expect(uploaded.status).toBe(200); const record = await uploaded.json() as any;
    await app.request(`/api/uploads/${record.id}`, { nature: 'generated' }, 'PATCH');
    const started = (await app.request('/api/tasks', { prompt: '这是合成图片的布光技术测试，只验证三档保存，不宣称实景审阅。', intent: 'lighting', uploadIds: [record.id] })).body;
    const view = await until(() => app.request(`/api/projects/${started.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.body.project.tasks.at(-1).status), 120000);
    expect(view.body.project.tasks.at(-1).status, JSON.stringify(view.body.project.tasks.at(-1))).toBe('done');
    expect(sawImage).toBe(true);
    const plan = view.body.artifacts.find((a: any) => a.type === 'lighting');
    expect(plan?.payload.tiers).toHaveLength(3); expect(plan.reviewRequired).toBe(true);
    const svg = await fetch(`${app.url}${plan.payload.svgUrls.standard}`, { headers: { Cookie: app.cookie } });
    expect(svg.status).toBe(200); expect(svg.headers.get('Content-Type')).toContain('image/svg+xml'); expect(await svg.text()).toContain('<svg');
    const selection = await app.request(`/api/projects/${started.projectId}/lighting/${plan.id}/select`, { tier: 'standard' });
    expect(selection.status, JSON.stringify(selection.body)).toBe(200);
    expect(selection.body.selection.tier).toBe('standard');
    const after = (await app.request(`/api/projects/${started.projectId}`)).body;
    expect(after.artifacts[0].payload.selection.tier).toBe('standard');
  }, 150000);
});
