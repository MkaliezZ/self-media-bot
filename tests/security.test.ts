import { describe, expect, it } from 'vitest';
import { checkBrowserRequest, runtimePath, sameSecret } from '../server/security.js';
import { modelBaseUrl } from '../server/config.js';
import { isInside, fileName } from '../server/files.js';
import path from 'node:path';

describe('本机访问与自媒体工具隔离', () => {
  it('拒绝跨站来源、DNS rebinding 和缺失 CSRF', () => {
    expect(() => checkBrowserRequest({ host: 'evil.example:3210' }, 'http://127.0.0.1:3210', false, 'token')).toThrow();
    expect(() => checkBrowserRequest({ host: '127.0.0.1:3210', origin: 'https://evil.example' }, 'http://127.0.0.1:3210', false, 'token')).toThrow();
    expect(() => checkBrowserRequest({ host: '127.0.0.1:3210' }, 'http://127.0.0.1:3210', true, 'token')).toThrow();
    expect(() => checkBrowserRequest({ host: '127.0.0.1:3210', 'x-csrf-token': 'token' }, 'http://127.0.0.1:3210', true, 'token')).not.toThrow();
  });
  it('凭据比较对不同长度和 Unicode 输入失败关闭', () => {
    expect(sameSecret(undefined, 'abc')).toBe(false); expect(sameSecret('你你你', 'abc')).toBe(false); expect(sameSecret('abc', 'abc')).toBe(true);
  });
  it('工具只允许当前项目和只读能力索引', () => {
    expect(runtimePath('GET', '/api/agent/v1/capabilities', 'project-a')).toBe('/api/agent/v1/capabilities');
    expect(runtimePath('POST', '/api/projects/project-a/timeline/export', 'project-a')).toContain('timeline');
    for (const route of ['https://evil.example/', '//evil.example/', '/api/projects/project-b/jobs', '/api/projects/project-a/../project-b/jobs', '/api/projects/project-a/%2e%2e/jobs', '/api/projects']) expect(() => runtimePath('POST', route, 'project-a')).toThrow();
    expect(() => runtimePath('POST', '/api/visual/templates', 'project-a')).toThrow();
    expect(() => runtimePath('DELETE', '/api/projects/project-a/jobs', 'project-a')).toThrow();
  });
  it('拒绝不安全模型地址，允许明确的本机测试端点', () => {
    expect(modelBaseUrl('http://127.0.0.1:3211/')).toBe('http://127.0.0.1:3211');
    expect(() => modelBaseUrl('http://remote.example/v1')).toThrow();
    expect(() => modelBaseUrl('https://user:secret@example.com')).toThrow();
    expect(() => modelBaseUrl('https://example.com/?secret=value')).toThrow();
  });
  it('路径边界不是简单字符串前缀', () => {
    expect(isInside(path.resolve('project'), path.resolve('project/file.txt'))).toBe(true);
    expect(isInside(path.resolve('project'), path.resolve('project-other/file.txt'))).toBe(false);
    expect(fileName('../../unsafe.txt')).toBe('unsafe.txt'); expect(fileName('C:\\fakepath\\文稿.md')).toBe('文稿.md');
  });
});
