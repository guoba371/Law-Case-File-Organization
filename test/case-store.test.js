const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-store-'));
process.env.CASES_DIR = dataDir;
const store = require('../src/case-store');
const { CASE_LIMITS } = require('../src/case-config');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('案件容量配置使用已确认的分片和存储上限', () => {
  assert.deepEqual(CASE_LIMITS, {
    maxFileBytes: 100 * 1024 * 1024,
    maxFiles: 500,
    maxCaseBytes: 2 * 1024 * 1024 * 1024,
    uploadChunkBytes: 5 * 1024 * 1024,
    textChunkChars: 12_000,
    textOverlapChars: 500,
  });
});

test('创建案件并通过原子写入更新状态', () => {
  const created = store.createCase({ name: '李某诈骗案', model: 'deepseek', redactedConfirmed: true });
  assert.equal(created.status, 'uploading');
  assert.equal(created.name, '李某诈骗案');
  assert.equal(created.progress.percent, 0);

  store.updateCase(created.id, (item) => ({ ...item, status: 'queued' }));
  assert.equal(store.getCase(created.id).status, 'queued');
  assert.equal(fs.existsSync(store.casePaths(created.id).caseFile), true);
  assert.equal(fs.existsSync(`${store.casePaths(created.id).caseFile}.tmp`), false);
});

test('案件按创建时间倒序列出并可完整删除目录', async () => {
  const older = store.createCase({ name: '旧案', model: 'deepseek', redactedConfirmed: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newer = store.createCase({ name: '新案', model: 'deepseek', redactedConfirmed: true });

  assert.deepEqual(store.listCases().slice(0, 2).map((item) => item.id), [newer.id, older.id]);

  fs.writeFileSync(store.casePaths(older.id).chunksFile, JSON.stringify([{ id: 'chunk-1' }]));
  store.deleteCase(older.id);
  assert.equal(fs.existsSync(store.casePaths(older.id).root), false);
  assert.throws(() => store.getCase(older.id), /案件不存在/);
});

test('拒绝非法案件编号和空案件名称', () => {
  assert.throws(() => store.createCase({ name: '   ', model: 'deepseek', redactedConfirmed: true }), /案件名称不能为空/);
  assert.throws(() => store.createCase({ name: '未脱敏案', model: 'deepseek' }), /已完成必要脱敏/);
  assert.throws(() => store.getCase('../escape'), /案件编号无效/);
});
