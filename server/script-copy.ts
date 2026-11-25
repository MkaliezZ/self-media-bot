import { z } from 'zod';
import { AppError } from './errors.js';
import type { Json } from './workbench.js';

const line = z.string().trim().min(4).max(220);
const comparisonInput = z.object({
  source_id: z.string().min(1),
  fixed_quote: line,
  changed_quote: line,
  fixed: line,
  changed: line,
  conclusion: line,
  fixed_subjects: z.array(z.string().trim().min(2).max(24)).min(1).max(8),
}).strict();

const logicBeat = z.object({
  label: z.string().trim().min(2).max(48),
  kind: z.enum(['offer', 'student_use']).optional(),
  after_cta: z.boolean().optional(),
  source_id: z.string().min(1).optional(),
  source_quote: line,
  spoken_options: z.array(line).min(1).max(4),
}).strict();

const planInput = z.object({
  reference_source_ids: z.array(z.string().min(1)).max(30),
  draft_source_id: z.string().min(1).optional(),
  opening: z.string().trim().min(4).max(180).optional(),
  preserve: z.array(z.string().trim().min(4).max(180)).max(8),
  comparison: comparisonInput.optional(),
  logic: z.array(logicBeat).min(1).max(24).optional(),
}).strict();

export type ScriptCopyPlan = z.infer<typeof planInput>;
export type ScriptComparisonBrief = { sourceId: string; fixed: string; changed: string };

function spokenText(text: string) {
  return text.replace(/[\p{P}\s]/gu, '');
}

function logicText(text: string) {
  // Normalize ordinary punctuation while keeping deliberate pauses in read-aloud examples.
  return text.replace(/\.{3,}|…+/gu, '…').replace(/(?!…)[\p{P}\s]/gu, '').toLowerCase();
}

export function scriptDurationLimit(prompt: string): number | undefined {
  const limit = /(?:总?时长|成稿|分镜|口播稿|这条口播)\s*(?:上限\s*(?:为|是|[：:])?|不超过|最多|不得超过)\s*(\d{1,4})\s*秒|(?:总?时长|成稿|分镜|口播稿|这条口播)\s*(?:控制在\s*)?(\d{1,4})\s*秒(?:以|之)内/u.exec(prompt);
  const seconds = Number(limit?.[1] ?? limit?.[2]);
  return seconds > 0 ? seconds : undefined;
}

export function scriptComparisonBrief(prompt: string, sourceId: unknown): ScriptComparisonBrief | undefined {
  if (typeof sourceId !== 'string') return;
  const fixed = /固定条件(?:是|为|[：:])\s*([^。\n]+)/u.exec(prompt)?.[1]?.trim();
  const changed = /变化项(?:是|为|[：:])\s*([^。\n]+)/u.exec(prompt)?.[1]?.trim();
  if (fixed && changed && fixed.length <= 210 && changed.length <= 210) return { sourceId, fixed, changed };
}

