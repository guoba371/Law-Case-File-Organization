const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

async function loadWorkspace(search = '') {
  const elements = {};
  const listeners = {};
  function element(id = '', dataset = {}) {
    const classes = new Set();
    return {
      id, dataset, hidden: false, style: {}, textContent: '', innerHTML: '', href: '',
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name),
      },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      addEventListener(name, callback) { this[name] = callback; },
      replaceChildren() {}, append() {},
      querySelectorAll: () => [],
    };
  }
  const buttons = ['overview', 'materials', 'analysis', 'documents', 'timeline', 'people', 'events', 'evidence'].map((view, index) => element('', { caseView: view, ...(index < 4 ? { caseSection: view } : {}) }));
  const location = new URL(`http://localhost/cases/case-1${search}`);
  const workspace = {
    case: { id: 'case-1', name: 'Test case', model: 'deepseek', status: 'ready', progress: { percent: 100 } },
    files: [], documents: [], summaries: {},
    chunks: [{ id: 'chunk-1', fileName: 'Test.txt', text: 'Synthetic source', pageStart: 1, pageEnd: 1 }],
    views: { timeline: [], people: [], relations: [], events: [], evidence: [] },
  };
  const context = vm.createContext({
    URLSearchParams, location, console, setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => workspace }),
    history: { pushState(_state, _title, url) { location.href = new URL(url, location).href; } },
    window: { addEventListener(name, callback) { listeners[name] = callback; } },
    document: {
      addEventListener(name, callback) { listeners[name] = callback; },
      getElementById: (id) => elements[id] ||= element(id),
      querySelectorAll: () => buttons, createElement: () => element(),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'case-workspace.js'), 'utf8'), context);
  await listeners.DOMContentLoaded();
  return { elements, buttons, location, listeners };
}

test('analysis views keep their group selected and restore the last view after visiting documents', async () => {
  const page = await loadWorkspace('?view=people');
  assert.equal(page.buttons[2]['aria-current'], 'page');
  assert.equal(page.elements.analysisNavigation.hidden, false);
  page.buttons[3].click();
  assert.equal(page.elements.analysisNavigation.hidden, true);
  page.buttons[2].click();
  assert.equal(page.location.searchParams.get('view'), 'people');
  page.location.searchParams.set('view', 'materials');
  page.listeners.popstate();
  assert.equal(page.elements.analysisNavigation.hidden, true);
  assert.equal(page.buttons[1]['aria-current'], 'page');
});

test('a source deep link opens its material and offers a direct return to the originating document', async () => {
  const page = await loadWorkspace('?view=overview&source=chunk-1&returnDoc=doc-1');
  assert.equal(page.elements.sourceExcerpt.textContent, 'Synthetic source');
  assert.equal(page.elements.sourceDrawer['aria-hidden'], 'false');
  assert.equal(page.elements.returnDocumentLink.href, '/documents?caseId=case-1&docId=doc-1');
  assert.equal(page.elements.returnDocumentLink.hidden, false);
  page.buttons[1].click();
  assert.equal(page.location.searchParams.has('source'), false);
  assert.equal(page.elements.sourceDrawer['aria-hidden'], 'true');
});
