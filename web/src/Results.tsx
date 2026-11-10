import { useEffect, useRef, useState } from 'react';
import { FileText, Film, Image as ImageIcon, History, Maximize2, Minimize2, BookOpen, PencilLine, Copy, Save, Download, Headphones, MessageSquareText, Captions, AlertCircle, Check, FolderOpen, ArrowRight, LoaderCircle, LampDesk, ChevronDown, ExternalLink, Eye, X } from 'lucide-react';
import type { ArtifactView, AssetView, ProjectView } from '../../shared/types';
import { api, copyText, post } from './api';
import { natureNames, secondsLabel, sizeLabel, timeLabel } from './catalog';
import { Modal } from './Modal';

type RecordValue = Record<string, any>;
interface Props {
  view: ProjectView; selectedId?: string; onSelect: (id: string) => void;
  onRefresh: () => void; onRequest: (text: string, intent?: string) => void;
  expanded: boolean; onExpand: () => void; notice: (text: string) => void;
  onClose?: () => void;
}

export function Results(props: Props) {
  const { view, selectedId, onSelect } = props;
  const [tab, setTab] = useState<'result' | 'assets' | 'versions'>('result');
  const [assetPreview, setAssetPreview] = useState<AssetView>();
  const selected = view.artifacts.find(a => a.id === selectedId) ?? view.artifacts[0];
  useEffect(() => { setTab('result'); }, [selectedId]);
  return <aside className={`result-panel ${props.expanded ? 'expanded' : ''}`} aria-label="素材与成果面板">
    <div className="panel-tabs" role="tablist" aria-label="项目内容">{(['result', 'assets', 'versions'] as const).map((t, i) => <button key={t} role="tab" aria-selected={tab === t} className={`panel-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{['成果', '素材', '版本'][i]}</button>)}<span className="spacer" /><button className="panel-expand" onClick={props.onExpand} aria-label={props.expanded ? '收起成果阅读区' : '展开成果阅读区'}>{props.expanded ? <Minimize2 /> : <Maximize2 />}<span>{props.expanded ? '收起' : '展开'}</span></button>{props.onClose && <button className="mobile-result-close icon-button" onClick={props.onClose} aria-label="关闭成果面板"><X /></button>}</div>
    {view.workbenchError && <div className="panel-warning"><AlertCircle />工作台暂不可用。下面如有缓存成果，版本可能不是最新，请恢复连接后再修改。</div>}
    {tab === 'result' && <>
      {view.artifacts.length > 1 && <div className="artifact-switch"><select aria-label="选择项目成果" value={selected?.id ?? ''} onChange={e => onSelect(e.target.value)}>{view.artifacts.map(a => <option key={a.id} value={a.id}>{a.title}{a.stale ? '（依赖已过期）' : a.current ? '' : '（历史）'}</option>)}</select></div>}
      {selected ? <Artifact key={selected.id} artifact={selected} {...props} onVersions={() => setTab('versions')} /> : <div className="empty-panel"><FileText /><h3>让想法，变成一份成果。</h3><p>任务开始后，实际保存的文稿、方案和成片会出现在这里。</p><span>从一个环节开始，不必走完整流程。</span></div>}
      {view.jobs.some(j => ['queued', 'running'].includes(j.status)) && <div className="background-jobs"><LoaderCircle className="spin" /><div><strong>后台仍在处理</strong><p>转写或导出尚未结束。停止 Bot 不等于停止工作台渲染。</p></div></div>}
      {view.jobs.filter(j => j.status === 'failed').slice(0, 2).map(j => <details className="job-failure" key={j.id}><summary><AlertCircle />有一项后台操作失败</summary><p>{j.error || '请让 Bot 查看当前作业反馈后继续。'}</p></details>)}
    </>}
    {tab === 'assets' && <div className="panel-content"><div className="panel-kicker">原始材料与生成成果分别保存</div><h2>项目素材</h2>{!view.assets.length && <p className="empty-description">还没有文件。你可以在输入框添加素材，也可以直接描述需求。</p>}<div className="asset-list">{view.assets.map(a => <button className="asset-item" key={a.id} onClick={() => setAssetPreview(a)}><span className="file-square">{a.kind.includes('video') ? <Film /> : a.kind.includes('image') ? <ImageIcon /> : <FileText />}</span><span className="asset-info"><strong>{a.name}</strong><small>{natureNames[a.nature] ?? a.nature} {a.bytes ? `· ${sizeLabel(a.bytes)}` : ''}{a.duration ? ` · ${secondsLabel(a.duration)}` : ''}</small></span><Eye size={16} /></button>)}</div><div className="review-notice"><FolderOpen /><div><strong>原件保留</strong><p>界面不提供覆盖或删除原件。素材性质为用户声明，仍需按来源核对。</p></div></div></div>}
    {tab === 'versions' && <div className="panel-content"><div className="panel-kicker">每次修改，保留可回看的记录</div><h2>成果与版本</h2>{!view.artifacts.length && <p className="empty-description">保存第一份成果后，这里会显示真实版本。</p>}{view.artifacts.map(a => <div className={`version-item ${a.id === selected?.id ? 'selected' : ''}`} key={a.id}><div className="version-title"><strong>{a.title}</strong><span className={`tiny-tag ${a.stale ? 'warning' : ''}`}>{a.stale ? '依赖已过期' : a.current ? '当前' : '历史'}</span></div><small>{timeLabel(a.createdAt)}</small><p>{String(a.payload.revision_reason ?? a.payload.intent ?? '原成果和历史记录保留。')}</p><div className="button-row"><button className="secondary small" onClick={() => { onSelect(a.id); setTab('result'); }}>查看此版</button><button className="text-button" onClick={() => props.onRequest(`请基于历史成果「${a.title}」（ID：${a.id}）继续修改，并另存为新版本。保留旧记录，先核对当前依赖。`)}>基于此版继续</button></div></div>)}</div>}
    {assetPreview && <AssetPreview asset={assetPreview} onClose={() => setAssetPreview(undefined)} />}
  </aside>;
}

function Artifact({ artifact: a, view, onRefresh, onRequest, notice, onVersions }: Props & { artifact: ArtifactView; onVersions: () => void }) {
  const [copied, setCopied] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [sources, setSources] = useState<Array<{ id: string; label: string; content: string; nature: string; integrity: boolean }>>([]);
  const [sourceError, setSourceError] = useState('');
  const p = a.payload as RecordValue;
  const isVideo = a.type === 'video';
  async function copy() { try { await copyText(a.text); setCopied(true); notice('已复制成果文字。'); setTimeout(() => setCopied(false), 1800); } catch (e) { notice((e as Error).message); } }
  async function showSources() { setEvidence(true); try { setSources(await api(`/api/projects/${view.project.id}/sources`)); } catch (e) { setSourceError((e as Error).message); } }
  return <div className={`panel-content ${isVideo ? 'video-panel-content' : ''}`}><div className="panel-kicker">{({ script: '口播脚本', video: '剪辑与包装', diagnose: '账号诊断与对标', topics: '选题策划', lighting: '拍摄布光', publish: '发布准备', review: '数据复盘' } as Record<string, string>)[a.type] ?? '创作成果'}</div><h2>{a.title}</h2>
    <div className="document-meta"><span className={`tiny-tag ${a.stale ? 'warning' : ''}`}>{a.stale ? '依赖已过期' : a.current ? isVideo ? '实际已导出' : '当前版本' : '历史版本'}</span><span>{a.scope === 'simulation' ? '模拟内容' : isVideo ? '原件保留' : '已保存'}</span><span className="spacer" />{a.type === 'script' && <span>约 {secondsLabel((p.segments ?? []).at(-1)?.end)} · 估算</span>}</div>
    {a.stale && <div className="review-notice warning"><AlertCircle /><div><strong>上游内容已发生变化</strong><p>此成果保留作参考。请让 Bot 核对后生成新版本，不要直接当作最新结果。</p><button className="text-button" onClick={() => onRequest(`请核对成果 ${a.id} 的过期依赖，依据当前项目重新生成并保存新版本。`)}>让 Bot 重新核对 <ArrowRight size={14} /></button></div></div>}
    {!isVideo && a.type !== 'script' && <div className="document-tools"><span className="tool-button active"><BookOpen />阅读</span><span className="spacer" /><button className="tool-button" onClick={showSources}><Eye />依据</button><button className="tool-button" onClick={copy}>{copied ? <Check /> : <Copy />}复制</button></div>}
    {a.type === 'script' ? <Script artifact={a} projectId={view.project.id} onSaved={onRefresh} notice={notice} onVersions={onVersions} blocked={!!view.workbenchError} />
      : isVideo ? <Video artifact={a} onRequest={onRequest} notice={notice} />
      : a.type === 'lighting' ? <Lighting artifact={a} projectId={view.project.id} onRefresh={onRefresh} onRequest={onRequest} notice={notice} />
      : a.type === 'topics' ? <div className="structured-document"><Claims claims={p.claims} />{(p.candidates ?? []).map((t: RecordValue, i: number) => <section className="topic-option" key={t.id}><div className="eyebrow">选题 {String(i + 1).padStart(2, '0')}{p.selected_id === t.id && <span className="tiny-tag">已选</span>}</div><h3>{t.question}</h3><p>{t.angle}</p><small>希望解决：{t.objective}</small><button className="text-button" onClick={() => onRequest(`选择选题 ${t.id}「${t.question}」。先保存选题选择的新版本，再围绕此题写口播稿；按现有材料，不编造事实。`, 'script')}>围绕此题写稿 <ArrowRight size={14} /></button></section>)}<p className="reading-note">选择理由：{p.selection_reason}</p></div>
      : a.type === 'diagnose' ? <div className="structured-document"><h3>{p.objective}</h3><dl className="summary-list"><dt>目标受众</dt><dd>{p.audience}</dd><dt>账号范围</dt><dd>{p.account_scope}</dd></dl><Claims claims={p.claims} /><section className="priority-action"><div className="eyebrow">优先做这一件事</div><p>{p.priority_action}</p><button className="text-button" onClick={() => onRequest('根据这份诊断和当前材料，继续策划下一条值得拍的选题。', 'topics')}>继续选题 <ArrowRight size={14} /></button></section></div>
      : a.type === 'publish' ? <div className="structured-document"><h3>{p.title}</h3><p className="pre-wrap">{p.caption || '配文待补充'}</p><section className="disclosure"><h4>披露说明</h4><p>{p.disclosure || '素材性质、权利和必要标注仍需核对。'}</p></section><h4>发布前检查</h4>{(p.checklist ?? []).map((c: RecordValue, i: number) => <div className={`checklist-row ${c.state === 'missing' ? 'missing' : ''}`} key={i}>{c.state === 'checked' ? <Check /> : <AlertCircle />}<div>{c.item}<small>{c.state === 'checked' ? '已记录技术/材料依据，不等于人工验收' : c.state === 'missing' ? '待检查' : '不适用'}</small></div></div>)}<div className="review-notice"><AlertCircle /><div><strong>这是发布准备，不是实际发布</strong><p>产品不会自动登录账号或把内容发送到平台。</p></div></div></div>
      : a.type === 'review' ? <div className="structured-document"><div className="tiny-tag">{p.observation_type === 'planned' ? '采集 / 实验计划，非已发布效果' : p.observation_type === 'simulated' ? '模拟数据' : '基于提供的数据，仍需核对口径'}</div><Claims claims={p.claims} />{(p.metrics ?? []).length > 0 && <div className="metrics-table">{p.metrics.map((m: RecordValue, i: number) => <div key={i}><span>{m.name}</span><strong>{m.value == null ? '未提供' : `${m.value}${m.unit === 'percent' ? '%' : ''}`}</strong><small>{m.window}</small></div>)}</div>}<h4>待验证的解释</h4><ul>{(p.hypotheses ?? []).map((h: string, i: number) => <li key={i}>{h}</li>)}</ul><section className="priority-action"><div className="eyebrow">下一次只改一个变量</div><p>{p.next_experiment?.change}</p><small>观察：{p.next_experiment?.metric}<br />停止条件：{p.next_experiment?.stop_rule}</small><button className="text-button" onClick={() => onRequest('根据这份复盘的下一次实验，继续优化下一条选题或口播稿。', 'topics')}>用于下一次创作 <ArrowRight size={14} /></button></section></div>
      : <div className="structured-document"><p className="pre-wrap">{a.text}</p></div>}
    {!isVideo && a.type !== 'script' && <footer className="panel-footer"><div className="version-line"><History />历史版本保留<button onClick={onVersions}>版本记录 →</button></div><button className="save-button" onClick={() => onRequest(`请继续修改「${a.title}」（${a.id}），要求：`)}><MessageSquareText />让 Bot 继续修改</button><p className="save-note">结构检查、事实核对与人工审阅分别进行。</p></footer>}
    {evidence && <Modal title="本项目的材料依据" onClose={() => setEvidence(false)} wide>{sourceError && <p className="error-box">{sourceError}</p>}<div className="sources-view">{!sources.length && !sourceError && <p className="muted">当前没有可展示的文字来源，或正在读取。图片和音视频请查看素材面板。</p>}{sources.map(s => <details key={s.id}><summary>{s.label}<span className="tiny-tag">{s.integrity ? '文件一致' : '原件需核对'}</span></summary><p className="muted">来源性质：{s.nature}；文件一致不代表内容真实或已获授权。</p><pre>{s.content}</pre></details>)}</div></Modal>}
  </div>;
}

function Claims({ claims = [] }: { claims?: RecordValue[] }) {
  return <div className="claims">{claims.map(c => <section key={c.id}><span className="claim-kind">{({ observation: '材料中的观察', hypothesis: '待验证判断', plan: '计划 / 建议', fictional: '虚构 / 模拟' } as Record<string, string>)[c.kind] ?? '待核对'}</span><p>{c.text}</p>{c.limitation && <small>{c.limitation}</small>}{c.evidence?.length > 0 && <details><summary>查看 {c.evidence.length} 处材料引用</summary>{c.evidence.map((e: RecordValue, i: number) => <blockquote key={i}>{e.quote}<small>来源 ID：{e.source_id}</small></blockquote>)}</details>}</section>)}</div>;
}

function Script({ artifact, projectId, onSaved, notice, onVersions, blocked }: { artifact: ArtifactView; projectId: string; onSaved: () => void; notice: (t: string) => void; onVersions: () => void; blocked: boolean }) {
  const segments = (artifact.payload as RecordValue).segments ?? [];
  const storageKey = `self-media-bot:draft:${projectId}:${artifact.id}`;
  const [editing, setEditing] = useState(false); const [drafts, setDrafts] = useState<string[]>(() => {
    try { const previous = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); if (Array.isArray(previous) && previous.length === segments.length && previous.every(v => typeof v === 'string')) return previous; } catch { /* Unavailable browser storage never discards server content. */ }
    return segments.map((s: RecordValue) => s.spoken);
  });
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [showShots, setShowShots] = useState(false);
  const dirty = drafts.some((v, i) => v !== segments[i].spoken);
  useEffect(() => { try { if (dirty) localStorage.setItem(storageKey, JSON.stringify(drafts)); else localStorage.removeItem(storageKey); } catch { /* The user can still copy/save the visible draft. */ } }, [drafts, dirty, storageKey]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function save() {
    setSaving(true); setError('');
    try { await post(`/api/projects/${projectId}/artifacts/${artifact.id}/revise`, { segments: segments.map((s: RecordValue, i: number) => ({ id: s.id, spoken: drafts[i] })) }); try { localStorage.removeItem(storageKey); } catch {} setEditing(false); notice('已另存新版本。分段时间已重新估算，历史稿件保留。'); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <><div className="document-tools"><button className={`tool-button ${!editing ? 'active' : ''}`} onClick={() => setEditing(false)}><BookOpen />阅读</button><button className={`tool-button ${editing ? 'active' : ''}`} disabled={!artifact.current || artifact.stale || blocked} onClick={() => setEditing(true)}><PencilLine />修改</button><span className="spacer" /><button className="tool-button" onClick={() => { void copyText(editing ? drafts.join('\n\n') : artifact.text).then(() => notice('已复制文稿。')).catch(e => notice(e.message)); }}><Copy />复制</button></div>
    <article className={`script-document ${editing ? 'editing' : ''}`} aria-label="口播稿正文">{segments.map((s: RecordValue, i: number) => <section className="script-block" key={s.id}><div className="script-block-head"><span className="number">{String(i + 1).padStart(2, '0')}</span><span>{i === 0 ? '开场' : i === segments.length - 1 ? '收尾' : '展开'}</span><time>约 {secondsLabel(Number(s.end) - Number(s.start))}</time></div>{editing ? <textarea aria-label={`修改第${i + 1}段口播`} value={drafts[i]} rows={Math.max(3, Math.ceil(drafts[i].length / 28))} onChange={e => setDrafts(values => values.map((v, n) => n === i ? e.target.value : v))} /> : <p>{s.spoken}</p>}{showShots && <div className="shot-note"><strong>镜头 / 画面</strong><p>{s.visual}</p><strong>字幕提示</strong><p>{s.subtitle || '未单独提供'}</p></div>}</section>)}<button className="text-button" onClick={() => setShowShots(v => !v)}><ChevronDown size={15} />{showShots ? '收起镜头与字幕提示' : '展开镜头与字幕提示'}</button><p className="reading-note">时长为计划估算，不是实际试读。手动修改另存后会重新估算时间。</p></article>
    {error && <p className="error-box" role="alert">{error}</p>}{dirty && !editing && <p className="reading-note">浏览器中保留了未保存的修改，点击“修改”可恢复查看。</p>}<footer className="panel-footer"><div className="version-line"><History />原稿与历史记录保留<button onClick={onVersions}>版本记录 →</button></div><button className="save-button" disabled={!editing || !dirty || saving || blocked || !artifact.current || artifact.stale} onClick={save}>{saving ? <LoaderCircle className="spin" /> : <Save />}保存为新版本</button><div className="save-note">{editing ? '只保存已修改的内容，不覆盖原稿；事实仍需核对。' : artifact.current ? '点击“修改”调整文字，或在对话中提出要求。' : '这是历史文稿，可在版本面板选择“基于此版继续”。'}</div></footer></>;
}

function Video({ artifact: a, onRequest, notice }: { artifact: ArtifactView; onRequest: Props['onRequest']; notice: Props['notice'] }) {
  const [original, setOriginal] = useState(false); const [subtitles, setSubtitles] = useState(true); const [vtt, setVtt] = useState(''); const [textPreview, setTextPreview] = useState<string>(); const [portrait, setPortrait] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const source = original ? a.originalUrl : a.mediaUrl;
  useEffect(() => {
    let objectUrl = ''; let active = true;
    if (a.subtitleUrl) void fetch(a.subtitleUrl).then(r => { if (!r.ok) throw new Error(); return r.text(); }).then(text => {
      objectUrl = URL.createObjectURL(new Blob(['WEBVTT\n\n' + text.replace(/^\uFEFF/, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')], { type: 'text/vtt' }));
      if (active) setVtt(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setVtt(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [a.subtitleUrl]);
  useEffect(() => { if (ref.current) for (const track of ref.current.textTracks) track.mode = subtitles && !original ? 'showing' : 'hidden'; }, [subtitles, original, vtt]);
  return <><div className="video-mode"><button disabled={!a.originalUrl} className={original ? 'active' : ''} onClick={() => setOriginal(true)}>原片</button><button className={!original ? 'active' : ''} onClick={() => setOriginal(false)}>成片</button></div><div className="preview-meta"><span>{portrait ? '竖屏预览' : '原始比例预览'}</span><span>实际文件</span></div><div className={`video-preview ${portrait ? 'portrait' : ''}`}><video ref={ref} key={source} controls preload="metadata" src={source} onLoadedMetadata={e => { setPortrait(e.currentTarget.videoHeight > e.currentTarget.videoWidth); }} onError={() => notice('浏览器无法播放此文件或编码。可下载后使用本机播放器检查。')}>{vtt && !original && <track key={vtt} kind="subtitles" srcLang="zh" label="中文字幕" src={vtt} default={subtitles} />}</video></div>{!a.originalUrl && <p className="reading-note">多源成片没有唯一原片，请在素材面板查看各个源文件。</p>}
    {a.subtitleUrl && <div className="subtitle-toolbar"><button className="subtitle-toggle" aria-pressed={subtitles} onClick={() => setSubtitles(v => !v)}><Captions />字幕预览<span className={`toggle ${subtitles ? 'on' : ''}`} /></button><button className="text-button" onClick={() => { void fetch(a.subtitleUrl!).then(r => r.text()).then(setTextPreview).catch(() => notice('字幕暂时无法读取。')); }}>查看 SRT <ArrowRight size={14} /></button></div>}
    <div className="review-notice"><Headphones /><div><strong>待人工审阅</strong><p>导出完成不代表已听审或已发布。请检查音画、字幕、事实和素材权利。</p></div></div><footer className="panel-footer video-footer"><div className="footer-actions"><button className="secondary" onClick={() => onRequest(`请帮我调整成片「${a.title}」（${a.id}），具体要求：`, 'edit')}><MessageSquareText />请求修改</button><a className="primary" href={`${a.mediaUrl}?download=1`} download><Download />下载成片</a></div>{a.files && <details className="download-list"><summary>字幕与其他交付文件</summary>{a.files.map(f => <a key={f.name} href={`${f.url}?download=1`} download><FileText size={15} />{f.name}<Download size={14} /></a>)}</details>}</footer>
    {textPreview !== undefined && <Modal title="实际字幕文件" onClose={() => setTextPreview(undefined)}><pre className="subtitle-text">{textPreview}</pre></Modal>}</>;
}

function Lighting({ artifact: a, projectId, onRefresh, onRequest, notice }: { artifact: ArtifactView; projectId: string; onRefresh: () => void; onRequest: Props['onRequest']; notice: Props['notice'] }) {
  const p = a.payload as RecordValue; const [tierId, setTierId] = useState('standard'); const [saving, setSaving] = useState(false);
  const tier = (p.tiers ?? []).find((t: RecordValue) => t.id === tierId) ?? p.tiers?.[0];
  if (!tier) return <p>方案内容待核对。</p>;
  const chosen = p.selection?.plan_id === a.id && p.selection?.tier === tier.id;
  async function select() { setSaving(true); try { await post(`/api/projects/${projectId}/lighting/${a.id}/select`, { tier: tier.id }); notice('已记录所选方案，现场效果仍需试拍确认。'); onRefresh(); } catch (e) { notice((e as Error).message); } finally { setSaving(false); } }
  return <div className="lighting-result"><div className="lighting-options">{(p.tiers ?? []).map((t: RecordValue) => <button key={t.id} className={tier.id === t.id ? 'selected' : ''} onClick={() => setTierId(t.id)}>{t.name}</button>)}</div><p className="reading-note">{p.precision_label}</p>{p.svgUrls?.[tier.id] && <img className="lighting-svg" src={p.svgUrls[tier.id]} alt={`${tier.name}布光布局示意`} />}<h3>{tier.upgrade}</h3><p>{tier.tradeoff}</p><ol className="lighting-steps">{(tier.steps ?? []).map((step: string, i: number) => <li key={i}>{step}</li>)}</ol>{(tier.warnings ?? []).length > 0 && <details><summary>适用条件与限制</summary><ul>{tier.warnings.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></details>}<div className="review-notice"><LampDesk /><div><strong>现场试拍后再调整</strong><p>三档不等于固定灯数或固定瓦数。布局图是规划，不是实景效果验收。</p></div></div><button className="save-button" disabled={saving || !a.current || chosen} onClick={select}>{saving ? <LoaderCircle className="spin" /> : <Check />}{chosen ? '已选择此档，待试拍' : `选择${tier.name}`}</button><button className="text-button" onClick={() => onRequest(`我选择了布光方案 ${a.id} 的 ${tier.name}。这是现场试拍反馈：`, 'lighting')}>补充试拍反馈 <ArrowRight size={14} /></button></div>;
}

function AssetPreview({ asset, onClose }: { asset: AssetView; onClose: () => void }) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [truncated, setTruncated] = useState(false);
  const image = asset.kind.includes('image'); const video = asset.kind.includes('video'); const audio = asset.kind.includes('audio');
  useEffect(() => { if (asset.url && !image && !video && !audio) void fetch(asset.url).then(r => { if (!r.ok) throw new Error('无法读取素材。'); return r.text(); }).then(value => { setText(value.slice(0, 200000)); setTruncated(value.length > 200000); }).catch(e => setError(e.message)); }, [asset.url]);
  return <Modal title={asset.name} onClose={onClose} wide><div className="asset-preview">{error && <p className="error-box">{error}</p>}{image ? <img src={asset.url} alt={asset.name} /> : video ? <video controls src={asset.url} /> : audio ? <audio controls src={asset.url} /> : <pre>{text || '正在读取…'}</pre>}{truncated && <p className="reading-note">仅预览前200,000个字符，下载可查看完整原件。</p>}<p className="muted">{natureNames[asset.nature] ?? asset.nature} · 文件一致不代表已完成事实或权利核验。</p>{asset.url && <a className="secondary" href={`${asset.url}?download=1`} download><Download />下载原文件</a>}</div></Modal>;
}
