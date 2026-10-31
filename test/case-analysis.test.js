const assert = require('node:assert/strict');
const test = require('node:test');
const { callChatJson } = require('../src/llm-client');
const { buildCaseViews, summarizeChunk } = require('../src/case-analysis');

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
