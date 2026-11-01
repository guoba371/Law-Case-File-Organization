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

test('structured candidates survive model summary merging through the case workspace', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-views-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { store, upload, cases } = loadModules(root);
  const analysis = require('../src/case-analysis');
  process.env.DEEPSEEK_API_KEY ||= 'test-key';
  const created = store.createCase({ name: 'Synthetic case', model: 'deepseek', redactedConfirmed: true });
  uploadText(upload, created.id, 'fixture.txt', 'Person A met Person B on 2024-03-01. A witness statement records the meeting.');
  const candidates = {
    summary: 'The statement records a meeting.',
    people: [{ id: 'p1', name: 'Person A' }, { id: 'p2', name: 'Person B' }],
    timeline: [{ id: 't1', date: '2024-03-01', title: 'Meeting' }],
    relations: [{ id: 'r1', from: 'p1', to: 'p2', type: 'Meeting', label: 'Meeting recorded' }],
    events: [{ id: 'e1', date: '2024-03-01', title: 'Meeting', lane: '人员行为' }],
    evidence: [{ id: 'v1', proposition: 'Whether the meeting occurred', material: 'Witness statement' }],
  };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const result = request.messages[1].content.includes('片段原文')
      ? candidates : { case_summary: 'The model returned different top-level keys.' };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
  };
  const service = cases.createCasesService({
    store, upload, listDocuments: () => [],
    summarizeChunk: (chunk, model) => analysis.summarizeChunk(chunk, model, { fetchImpl }),
    mergeFileSummary: (file, summaries, model) => analysis.mergeFileSummary(file, summaries, model, { fetchImpl }),
    mergeCaseSummary: (summaries, model) => analysis.mergeCaseSummary(summaries, model, { fetchImpl }),
  });

  const result = await service.processCase(created.id);
  const workspace = service.getCaseWorkspace(created.id);

  assert.equal(result.status, 'ready');
  for (const key of ['timeline', 'people', 'relations', 'events', 'evidence']) {
    assert.equal(workspace.views[key].length, candidates[key].length, `${key} must not disappear during merging`);
    assert.equal(workspace.views[key][0].sourceRefs[0].chunkId, workspace.chunks[0].id);
  }
  assert.equal(workspace.summaries.case.summary, candidates.summary);
});

test('empty legacy views recover from saved chunk candidates without changing documents or reanalyzing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { store, cases } = loadModules(root);
  const created = store.createCase({ name: 'Synthetic legacy case', redactedConfirmed: true });
  const empty = { summary: '', people: [], timeline: [], relations: [], events: [], evidence: [] };
  const candidate = { ...empty, summary: 'A recorded meeting.',
    timeline: [{ date: '2024-03-01', event: 'Meeting', sourceRefs: [{ chunkId: 'c1', fileId: 'f1' }] }],
  };
  store.writeCaseData(created.id, 'summaries', {
    chunks: [{ chunkId: 'c1', fileId: 'f1', summary: candidate }],
    files: [{ fileId: 'f1', fileName: 'fixture.txt', summary: empty }], case: empty,
  });
  const document = { id: 'doc1', caseId: created.id, status: 'completed' };
  const service = cases.createCasesService({ store, listDocuments: () => [document] });

  assert.equal(service.restoreCaseViews(created.id), true);
  const workspace = service.getCaseWorkspace(created.id);
  assert.equal(workspace.views.timeline[0].title, 'Meeting');
  assert.equal(workspace.views.timeline[0].sourceRefs[0].chunkId, 'c1');
  assert.equal(workspace.summaries.case.summary, 'A recorded meeting.');
  assert.deepEqual(workspace.documents, [document]);
  assert.deepEqual(workspace.summaries.chunks[0].summary, candidate);
  const snapshot = JSON.stringify(workspace);
  assert.equal(service.restoreCaseViews(created.id), false);
  assert.equal(JSON.stringify(service.getCaseWorkspace(created.id)), snapshot);
});
