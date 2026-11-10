export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', public details?: unknown) { super(message); }
}
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[已隐藏密钥]').slice(0, 3000);
}