function changedFixedSubject(text: string, subjects: string[]) {
  const clauses = text.split(/[，,。！？!?；;：:\n]+/u);
  const change = /^(?:本身|自身|原先|原本)?(?:就|也|才|都|各自|有|存在|的|是)*(?:不一样|不相同|各不相同|不同|差别|差异|变了|变过|换了|变掉|换成)/u;
  const reverseChange = /(?:改变了|更换了|换掉了|换了|换成了|变了的是)$/u;
  for (const clause of clauses) {
    const cleaned = spokenText(clause);
    for (const subject of subjects.map(spokenText)) {
      if (!subject) continue;
      for (const match of cleaned.matchAll(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'))) {
        const start = match.index ?? 0;
        const prefix = cleaned.slice(0, start);
        const suffix = cleaned.slice(start + subject.length);
        if (!/(?:不是|并非|没有|没|不)$/.test(prefix) && (change.test(suffix) || reverseChange.test(prefix))) return clause.trim();
      }
    }
  }
}

export function scriptCopyPlan(input: unknown, context: Json, brief?: ScriptComparisonBrief): ScriptCopyPlan {
  const parsed = planInput.safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map(issue => issue.path.join('.') || 'plan').join('、');
    throw new AppError(422, `口播编排计划字段有误：${fields}。fixed_subjects 只写引文中的短名词，例如老师、语速，不要填写整句英文。`, 'INVALID_SCRIPT_PLAN');
  }
  const plan = parsed.data;
  const sources = new Map<string, Json>((context.sources ?? []).map((source: Json) => [source.id, source]));
  if (plan.reference_source_ids.some(id => !sources.get(id)?.content)) {
    throw new AppError(422, '请用项目上下文中有正文的参考来源。', 'INVALID_SCRIPT_REFERENCE');
  }
  if (plan.comparison) {
    const { source_id, fixed_quote, changed_quote, fixed, changed, conclusion, fixed_subjects } = plan.comparison;
    if (brief && (source_id !== brief.sourceId || !spokenText(fixed_quote).includes(spokenText(brief.fixed)) || !spokenText(changed_quote).includes(spokenText(brief.changed)))) {
      throw new AppError(422, `请直接引用本轮对照来源 ${brief.sourceId} 中的两句。fixed_quote：${brief.fixed}。changed_quote：${brief.changed}。`, 'SCRIPT_COMPARISON_BRIEF_MISMATCH');
    }
    const source = sources.get(source_id);
    if (source?.nature === 'reference' || plan.reference_source_ids.includes(source_id) || typeof source?.content !== 'string' || ![fixed_quote, changed_quote].every(quote => source.content.includes(quote))) {
      throw new AppError(422, '对照的固定条件与变化项要用自有来源中的两段逐字引文核对。', 'UNBOUND_SCRIPT_COMPARISON');
    }
    if (new Set([fixed, changed, conclusion].map(spokenText)).size !== 3 || fixed_subjects.some(subject => !spokenText(fixed_quote).includes(spokenText(subject).replace(/子$/u, '')))) {
      throw new AppError(422, `分别写固定条件、变化项和结论。fixed_subjects 请用固定条件引文中的短名词：${fixed_quote}`, 'INVALID_SCRIPT_COMPARISON');
    }
    const conflict = changedFixedSubject([fixed, changed, conclusion].join('。'), fixed_subjects);
    if (conflict) throw new AppError(422, `锁定的对照表述改动了固定对象：${conflict}`, 'SCRIPT_COMPARISON_DRIFT');
  }
  const draft = plan.draft_source_id ? sources.get(plan.draft_source_id) : undefined;
  if (plan.draft_source_id && (!draft?.content || draft.nature === 'reference' || plan.reference_source_ids.includes(draft.id))) {
    throw new AppError(422, '保留原句应来自可改写的自有原稿，不可锁定外部参考措辞。', 'INVALID_SCRIPT_DRAFT');
  }
  const current = (context.artifacts ?? []).find((artifact: Json) => artifact.id === context.heads?.script);
  const original = draft?.content ?? (current?.payload?.segments ?? []).map((segment: Json) => segment.spoken).join('\n');
  const base = spokenText(original);
  const anchors = plan.opening ? [plan.opening, ...plan.preserve] : plan.preserve;
  if (anchors.some(line => spokenText(line).length < 4 || !base.includes(spokenText(line)))) {
    throw new AppError(422, '保留句与原稿不符，请复制原句并重新登记。', 'UNBOUND_SCRIPT_ANCHOR');
  }
  for (const beat of plan.logic ?? []) {
    const source = beat.source_id ? sources.get(beat.source_id) : draft;
    const content = beat.source_id ? source?.content : original;
    if (source?.nature === 'reference' || (source && plan.reference_source_ids.includes(source.id)) || typeof content !== 'string' || !content.includes(beat.source_quote)) {
      throw new AppError(422, `「${beat.label}」需要引用自有材料或当前稿的原句。`, 'UNBOUND_SCRIPT_LOGIC');
    }
    if (beat.spoken_options.some(option => spokenText(option).length < 4)) {
      throw new AppError(422, `「${beat.label}」需要写出能独立表达完整意思的口播短句。`, 'INVALID_SCRIPT_LOGIC');
    }
  }
  return plan;
}

