import type { PublicSettings } from '../../shared/types';

let csrf = '';
export class ApiError extends Error {
  constructor(message: string, public code: string, public details?: unknown) { super(message); }
}
export async function api<T>(route: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(route, { ...options, credentials: 'same-origin', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? `请求失败（${response.status}）`, data.code ?? 'REQUEST_FAILED', data.details);
  return data as T;
}
export async function bootstrap() {
  const data = await api<{ csrfToken: string; settings: PublicSettings }>('/api/bootstrap');
  csrf = data.csrfToken; return data;
}
export function post<T>(route: string, body: unknown = {}) { return api<T>(route, { method: 'POST', body: JSON.stringify(body) }); }
export function upload(file: File, onProgress: (percent: number) => void): Promise<{ id: string; name: string; bytes: number; mime: string; nature: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/uploads'); xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('上传连接断开，原文件未受影响，请重试。'));
    xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(data) : reject(new ApiError(data.error, data.code)); } catch { reject(new Error('无法读取上传结果。')); } };
    const form = new FormData(); form.append('file', file); xhr.send(form);
  });
}
export async function copyText(text: string) {
  if (!navigator.clipboard) throw new Error('当前浏览器不支持剪贴板，请手动选择文字复制。');
  await navigator.clipboard.writeText(text);
}
