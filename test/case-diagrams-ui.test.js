const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(fetchImpl) {
  const elements = new Map();
  function element() {
    return {
      style: {}, dataset: {}, hidden: false, disabled: false, innerHTML: '', textContent: '', clientWidth: 600,
      addEventListener(name, fn) { this[name] = fn; },
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
      append(child) { this.child = child; }, querySelectorAll() { return []; },
      querySelector(selector) {
        if (selector === 'svg' && !this.innerHTML.startsWith('<svg')) return null;
        if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector);
      },
      getAttribute(name) { return this[name] || (name === 'viewBox' ? '0 0 400 700' : null); },
    };
  }
  const root = element();
  const document = { documentElement: { dataset: { theme: 'light' } }, createElement: () => root };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'case-diagrams.js'), 'utf8'), {
    document, window, fetch: fetchImpl, URLSearchParams, AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
  });
  return { window, document, root, elements };
}

test('diagram requests follow the current theme and stale responses cannot replace the current image', async () => {
  const pending = [];
  const page = harness((url) => new Promise((resolve) => pending.push({ url, resolve })));
  const opened = [];
  const diagram = page.window.createCaseDiagram({ caseId: 'case-1', view: 'people', records: {}, relationTypes: [], onSource: (refs) => opened.push(refs) });
  const light = diagram.load();
  page.document.documentElement.dataset.theme = 'dark';
  const dark = diagram.load();
  const result = { svg: '<svg>dark diagram</svg>', sources: { p0: [{ chunkId: 'c1' }] }, notice: '候选' };
  pending[1].resolve({ ok: true, json: async () => result });
  await dark;
  pending[0].resolve({ ok: true, json: async () => ({ ...result, svg: '<svg>old diagram</svg>' }) });
  await light;
  const canvas = page.elements.get('.diagram-canvas');
  assert.equal(canvas.innerHTML, '<svg>dark diagram</svg>');
  assert.match(pending[1].url, /theme=dark/);
  canvas.click({ target: { closest: () => ({ dataset: { diagramRef: 'p0' } }) } });
  assert.equal(opened[0][0].chunkId, 'c1');
  canvas.keydown({ key: 'Enter', preventDefault() {}, target: { closest: () => ({ dataset: { diagramRef: 'p0' } }) } });
  assert.equal(opened.length, 2);
  diagram.destroy();
});

test('empty or unavailable diagrams keep original records and disable download and zoom', async () => {
  let response = { ok: true, json: async () => ({ svg: '<svg>diagram</svg>', sources: {}, notice: '候选' }) };
  const page = harness(async () => response);
  const records = { textContent: '原记录' };
  const diagram = page.window.createCaseDiagram({ caseId: 'case-1', view: 'timeline', records, onSource() {} });
  await diagram.load();
  assert.equal(page.elements.get('.diagram-download').hidden, false);
  response = { ok: false };
  await diagram.load();
  assert.equal(page.elements.get('.diagram-records').child, records);
  assert.equal(page.elements.get('.diagram-records').open, true);
  assert.equal(page.elements.get('.diagram-download').hidden, true);
  assert.equal(page.elements.get('[data-diagram-action="in"]').disabled, true);
  assert.equal(page.elements.get('.diagram-canvas').innerHTML, '');
  response = { ok: true, json: async () => ({ svg: '', sources: {}, notice: '暂无数据' }) };
  await diagram.load();
  assert.equal(page.elements.get('.diagram-notice').textContent, '暂无数据');
  assert.equal(page.elements.get('.diagram-download').hidden, true);
  assert.equal(page.elements.get('[data-diagram-action="in"]').disabled, true);
  diagram.destroy();
});

test('narrow screens start at readable size and can explicitly fit the full diagram', async () => {
  const page = harness(async () => ({ ok: true, json: async () => ({ svg: '<svg>diagram</svg>', sources: {}, notice: '候选' }) }));
  const diagram = page.window.createCaseDiagram({ caseId: 'case-1', view: 'events', records: {}, onSource() {} });
  page.elements.get('.diagram-viewport').clientWidth = 300;
  await diagram.load();
  assert.equal(page.elements.get('.diagram-scale').textContent, '100%');
  page.elements.get('[data-diagram-action="fit"]').click();
  assert.equal(page.elements.get('.diagram-scale').textContent, '67%');
  diagram.destroy();
});
