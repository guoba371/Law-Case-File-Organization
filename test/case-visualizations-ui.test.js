const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'case-workspace.js'), 'utf8');

test('三类刑事案件图提供独立渲染函数和来源交互', () => {
  for (const name of ['renderTimeline', 'renderPeopleGraph', 'renderEventLanes']) {
    assert.match(script, new RegExp(`function ${name}\\b`));
  }
  assert.match(script, /时间待确认/);
  assert.match(script, /openSourceDrawer/);
  assert.match(script, /createCaseDiagram/);
});

test('事件进展始终使用确认的五条泳道顺序', () => {
  assert.match(script, /\['案件事实', '人员行为', '资金与物品', '侦查程序', '强制措施'\]/);
});

test('relationship records preserve people, explanations and source controls alongside diagrams', () => {
  const window = { addEventListener() {} };
  vm.runInNewContext(script, { window, document: {
    addEventListener() {},
    createElement: () => ({
      querySelector: () => ({ addEventListener() {} }),
      querySelectorAll: () => [],
    }),
  } });
  const graph = window.renderPeopleGraph(
    [{ id: 'p1', name: 'Person A' }, { id: 'p2', name: 'Person B' }],
    [{ from: 'p1', to: 'p2', type: 'Meeting', label: 'Recorded meeting', sourceRefs: [{ chunkId: 'c1' }] }],
  );
  assert.equal((graph.innerHTML.match(/class="material-row person-record"/g) || []).length, 2);
  assert.match(graph.innerHTML, /Recorded meeting/);
  assert.match(graph.innerHTML, /<button[^>]+data-relation-type="Meeting"[^>]+data-source-index="0"/);
  const timeline = window.renderTimeline([{ date: '2024-03-01', title: 'Meeting', precision: 'day' }]);
  assert.match(timeline.innerHTML, /2024-03-01/);
  assert.match(timeline.innerHTML, /Meeting/);
  const lanes = window.renderEventLanes([{ lane: '人员行为', title: 'Meeting' }]);
  assert.match(lanes.innerHTML, /data-source-index="0"/);
});
