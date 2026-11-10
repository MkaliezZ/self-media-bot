import path from 'node:path';
import type { ArtifactView, AssetView, BotProject, ProjectView } from '../shared/types.js';
import { Workbench, type Json } from './workbench.js';
import { errorText } from './errors.js';
import { atomicJson, loadJson } from './files.js';

export const STAGE_NAMES: Record<string, string> = { diagnose: '账号诊断与对标', topics: '选题策划', script: '口播稿', lighting: '布光方案', edit: '剪辑与包装', publish: '发布准备', review: '数据复盘' };
export const projectFileUrl = (pid: string, relative: string) => `/api/projects/${encodeURIComponent(pid)}/files/${Buffer.from(relative.replaceAll('\\', '/')).toString('base64url')}`;

export function artifactText(type: string, payload: Json): string {
  if (type === 'script') return (payload.segments ?? []).map((s: Json) => s.spoken).join('\n\n');
  if (type === 'diagnose') return `目标：${payload.objective ?? ''}\n受众：${payload.audience ?? ''}\n\n${(payload.claims ?? []).map((c: Json) => c.text).join('\n\n')}\n\n优先行动：${payload.priority_action ?? ''}`;
  if (type === 'topics') return (payload.candidates ?? []).map((c: Json, i: number) => `${i + 1}. ${c.question}\n角度：${c.angle}\n目标：${c.objective}`).join('\n\n') + `\n\n选择理由：${payload.selection_reason ?? ''}`;
  if (type === 'publish') return `${payload.title ?? ''}\n\n${payload.caption ?? ''}\n\n披露说明：${payload.disclosure || '待核对'}\n\n${(payload.checklist ?? []).map((c: Json) => `${c.state === 'checked' ? '已记录依据' : c.state === 'missing' ? '待检查' : '不适用'}：${c.item}`).join('\n')}`;
  if (type === 'review') return `${(payload.claims ?? []).map((c: Json) => c.text).join('\n\n')}\n\n待验证假设：\n${(payload.hypotheses ?? []).join('\n')}\n\n下一次实验：\n${payload.next_experiment?.change ?? ''}`;
  if (type === 'lighting') return `${payload.precision_label ?? ''}\n\n${(payload.tiers ?? []).map((t: Json) => `${t.name}\n${t.upgrade ?? ''}\n${t.tradeoff ?? ''}\n${(t.steps ?? []).join('\n')}`).join('\n\n')}`;
  return JSON.stringify(payload, null, 2);
}

