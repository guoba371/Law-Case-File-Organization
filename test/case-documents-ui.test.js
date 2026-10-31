const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDir = path.join(__dirname, '..', 'public');

test('文书页识别案件参数并调用案件范围生成接口', () => {
  const html = fs.readFileSync(path.join(publicDir, 'documents.html'), 'utf8');
  assert.match(html, /URLSearchParams/);
  assert.match(html, /caseId/);
  assert.ok(html.includes('/api/cases/${caseId}/documents'));
  assert.ok(html.includes('docs.filter(doc => doc.caseId === caseId)'));
  assert.match(html, /docId/);
});

test('文书段落来源标签可返回案件工作台原文定位', () => {
  const html = fs.readFileSync(path.join(publicDir, 'documents.html'), 'utf8');
  assert.match(html, /sec\.sourceRefs/);
  assert.match(html, /view=overview&source=/);
  assert.doesNotMatch(html, /加载文书失败/);
});

test('案件工作台法律文书视图展示本案文书', () => {
  const script = fs.readFileSync(path.join(publicDir, 'case-workspace.js'), 'utf8');
  assert.match(script, /workspace\.documents/);
  assert.ok(script.includes('/documents?caseId='));
  assert.match(script, /source/);
});
