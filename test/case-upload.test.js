const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-upload-'));
process.env.CASES_DIR = dataDir;
const store = require('../src/case-store');
const { CASE_LIMITS } = require('../src/case-config');
const upload = require('../src/case-upload');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function makeCase(name = '上传测试案') {
  return store.createCase({ name, model: 'deepseek', redactedConfirmed: true });
}

test('未确认脱敏时终止文件上传', () => {
  const caseItem = makeCase('未确认脱敏案');
  store.updateCase(caseItem.id, (item) => ({ ...item, redactedConfirmed: false }));
  assert.throws(
    () => upload.initFile(caseItem.id, { name: '案卷.txt', size: 1, totalChunks: 1 }),
    /未脱敏材料不得上传或分析/,
  );
  assert.deepEqual(store.readCaseData(caseItem.id, 'files', []), []);
});

test('分片写入并合并为完整 TXT 文件', () => {
  const caseItem = makeCase();
  const content = Buffer.from('第一部分案卷第二部分案卷');
  const file = upload.initFile(caseItem.id, { name: '../案卷一.txt', size: content.length, totalChunks: 2 });

  upload.writeChunk(caseItem.id, file.id, 0, content.subarray(0, 12));
  upload.writeChunk(caseItem.id, file.id, 1, content.subarray(12));
  const completed = upload.completeFile(caseItem.id, file.id);

  assert.equal(completed.name, '案卷一.txt');
  assert.equal(completed.status, 'uploaded');
  assert.deepEqual(fs.readFileSync(upload.completedFilePath(caseItem.id, file.id)), content);
  assert.equal(fs.existsSync(upload.chunkDirectory(caseItem.id, file.id)), false);
});

test('拒绝重复分片、缺失分片和超出分片大小', () => {
  const caseItem = makeCase('分片校验案');
  const file = upload.initFile(caseItem.id, { name: '案卷.txt', size: 4, totalChunks: 2 });
  upload.writeChunk(caseItem.id, file.id, 0, Buffer.from('ab'));
  assert.throws(() => upload.writeChunk(caseItem.id, file.id, 0, Buffer.from('ab')), /分片已上传/);
  assert.throws(() => upload.completeFile(caseItem.id, file.id), /缺少分片/);
  assert.throws(
    () => upload.writeChunk(caseItem.id, file.id, 1, Buffer.alloc(CASE_LIMITS.uploadChunkBytes + 1)),
    /分片不能超过 5MB/,
  );
});

test('拒绝扩展名、文件头和声明大小不一致', () => {
  const caseItem = makeCase('格式校验案');
  assert.throws(() => upload.initFile(caseItem.id, { name: '恶意.exe', size: 1, totalChunks: 1 }), /仅支持/);

  const pdf = upload.initFile(caseItem.id, { name: '伪造.pdf', size: 3, totalChunks: 1 });
  upload.writeChunk(caseItem.id, pdf.id, 0, Buffer.from('abc'));
  assert.throws(() => upload.completeFile(caseItem.id, pdf.id), /有效的 PDF/);

  const txt = upload.initFile(caseItem.id, { name: '大小错误.txt', size: 5, totalChunks: 1 });
  upload.writeChunk(caseItem.id, txt.id, 0, Buffer.from('abc'));
  assert.throws(() => upload.completeFile(caseItem.id, txt.id), /文件大小不一致/);
});

test('按元数据拒绝单文件、文件数量和案件总容量超限', () => {
  const caseItem = makeCase('容量校验案');
  assert.throws(() => upload.initFile(caseItem.id, {
    name: '超大.txt', size: CASE_LIMITS.maxFileBytes + 1, totalChunks: 21,
  }), /单文件不能超过 100MB/);

  store.writeCaseData(caseItem.id, 'files', Array.from({ length: CASE_LIMITS.maxFiles }, (_, index) => ({
    id: `file-${index}`, name: `${index}.txt`, size: 1, status: 'uploaded',
  })));
  assert.throws(() => upload.initFile(caseItem.id, { name: '第501份.txt', size: 1, totalChunks: 1 }), /最多 500 份/);

  store.writeCaseData(caseItem.id, 'files', [{ id: 'existing', name: '已有.txt', size: CASE_LIMITS.maxCaseBytes, status: 'uploaded' }]);
  assert.throws(() => upload.initFile(caseItem.id, { name: '超总量.txt', size: 1, totalChunks: 1 }), /合计不能超过 2GB/);
});
