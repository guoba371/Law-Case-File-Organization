const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicDir = path.join(__dirname, '..', 'public');

test('案件工作台包含七个视图和可核验的来源抽屉', () => {
  const html = fs.readFileSync(path.join(publicDir, 'case-workspace.html'), 'utf8');
  for (const label of ['案件概览', '案卷材料', '时间轴', '人物关系', '事件进展', '证据研判', '法律文书']) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /class="case-sidebar"/);
  assert.match(html, /class="case-main"/);
  assert.match(html, /class="source-drawer/);
  assert.match(html, /id="sourceFile"/);
  assert.match(html, /id="sourceFragment"/);
  assert.match(html, /id="sourceExcerpt"/);
});

test('工作台脚本保留视图状态并按 1.5 秒轮询', () => {
  const script = fs.readFileSync(path.join(publicDir, 'case-workspace.js'), 'utf8');
  for (const name of ['activateCaseView', 'openSourceDrawer', 'navigateWithScope', 'pollCaseStatus']) {
    assert.match(script, new RegExp(`function ${name}\\b`));
  }
  assert.match(script, /1500/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /popstate/);
  assert.match(script, /暂无数据/);
  new Function(script);
});

test('移动端将案件导航改为横向滚动并将来源抽屉改为底部面板', () => {
  const css = fs.readFileSync(path.join(publicDir, 'app.css'), 'utf8');
  assert.match(css, /case-sidebar[\s\S]*overflow-x:\s*auto/);
  assert.match(css, /source-drawer[\s\S]*bottom:\s*0/);
});
