const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function clearModules() {
  for (const modulePath of ['../src/case-store', '../src/cases', '../src/documents']) {
    delete require.cache[require.resolve(modulePath)];
  }
}

test('案件范围文书只使用相关片段并保存来源引用', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-docs-'));
  process.env.CASES_DIR = path.join(root, 'cases');
  process.env.DOCUMENTS_DIR = path.join(root, 'documents');
  process.env.SETTINGS_FILE = path.join(root, 'settings.json');
  process.env.DEEPSEEK_API_KEY = 'test-key';
  clearModules();
  const store = require('../src/case-store');
  const documents = require('../src/documents');
  const { createCasesService } = require('../src/cases');
  const service = createCasesService({ store, listDocuments: documents.listDocuments });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const created = store.createCase({ name: '张某诈骗案', model: 'deepseek', redactedConfirmed: true });
  const relevant = { id: 'c-relevant', fileId: 'f1', fileName: '讯问笔录.txt', pageStart: 2, pageEnd: 2, text: '张某陈述收到李某转账十万元。' };
  const unrelated = { id: 'c-unrelated', fileId: 'f2', fileName: '其他材料.txt', pageStart: 1, pageEnd: 1, text: '王某的租房合同，与张某无关。' };
  store.writeCaseData(created.id, 'chunks', [relevant, unrelated]);
  store.writeCaseData(created.id, 'summaries', { chunks: [], files: [], case: { summary: '案件涉及转账事实与言词证据矛盾。' } });

  const context = service.getCaseDocumentContext(created.id, { scope: { keywords: ['张某陈述'] } });
  assert.deepEqual(context.chunks.map((chunk) => chunk.id), ['c-relevant']);

  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const content = documents.DOC_TYPES.evidence_opinion.sections.map((section) => `【${section.title}】\n测试内容`).join('\n');
    return { ok: true, async json() { return { choices: [{ message: { content } }] }; } };
  };
  const summary = await documents.generateCaseDocument({ docType: 'evidence_opinion', model: 'deepseek', draftingRequirements: '重点核验转账事实' }, context, fetchImpl);
  const prompt = requestBody.messages.map((message) => message.content).join('\n');
  const saved = documents.getDocument(summary.id);

  assert.match(prompt, /案件涉及转账事实与言词证据矛盾/);
  assert.match(prompt, /张某陈述收到李某转账十万元/);
  assert.doesNotMatch(prompt, /王某的租房合同/);
  assert.equal(saved.caseId, created.id);
  assert.deepEqual(saved.sections[0].sourceRefs, [{ chunkId: 'c-relevant', fileId: 'f1', fileName: '讯问笔录.txt', pageStart: 2, pageEnd: 2 }]);

  fs.writeFileSync(path.join(process.env.DOCUMENTS_DIR, 'legacy.json'), JSON.stringify({ id: 'legacy', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', sections: [] }));
  assert.equal(documents.getDocument('legacy').caseId, undefined);
  assert.deepEqual(service.getCaseWorkspace(created.id).documents.map((item) => item.id), [summary.id]);
});
