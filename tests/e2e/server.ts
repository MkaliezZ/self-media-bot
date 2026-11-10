// Isolated browser-test host: real application, DSH and workbench; fake model only.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../../server/app.js';
import { modelServer } from '../fixtures/model-server.js';
import { scriptSubmission, toolResult, until, installedWorkbench } from '../helpers.js';

const stages = new Map<string, { phase: number; context?: any }>();
const fixture = await modelServer(body => {
  const userText = [...body.messages].reverse().filter((m: any) => m.role === 'user').map((m: any) => typeof m.content === 'string' ? m.content : m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')).join('\n');
  const pid = /当前项目 ID：([a-z0-9-]+)/i.exec(userText)?.[1] ?? 'default';
  const state = stages.get(pid) ?? { phase: 0 }; stages.set(pid, state);
  const step = state.phase++ % 4;
  if (step === 0) return { tool: { name: 'media_context', input: {} } };
  if (step === 1) { state.context = toolResult(body); return { tool: { name: 'media_schema', input: { name: 'script' } } }; }
  if (step === 2) return { tool: { name: 'media_request', input: { method: 'POST', path: `/api/agent/v1/projects/${state.context.project.id}/artifacts`, body_json: JSON.stringify(scriptSubmission(state.context)) } } };
  return { text: '已通过工作台保存口播稿。原稿与历史版本保留，时长仍需实际试读。（本项目为自动化验收素材）' };
});
const parent = path.join(os.tmpdir(), 'opencode'); await mkdir(parent, { recursive: true });
const home = await mkdtemp(path.join(parent, 'self-media-bot-browser-'));
const instance = await createApp({ root: process.cwd(), home });
const settings = instance.config.public();
const dependencies = settings.workbenchRoot ? { workbenchRoot: settings.workbenchRoot, python: settings.python } : await installedWorkbench();
await instance.config.save({ model: 'deepseek-flash', baseUrl: fixture.url, apiKey: `sk-${'0'.repeat(32)}`, maxTokens: 4096, vision: true, ...dependencies });

const videoProject = await instance.wb.request('POST', '/api/projects', { title: '演示验收｜剪辑与包装（合成片源）' }) as any;
await instance.store.create(videoProject.id, videoProject.title, 'edit');
const input = path.join(home, 'synthetic-preview.mp4');
await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1d4a3b:s=360x640:r=25:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', input], { timeout: 30000, windowsHide: true });
await instance.wb.intake({ task: '为浏览器技术验收导出合成片源，不代表真人素材或运营效果。', intent: 'edit', project: videoProject.id, input_paths: [input], media_nature: 'generated', session_key: 'browser-preview' });
const context = await instance.wb.context(videoProject.id); const media = context.media[0];
const saved = await instance.wb.request('POST', `/api/projects/${videoProject.id}/timeline-plans`, { request_id: crypto.randomUUID(), project_revision: context.project.revision, revision_reason: '浏览器技术测试，原始合成素材保留。', intent: '完整保留合成画面与测试音；不是实拍或配音。', width: 360, height: 640, fps: 25, sources: [{ id: 'src', kind: 'media', asset_id: media.id, sha256: media.sha256 }], shots: [{ id: 'shot', source_id: 'src', source_in: 0, source_out: 3, role: 'technical preview', reason: '技术验收，非真实内容生产。', fit: 'contain', source_audio_gain: 1 }], audio: [], titles: [], transitions: [], masks: [], effects: [] }) as any;
const job = await instance.wb.request('POST', `/api/projects/${videoProject.id}/timeline/export`, { plan_id: saved.plan?.id ?? saved.id }) as any;
const done = await until(() => instance.wb.request('GET', `/api/projects/${videoProject.id}/jobs/${job.id}`) as Promise<any>, j => ['done', 'failed'].includes(j.status));
if (done.status !== 'done') throw new Error(JSON.stringify(done));
await instance.store.update(videoProject.id, p => {
  p.messages.push({ id: crypto.randomUUID(), role: 'user', content: '这是程序生成的浏览器验收片源，保留原件并导出一个可播放版本。', at: new Date().toISOString() });
  p.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: '合成测试片源已实际导出，可以预览和下载。尚未人工听审，不代表真人成片或真实运营效果。', at: new Date().toISOString(), taskId: 'preview-task' });
  p.tasks.push({ id: 'preview-task', projectId: p.id, intent: 'edit', prompt: '合成媒体技术验收', status: 'done', progress: [], startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
});
instance.setOrigin('http://127.0.0.1:3211'); await instance.app.listen({ host: '127.0.0.1', port: 3211 });
console.log('Browser acceptance host ready; local model fixture only; no external model calls.');
async function close() { await instance.app.close(); await fixture.close(); await instance.wb.stopIfIdle(); }
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
