import { ScanSearch, Lightbulb, FilePenLine, LampDesk, Clapperboard, Send, ChartNoAxesCombined } from 'lucide-react';
import type { Intent, TaskStatus } from '../../shared/types';

export const TASKS = [
  { id: 'diagnose', icon: ScanSearch, name: '账号诊断与对标', subtitle: '找出问题，找到参考', prompt: '根据这些作品和资料，找出账号最该先改的问题。' },
  { id: 'topics', icon: Lightbulb, name: '选题策划', subtitle: '把材料变成好角度', prompt: '根据这份素材，给我几个值得拍的选题。' },
  { id: 'script', icon: FilePenLine, name: '口播脚本', subtitle: '写一版，也改到顺口', prompt: '把这份素材改成约90秒口播稿，保留原意，不编造个人经历。' },
  { id: 'lighting', icon: LampDesk, name: '拍摄布光', subtitle: '按现场条件安排灯光', prompt: '根据现场照片和已有灯具，给我简版、标准、理想三档布光方案。' },
  { id: 'edit', icon: Clapperboard, name: '剪辑与包装', subtitle: '整理节奏、字幕与画面', prompt: '剪这段口播，保留原意，检查字幕和停顿。' },
  { id: 'publish', icon: Send, name: '发布准备', subtitle: '准备标题、配文与清单', prompt: '为这个成片准备标题、配文和发布检查清单，不对外发布。' },
  { id: 'review', icon: ChartNoAxesCombined, name: '数据复盘', subtitle: '从真实反馈里找到下一步', prompt: '根据这份发布数据复盘，给出下一条最值得改的一点。没有数据的地方请保留未知。' },
] as const;
export function intentName(intent: string) { return TASKS.find(t => t.id === intent)?.name ?? '自媒体创作'; }
export function statusName(status: TaskStatus | 'idle') { return ({ idle: '可以继续', pending: '准备中', running: '处理中', waiting: '待补充', done: '本轮结束', failed: '需要处理', interrupted: '已中断' })[status]; }
export const activeStatus = (status?: string) => !!status && ['pending', 'running', 'waiting'].includes(status);
export const natureNames: Record<string, string> = { unknown: '性质待说明', recorded: '实拍 / 实录', generated: '合成 / 生成', restored: '修复 / 增强', mixed: '混合素材' };
export function sizeLabel(size?: number) { return size === undefined ? '' : size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
export function timeLabel(date: string) {
  const value = new Date(date); return Number.isNaN(value.getTime()) ? date : value.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function secondsLabel(n: unknown) { const value = Number(n); return Number.isFinite(value) ? `${Math.round(value)} 秒` : '待核对'; }
