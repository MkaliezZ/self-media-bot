import { describe, expect, it } from 'vitest';
import { scriptComparisonBrief, scriptCopyPlan, scriptDurationLimit, validateScriptCopy } from '../server/script-copy.js';

const context = {
  sources: [
    { id: 'sample', content: '这家修表摊开了二十年。', nature: 'provided' },
    { id: 'draft', content: '晚一步，门就关了。把钥匙交出去以后，等的人才最心急。', nature: 'provided' },
  ],
  artifacts: [],
};

const plan = scriptCopyPlan({
  reference_source_ids: ['sample'],
  draft_source_id: 'draft',
  opening: '晚一步，门就关了。',
  preserve: ['把钥匙交出去以后，等的人才最心急。'],
}, context);

function submission(spoken: string, sourceId = 'draft') {
  return { payload: { segments: [{ spoken }], claims: [{ evidence: [{ source_id: sourceId }] }] } };
}

describe('口播编排保存检查', () => {
  const retained = '晚一步，门就关了！把钥匙交出去以后，等的人才最心急。';

  it('接受原句词序不变的标点和停顿调整', () => {
    expect(() => validateScriptCopy(plan, submission(retained))).not.toThrow();
  });

  it('拦下移走开头、删掉金句和把外部样本当成宣传证据的成稿', () => {
    expect(() => validateScriptCopy(plan, submission(`我今天想和你聊聊。${retained}`))).toThrow('原稿开头');
    expect(() => validateScriptCopy(plan, submission('晚一步，门就关了。剩下的交给我。'))).toThrow('应保留的原句');
    expect(() => validateScriptCopy(plan, submission(retained, 'sample'))).toThrow('外部样本只作编排参考');
  });

  it('只锁定确实出现在自有原稿或项目当前稿里的句子', () => {
    expect(() => scriptCopyPlan({ ...plan, draft_source_id: 'sample' }, context)).toThrow('自有原稿');
    expect(() => scriptCopyPlan({ ...plan, preserve: ['随便编造的一句。'] }, context)).toThrow('与原稿不符');
    const current = { ...context, heads: { script: 'latest' }, artifacts: [{ id: 'latest', payload: { segments: [{ spoken: retained }] } }] };
    expect(scriptCopyPlan({ ...plan, draft_source_id: undefined }, current).opening).toBe(plan.opening);
  });

  it('结尾行动写入实际口播，记录字段与最后一句一致', () => {
    const body = submission(`${retained}需要查一下营业时间，打开主页里的营业表。`);
    expect(() => validateScriptCopy(plan, { payload: { ...body.payload, cta: '需要查一下营业时间，打开主页里的营业表。' } })).not.toThrow();
    expect(() => validateScriptCopy(plan, { payload: { ...body.payload, cta: '去主页看看。也可以先关注。' } })).toThrow('最后一句');
    expect(() => validateScriptCopy(plan, { payload: { ...body.payload, cta: '去主页看看。' } })).toThrow('最后一句');
  });

  it('改广告口播要保住两项不同的具体服务，允许同义表达', () => {
    const original = '公开样课页可听两段20秒完整录音及老师讲评。';
    const ownContext = { sources: [{ id: 'original', content: original }] };
    const rewrite = scriptCopyPlan({ reference_source_ids: [], draft_source_id: 'original', preserve: [], logic: [
      { label: '两段完整的二十秒录音', kind: 'offer', source_quote: '两段20秒完整录音', spoken_options: ['两段录音各二十秒，完整的都在。', '两段二十秒的原声都能从头听到尾。'] },
      { label: '老师讲评', kind: 'offer', source_quote: '老师讲评', spoken_options: ['老师还会拿两段做对比，讲讲为什么这么排。'] },
    ] }, ownContext);
    const recording = '两段二十秒的原声都能从头听到尾。';
    const feedback = '老师还会拿两段做对比，讲讲为什么这么排。';
    expect(() => validateScriptCopy(rewrite, submission(recording + feedback))).not.toThrow();
    expect(() => validateScriptCopy(rewrite, submission(recording + '详情在样课里。'))).toThrow('老师讲评');
    expect(() => validateScriptCopy(rewrite, submission('有两段录音。' + feedback))).toThrow('两段完整的二十秒录音');
  });

  it('允许点击之后继续说具体收获，并拒绝把收获放错位置或写成空话', () => {
    const original = '跟读页有同一句的停顿标记和跟读音频。';
    const ownContext = { sources: [{ id: 'original', content: original }] };
    const rewrite = scriptCopyPlan({ reference_source_ids: [], draft_source_id: 'original', preserve: [], logic: [
      { label: '标了停顿的原句', kind: 'offer', after_cta: true, source_quote: '同一句的停顿标记', spoken_options: ['刚才那句就在那儿，哪儿该停我标出来了。'] },
      { label: '依照音频跟读', kind: 'student_use', after_cta: true, source_quote: '跟读音频', spoken_options: ['旁边还有音频，你可以先听听我在哪儿停，再跟着念一遍。'] },
    ] }, ownContext);
    const action = '点开说明里的跟读页就好。';
    const benefit = '刚才那句就在那儿，哪儿该停我标出来了。旁边还有音频，你可以先听听我在哪儿停，再跟着念一遍。';
    const check = (lines: string[], cta = action) => validateScriptCopy(rewrite, { payload: { ...submission('').payload, segments: lines.map(spoken => ({ spoken })), cta } });
    expect(() => check([action, benefit])).not.toThrow();
    expect(() => check([action + benefit])).not.toThrow();
    expect(() => check([action, benefit], '')).toThrow('行动');
    expect(() => check([benefit, action, '希望对你有帮助。'])).toThrow('请在行动句后');
    expect(() => check([action, '你就能找到需要的东西哦。'])).toThrow('标了停顿的原句');
  });

  it('固定同一支豆，拒绝把豆子说成有差别，允许比较水和奶的兑法', () => {
    const facts = '两杯的豆子相同，浓缩的份量也一样。一杯只加水，另一杯加牛奶。';
    const comparison = {
      source_id: 'facts', fixed_quote: '两杯的豆子相同，浓缩的份量也一样。', changed_quote: '一杯只加水，另一杯加牛奶。',
      fixed: '两杯的豆子相同，浓缩的份量也一样。', changed: '一杯只加水，另一杯加牛奶。',
      conclusion: '这样可以对照水和奶两种兑法。', fixed_subjects: ['豆子', '浓缩'],
    };
    const coffeeContext = { ...context, sources: [...context.sources, { id: 'facts', content: facts }] };
    const coffee = scriptCopyPlan({ reference_source_ids: [], preserve: [], comparison }, coffeeContext);
    expect(() => validateScriptCopy(coffee, submission(facts + comparison.conclusion))).not.toThrow();
    expect(() => validateScriptCopy(coffee, submission(facts))).toThrow(`结论「${comparison.conclusion}」`);
    expect(() => validateScriptCopy(coffee, submission(facts + comparison.conclusion + '豆子本身的差别，比小票上的字清楚得多。'))).toThrow('固定条件');
    expect(() => scriptCopyPlan({ ...coffee, comparison: { ...comparison, changed_quote: '两边比例不同。' } }, coffeeContext)).toThrow('逐字引文');
  });

  it('用户明确写出的对照条件不能被原稿中无关的句子替换', () => {
    const prompt = '固定条件是同一位老师，语速一样。变化项是请在末尾停一拍。';
    const brief = scriptComparisonBrief(prompt, 'task');
    const ownContext = { ...context, sources: [...context.sources, { id: 'task', content: prompt }] };
    const comparison = {
      source_id: 'task', fixed_quote: '同一位老师，语速一样', changed_quote: '请在末尾停一拍',
      fixed: '两遍我来读，语速一样。', changed: '第二遍到末尾停一下。',
      conclusion: '你听末尾多出来的那一拍。', fixed_subjects: ['老师', '语速'],
    };
    const input = { reference_source_ids: [], preserve: [], comparison };
    expect(scriptCopyPlan(input, ownContext, brief).comparison).toEqual(comparison);
    expect(() => scriptCopyPlan({ ...input, comparison: { ...comparison, source_id: 'draft' } }, ownContext, brief)).toThrow('本轮对照来源');
  });

  it('允许表达相同意思的口语改写，并保留例子、解释、结论的顺序', () => {
    const original = '下雨时地面变滑。下坡要慢下来。这样才有时间避开积水。';
    const ownContext = { sources: [{ id: 'original', content: original }] };
    const rewrite = scriptCopyPlan({ reference_source_ids: [], draft_source_id: 'original', preserve: [], logic: [
      { label: '下雨路滑', source_quote: '下雨时地面变滑', spoken_options: ['下了雨，脚底下容易打滑。', '一下雨，路就滑。'] },
      { label: '下坡放慢', source_quote: '下坡要慢下来', spoken_options: ['所以下坡别急，慢一点走。'] },
      { label: '有时间绕过积水', source_quote: '这样才有时间避开积水', spoken_options: ['看到水坑，也来得及绕开。'] },
    ] }, ownContext);
    const first = '一下雨，路就滑。';
    const second = '所以下坡别急，慢一点走。';
    const third = '看到水坑，也来得及绕开。';
    expect(() => validateScriptCopy(rewrite, submission(first + second + third))).not.toThrow();
    expect(() => validateScriptCopy(rewrite, submission(first + third))).toThrow('下坡放慢');
    expect(() => validateScriptCopy(rewrite, submission(second + first + third))).toThrow('下坡放慢');
    expect(() => scriptCopyPlan({ ...rewrite, logic: [{ ...rewrite.logic![0], source_quote: '下雨路滑是因为油' }] }, ownContext)).toThrow('自有材料');
  });

  it('两次示范都得出现，同一句中的停顿要落在指定位置', () => {
    const original = '第一遍连着说，第二遍在 coffee 后停一拍，再说 please。';
    const ownContext = { sources: [{ id: 'original', content: original }] };
    const first = 'Could I get a small coffee, please?';
    const second = 'Could I get a small coffee…… please?';
    const rewrite = scriptCopyPlan({ reference_source_ids: [], draft_source_id: 'original', preserve: [], logic: [
      { label: '第一遍完整示范', source_quote: '第一遍连着说', spoken_options: [first] },
      { label: '第二遍完整示范', source_quote: '第二遍在 coffee 后停一拍', spoken_options: [second] },
    ] }, ownContext);
    expect(() => validateScriptCopy(rewrite, submission(`${first} ${second}`))).not.toThrow();
    expect(() => validateScriptCopy(rewrite, submission(`${first} ${first}`))).toThrow('第二遍完整示范');
    expect(() => validateScriptCopy(rewrite, submission(`${first} Could I get a small…… coffee, please?`))).toThrow('第二遍完整示范');
    expect(() => validateScriptCopy(rewrite, submission(`第一遍连着说。${second}`))).toThrow('第一遍完整示范');
  });

  it('一般估时和例子中的时长不会变成成稿裁切上限', () => {
    expect(scriptDurationLimit('写一条约35–45秒的口播。视频里两段对照各20秒。')).toBeUndefined();
    expect(scriptDurationLimit('示范中每次停顿最多2秒。')).toBeUndefined();
    expect(scriptDurationLimit('写完后把成稿控制在90秒以内。')).toBe(90);
    expect(scriptDurationLimit('口播总时长不得超过60秒。')).toBe(60);
  });
});
