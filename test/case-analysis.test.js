const assert = require('node:assert/strict');
const test = require('node:test');
const { callChatJson } = require('../src/llm-client');
const { buildCaseViews, mergeCaseSummary, summarizeChunk } = require('../src/case-analysis');

process.env.DEEPSEEK_API_KEY ||= 'test-key';

function response(content, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return { choices: [{ message: { content } }] }; },
    async text() { return content; },
  };
}

test('JSON 模型调用会清理代码围栏并在格式错误时重试一次', async () => {
  const contents = ['不是 JSON', '```json\n{"summary":"完成"}\n```'];
  let calls = 0;
  const fetchImpl = async () => response(contents[calls++]);

  const result = await callChatJson('deepseek', [{ role: 'user', content: 'test' }], { maxAttempts: 2 }, fetchImpl);

  assert.deepEqual(result, { summary: '完成' });
  assert.equal(calls, 2);
});

test('片段摘要请求只包含当前片段并为候选结果补充来源', async () => {
  const chunk = {
    id: 'chunk-a',
    fileId: 'file-a',
    fileName: '第一卷.txt',
    pageStart: 2,
    pageEnd: 3,
    text: '张某于2024年3月向李某转账。',
  };
  const otherText = '不应出现在请求中的第二片段';
  let requestBody;
  const fetchImpl = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return response(JSON.stringify({
      summary: '张某向李某转账',
      people: [{ id: 'p1', name: '张某', role: '相关人员', aliases: [] }],
      timeline: [{ id: 't1', date: '2024年3月', title: '转账', detail: '发生转账', peopleIds: ['p1'], category: '资金' }],
      relations: [],
      events: [],
      evidence: [],
    }));
  };

  const result = await summarizeChunk(chunk, 'deepseek', { fetchImpl });
  const promptText = JSON.stringify(requestBody.messages);

  assert.match(promptText, /张某于2024年3月向李某转账/);
  assert.doesNotMatch(promptText, new RegExp(otherText));
  assert.equal(result.timeline[0].precision, 'month');
  assert.deepEqual(result.timeline[0].sourceRefs, [{
    chunkId: 'chunk-a', fileId: 'file-a', fileName: '第一卷.txt', pageStart: 2, pageEnd: 3,
  }]);
  assert.equal(result.people[0].confidence, 'candidate');
});

test('案件视图保留来源并将关系和证据标记为候选', () => {
  const summary = {
    people: [{ id: 'p1', name: '张某', sourceRefs: [{ chunkId: 'c1' }] }],
    timeline: [{ id: 't1', date: '时间不详', title: '会面', sourceRefs: [{ chunkId: 'c1' }] }],
    relations: [{ id: 'r1', from: 'p1', to: 'p2', type: '共同出现', label: '同一材料提及', sourceRefs: [{ chunkId: 'c1' }] }],
    events: [{ id: 'e1', lane: '人员行为', title: '会面', sourceRefs: [{ chunkId: 'c1' }] }],
    evidence: [{ id: 'v1', proposition: '是否会面', direction: '仅相关', material: '笔录', sourceRefs: [{ chunkId: 'c1' }] }],
  };

  const views = buildCaseViews('case-1', summary);

  assert.equal(views.timeline[0].precision, 'unknown');
  assert.equal(views.relations[0].confidence, 'candidate');
  assert.equal(views.evidence[0].status, 'candidate');
  assert.deepEqual(views.people[0].sourceRefs, [{ chunkId: 'c1' }]);
});

