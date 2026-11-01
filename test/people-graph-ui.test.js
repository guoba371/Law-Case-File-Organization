const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const people = [
  { id: 'a', name: '人员甲', role: '委托当事人', sourceRefs: [{ chunkId: 'c1', fileName: '材料一' }] },
  { id: 'b', name: '人员乙', role: '证人', sourceRefs: [] },
  { id: 'c', name: '人员丙', role: '相关人员', sourceRefs: [] },
];
const relations = [
  { from: 'a', to: 'b', type: '接触', label: '首次会面', sourceRefs: [{ chunkId: 'c1', fileName: '材料一' }, { chunkId: 'c2', fileName: '材料二' }] },
  { from: 'b', to: 'a', type: '资金', label: '款项用途待核对', sourceRefs: [{ chunkId: 'c3', fileName: '材料三' }] },
];

function harness(options = {}) {
  const { window, document } = parseHTML('<html data-theme="light"><body></body></html>');
  Object.defineProperty(window, 'innerWidth', { value: options.width || 1024, configurable: true });
  const graphs = [];
  const objectUrls = [];
  class Graph {
    constructor(config) { this.config = config; this.data = config.data; this.events = {}; this.zoom = 1; graphs.push(this); }
    on(name, callback) { this.events[name] = callback; }
    async render() { if (options.fail) throw new Error('renderer unavailable'); }
    async draw() {}
    setNode(node) { this.config.node = node; }
    setEdge(edge) { this.config.edge = edge; }
    setOptions(options) { Object.assign(this.config, options); }
    setData(data) { this.data = data; }
    getNodeData() { return this.data.nodes; }
    getZoom() { return this.zoom; }
    async zoomTo(value) { this.zoom = value; }
    async fitView() { this.zoom = 0.4; }
    async fitCenter() {}
    async focusElement() {}
    async setElementState(states) { this.states = states; }
    resize() {}
    async toDataURL(options) { this.exportOptions = options; return 'data:image/png;base64,TEST'; }
    destroy() { this.destroyed = true; }
  }
  window.G6 = { Graph, Rect: class {}, register() {}, ExtensionCategory: { NODE: 'node' } };
  window.PeopleGraphData = require('../public/people-graph-data');
  const observers = [];
  const context = vm.createContext({ window, document, console, setTimeout, clearTimeout,
    fetch: async () => ({ blob: async () => ({ type: 'image/png' }) }),
    URL: { createObjectURL(blob) { objectUrls.push(blob); return 'blob:people-graph'; }, revokeObjectURL() {} },
    ResizeObserver: class { observe() {} disconnect() { this.disconnected = true; } },
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'people-graph.js'), 'utf8'), context);
  const records = document.createElement('div');
  records.textContent = '原记录';
  const sources = [];
  const graph = window.createPeopleGraph({ people: options.people || people, relations: options.relations || relations, records, onSource: (refs) => sources.push(refs) });
  graph.element.querySelectorAll('select').forEach((select) => {
    Object.defineProperty(select, 'value', {
      get() { return this.querySelector('option[selected]')?.value || ''; },
      set(value) { this.querySelectorAll('option').forEach((option) => { option.selected = option.value === value; }); },
    });
  });
  document.body.append(graph.element);
  return { window, document, graph, graphs, sources, records, observers, objectUrls, query: (selector) => graph.element.querySelector(selector) };
}

test('relationship graph opens each relationship and every source without merging parallel records', async () => {
  const page = harness();
  await page.graph.load();
  assert.equal(page.graphs[0].data.edges.length, 2);
  assert.equal(page.graphs[0].config.layout.type, 'antv-dagre');
  assert.equal(page.graphs[0].config.layout.rankdir, 'LR');
  assert.equal(page.graphs[0].config.layout.edgeLabelSpace, true);
  assert.equal(page.graphs[0].config.layout.animation, false);
  assert.match(page.query('.people-isolated').textContent, /人员丙/);
  await page.graphs[0].events['edge:click']({ target: { id: 'relation-0' } });
  assert.match(page.query('.people-detail').textContent, /首次会面/);
  const buttons = page.query('.people-detail').querySelectorAll('[data-source-ref]');
  assert.equal(buttons.length, 2);
  buttons[1].click();
  assert.equal(page.sources[0][0].chunkId, 'c2');
  await page.graphs[0].events['edge:click']({ target: { id: 'relation-1' } });
  assert.match(page.query('.people-detail').textContent, /款项用途待核对/);
  await page.graph.destroy();
  assert.equal(page.graphs[0].destroyed, true);
});

