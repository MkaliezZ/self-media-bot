export type Intent = 'auto' | 'full' | 'diagnose' | 'topics' | 'script' | 'lighting' | 'edit' | 'publish' | 'review';
export type TaskStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'interrupted';
export type Nature = 'unknown' | 'recorded' | 'generated' | 'restored' | 'mixed';
export interface UploadRecord {
  id: string; name: string; bytes: number; mime: string; createdAt: string;
  nature: Nature; path: string; projectId?: string;
}
export interface Message {
  id: string; role: 'user' | 'assistant' | 'system'; content: string; at: string;
  attachmentIds?: string[]; taskId?: string; error?: boolean;
}
export interface Progress { at: string; label: string; detail?: string; error?: boolean }
export interface PendingQuestion {
  id: string; kind: 'question' | 'approval'; title: string;
  detail?: string; questions?: Array<{ id: string; question?: string; header?: string; options?: Array<{ label: string; description?: string }>; multiple?: boolean }>;
}
export interface BotTask {
  id: string; projectId: string; intent: Intent; prompt: string;
  status: TaskStatus; startedAt: string; finishedAt?: string;
  progress: Progress[]; error?: string; question?: PendingQuestion;
  usage?: { input: number; output: number; cacheRead: number };
}
export interface BotProject {
  id: string; title: string; createdAt: string; updatedAt: string;
  intent: Intent; messages: Message[]; uploads: UploadRecord[]; tasks: BotTask[];
  sessionId: string; runtimeStarted: boolean;
  runtimeFingerprint?: string;
}
export interface ProjectSummary { id: string; title: string; createdAt: string; updatedAt: string; intent: Intent; status: TaskStatus | 'idle'; lastMessage: string }
export interface ArtifactView {
  id: string; type: string; title: string; version: number; createdAt: string;
  current: boolean; stale: boolean; payload: Record<string, unknown>;
  text: string; mediaUrl?: string; originalUrl?: string; subtitleUrl?: string;
  files?: Array<{ name: string; url: string }>;
  scope?: string; reviewRequired: boolean;
}
export interface AssetView { id: string; name: string; kind: string; nature: string; bytes?: number; url?: string; duration?: number; generated?: boolean }
export interface ProjectView {
  project: BotProject; artifacts: ArtifactView[]; assets: AssetView[];
  jobs: Array<{ id: string; kind: string; status: string; error?: string }>;
  workbenchError?: string;
}
export interface PublicSettings {
  model: string; baseUrl: string; protocol: 'deepseek-messages'; maxTokens: number;
  vision: boolean;
  hasKey: boolean; keySource: 'saved' | 'environment' | 'none';
  workbenchRoot: string; python: string; dataHome: string;
}
export interface Health {
  ready: boolean; workbench: { ok: boolean; error?: string; version?: string };
  model: { configured: boolean; model: string };
  runtime: { name: 'DeepSeek Harness'; version: string; restricted: boolean };
  capabilities?: Record<string, unknown>;
}
