const assert = require('node:assert/strict');
const test = require('node:test');

test('case diagrams render local SVGs with source bindings and both themes', async () => {
  const { renderCaseDiagram } = require('../src/case-diagrams');
  const ref = { chunkId: 'c1', fileId: 'f1', pageStart: 1, pageEnd: 1 };
  const views = {
    people: [{ id: 'p1', name: '人员甲', role: '相关人员', sourceRefs: [ref] }, { id: 'p2', name: '人员乙', sourceRefs: [ref] }],
    relations: [{ from: 'p1', to: 'p2', type: '会面', label: '材料记载会面', sourceRefs: [ref] }],
    timeline: [{ date: '2024年10月2日', title: '后续记录', sourceRefs: [ref] }, { date: '2024年2月3日', title: '首次会面', sourceRefs: [ref] }, { title: '时间不详的记录', precision: 'unknown', sourceRefs: [ref] }],
    events: [{ title: '会面', lane: '人员行为', sourceRefs: [ref] }],
  };
  const before = JSON.stringify(views);
  for (const view of ['people', 'timeline', 'events']) {
    const result = await renderCaseDiagram(views, view, { theme: 'light' });
    assert.match(result.svg, /^<svg/);
    assert.match(result.svg, /data-diagram-ref=/);
    assert.match(result.svg, /tabindex="0"/);
    assert.doesNotMatch(result.svg, /@import|https?:\/\/(?!www.w3.org)|<script|<foreignObject/);
    assert.ok(Object.values(result.sources).every((refs) => refs[0].chunkId === 'c1'));
    assert.match(result.notice, /候选/);
  }
  const timeline = await renderCaseDiagram(views, 'timeline');
  assert.ok(timeline.source.indexOf('首次会面') < timeline.source.indexOf('后续记录'));
  assert.match(timeline.source, /时间待确认/);
  assert.doesNotMatch(timeline.source, /t[01] --- t2|t2 ---/);
  const light = await renderCaseDiagram(views, 'people', { theme: 'light' });
  const dark = await renderCaseDiagram(views, 'people', { theme: 'dark' });
  assert.notEqual(light.svg, dark.svg);
  assert.equal(JSON.stringify(views), before);
});

test('diagram API exposes saved case sources and downloadable SVG without model calls', async (t) => {
  const { createHttpServer } = require('../src/server');
  const workspace = { views: { people: [{ id: 'p1', name: '人员甲', sourceRefs: [{ chunkId: 'c1' }] }], relations: [] } };
  const server = createHttpServer({ casesService: { getCaseWorkspace: () => workspace } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/cases/fixture/diagrams/people?theme=dark`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.svg, /人员甲/);
  assert.equal(result.theme, 'dark');
  assert.deepEqual(result.sources.p0, [{ chunkId: 'c1' }]);
  const download = await fetch(`${base}/api/cases/fixture/diagrams/people?format=svg`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(await download.text(), /^<svg/);
  assert.equal((await fetch(`${base}/api/cases/fixture/diagrams/invalid`)).status, 400);
  assert.equal((await fetch(`${base}/api/cases/fixture/diagrams/constructor`)).status, 400);
  const empty = await fetch(`${base}/api/cases/fixture/diagrams/timeline`);
  assert.equal((await empty.json()).notice, '暂无数据');
  assert.equal((await fetch(`${base}/api/cases/fixture/diagrams/timeline?format=svg`)).status, 404);
});

test('identical relationship labels retain their own sources and filtering retains matching records', async () => {
  const { renderCaseDiagram } = require('../src/case-diagrams');
  const views = {
    people: [{ id: 'a', name: '人员甲' }, { id: 'b', name: '人员乙' }],
    relations: [
      { from: 'a', to: 'b', label: '会面', type: '接触', sourceRefs: [{ chunkId: 'first' }] },
      { from: 'a', to: 'b', label: '会面', type: '接触', sourceRefs: [{ chunkId: 'second' }] },
      { from: 'a', to: 'b', label: '转账', type: '资金', sourceRefs: [{ chunkId: 'third' }] },
    ],
  };
  const result = await renderCaseDiagram(views, 'people');
  const refs = [...result.svg.matchAll(/class="edge-label"[^>]*data-diagram-ref="([^"]+)"/g)].map((match) => result.sources[match[1]][0].chunkId);
  assert.deepEqual(refs, ['first', 'second', 'third']);
  const filtered = await renderCaseDiagram(views, 'people', { relationType: '资金' });
  assert.equal((filtered.svg.match(/class="edge-label"/g) || []).length, 1);
  assert.match(filtered.svg, /转账/);
  assert.doesNotMatch(filtered.svg, /会面/);
});

test('case labels stay literal with generated-token text, long Chinese labels and Mermaid punctuation', async () => {
  const { renderCaseDiagram } = require('../src/case-diagrams');
  const result = await renderCaseDiagram({
    people: [{ id: 'a', name: 'LABEL1TOKEN', role: '相关人员' }, { id: 'b', name: '人员乙' }],
    relations: [{ from: 'a', to: 'b', label: '双方在某地点会面并对相关记录进行核对且日期待确认 "&<>[]|;\\', sourceRefs: [{ chunkId: 'c1' }] }],
  }, 'people');
  assert.match(result.svg, />LABEL1TOKEN</);
  assert.match(result.svg, /&quot;&amp;&lt;&gt;\[\]\|;\\/);
  assert.match(result.svg, /class="edge-label"[^>]*data-diagram-ref=/);
  assert.equal((result.svg.match(/class="node"/g) || []).length, 2);
  assert.doesNotMatch(result.svg, /@import|<script|<foreignObject|  (?:svg|text) \{/);
});
