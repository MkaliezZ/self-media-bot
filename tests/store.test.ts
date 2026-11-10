import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Config } from '../server/config.js';
import { tempHome } from './helpers.js';

describe('本机保存、重启恢复与凭据', () => {
  it('并发修改不丢消息，重启把未完成任务标为中断而非完成', async () => {
    const home = await tempHome('store'); const store = new Store(home); await store.init();
    await store.create('project-1', '测试项目', 'script');
    await Promise.all(Array.from({ length: 15 }, (_, i) => store.update('project-1', p => p.messages.push({ id: String(i), role: 'user', content: `消息${i}`, at: new Date().toISOString() }))));
    await store.update('project-1', p => p.tasks.push({ id: 't', projectId: p.id, prompt: '测试', intent: 'script', status: 'running', progress: [], startedAt: new Date().toISOString() }));
    const restored = new Store(home); await restored.init();
    expect(restored.get('project-1').messages).toHaveLength(15); expect(restored.get('project-1').tasks[0].status).toBe('interrupted');
  });
  it('素材不能在不声明复制的情况下跨项目绑定', async () => {
    const store = new Store(await tempHome('upload-scope')); await store.init();
    await store.create('a', 'A', 'script'); await store.create('b', 'B', 'script');
    await store.addUpload({ id: 'u', name: '文稿.md', bytes: 10, mime: 'text/plain', createdAt: '', nature: 'unknown', path: '/file' });
    await store.bindUploads('a', ['u']); await expect(store.bindUploads('b', ['u'])).rejects.toThrow('不属于');
    expect(store.get('b').uploads).toHaveLength(0);
  });
  it('并发争用同一附件时，失败项目不会留下永远等待的任务', async () => {
    const store = new Store(await tempHome('enqueue')); await store.init(); await store.create('a', 'A', 'script'); await store.create('b', 'B', 'script');
    await store.addUpload({ id: 'u', name: '素材.md', bytes: 10, mime: 'text/plain', createdAt: '', nature: 'unknown', path: '/file' });
    const result = await Promise.allSettled(['a', 'b'].map(id => store.beginTask(id, { id: `task-${id}`, projectId: id, prompt: '测试', intent: 'script', status: 'pending', startedAt: '', progress: [] }, { id: `message-${id}`, role: 'user', content: '测试', at: '' }, ['u'])));
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(store.get('a').tasks.length + store.get('b').tasks.length).toBe(1);
  });
  it('API key 不进入公开配置或明文 settings.json', async () => {
    const home = await tempHome('config'); const config = new Config(home); await config.init();
    const initial = config.public(); const secret = 'not-a-real-api-key';
    await config.save({ model: initial.model, baseUrl: initial.baseUrl, maxTokens: initial.maxTokens, vision: true, workbenchRoot: '', python: initial.python, apiKey: secret });
    expect(config.key()).toBe(secret); expect(JSON.stringify(config.public())).not.toContain(secret);
    expect(await readFile(path.join(home, 'settings.json'), 'utf8')).not.toContain(secret);
    const restored = new Config(home); await restored.init(); expect(restored.key()).toBe(secret);
  });
});
