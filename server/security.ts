import { timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';

export function sameSecret(actual: unknown, expected: string) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function checkBrowserRequest(headers: Record<string, string | string[] | undefined>, origin: string, mutation: boolean, csrf: string) {
  const host = String(headers.host ?? '');
  const expected = new URL(origin);
  const accepted = [expected.host, `localhost:${expected.port}`];
  if (!accepted.includes(host)) throw new AppError(403, '不接受此访问来源。', 'BAD_HOST');
  if (headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, '不接受跨站请求。', 'CROSS_SITE');
  const requestOrigin = headers.origin;
  if (requestOrigin && requestOrigin !== origin && requestOrigin !== `http://localhost:${expected.port}`) throw new AppError(403, '不接受跨站请求。', 'BAD_ORIGIN');
  if (mutation && !sameSecret(headers['x-csrf-token'], csrf)) throw new AppError(403, '会话校验失败，请刷新页面。', 'CSRF');
}
export function runtimePath(method: string, raw: string, projectId: string) {
  if (!['GET', 'POST', 'PUT'].includes(method) || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('#')) throw new AppError(403, '只允许工作台接口。', 'TOOL_SCOPE');
  const pathname = raw.split('?')[0];
  if (pathname.includes('%') || pathname.split('/').some(s => s === '.' || s === '..')) throw new AppError(403, '无效的接口路径。', 'TOOL_SCOPE');
  const readOnly = pathname === '/api/agent/v1/capabilities' || /^\/api\/agent\/v1\/schemas\/[a-z_-]+$/.test(pathname) || /^\/api\/(visual|lighting)\/[a-z0-9_/-]+$/.test(pathname) || pathname === '/openapi.json';
  const projectRoute = pathname.startsWith(`/api/projects/${projectId}/`) || pathname.startsWith(`/api/agent/v1/projects/${projectId}/`);
  if (!(projectRoute || (method === 'GET' && readOnly))) throw new AppError(403, '工具只能操作当前自媒体项目。', 'TOOL_SCOPE');
  if (/\/(agent-pack|original)$/.test(pathname) || /\/exports\//.test(pathname)) throw new AppError(400, '文件通过成果面板预览；工具接口返回 JSON。', 'BINARY_ROUTE');
  return raw;
}
