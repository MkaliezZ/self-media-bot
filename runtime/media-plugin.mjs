// MIT. Uses the public DSH tool-authoring contract, not a separate agent loop.
import { defineTool } from '@deepseek-ai/dsh-tools';
import { realpathSync } from 'node:fs';
import path from 'node:path';

export const name = 'self-media-only';
export const inject = ['tools'];

const definitions = [
  ['media_context', '读取当前自媒体项目的最新上下文、素材、成果、revision 和 context_id。每次写入后重新读取。', {}],
  ['media_reference', '读取自媒体方法文档。支持 SKILL.md、AGENTS.md、references/具体环节.md、docs/相关文档.md；不是通用文件读取。', { name: { type: 'string', required: true } }],
  ['media_schema', '读取实际能力清单或 JSON Schema。name=capabilities 得到接口索引；其他如 submission、script、lighting-plan、timeline-plan。', { name: { type: 'string', required: true } }],
  ['media_doctor', '检查当前实际运行环境、ASR/GPU策略、FFmpeg和包装组件。环境检测不等于本轮推理成功；不安装或下载任何内容。', {}],
  ['media_request', '调用当前自媒体项目的工作台接口。path 为 /api/...，body_json 为严格 JSON 字符串。只允许 GET/POST/PUT；不允许其他项目、任意命令或外部发布。', { method: { type: 'string', required: true }, path: { type: 'string', required: true }, body_json: { type: 'string' } }],
  ['media_frame', '抽取当前项目原片/成片的一个真实画面，返回本机图片路径，再调用 read_image 审图。不得把抽帧本身称为已审阅。', { media_id: { type: 'string', required: true }, seconds: { type: 'number', required: true }, export_id: { type: 'string' } }],
  ['media_ask_user', '只在实际缺项或需要用户选择时询问。返回用户明确回答；不得代替用户批准。', { question: { type: 'string', required: true }, options: { type: 'array', items: { type: 'string' } } }],
  ['media_wait_job', '等待当前项目异步任务到 done/failed。返回状态；仍在运行不等于成功。', { job_id: { type: 'string', required: true }, seconds: { type: 'integer' } }],
];

export function apply(ctx) {
  const base = process.env.MEDIA_BOT_BRIDGE;
  const token = process.env.MEDIA_BOT_TOKEN;
  if (!base || !token || !/^http:\/\/127\.0\.0\.1:\d+\/internal\/runtime\/[a-zA-Z0-9_-]+$/.test(base)) throw new Error('Missing local media bridge');
  const roots = JSON.parse(process.env.MEDIA_BOT_IMAGE_ROOTS ?? '[]').map(p => path.resolve(p));
  const allowed = new Set([...definitions.map(d => d[0]), 'read_image']);

  ctx.tools.guard(call => {
    if (!allowed.has(call.name)) return '本产品仅提供自媒体工作台工具。';
    if (call.name !== 'read_image') return;
    const candidate = call.arguments?.path ?? call.arguments?.file_path ?? call.arguments?.image_path;
    if (typeof candidate !== 'string') return '请指定当前项目的图片。';
    let actual;
    try { actual = realpathSync(candidate); } catch { return '图片不存在或无法读取。'; }
    if (!roots.some(root => { let resolved; try { resolved = realpathSync(root); } catch { resolved = root; } const rel = path.relative(resolved, actual); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); })) return '不能访问当前自媒体项目以外的图片。';
  });

  for (const [toolName, description, parameters] of definitions) {
    ctx.tools.register(defineTool({
      name: toolName, description, parameters,
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      async execute(args, exec) {
        const response = await fetch(base, {
          method: 'POST', redirect: 'error', signal: exec.signal,
          headers: { 'Content-Type': 'application/json', 'X-Runtime-Token': token },
          body: JSON.stringify({ tool: toolName, args }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        return JSON.stringify(data);
      },
    }));
  }
}
