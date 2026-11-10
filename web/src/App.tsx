import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AudioLines, Plus, FolderOpen, Settings as SettingsIcon, Paperclip, ArrowUp, ArrowUpRight, ArrowRight, FileText, Film, X, SlidersHorizontal, LoaderCircle, Check, AlertCircle, Square, ChevronDown, Search, PanelLeftClose, PanelLeftOpen, Menu, ShieldCheck, RefreshCw, Image as ImageIcon, MessageSquareText } from 'lucide-react';
import type { BotTask, Health, Intent, ProjectSummary, ProjectView, PublicSettings } from '../../shared/types';
import { api, ApiError, bootstrap, post, upload } from './api';
import { activeStatus, intentName, natureNames, sizeLabel, statusName, TASKS, timeLabel } from './catalog';
import { Results } from './Results';
import { Settings } from './Settings';

interface Attachment { id: string; name: string; bytes: number; mime: string; nature: string; progress: number; uploading: boolean; error?: string }

export function App() {
  const [ready, setReady] = useState(false); const [fatal, setFatal] = useState('');
  const [settings, setSettings] = useState<PublicSettings>(); const [health, setHealth] = useState<Health>(); const [settingsOpen, setSettingsOpen] = useState(false);
  const [page, setPage] = useState<'home' | 'projects' | 'workspace'>('home'); const [projectId, setProjectId] = useState<string>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]); const [view, setView] = useState<ProjectView>(); const [viewError, setViewError] = useState(''); const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(''); const [intent, setIntent] = useState<Intent>('auto'); const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false); const [composerError, setComposerError] = useState(''); const [target, setTarget] = useState(''); const [selectedArtifact, setSelectedArtifact] = useState<string>();
  const [expanded, setExpanded] = useState(false); const [mobileResult, setMobileResult] = useState(false); const [collapsed, setCollapsed] = useState(false); const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(''); const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null); const inputRef = useRef<HTMLTextAreaElement>(null); const chatRef = useRef<HTMLDivElement>(null);
  const pidRef = useRef<string | undefined>(undefined); const pageRef = useRef(page); const sequence = useRef(0); const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const lastTask = useRef('');
  const notice = useCallback((text: string) => { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 6000); }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const navigate = (location: 'home' | 'projects' | string) => { window.location.hash = location === 'home' ? '' : location === 'projects' ? 'projects' : `project/${location}`; };
  const refreshProjects = useCallback(async () => { try { setProjects(await api('/api/projects')); } catch (e) { notice((e as Error).message); } }, [notice]);
  const refreshHealth = useCallback(async () => { try { setHealth(await api('/api/health')); } catch { setHealth(undefined); } }, []);
  const refreshView = useCallback(async (pid: string, chooseLatest = false) => {
    const current = ++sequence.current;
    try {
      const result = await api<ProjectView>(`/api/projects/${pid}`);
      if (current !== sequence.current || pidRef.current !== pid) return;
      const token = result.project.tasks.at(-1); const finished = token && ['done', 'failed', 'interrupted'].includes(token.status) && lastTask.current !== `${token.id}:${token.status}`;
      if (token) lastTask.current = `${token.id}:${token.status}`;
      setView(result); setViewError(''); setLoading(false);
      setSelectedArtifact(id => chooseLatest || finished || !result.artifacts.some(a => a.id === id) ? result.artifacts[0]?.id : id);
    } catch (e) { if (current === sequence.current) { setViewError((e as Error).message); setLoading(false); } }
  }, []);

  const loadRoute = useCallback(() => {
    const hash = window.location.hash.slice(1); const match = /^project\/([a-zA-Z0-9_-]{1,100})$/.exec(hash);
    const next = match?.[1];
    if (pidRef.current !== next) { setView(undefined); setSelectedArtifact(undefined); setLoading(!!next); lastTask.current = ''; setDraft(''); setIntent('auto'); setComposerError(''); }
    pidRef.current = next; setProjectId(next); const route = next ? 'workspace' : hash === 'projects' ? 'projects' : 'home'; setPage(route); pageRef.current = route;
    if (next) void refreshView(next);
  }, [refreshView]);
  useEffect(() => {
    let active = true;
    void bootstrap().then(result => { if (!active) return; setSettings(result.settings); setReady(true); loadRoute(); void refreshProjects(); void refreshHealth(); }).catch(e => { if (active) setFatal(e.message); });
    window.addEventListener('hashchange', loadRoute);
    return () => { active = false; window.removeEventListener('hashchange', loadRoute); };
  }, [loadRoute, refreshProjects, refreshHealth]);
  useEffect(() => {
    if (!ready) return;
    const events = new EventSource('/api/events'); let timer: ReturnType<typeof setTimeout>;
    events.addEventListener('change', event => {
      const pid = JSON.parse((event as MessageEvent).data).projectId;
      clearTimeout(timer); timer = setTimeout(() => { void refreshProjects(); if (pidRef.current === pid) void refreshView(pid); }, 250);
    });
    events.addEventListener('closing', () => notice('服务正在退出，历史项目已保留。重新启动后刷新即可继续。'));
    const poll = setInterval(() => { if (pidRef.current && document.visibilityState === 'visible') void refreshView(pidRef.current); }, 7000);
    const onFocus = () => { void refreshProjects(); if (pidRef.current) void refreshView(pidRef.current); };
    window.addEventListener('focus', onFocus);
    return () => { events.close(); clearTimeout(timer); clearInterval(poll); window.removeEventListener('focus', onFocus); };
  }, [ready, refreshProjects, refreshView, notice]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [view?.project.messages.length, projectId]);
  useEffect(() => { const textarea = inputRef.current; if (textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.min(page === 'home' ? 210 : 180, textarea.scrollHeight)}px`; } }, [draft, page]);

  const task = view?.project.tasks.at(-1); const busy = activeStatus(task?.status); const uploading = attachments.some(a => a.uploading);
  async function addFiles(files: FileList | File[]) {
    for (const file of [...files]) {
      const localId = crypto.randomUUID();
      if (attachments.length >= 30) { notice('每轮最多附加30个文件。'); break; }
      setAttachments(values => [...values, { id: localId, name: file.name, mime: file.type, bytes: file.size, nature: 'unknown', progress: 0, uploading: true }]);
      try {
        const result = await upload(file, progress => setAttachments(values => values.map(v => v.id === localId ? { ...v, progress } : v)));
        setAttachments(values => values.map(v => v.id === localId ? { ...v, ...result, progress: 100, uploading: false } : v));
      } catch (e) { setAttachments(values => values.map(v => v.id === localId ? { ...v, uploading: false, error: (e as Error).message } : v)); }
    }
    if (fileRef.current) fileRef.current.value = '';
  }
  async function changeNature(id: string, nature: string) {
    try { await api(`/api/uploads/${id}`, { method: 'PATCH', body: JSON.stringify({ nature }) }); setAttachments(v => v.map(a => a.id === id ? { ...a, nature } : a)); } catch (e) { notice((e as Error).message); }
  }
  async function answerQuestion(answer: string) {
    if (!task?.question) return; setSending(true); setComposerError('');
    try { await post(`/api/tasks/${task.id}/answer`, { questionId: task.question.id, answer, uploadIds: attachments.filter(a => !a.error && !a.uploading).map(a => a.id) }); setDraft(''); setAttachments([]); if (projectId) await refreshView(projectId); }
    catch (e) { setComposerError((e as Error).message); } finally { setSending(false); }
  }
  async function send() {
    if (!draft.trim() || sending || uploading) return;
    if (task?.status === 'waiting' && task.question) { await answerQuestion(draft.trim()); return; }
    if (busy) { notice('当前任务仍在处理。可以先记下修改要求，完成后再发送，或先停止 Bot。'); return; }
    if (!settings?.hasKey) { setSettingsOpen(true); setComposerError('先配置模型连接，才能开始真实创作。'); return; }
    if (attachments.some(a => a.error)) { setComposerError('请移除或重新上传失败的附件。'); return; }
    setSending(true); setComposerError('');
    try {
      const result = await post<{ projectId: string }>('/api/tasks', { prompt: draft.trim(), intent, projectId: page === 'workspace' ? projectId : target || undefined, uploadIds: attachments.map(a => a.id) });
      setDraft(''); setAttachments([]); setMobileResult(false);
      if (pidRef.current === result.projectId) await refreshView(result.projectId); else navigate(result.projectId);
      void refreshProjects();
    } catch (e) { setComposerError((e as Error).message); void refreshProjects(); if (e instanceof ApiError && e.code === 'MODEL_NOT_CONFIGURED') setSettingsOpen(true); }
    finally { setSending(false); }
  }
  function requestChange(text: string, nextIntent?: string) {
    setDraft(text); if (nextIntent) setIntent(nextIntent as Intent); inputRef.current?.focus(); setMobileResult(false);
  }
  async function stop() { if (!task) return; try { await post(`/api/tasks/${task.id}/cancel`); notice('Bot 已停止。后台渲染状态单独显示，已保存内容不会删除。'); if (projectId) await refreshView(projectId); } catch (e) { notice((e as Error).message); } }
  const savedSettings = (value: PublicSettings) => { setSettings(value); void refreshHealth(); };

  if (fatal) return <main className="fatal"><AlertCircle /><h1>暂时无法连接本机服务</h1><p>{fatal}</p><button className="primary" onClick={() => location.reload()}>重新连接</button></main>;
  if (!ready) return <main className="loading-app"><div className="brand-mark"><AudioLines /></div><LoaderCircle className="spin" /><p>正在连接你的创作空间…</p></main>;

  const composer = <div className={`composer-wrap ${page === 'home' ? 'home-composer-wrap' : ''}`}>
    {attachments.length > 0 && <div className="pending-attachments">{attachments.map(a => <div key={a.id} className={`pending-attachment ${a.error ? 'failed' : ''}`}><span className="file-square">{a.uploading ? <LoaderCircle className="spin" /> : a.mime.includes('video') ? <Film /> : <FileText />}</span><span className="pending-info"><strong>{a.name}</strong><small>{a.error ?? (a.uploading ? `正在上传 ${a.progress}%` : sizeLabel(a.bytes))}</small>{!a.uploading && !a.error && /image|video|audio/.test(a.mime) && <select aria-label={`${a.name}的素材性质`} value={a.nature} onChange={e => { void changeNature(a.id, e.target.value); }}>{Object.entries(natureNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</span><button className="icon-button" disabled={a.uploading} aria-label={`移除待发送附件${a.name}`} onClick={() => setAttachments(values => values.filter(v => v.id !== a.id))}><X size={15} /></button></div>)}</div>}
    <div className={`composer ${page === 'home' ? 'home-composer' : ''}`}>
      <textarea ref={inputRef} aria-label={page === 'home' ? '描述创作需求' : '继续描述创作要求'} placeholder={task?.status === 'waiting' ? '回答 Bot 的问题，也可以补充素材…' : page === 'home' ? '告诉我你想做什么，也可以把素材拖到这里…' : '继续描述想改的地方，或补充素材…'} value={draft} onChange={e => setDraft(e.target.value)} maxLength={10000} rows={page === 'home' ? 3 : 2} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="composer-actions"><button className="plain-action" onClick={() => fileRef.current?.click()}><Paperclip />添加素材</button><span className="composer-separator" />{page === 'home' ? <label className="composer-select"><FolderOpen /><select aria-label="选择新建或已有项目" value={target} onChange={e => setTarget(e.target.value)}><option value="">新建项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label> : <label className="composer-select"><SlidersHorizontal /><select aria-label="选择任务类型" value={intent} onChange={e => setIntent(e.target.value as Intent)}><option value="auto">自动理解任务</option>{TASKS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}<span className="spacer" />{busy && task?.status !== 'waiting' ? <button className="stop-button" onClick={() => { void stop(); }} title="停止 Bot 不会取消已启动的工作台渲染"><Square size={15} />停止 Bot</button> : <button className={page === 'home' ? 'primary' : 'send-square'} aria-label={task?.status === 'waiting' ? '发送补充回答' : '发送创作需求'} disabled={!draft.trim() || sending || uploading} onClick={() => { void send(); }}>{sending ? <LoaderCircle className="spin" /> : <>{page === 'home' && '开始创作'}{page === 'home' ? <ArrowUpRight /> : <ArrowUp />}</>}</button>}</div>
    </div>{composerError && <div className="composer-error" role="alert"><AlertCircle size={16} />{composerError}</div>}<div className="composer-note"><span>{page === 'home' ? '材料只在本机保存；执行时发送所需内容至你配置的模型。' : '原件与版本保留 · 不自动对外发布'}</span><span>Enter 发送 · Shift + Enter 换行</span></div>
  </div>;

  return <div className={`app-shell ${page === 'workspace' ? 'workspace' : ''} ${expanded ? 'reading-expanded' : ''} ${collapsed ? 'nav-collapsed' : ''} ${mobileResult ? 'show-result' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); } }}>
    <input className="visually-hidden" type="file" multiple ref={fileRef} accept=".txt,.md,.json,.csv,.png,.jpg,.jpeg,.mp4,.mov,.mkv,.webm,.wav,.mp3,.m4a" onChange={e => { if (e.target.files) void addFiles(e.target.files); }} />
    <aside className="sidebar" aria-label="项目导航"><a href="#" className="brand" aria-label="自媒体Bot首页"><span className="brand-mark"><AudioLines /></span><span className="brand-name">自媒体 Bot</span></a><div className="brand-note">专注每一次创作</div><button className="new-button" onClick={() => navigate('home')}><Plus />新建创作</button><button className={`nav-row ${page === 'projects' ? 'active' : ''}`} onClick={() => navigate('projects')}><FolderOpen /><span>我的项目</span></button><div className="side-label">最近项目</div><div className="side-projects">{projects.slice(0, 8).map(p => <button className={`side-project ${projectId === p.id ? 'active' : ''}`} key={p.id} onClick={() => navigate(p.id)}><span className="project-title">{p.title}</span><span className="project-meta"><span className={`dot ${p.status === 'failed' ? 'amber' : ''}`} />{intentName(p.intent)}</span></button>)}{!projects.length && <p className="sidebar-empty">从第一项创作开始。<br />项目会保留在这里。</p>}</div><div className="side-bottom"><div className="local-note"><ShieldCheck />仅本机 · DSH 专用底座</div><button className="nav-row" onClick={() => setSettingsOpen(true)}><SettingsIcon /><span>设置</span></button></div><button className="collapse-nav icon-button" aria-label={collapsed ? '展开导航' : '收起导航'} onClick={() => setCollapsed(v => !v)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button></aside>

    {page === 'home' && <main className="home-main"><header className="topbar"><div className="crumb">创作空间 <span>/</span> 新建创作</div><button className="connection-status" onClick={() => setSettingsOpen(true)}><span className={`dot ${health?.workbench.ok && settings?.hasKey ? '' : 'amber'}`} />{health?.workbench.ok && settings?.hasKey ? '本机工作台就绪' : '检查连接设置'}</button></header><div className="home-content"><div className="eyebrow">你的自媒体创作助手</div><h1>这次，想完成哪项创作？</h1><p className="intro">告诉我你的想法，或者从一个环节开始。</p>{composer}<div className="section-head"><h2>从一个环节开始</h2><span>每个环节都可以单独完成</span></div><div className="task-grid">{TASKS.map(t => <button className={`task-entry ${intent === t.id ? 'selected' : ''}`} key={t.id} onClick={() => { setIntent(t.id); setDraft(t.prompt); inputRef.current?.focus(); }}><span className="task-icon"><t.icon /></span><span><strong>{t.name}</strong><small>{t.subtitle}</small></span></button>)}</div><div className="section-head recent-heading"><h2>最近项目</h2><button className="text-button" onClick={() => navigate('projects')}>查看项目 <ArrowRight /></button></div><div className="recent-list">{projects.slice(0, 3).map(p => <button className="recent-row" key={p.id} onClick={() => navigate(p.id)}><span className="file-square"><FileText /></span><span className="recent-info"><strong>{p.title}</strong><small>{intentName(p.intent)} / {timeLabel(p.updatedAt)}</small></span><span className="recent-tag">{statusName(p.status)}</span><ArrowUpRight size={17} /></button>)}{!projects.length && <div className="recent-empty"><FolderOpen /><div>还没有项目<p>把需求或素材交给 Bot，第一份创作会保存在这里。</p></div></div>}</div><div className="home-footer"><span>材料有依据，修改有记录。</span><span>用自然语言，继续每一次创作。</span></div></div></main>}

    {page === 'projects' && <main className="projects-main"><header className="topbar"><div className="crumb">创作空间 <span>/</span> 我的项目</div><button className="plain-action" onClick={() => { void refreshProjects(); }}><RefreshCw />刷新</button></header><div className="projects-content"><div className="eyebrow">每一份创作，都可以接着做</div><h1>我的项目</h1><div className="project-search"><Search /><input aria-label="搜索项目" placeholder="搜索项目名称…" value={search} onChange={e => setSearch(e.target.value)} /><span>最近更新优先</span></div><div className="project-table">{projects.filter(p => p.title.toLowerCase().includes(search.toLowerCase())).map(p => <button className="project-table-row" key={p.id} onClick={() => navigate(p.id)}><span className="file-square"><FileText /></span><span className="project-table-info"><strong>{p.title}</strong><small>{p.lastMessage || '尚未开始任务'}</small></span><span className="project-stage">{intentName(p.intent)}</span><span className={`tiny-tag ${p.status === 'failed' ? 'warning' : ''}`}>{statusName(p.status)}</span><time>{timeLabel(p.updatedAt)}</time><ArrowUpRight size={17} /></button>)}{!projects.filter(p => p.title.toLowerCase().includes(search.toLowerCase())).length && <div className="empty-state"><FolderOpen /><h3>{search ? '没有匹配的项目' : '从第一项创作开始'}</h3><p>{search ? '换一个项目名称试试。' : '原始材料、对话和成果版本都会保留。'}</p><button className="primary" onClick={() => navigate('home')}><Plus />新建创作</button></div>}</div></div></main>}

    {page === 'workspace' && <><main className="chat-column"><header className="topbar workspace-top"><div className="project-header"><div className="breadcrumb-small">我的项目 / 当前项目</div><h1>{view?.project.title ?? '正在打开项目…'}</h1></div><button className="open-results secondary small" onClick={() => setMobileResult(true)}><FileText />成果</button><span className={`status-pill ${task?.status === 'failed' ? 'warning' : ''}`}><span className="dot" />{task ? statusName(task.status) : '项目已保存'}</span></header>
      {loading ? <div className="workspace-loading"><LoaderCircle className="spin" />正在恢复项目…</div> : viewError ? <div className="workspace-loading error"><AlertCircle /><p>{viewError}</p><button className="secondary" onClick={() => { if (projectId) void refreshView(projectId); }}>重新载入</button></div> : <div className="chat-stream" ref={chatRef}>{!view?.project.messages.length && <div className="chat-empty"><AudioLines /><h2>接着这份创作，往下做。</h2><p>描述下一步，或补充已有的素材。</p></div>}{view?.project.messages.map(message => <section className={`turn ${message.role === 'user' ? 'user-turn' : 'bot-turn'} ${message.error ? 'message-error' : ''}`} key={message.id}><div className="speaker">{message.role !== 'user' && <span className="avatar"><AudioLines /></span>}<strong>{message.role === 'user' ? '你' : '自媒体 Bot'}</strong><time>{timeLabel(message.at)}</time></div><div className={message.role === 'user' ? 'user-message' : 'bot-message'}><ReactMarkdown components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{message.content}</ReactMarkdown>{message.attachmentIds?.map(id => { const file = view.project.uploads.find(u => u.id === id); return file ? <div className="message-attachment" key={id}><FileText /><span>{file.name}<small>{natureNames[file.nature] ?? '用户提供'} · 原件保留</small></span></div> : null; })}</div>{message.role === 'assistant' && !message.error && view.artifacts.length > 0 && message.taskId === view.project.tasks.at(-1)?.id && <button className="result-card" onClick={() => { setSelectedArtifact(view.artifacts[0].id); setMobileResult(true); }}><div className="result-card-main"><span className="result-icon">{view.artifacts[0].type === 'video' ? <Film /> : <FileText />}</span><span><strong>{view.artifacts[0].title}</strong><small>{view.artifacts[0].stale ? '上游变更，需核对依赖' : '已保存，历史版本保留'}</small></span></div><div className="result-card-foot"><span><Check />实际保存的成果</span><span>在右侧查看 <ArrowRight /></span></div></button>}</section>)}{task && activeStatus(task.status) && <TaskProgress task={task} onStop={() => { void stop(); }} onAnswer={answerQuestion} sending={sending} />}{task?.status === 'interrupted' && <div className="task-interrupted"><Square size={16} /><p>{task.error}</p></div>}</div>}
      <div className="chat-compose-wrap">{composer}</div>
    </main>{view ? <Results view={view} selectedId={selectedArtifact} onSelect={setSelectedArtifact} onRefresh={() => { if (projectId) void refreshView(projectId, true); }} onRequest={requestChange} expanded={expanded} onExpand={() => setExpanded(v => !v)} notice={notice} onClose={() => setMobileResult(false)} /> : <aside className="result-panel"><div className="empty-panel"><FileText /><p>成果会显示在这里。</p></div></aside>}</>}
    {settingsOpen && settings && <Settings initial={settings} health={health} onClose={closeSettings} onSaved={savedSettings} notice={notice} />}
    {toast && <div className="toast" role="status">{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={16} /></button></div>}
    {dragging && <div className="drop-overlay"><Paperclip /><h2>把素材放到这里</h2><p>文稿、图片、音视频 · 原件保留</p></div>}
  </div>;
}

function TaskProgress({ task, onStop, onAnswer, sending }: { task: BotTask; onStop: () => void; onAnswer: (answer: string) => Promise<void>; sending: boolean }) {
  const [answer, setAnswer] = useState('');
  return <div className="task-progress" aria-live="polite"><div className="task-progress-title">{task.status === 'waiting' ? <MessageSquareText /> : <LoaderCircle className="spin" />}<strong>{task.status === 'waiting' ? '需要你补充一个信息' : task.progress.at(-1)?.label ?? '正在准备任务'}</strong></div>{task.question && <div className="question-card"><p>{task.question.title}</p><div className="question-options">{task.question.questions?.[0]?.options?.map(option => <button className="secondary small" key={option.label} disabled={sending} onClick={() => { void onAnswer(option.label); }}>{option.label}</button>)}</div><div className="answer-field"><textarea aria-label="补充回答" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="补充说明，也可以在下方输入框添加材料…" rows={2} /><button className="primary small" disabled={!answer.trim() || sending} onClick={() => { void onAnswer(answer); }}>提交回答</button></div></div>}<details><summary>查看执行摘要 <ChevronDown size={14} /></summary><ol>{task.progress.map((p, i) => <li key={`${p.at}-${i}`} className={p.error ? 'warning' : ''}><span>{p.label}</span><time>{new Date(p.at).toLocaleTimeString('zh-CN')}</time>{p.detail && <small>{p.detail}</small>}</li>)}</ol></details><button className="text-button muted" onClick={onStop}><Square size={13} />停止 Bot 继续处理</button></div>;
}
