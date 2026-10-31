const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDir = path.join(__dirname, '..', 'public');

test('案件页支持多文件分片上传并清晰展示容量规则', () => {
  const html = fs.readFileSync(path.join(publicDir, 'cases.html'), 'utf8');
  const script = fs.readFileSync(path.join(publicDir, 'cases.js'), 'utf8');
  assert.match(html, /type="file"[^>]*multiple/);
  assert.match(html, /100MB/);
  assert.match(html, /500份/);
  assert.match(html, /2GB/);
  assert.match(html, /超长案卷将自动分批解析/);
  assert.match(html, /未确认将停止创建、上传与分析/);
  assert.doesNotMatch(html, /2MB/);
  assert.match(script, /file\.slice/);
  assert.match(script, /5 \* 1024 \* 1024/);
  assert.match(script, /暂无数据/);
  assert.match(script, /if \(!redactedConfirm\.checked\)/);
  assert.match(script, /redactedConfirmed: true/);
  assert.doesNotMatch(script, /console\.error\('Failed to create case:'/);
  new Function(script);
});

test('所有主页面使用案件、全部文书、样本、模型导航', () => {
  for (const name of ['cases.html', 'documents.html', 'samples.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(publicDir, name), 'utf8');
    for (const label of ['案件', '全部文书', '样本', '模型']) assert.match(html, new RegExp(`>${label}<`), name);
  }
});

test('页面不向律师显示加载失败文案', () => {
  for (const name of fs.readdirSync(publicDir).filter((item) => /\.(html|js)$/.test(item))) {
    assert.doesNotMatch(fs.readFileSync(path.join(publicDir, name), 'utf8'), />[^<]*加载失败[^<]*</, name);
  }
});

test('移动端优先展示案件上传表单', () => {
  const css = fs.readFileSync(path.join(publicDir, 'app.css'), 'utf8');
  assert.doesNotMatch(css, /\.case-process-map\s*\{[^}]*order:\s*-1/);
});
