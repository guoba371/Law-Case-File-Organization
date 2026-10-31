const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'case-workspace.js'), 'utf8');

test('三类刑事案件图提供独立渲染函数和来源交互', () => {
  for (const name of ['renderTimeline', 'renderPeopleGraph', 'renderEventLanes']) {
    assert.match(script, new RegExp(`function ${name}\\b`));
  }
  assert.match(script, /时间待确认/);
  assert.match(script, /openSourceDrawer/);
  assert.match(script, /relationTypeFilter/);
});

test('事件进展始终使用确认的五条泳道顺序', () => {
  assert.match(script, /\['案件事实', '人员行为', '资金与物品', '侦查程序', '强制措施'\]/);
});
