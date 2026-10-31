const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MAX_FILES, extractCaseFile, extractCaseFiles, extractCasePath } = require('../src/case-files');

test('提取 TXT 案卷正文', async () => {
  const result = await extractCaseFile('案卷.txt', Buffer.from('已脱敏案卷正文').toString('base64'));
  assert.strictEqual(result.name, '案卷.txt');
  assert.strictEqual(result.text, '已脱敏案卷正文');
});

test('拒绝不支持格式和伪造 PDF', async () => {
  await assert.rejects(() => extractCaseFile('案卷.exe', 'YQ=='), /仅支持/);
  await assert.rejects(() => extractCaseFile('案卷.pdf', 'YQ=='), /有效的 PDF/);
});

test('按选择顺序提取多份案卷', async () => {
  const files = await extractCaseFiles([
    { name: '第一卷.txt', base64: Buffer.from('第一卷正文').toString('base64') },
    { name: '第二卷.txt', base64: Buffer.from('第二卷正文').toString('base64') },
  ]);
  assert.deepStrictEqual(files.map((file) => file.name), ['第一卷.txt', '第二卷.txt']);
  assert.deepStrictEqual(files.map((file) => file.text), ['第一卷正文', '第二卷正文']);
});

test('拒绝超过文件数量上限的案卷', async () => {
  const files = Array.from({ length: MAX_FILES + 1 }, (_, index) => ({
    name: `${index}.txt`,
    base64: Buffer.from('正文').toString('base64'),
  }));
  await assert.rejects(() => extractCaseFiles(files), /最多上传 20 份/);
});

test('从磁盘路径提取 TXT 并返回逻辑页定位', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-path-'));
  const filePath = path.join(dir, '案卷.txt');
  fs.writeFileSync(filePath, '第一段\n\n第二段');
  try {
    const result = await extractCasePath(filePath, '案卷.txt');
    assert.strictEqual(result.text, '第一段\n\n第二段');
    assert.deepStrictEqual(result.pages, [{ page: 1, startChar: 0, endChar: result.text.length }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('无可提取文字时返回 NEEDS_OCR 类型错误', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-ocr-'));
  const filePath = path.join(dir, '空白.txt');
  fs.writeFileSync(filePath, '   ');
  try {
    await assert.rejects(
      () => extractCasePath(filePath, '空白.txt'),
      (error) => error.code === 'NEEDS_OCR',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