export async function buildProjectView(project: BotProject, wb: Workbench): Promise<ProjectView> {
  const baseAssets: AssetView[] = project.uploads.map(u => ({ id: u.id, name: u.name, bytes: u.bytes, nature: u.nature, kind: u.mime, url: `/api/uploads/${u.id}/file` }));
  try {
    const context = await wb.context(project.id);
    const versions = new Map<string, number>();
    const items: ArtifactView[] = [];
    for (const a of [...context.artifacts].sort((a: Json, b: Json) => a.created_at.localeCompare(b.created_at))) {
      const version = (versions.get(a.stage) ?? 0) + 1; versions.set(a.stage, version);
      items.push({ id: a.id, type: a.stage, title: `${STAGE_NAMES[a.stage] ?? a.stage} · 第 ${version} 版`, version, createdAt: a.created_at, current: context.heads[a.stage] === a.id, stale: !!a.dependency_stale, payload: a.payload, text: artifactText(a.stage, a.payload), scope: a.scope, reviewRequired: true });
    }
    const lighting = context.lighting ?? {};
    let lightingVersion = 0;
    for (const entry of lighting.plans ?? []) {
      const plan = await wb.request('GET', `/api/projects/${project.id}/lighting/plans/${entry.id}`) as Json;
      lightingVersion++;
      items.push({ id: entry.id, type: 'lighting', title: `布光方案 · 第 ${lightingVersion} 版`, version: lightingVersion, createdAt: entry.created_at, current: lighting.head === entry.id, stale: false, payload: { ...plan, selection: lighting.selection, svgUrls: Object.fromEntries(['simple', 'standard', 'ideal'].map(t => [t, projectFileUrl(project.id, `lighting/plans/${entry.id}/${t}.svg`)])) }, text: artifactText('lighting', plan), reviewRequired: true, files: [{ name: '布光方案.json', url: projectFileUrl(project.id, `lighting/plans/${entry.id}/plan.json`) }] });
    }
    const doneExports = (context.jobs as Json[]).filter(j => j.status === 'done' && j.result?.export_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    let exportVersion = 0;
    for (const job of doneExports) {
      const eid = job.result.export_id; const fileNames = await wb.exportFiles(project.id, eid);
      const primary = job.result.primary_video ?? (fileNames.includes('timeline.mp4') ? 'timeline.mp4' : 'reviewed_cut.mp4');
      if (!fileNames.includes(primary)) continue;
      exportVersion++;
      const source = (context.media as Json[]).find(m => m.id === job.media_id);
      const provenance = (context.exports as Json[]).find(e => e.id === eid)?.provenance ?? {};
      const plan = (context.timeline_plans as Json[]).find(p => p.id === provenance.timeline_plan_id);
      const currentTimeline = context.project.timeline_head;
      const stale = plan ? !!currentTimeline && currentTimeline !== plan.id : source?.asr ? provenance.asr_run && provenance.asr_run !== source.asr.run_id : false;
      items.push({ id: eid, type: 'video', title: `口播成片 · 第 ${exportVersion} 版`, version: exportVersion, createdAt: job.finished_at ?? job.created_at, current: job === doneExports.at(-1), stale: !!stale, payload: { ...provenance, media_id: job.media_id, job: job.result }, text: '文件已实际导出。音画、字幕、事实与素材权利仍需人工核对。', mediaUrl: projectFileUrl(project.id, `exports/${eid}/${primary}`), originalUrl: source ? projectFileUrl(project.id, source.relative_path) : undefined, subtitleUrl: fileNames.includes('reviewed_cut.srt') ? projectFileUrl(project.id, `exports/${eid}/reviewed_cut.srt`) : undefined, files: fileNames.map(name => ({ name, url: projectFileUrl(project.id, `exports/${eid}/${name}`) })), reviewRequired: true });
    }
    for (const m of context.media as Json[]) {
      if (!baseAssets.some(a => a.name === m.name)) baseAssets.push({ id: m.id, name: m.name, kind: m.has_video ? 'video' : 'audio', nature: m.media_nature ?? 'unknown', duration: m.duration, url: projectFileUrl(project.id, m.relative_path) });
    }
    for (const image of context.project.image_assets ?? []) {
      const relative = image.path ? path.relative(wb.projectFolder(project.id), image.path) : image.relative_path;
      if (relative && !relative.startsWith('..')) baseAssets.push({ id: image.id, name: image.label ?? '图片素材', kind: 'image', nature: 'unknown', url: projectFileUrl(project.id, relative) });
    }
    const view: ProjectView = { project, artifacts: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), assets: baseAssets, jobs: (context.jobs as Json[]).map(j => ({ id: j.id, kind: j.kind, status: j.status, error: j.error })) };
    await atomicJson(path.join(wb.config.home, 'ui-cache', `${project.id}.json`), { artifacts: view.artifacts, assets: view.assets, jobs: view.jobs }).catch(error => console.error('成果缓存暂未写入：', errorText(error)));
    return view;
  } catch (error) {
    const cached = await loadJson<Pick<ProjectView, 'artifacts' | 'assets' | 'jobs'>>(path.join(wb.config.home, 'ui-cache', `${project.id}.json`), { artifacts: [], assets: baseAssets, jobs: [] });
    return { project, ...cached, jobs: cached.jobs.map(j => ['running', 'queued'].includes(j.status) ? { ...j, status: 'unknown' } : j), workbenchError: errorText(error) };
  }
}