test('narrow screens use a vertical relationship layout', async () => {
  const page = harness({ width: 390 });
  await page.graph.load();
  assert.equal(page.graphs[0].config.layout.rankdir, 'TB');
  assert.equal(page.query('[data-people-scale]').textContent, '60%');
  await page.graph.destroy();
});

test('search focuses a person, direct view filters edges, and theme changes retain the graph', async () => {
  const page = harness();
  await page.graph.load();
  const search = page.query('[data-people-search]');
  assert.ok(search, 'people search is available');
  search.value = '人员乙';
  search.dispatchEvent(new page.window.Event('input'));
  page.query('[data-person-result]').click();
  await new Promise(setImmediate);
  assert.deepEqual(Array.from(page.graphs[0].states['person-1']), ['selected']);
  assert.deepEqual(Array.from(page.graphs[0].states['person-0']), ['related']);
  const direct = page.query('[data-people-direct]');
  direct.checked = true;
  direct.dispatchEvent(new page.window.Event('change'));
  await new Promise(setImmediate);
  assert.equal(page.graphs[0].data.nodes.length, 2);
  const filter = page.query('[data-people-filter]');
  filter.querySelector('option[value="资金"]').selected = true;
  filter.dispatchEvent(new page.window.Event('change'));
  await new Promise(setImmediate);
  assert.equal(page.graphs[0].data.edges.length, 1);
  assert.equal(page.graphs[0].data.edges[0].data.type, '资金');
  const oldFill = page.graphs[0].config.node.style.fill;
  const oldBackground = page.graphs[0].config.background;
  page.document.documentElement.dataset.theme = 'dark';
  page.observers[0].callback();
  await new Promise(setImmediate);
  assert.equal(page.graphs.length, 1);
  assert.notEqual(page.graphs[0].config.node.style.fill, oldFill);
  assert.notEqual(page.graphs[0].config.background, oldBackground);
  page.query('[data-people-action="reset"]').click();
  await new Promise(setImmediate);
  assert.equal(page.graphs[0].data.edges.length, 2);
  await page.graph.destroy();
  assert.equal(page.observers[0].disconnected, true);
});

test('graph supports readable zoom, full-screen return, PNG download and empty/error fallback', async () => {
  const page = harness();
  await page.graph.load();
  assert.equal(page.query('[data-people-scale]').textContent, '72%');
  page.query('[data-people-action="in"]').click();
  await new Promise(setImmediate);
  assert.equal(page.query('[data-people-scale]').textContent, '90%');
  page.query('[data-people-action="fullscreen"]').click();
  assert.equal(page.graph.element.classList.contains('is-fullscreen'), true);
  const escape = new page.window.Event('keydown');
  escape.key = 'Escape';
  page.document.dispatchEvent(escape);
  assert.equal(page.graph.element.classList.contains('is-fullscreen'), false);
  page.query('[data-people-action="download"]').click();
  await new Promise(setImmediate);
  assert.equal(page.objectUrls.length, 1);
  assert.equal(page.graphs[0].exportOptions.mode, 'viewport');
  await page.graph.destroy();

  for (const options of [{ fail: true }, { people: [], relations: [] }]) {
    const fallback = harness(options);
    await fallback.graph.load();
    assert.equal(fallback.query('.diagram-records').contains(fallback.records), true);
    assert.equal(fallback.query('[data-people-action="download"]').disabled, true);
    if (options.fail) assert.equal(fallback.query('.diagram-records').open, true);
    else assert.match(fallback.query('.people-status').textContent, /暂无/);
    await fallback.graph.destroy();
  }
});