test('legacy model fields render meaningful titles and resolve only unambiguous people', () => {
  const reference = { chunkId: 'c1', fileId: 'f1', pageStart: 2, pageEnd: 2 };
  const views = buildCaseViews('case-1', {
    people: [{ id: 'p1', name: 'Person A', sourceRefs: [reference] }, { id: 'p2', name: 'Person B', sourceRefs: [reference] }, { id: 'p3', name: 'Same name' }, { id: 'p4', name: 'Same name' }],
    timeline: [{ date: '2024-03-01', event: 'Meeting', sourceRefs: [reference] }, { date: '2024-03', text: 'Payment' }],
    events: [{ event: 'Meeting', details: 'A statement records a meeting.' }],
    relations: [{ party_a: 'Person A', party_b: 'Person B', relation: 'Meeting recorded', sourceRefs: [reference] }, { from: 'Person A', to: 'Same name', relation: 'Unclear identity' }],
    evidence: [{ item: 'Statement', details: 'The witness described a meeting.' }],
  });
  assert.equal(views.timeline[0].title, 'Meeting');
  assert.equal(views.timeline[1].title, 'Payment');
  assert.equal(views.events[0].title, 'Meeting');
  assert.equal(views.events[0].detail, 'A statement records a meeting.');
  assert.equal(views.relations[0].from, 'p1');
  assert.equal(views.relations[0].to, 'p2');
  assert.equal(views.relations[0].label, 'Meeting recorded');
  assert.deepEqual(views.relations[0].sourceRefs, [reference]);
  assert.equal(views.relations[1].to, 'Same name');
  assert.equal(views.evidence[0].material, 'Statement');
  assert.equal(views.evidence[0].detail, 'The witness described a meeting.');
});

test('merging independent sources does not confuse reused model person IDs or lose sources', async () => {
  const source = (chunkId, name) => ({
    summary: name, people: [{ id: 'p1', name, sourceRefs: [{ chunkId }] }, { id: 'p2', name: 'Other', sourceRefs: [{ chunkId }] }],
    relations: [{ id: 'r1', from: 'p1', to: 'p2', label: name, sourceRefs: [{ chunkId }] }],
    timeline: [{ id: 't1', title: name, sourceRefs: [{ chunkId }] }], events: [], evidence: [],
  });
  const merged = await mergeCaseSummary([source('c1', 'Person A'), source('c2', 'Person B')]);
  assert.equal(new Set(merged.people.map((p) => p.id)).size, 4);
  assert.equal(new Set(merged.timeline.map((p) => p.id)).size, 2);
  assert.deepEqual(merged.relations.map((r) => merged.people.find((p) => p.id === r.from).name), ['Person A', 'Person B']);
  assert.deepEqual(merged.relations.map((r) => r.sourceRefs[0].chunkId), ['c1', 'c2']);
});

test('invalid extraction structure is retried and never accepted as an empty successful analysis', async () => {
  const chunk = { id: 'c1', fileId: 'f1', fileName: 'fixture.txt', text: 'A meeting is recorded.' };
  let attempts = 0;
  await assert.rejects(summarizeChunk(chunk, 'deepseek', {
    fetchImpl: async () => { attempts += 1; return response(JSON.stringify({ case_summary: 'Wrong structure' })); },
  }), /结构/);
  assert.equal(attempts, 2);
});

test('extracted facts are bound to the actual chunk rather than model-supplied source identifiers', async () => {
  const chunk = { id: 'c1', fileId: 'f1', fileName: 'fixture.txt', text: 'A meeting is recorded.' };
  const raw = { summary: 'Meeting', people: [], relations: [], events: [], evidence: [],
    timeline: [{ title: 'Meeting', sourceRefs: [{ chunkId: 'invented' }] }],
  };
  const result = await summarizeChunk(chunk, 'deepseek', { fetchImpl: async () => response(JSON.stringify(raw)) });
  assert.equal(result.timeline[0].sourceRefs[0].chunkId, 'c1');
});

test('an unresolved relation is not linked to a same-name person from a different source', async () => {
  const merged = await mergeCaseSummary([{
    people: [{ id: 'p1', name: 'Person A', sourceRefs: [{ chunkId: 'c1' }] }],
    relations: [{ from: 'p1', to: 'Person B', sourceRefs: [{ chunkId: 'c1' }] }],
  }, { people: [{ id: 'p1', name: 'Person B', sourceRefs: [{ chunkId: 'c2' }] }] }]);
  const views = buildCaseViews('case-1', merged);
  assert.equal(views.relations[0].to, 'Person B');
  assert.equal(views.people.some((person) => person.id === views.relations[0].to), false);
});
