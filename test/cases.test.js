const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function loadModules(root) {
  process.env.CASES_DIR = root;
  for (const modulePath of ['../src/case-store', '../src/case-upload', '../src/cases']) {
    delete require.cache[require.resolve(modulePath)];
  }
  return {
    store: require('../src/case-store'),
    upload: require('../src/case-upload'),
    cases: require('../src/cases'),
  };
}

function uploadText(upload, caseId, name, text) {
  const buffer = Buffer.from(text);
  const file = upload.initFile(caseId, { name, size: buffer.length, totalChunks: 1 });
  upload.writeChunk(caseId, file.id, 0, buffer);
  upload.completeFile(caseId, file.id);
  return file;
}

test('整案处理隔离空白材料并持久化可用研判结果', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-cases-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { store, upload, cases } = loadModules(root);
  const created = store.createCase({ name: '李某诈骗案', model: 'deepseek', redactedConfirmed: true });
  const valid = uploadText(upload, created.id, '第一卷.txt', '张某于2024年3月向李某转账10万元。');
  const blank = uploadText(upload, created.id, '扫描空白.txt', ' ');

  const service = cases.createCasesService({
    store,
    upload,
    summarizeChunk: async (chunk) => ({
      summary: '张某向李某转账',
      people: [{ id: 'p1', name: '张某', confidence: 'candidate', sourceRefs: [{ chunkId: chunk.id }] }],
      timeline: [{ id: 't1', date: '2024年3月', precision: 'month', title: '转账', sourceRefs: [{ chunkId: chunk.id }] }],
      relations: [],
      events: [],
      evidence: [],
    }),
    mergeFileSummary: async (_file, summaries) => summaries[0],
    mergeCaseSummary: async (summaries) => summaries[0],
    buildCaseViews: (caseId, summary) => ({ caseId, timeline: summary.timeline, people: summary.people, relations: [], events: [], evidence: [] }),
  });

  const result = await service.processCase(created.id, () => {});
  const workspace = service.getCaseWorkspace(created.id);
  const validState = workspace.files.find((file) => file.id === valid.id);
  const blankState = workspace.files.find((file) => file.id === blank.id);

  assert.equal(result.status, 'partial_ready');
  assert.equal(validState.status, 'ready');
  assert.equal(blankState.status, 'needs_ocr');
  assert.equal(workspace.chunks.length, 1);
  assert.equal(workspace.views.timeline.length, 1);
  assert.equal(workspace.views.people[0].confidence, 'candidate');
  assert.equal(fs.existsSync(upload.completedFilePath(created.id, valid.id)), false);
  assert.equal(fs.existsSync(upload.completedFilePath(created.id, blank.id)), false);
});
