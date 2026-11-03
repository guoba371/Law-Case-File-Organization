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

test('案卷材料逐份列出，可单独移除或清空', () => {
  const html = fs.readFileSync(path.join(publicDir, 'cases.html'), 'utf8');
  const script = fs.readFileSync(path.join(publicDir, 'cases.js'), 'utf8');
  assert.doesNotMatch(html, /id="caseFiles"[^>]*required/);
  assert.match(script, /let selectedFiles = \[\]/);
  assert.match(script, /selected-file-row/);
  assert.match(script, /textContent = '移除'/);
  assert.match(script, /textContent = '清空'/);
  assert.match(script, /const files = selectedFiles\.slice\(\)/);
  new Function(script);
});

test('所有主页面仅提供案件工作台、文书样本和系统设置三个入口', () => {
  for (const name of ['cases.html', 'case-workspace.html', 'documents.html', 'samples.html', 'settings.html']) {
    const html = fs.readFileSync(path.join(publicDir, name), 'utf8');
    const navigation = html.match(/<nav class="app-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
    assert.deepEqual([...navigation.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1]), ['案件工作台', '文书样本', '系统设置'], name);
    assert.doesNotMatch(navigation, /href="\/documents/);
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

test('案件工作台优先展示案件列表并保留次级历史文书入口', () => {
  const html = fs.readFileSync(path.join(publicDir, 'cases.html'), 'utf8');
  assert.ok(html.indexOf('id="caseList"') < html.indexOf('id="caseForm"'));
  assert.match(html, /id="newCasePanel"[^>]*hidden/);
  assert.match(html, /aria-controls="newCasePanel"/);
  assert.match(html, /href="\/documents">未归属案件的历史文书<\/a>/);
});

test('首页提供低调的问题反馈入口，支持文字和多张截图', () => {
  const html = fs.readFileSync(path.join(publicDir, 'cases.html'), 'utf8');
  const script = fs.readFileSync(path.join(publicDir, 'cases.js'), 'utf8');
  assert.match(html, /id="feedbackTrigger"/);
  assert.match(html, /<dialog[^>]*id="feedbackDialog"/);
  assert.match(html, /id="feedbackDescription"[^>]*required/);
  assert.match(html, /id="feedbackImages"[^>]*type="file"[^>]*multiple/);
  assert.match(html, /PNG、JPG、WEBP/);
  assert.match(script, /\/api\/feedback/);
  assert.match(script, /notificationStatus === 'sent'/);
  assert.match(script, /sent \? 'ok' : 'warn'/);
  assert.match(script, /最多上传 5 张图片/);
  new Function(script);
});
