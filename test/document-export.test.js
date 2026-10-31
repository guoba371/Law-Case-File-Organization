const assert = require('node:assert/strict');
const test = require('node:test');
const { exportDocument, cleanText, fileNameFor } = require('../src/document-export');

const doc = {
  typeName: '质证意见',
  caseFileName: '李某诈骗案.pdf',
  createdAt: '2026-11-01T00:00:00.000Z',
  model: 'deepseek',
  sections: [
    { title: '一、案件基本情况', content: '**现有材料缺口**\n\n---\n\n## 需要补充' },
    { title: '二、证据分析', content: '证据内容。' },
  ],
};

test('清理模型输出中的基础 Markdown 标记', () => {
  assert.equal(cleanText(doc.sections[0].content), '现有材料缺口\n\n需要补充');
});

test('导出文件名安全且不重复原扩展名', () => {
  assert.equal(fileNameFor(doc, 'docx'), '李某诈骗案-质证意见.docx');
});

test('生成可下载的 Word 和 PDF 文件', async () => {
  const word = await exportDocument(doc, 'docx');
  const pdf = await exportDocument(doc, 'pdf');

  assert.equal(word.buffer.subarray(0, 2).toString(), 'PK');
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(word.buffer.length > 1000);
  assert.ok(pdf.buffer.length > 1000);
});
