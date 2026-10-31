const assert = require('node:assert/strict');
const test = require('node:test');
const { CASE_LIMITS } = require('../src/case-config');
const { chunkText } = require('../src/text-chunker');

test('长案卷按自然段切片并保留来源和重叠文字', () => {
  const paragraphs = Array.from({ length: 8 }, (_, index) => `第${index + 1}段` + '甲'.repeat(2500));
  const text = paragraphs.join('\n\n');
  const chunks = chunkText({ fileId: 'file-1', fileName: '第一卷.txt', text, pages: null });

  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].fileName, '第一卷.txt');
  assert.equal(chunks[0].startChar, 0);
  assert.equal(chunks[0].pageStart, null);
  assert.equal(chunks[1].startChar, chunks[0].endChar - CASE_LIMITS.textOverlapChars);
  assert.equal(chunks[1].text.slice(0, CASE_LIMITS.textOverlapChars), chunks[0].text.slice(-CASE_LIMITS.textOverlapChars));
});

test('超长单段会硬切分且生成稳定片段编号', () => {
  const text = '案'.repeat(CASE_LIMITS.textChunkChars * 2 + 100);
  const first = chunkText({ fileId: 'file-fixed', fileName: '超长.txt', text, pages: null });
  const second = chunkText({ fileId: 'file-fixed', fileName: '超长.txt', text, pages: null });

  assert.ok(first.length >= 3);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.ok(first.every((item) => item.text.length <= CASE_LIMITS.textChunkChars));
});

test('能够根据字符区间保留 PDF 页码范围', () => {
  const text = '第一页内容'.repeat(1500) + '\n' + '第二页内容'.repeat(1500);
  const split = text.indexOf('第二页内容');
  const chunks = chunkText({
    fileId: 'pdf-1',
    fileName: '卷宗.pdf',
    text,
    pages: [
      { page: 1, startChar: 0, endChar: split },
      { page: 2, startChar: split, endChar: text.length },
    ],
  });

  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks.at(-1).pageEnd, 2);
});