function validateLogic(logic: NonNullable<ScriptCopyPlan['logic']>, segments: string[], actionEnd: number) {
  const script = segments.map(logicText).join('');
  let nextBeatStart = 0;
  for (const beat of logic) {
    const searchStart = beat.after_cta ? Math.max(nextBeatStart, actionEnd) : nextBeatStart;
    let earliestEnd = Infinity;
    for (const option of beat.spoken_options.map(logicText)) {
      const start = script.indexOf(option, searchStart);
      if (start !== -1) earliestEnd = Math.min(earliestEnd, start + option.length);
    }
    if (!Number.isFinite(earliestEnd)) {
      if (beat.after_cta) throw new AppError(422, `请在行动句后把「${beat.label}」说完整，让学生知道点开之后会看到什么、怎么用。`, 'SCRIPT_CTA_PAYOFF_MISSING');
      if (beat.kind === 'offer' || beat.kind === 'student_use') {
        throw new AppError(422, `口播缺少已登记的学生价值「${beat.label}」，或顺序有误。说出具体提供的内容、数量或用法，可用：${beat.spoken_options.join(' / ')}`, 'SCRIPT_OFFER_MISSING');
      }
      throw new AppError(422, `口播缺少「${beat.label}」，或它出现在依赖它的前后段落之外。把对应内容放回正确位置。可用：${beat.spoken_options.join(' / ')}`, 'SCRIPT_LOGIC_GAP');
    }
    nextBeatStart = earliestEnd;
  }
}

function validateClosing(segments: string[], cta: unknown, actionHasFollowUp: boolean) {
  const splitSentences = (text: string) => text.split(/[。！？!?；;\n]+/u);
  const action = typeof cta === 'string' ? splitSentences(cta).map(spokenText).filter(Boolean) : [];
  if (action.length === 0 && !actionHasFollowUp && (typeof cta !== 'string' || !cta.trim())) return 0;
  const sentences = segments.flatMap(splitSentences).filter(sentence => logicText(sentence));
  const actionIndex = actionHasFollowUp ? sentences.findLastIndex(sentence => spokenText(sentence) === action[0]) : sentences.length - 1;
  if (action.length !== 1 || actionIndex < 0 || spokenText(sentences[actionIndex]) !== action[0]) {
    const position = actionHasFollowUp ? '收尾段中实际邀请对方的行动句' : '最后一句';
    throw new AppError(422, `cta 填口播${position}的原话。结尾只有一个转化动作。`, 'SCRIPT_CTA_MISMATCH');
  }
  return sentences.slice(0, actionIndex + 1).map(logicText).join('').length;
}

export function validateScriptCopy(plan: ScriptCopyPlan, body: Json) {
  const payload = body.payload;
  if (!Array.isArray(payload?.segments) || !Array.isArray(payload?.claims)) return; // Workbench owns the payload schema.
  const segments = payload.segments.map((segment: Json) => String(segment?.spoken ?? ''));
  const script = spokenText(segments.join(''));
  if (plan.comparison) {
    const { fixed, changed, conclusion, fixed_subjects } = plan.comparison;
    const conflict = changedFixedSubject(segments.join('。'), fixed_subjects);
    if (conflict) throw new AppError(422, `成稿把固定条件写成了变化项：${conflict}。请遵守已锁定的对照。`, 'SCRIPT_COMPARISON_DRIFT');
    const omitted = [['固定条件', fixed], ['变化项', changed], ['结论', conclusion]].filter(([, value]) => !script.includes(spokenText(value)));
    if (omitted.length) {
      const missing = omitted.map(([label, value]) => `${label}「${value}」`).join('、');
      throw new AppError(422, `成稿缺少已锁定的对照：${missing}。把漏掉的内容放回 spoken，再检查例子、限制和结论是不是接得上。`, 'SCRIPT_COMPARISON_MISSING');
    }
  }
  if (plan.opening && !script.startsWith(spokenText(plan.opening))) {
    throw new AppError(422, '请用已锁定的原稿开头起句。', 'SCRIPT_OPENING_CHANGED');
  }
  const missing = plan.preserve.filter(line => !script.includes(spokenText(line)));
  if (missing.length) throw new AppError(422, `成稿漏掉应保留的原句：${missing.join(' / ')}`, 'SCRIPT_ANCHOR_MISSING');
  const actionEnd = validateClosing(segments, payload.cta, plan.logic?.some(beat => beat.after_cta) ?? false);
  if (plan.logic) validateLogic(plan.logic, segments, actionEnd);
  const references = new Set(plan.reference_source_ids);
  for (const claim of payload.claims) {
    if (Array.isArray(claim?.evidence) && claim.evidence.some((evidence: Json) => references.has(evidence?.source_id))) {
      throw new AppError(422, '外部样本只作编排参考。请用自有材料支持成稿主张，参考结构单独在交付说明中交代。', 'SCRIPT_REFERENCE_AS_EVIDENCE');
    }
  }
}
