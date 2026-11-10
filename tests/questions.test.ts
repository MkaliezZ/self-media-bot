import { describe, expect, it } from 'vitest';
import { testApp, until, toolResult } from './helpers.js';

describe('真实 DSH 的用户问答、越界拒绝和中断', () => {
  it('问题不会被自动批准，用户回答后才继续，并保留对话', async () => {
    const app = await testApp((_body, index) => index === 0 ? { tool: { name: 'media_ask_user', input: { question: '这条内容面向哪个受众？', options: ['新手', '有经验的创作者'] } } } : { text: '收到明确回答；这是协议问答测试，不代表已生成正式成果。' });
    try {
      const started = (await app.request('/api/tasks', { prompt: '请先问清受众，再继续。', intent: 'script', uploadIds: [] })).body;
      const waiting = await until(() => app.request(`/api/projects/${started.projectId}`), r => r.body.project.tasks.at(-1).status === 'waiting');
      const question = waiting.body.project.tasks.at(-1).question;
      expect(app.fixture.requests).toHaveLength(1);
      expect((await app.request(`/api/tasks/${started.taskId}/answer`, { questionId: 'wrong-id', answer: '不应通过', uploadIds: [] })).status).toBe(409);
      expect((await app.request(`/api/tasks/${started.taskId}/answer`, { questionId: question.id, answer: '新手', uploadIds: [] })).status).toBe(200);
      const done = await until(() => app.request(`/api/projects/${started.projectId}`), r => r.body.project.tasks.at(-1).status === 'done');
      expect(done.body.project.messages.some((m: any) => m.content === '新手')).toBe(true);
      expect(toolResult(app.fixture.requests.at(-1)).answer).toBe('新手');
    } finally { await app.close(); }
  }, 120000);
  it('中断等待中的 Bot，不能宣称取消了工作台后台渲染', async () => {
    const app = await testApp(() => ({ tool: { name: 'media_ask_user', input: { question: '请补充材料。' } } }));
    try {
      const started = (await app.request('/api/tasks', { prompt: '这是等待和中断测试。', intent: 'script', uploadIds: [] })).body;
      await until(() => app.request(`/api/projects/${started.projectId}`), r => r.body.project.tasks.at(-1).status === 'waiting');
      const response = await app.request(`/api/tasks/${started.taskId}/cancel`, {});
      expect(response.status).toBe(200); expect(response.body.note).toContain('后台渲染');
      const result = (await app.request(`/api/projects/${started.projectId}`)).body;
      expect(result.project.tasks.at(-1).status).toBe('interrupted'); expect(result.project.tasks.at(-1).question).toBeUndefined();
    } finally { await app.close(); }
  }, 120000);
  it('模型尝试访问其他项目时，工具返回拒绝，不执行越界请求', async () => {
    const app = await testApp((body, index) => index === 0 ? { tool: { name: 'media_request', input: { method: 'GET', path: '/api/projects/other-project/jobs' } } } : { text: `已收到越界拒绝：${JSON.stringify(toolResult(body))}` });
    try {
      const started = (await app.request('/api/tasks', { prompt: '自媒体工具隔离的技术测试。', intent: 'script', uploadIds: [] })).body;
      const result = await until(() => app.request(`/api/projects/${started.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.body.project.tasks.at(-1).status));
      expect(result.body.project.messages.at(-1).content).toContain('当前自媒体项目');
      expect(result.body.artifacts).toHaveLength(0);
    } finally { await app.close(); }
  }, 120000);
});
