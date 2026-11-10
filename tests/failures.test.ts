import { describe, expect, it } from 'vitest';
import { testApp, until } from './helpers.js';

describe('失败与不完整输出不能冒充成功', () => {
  it('模型认证失败会显示失败并保留原始需求，不泄露key', async () => {
    const app = await testApp(() => ({ status: 401 }));
    try {
      const started = await app.request('/api/tasks', { prompt: '这是认证失败处理测试，保留我的需求。', intent: 'script', uploadIds: [] });
      const result = await until(() => app.request(`/api/projects/${started.body.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.body.project.tasks.at(-1).status));
      expect(result.body.project.tasks.at(-1).status).toBe('failed');
      expect(result.body.project.messages[0].content).toContain('保留我的需求');
      expect(result.body.artifacts).toHaveLength(0);
      expect(JSON.stringify(result.body)).not.toContain(`sk-${'0'.repeat(32)}`);
    } finally { await app.close(); }
  }, 120000);
  it('输出达到token上限时，不把半份回答标成完成', async () => {
    const app = await testApp(() => ({ text: '这是一份未完成的部分输出。', finishReason: 'max_tokens' }));
    try {
      const started = await app.request('/api/tasks', { prompt: '这是输出上限的技术测试。', intent: 'script', uploadIds: [] });
      const result = await until(() => app.request(`/api/projects/${started.body.projectId}`), r => !['pending', 'running', 'waiting'].includes(r.body.project.tasks.at(-1).status));
      expect(result.body.project.tasks.at(-1).status).toBe('failed');
      expect(result.body.artifacts).toHaveLength(0);
    } finally { await app.close(); }
  }, 120000);
});
