import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { testApp, until } from './helpers.js';

const execute = promisify(execFile);
describe('实际媒体文件、原生时间轴与安全下载', () => {
  let app: Awaited<ReturnType<typeof testApp>>; let pid: string; let exportId: string; let mediaId: string;
  beforeAll(async () => { app = await testApp(); }, 90000);
  afterAll(async () => { await app?.close(); }, 30000);
  it('合成两秒测试片源，调用原工作台保存时间轴并真实导出', async () => {
    const input = path.join(app.home, 'synthetic-test.mp4');
    await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1d4a3b:s=320x568:r=15:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input], { windowsHide: true, timeout: 30000 });
    const created = await app.request('/api/projects', { title: '自动化验收｜合成媒体，非实拍' });
    expect(created.status, JSON.stringify(created.body)).toBe(200); pid = created.body.id;
    await app.wb.intake({ task: '只做合成测试媒体的时间轴导出，不做ASR或实际发布。', intent: 'edit', project: pid, input_paths: [input], media_nature: 'generated', source_note: '程序生成的自动化测试片源，非实拍。', session_key: `test-${pid}` });
    const context = await app.wb.context(pid); const media = context.media[0]; mediaId = media.id;
    const saved = await app.wb.request('POST', `/api/projects/${pid}/timeline-plans`, { request_id: crypto.randomUUID(), project_revision: context.project.revision, supersedes: null, revision_reason: '合成片源的首个时间轴，供技术测试。', intent: '保留两秒合成画面与声音；无ASR、无真实账号数据。', width: 320, height: 568, fps: 15, sources: [{ id: 'source-1', kind: 'media', asset_id: media.id, sha256: media.sha256 }], shots: [{ id: 'shot-1', source_id: 'source-1', source_in: 0, source_out: 2, role: '演示片段', reason: '完整保留合成片源，用于导出与播放测试。', fit: 'contain', source_audio_gain: 1 }], audio: [], titles: [], transitions: [], masks: [], effects: [] }) as any;
    expect(saved.plan?.id ?? saved.id, JSON.stringify(saved)).toBeTruthy();
    const planId = saved.plan?.id ?? saved.id;
    const job = await app.wb.request('POST', `/api/projects/${pid}/timeline/export`, { plan_id: planId }) as any;
    const completed = await until(() => app.wb.request('GET', `/api/projects/${pid}/jobs/${job.id}`) as Promise<any>, j => ['done', 'failed'].includes(j.status));
    expect(completed.status, JSON.stringify(completed)).toBe('done'); exportId = completed.result.export_id;
    const view = (await app.request(`/api/projects/${pid}`)).body;
    const video = view.artifacts.find((a: any) => a.type === 'video');
    expect(video).toBeTruthy(); expect(video.reviewRequired).toBe(true);
    const response = await fetch(`${app.url}${video.mediaUrl}`, { headers: { Cookie: app.cookie, Range: 'bytes=0-255' } });
    expect(response.status).toBe(206); expect(response.headers.get('Content-Type')).toContain('video/mp4'); expect((await response.arrayBuffer()).byteLength).toBe(256);
  }, 120000);
  it('从实际成片抽取JPEG帧，不把抽帧本身冒充视觉审阅', async () => {
    const frame = await app.wb.frame(pid, mediaId, .25, exportId);
    expect((await stat(frame.path)).size).toBeGreaterThan(100);
    const bytes = await readFile(frame.path); expect(bytes[0]).toBe(255); expect(bytes[1]).toBe(216);
    expect(frame.next).toContain('不等于');
  });
  it('读取项目文件时拒绝指向项目外的符号链接', async () => {
    const outside = path.join(app.home, 'private-test.txt'); await writeFile(outside, 'private-test-only');
    const link = path.join(app.wb.projectFolder(pid), 'outside-link.txt');
    await symlink(outside, link);
    const ref = Buffer.from('outside-link.txt').toString('base64url');
    const response = await fetch(`${app.url}/api/projects/${pid}/files/${ref}`, { headers: { Cookie: app.cookie } });
    expect(response.status).toBe(403);
  });
  it('工作台不可用时保留可下载的历史成果缓存，不伪造最新状态', async () => {
    const before = (await app.request(`/api/projects/${pid}`)).body;
    const settings = app.config.public();
    await app.config.save({ model: settings.model, baseUrl: settings.baseUrl, maxTokens: settings.maxTokens, vision: settings.vision, workbenchRoot: settings.workbenchRoot, python: path.join(app.home, 'nonexistent-python') });
    const cached = (await app.request(`/api/projects/${pid}`)).body;
    expect(cached.workbenchError).toBeTruthy(); expect(cached.artifacts.length).toBe(before.artifacts.length);
    const file = cached.artifacts.find((a: any) => a.type === 'video').mediaUrl;
    expect((await fetch(`${app.url}${file}`, { headers: { Cookie: app.cookie } })).status).toBe(200);
    await app.config.save({ model: settings.model, baseUrl: settings.baseUrl, maxTokens: settings.maxTokens, vision: settings.vision, workbenchRoot: settings.workbenchRoot, python: settings.python });
  });
});
