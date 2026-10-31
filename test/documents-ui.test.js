const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'documents.html'), 'utf8');

test('文书列表空数据或请求失败时只显示暂无数据', () => {
  assert.match(html, /if \(docs\.length === 0\)[\s\S]*?暂无数据/);
  assert.match(html, /catch \(err\)[\s\S]*?暂无数据/);
  assert.doesNotMatch(html, /加载失败：\$\{err\.message\}/);
});
