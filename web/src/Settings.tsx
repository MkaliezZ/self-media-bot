import { useState } from 'react';
import { Check, LoaderCircle, ShieldCheck, AlertCircle, KeyRound, Cable, ChevronDown } from 'lucide-react';
import { api, post, copyText } from './api';
import { Modal } from './Modal';
import type { PublicSettings, Health } from '../../shared/types';

export function Settings({ initial, health, onClose, onSaved, notice }: { initial: PublicSettings; health?: Health; onClose: () => void; onSaved: (s: PublicSettings) => void; notice: (s: string) => void }) {
  const [form, setForm] = useState({ model: initial.model, baseUrl: initial.baseUrl, maxTokens: initial.maxTokens, vision: initial.vision, workbenchRoot: initial.workbenchRoot, python: initial.python, apiKey: '', clearKey: false });
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [testConfirm, setTestConfirm] = useState(false); const [testResult, setTestResult] = useState(''); const [diagnostic, setDiagnostic] = useState<unknown>();
  async function save() {
    setBusy('save'); setError('');
    try { const value = await api<PublicSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(form) }); onSaved(value); setForm(v => ({ ...v, apiKey: '', clearKey: false })); notice('连接配置已保存。凭据不会发送到页面。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function test() {
    setTestConfirm(false); setBusy('test'); setError(''); setTestResult('');
    try { const result = await post<{ response: string }>('/api/settings/test-model', { consent: true }); setTestResult(result.response); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function diagnose() {
    setBusy('doctor'); setError('');
    try { setDiagnostic(await post('/api/diagnostics')); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <Modal title="连接与运行设置" onClose={onClose} wide><div className="settings-body">
    <p className="settings-intro"><ShieldCheck />仅本机使用。项目库与原工作台隔离，源素材与历史版本保留。</p>
    <section className="settings-section"><h3><KeyRound />模型连接</h3><p className="muted">由官方 DeepSeek Harness 执行。发送任务后，需求及选用的材料会发给你配置的模型服务，并可能产生 API 费用。</p>
      <div className="form-grid"><label>模型名称<input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="deepseek-flash" /></label><label>单次输出上限<select value={form.maxTokens} onChange={e => setForm({ ...form, maxTokens: Number(e.target.value) })}>{[4096, 8192, 16384, 32768, 65536].map(v => <option value={v} key={v}>{v.toLocaleString()} tokens</option>)}</select></label></div>
      <label>Messages API 根地址<input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/anthropic" /><small>使用 DeepSeek Messages / 兼容网关，不是 Chat Completions 地址。非本机地址必须使用 HTTPS；更换地址前请确认可信，密钥将用于该地址。</small></label>
      <label>API Key<input aria-label="API Key" aria-describedby="api-key-help" autoComplete="new-password" type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value, clearKey: false })} placeholder={initial.hasKey ? `已配置（${initial.keySource === 'environment' ? '来自环境变量' : '本机保存'}），留空保持不变` : '输入你的模型 API Key'} /><small id="api-key-help">只写入本机凭据存储，不显示已保存的密钥，不进入项目内容。</small></label>
      <label className="checkbox-label"><input type="checkbox" checked={form.vision} onChange={e => setForm({ ...form, vision: e.target.checked })} />此模型支持图片理解（布光和实际帧审阅需要）</label>
      {initial.keySource === 'saved' && <label className="checkbox-label"><input type="checkbox" checked={form.clearKey} onChange={e => setForm({ ...form, clearKey: e.target.checked })} />清除本机保存的 API Key（如存在环境变量，将使用环境变量）</label>}
      <div className="connection-line"><span className={`dot ${initial.hasKey ? '' : 'amber'}`} />{initial.hasKey ? '凭据已配置，尚不代表本次连接测试通过' : '尚未配置模型凭据'}<button className="text-button" disabled={!!busy || !initial.hasKey} onClick={() => setTestConfirm(true)}>测试已保存的连接</button></div>
      {testResult && <div className="inline-success"><Check />模型返回：{testResult}</div>}
    </section>
    <section className="settings-section"><h3><Cable />自媒体工作台</h3><div className="connection-line"><span className={`dot ${health?.workbench.ok ? '' : 'amber'}`} />{health?.workbench.ok ? '本机工作台可连接' : '尚未连接或需要检查'}</div>
      <label>工作台目录<input value={form.workbenchRoot} onChange={e => setForm({ ...form, workbenchRoot: e.target.value })} placeholder="包含 workbench.py 的已安装目录" /></label>
      <details><summary><ChevronDown size={15} />高级运行信息</summary><label>工作台 Python 解释器<input value={form.python} onChange={e => setForm({ ...form, python: e.target.value })} /></label><p className="private-path">本 Bot 的独立数据目录：{initial.dataHome}</p><p className="muted">会复用已有模型/GPU 配置，但不会改动原工作台的项目库，不自动安装或下载模型。</p></details>
      <button className="secondary" disabled={!!busy} onClick={diagnose}>{busy === 'doctor' ? <LoaderCircle className="spin" /> : <Cable />}检测已保存的运行环境</button>
      {diagnostic !== undefined && <details open className="diagnostic"><summary>诊断信息（环境检查不等于媒体验收）</summary><pre>{JSON.stringify(diagnostic, null, 2)}</pre><button className="text-button" onClick={() => { void copyText(JSON.stringify(diagnostic, null, 2)).then(() => notice('已复制诊断信息。')).catch(e => setError(e.message)); }}>复制诊断信息</button></details>}
    </section>
    {error && <div className="error-box" role="alert"><AlertCircle />{error}</div>}
    <footer className="modal-actions"><span className="muted">修改模型或地址后，同一项目的旧会话仍会保留。</span><button className="primary" disabled={!!busy} onClick={save}>{busy === 'save' ? <LoaderCircle className="spin" /> : <Check />}保存设置</button></footer>
  </div>{testConfirm && <div className="confirm-overlay"><div role="alertdialog" aria-label="确认模型测试"><h3>发送一次真实模型测试？</h3><p>使用已保存的 {initial.model} 配置，通过 DSH 发送最小请求。可能产生少量 API 费用，不会上传你的项目素材。</p><div className="button-row"><button className="secondary" onClick={() => setTestConfirm(false)}>取消</button><button className="primary" onClick={test}>同意并测试</button></div></div></div>}{busy === 'test' && <div className="settings-testing"><LoaderCircle className="spin" />正在通过官方 DSH 测试连接，请稍候…</div>}</Modal>;
}
