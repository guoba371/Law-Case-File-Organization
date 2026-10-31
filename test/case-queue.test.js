const assert = require('node:assert/strict');
const test = require('node:test');
const { createCaseQueue } = require('../src/case-queue');

function createMemoryStore(cases) {
  const items = new Map(cases.map((item) => [item.id, structuredClone(item)]));
  return {
    getCase(id) {
      const item = items.get(id);
      if (!item) throw new Error('案件不存在');
      return structuredClone(item);
    },
    listCases() { return [...items.values()].map((item) => structuredClone(item)); },
    updateCase(id, updater) {
      const current = this.getCase(id);
      const next = updater(current);
      next.updatedAt = new Date().toISOString();
      items.set(id, structuredClone(next));
      return structuredClone(next);
    },
    assertRedactedConfirmed(itemOrId) {
      const item = typeof itemOrId === 'string' ? this.getCase(itemOrId) : itemOrId;
      if (item.redactedConfirmed !== true) throw new Error('请确认案卷已完成必要脱敏，未脱敏材料不得上传或分析');
      return item;
    },
  };
}

function caseItem(id, status = 'uploading') {
  return {
    id,
    name: id,
    redactedConfirmed: true,
    status,
    progress: { stage: status, percent: 0, processedFiles: 0, totalFiles: 1, failedFiles: 0 },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

test('未确认脱敏的案件不会进入分析队列', async () => {
  const item = caseItem('unredacted');
  item.redactedConfirmed = false;
  const store = createMemoryStore([item]);
  let processed = false;
  const queue = createCaseQueue({ store, async processCase() { processed = true; } });

  assert.throws(() => queue.enqueue(item.id), /未脱敏材料不得上传或分析/);
  await queue.whenIdle();
  assert.equal(processed, false);
});

test('同一时间只处理一个案件并忽略重复入队', async () => {
  const store = createMemoryStore([caseItem('a'), caseItem('b')]);
  const active = [];
  let maxActive = 0;
  const queue = createCaseQueue({
    store,
    async processCase(id, report) {
      active.push(id);
      maxActive = Math.max(maxActive, active.length);
      report({ stage: 'extracting', percent: 30 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.splice(active.indexOf(id), 1);
      return { status: 'ready', progress: { stage: 'ready', percent: 100 } };
    },
  });

  assert.equal(queue.enqueue('a'), true);
  assert.equal(queue.enqueue('a'), false);
  assert.equal(queue.enqueue('b'), true);
  await queue.whenIdle();

  assert.equal(maxActive, 1);
  assert.equal(store.getCase('a').status, 'ready');
  assert.equal(store.getCase('b').status, 'ready');
  assert.equal(store.getCase('a').progress.percent, 100);
});

test('处理失败会写入失败状态但不阻塞后续案件', async () => {
  const store = createMemoryStore([caseItem('bad'), caseItem('good')]);
  const queue = createCaseQueue({
    store,
    async processCase(id) {
      if (id === 'bad') throw new Error('解析失败');
      return { status: 'ready', progress: { stage: 'ready', percent: 100 } };
    },
  });

  queue.enqueue('bad');
  queue.enqueue('good');
  await queue.whenIdle();

  assert.equal(store.getCase('bad').status, 'failed');
  assert.match(store.getCase('bad').error, /解析失败/);
  assert.equal(store.getCase('good').status, 'ready');
});

test('服务恢复时将中断阶段重新排队', async () => {
  const store = createMemoryStore([
    caseItem('extracting', 'extracting'),
    caseItem('chunking', 'chunking'),
    caseItem('summarizing', 'summarizing'),
    caseItem('ready', 'ready'),
  ]);
  const processed = [];
  const queue = createCaseQueue({
    store,
    async processCase(id) {
      processed.push(id);
      return { status: 'ready', progress: { stage: 'ready', percent: 100 } };
    },
  });

  const recovered = queue.recover();
  await queue.whenIdle();

  assert.deepEqual(recovered.sort(), ['chunking', 'extracting', 'summarizing']);
  assert.deepEqual(processed.sort(), ['chunking', 'extracting', 'summarizing']);
});
