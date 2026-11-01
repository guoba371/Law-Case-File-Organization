const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'documents.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function element(classNames = '', dataset = {}) {
  const classes = new Set(classNames.split(' ').filter(Boolean));
  const listeners = {};
  const children = [];
  return {
    dataset, style: {}, value: '', textContent: '', innerHTML: '', hidden: false, href: '', disabled: false, children,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force === true || (force === undefined && !classes.has(name))) classes.add(name);
        else classes.delete(name);
      },
    },
    addEventListener(name, handler) { listeners[name] = handler; },
    click() { return listeners.click?.({ preventDefault() {} }); },
    setAttribute(name, value) { this[name] = value; },
    append(...nodes) { children.push(...nodes); },
    appendChild(node) { children.push(node); return node; },
    replaceChildren(...nodes) { children.splice(0, children.length, ...nodes); },
  };
}

async function loadPage(search, documents = [], generatedDocument, samples = []) {
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], element()]));
  const tabs = [element('tab', { tab: 'generate' }), element('tab active', { tab: 'list' })];
  const panels = [elements['generate-panel'], elements['list-panel']];
  panels[1].classList.add('active');
  const listView = element();
  const ready = [];
  const requests = [];
  const location = new URL(`http://localhost/documents${search}`);
  const responseData = {
    '/api/doc-types': [], '/api/samples': samples,
    '/api/providers': { providers: [], active: '' },
    '/api/documents': documents,
    '/api/cases/case-1': { case: { name: 'Test case' } },
  };
  for (const document of documents) responseData[`/api/documents/${document.id}`] = document;
  const context = vm.createContext({
    URL, URLSearchParams, console, setTimeout, clearTimeout,
    window: { location },
    history: { replaceState(_state, _title, url) { location.href = new URL(url, location).href; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (options?.method === 'POST') {
        if (!generatedDocument) throw new Error('Unexpected generation request');
        responseData['/api/documents'] = [...documents, generatedDocument];
        responseData[`/api/documents/${generatedDocument.id}`] = generatedDocument;
        return { ok: true, json: async () => generatedDocument };
      }
      return { ok: true, json: async () => responseData[url] };
    },
    document: {
      addEventListener(name, handler) { if (name === 'DOMContentLoaded') ready.push(handler); },
      getElementById: (id) => elements[id],
      createElement: () => element(),
      querySelectorAll: (selector) => selector === '.tab' ? tabs : selector === '.panel' ? panels : [],
      querySelector(selector) {
        if (selector === '.list-view') return listView;
        if (selector === '.tab[data-tab="list"]') return tabs[1];
        if (selector === '.tab[data-tab="generate"]') return tabs[0];
        return null;
      },
    },
  });
  vm.runInContext(script, context);
  for (const handler of ready) handler();
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, tabs, panels, listView, location, requests };
}

test('opening a case document page provides a return link to the originating case view', async () => {
  const page = await loadPage('?caseId=case-1&view=timeline');
  assert.equal(page.elements.pageBackLink.href, '/cases/case-1?view=timeline');
  assert.equal(page.elements.pageBackLabel.textContent, '返回本案研判');
  assert.equal(page.elements.caseListLink.hidden, false);
});

test('a direct document link opens the editor and its return button restores the list', async () => {
  const page = await loadPage('?caseId=case-1&docId=doc-1', [{
    id: 'doc-1', caseId: 'case-1', typeName: 'Test document', caseFileName: 'Test case',
    status: 'draft', model: 'deepseek', sampleTitle: '本所质证意见样本', createdAt: '2026-11-01T00:00:00Z', sections: [],
  }]);
  assert.equal(page.panels[1].classList.contains('active'), true);
  assert.equal(page.elements.editView.style.display, 'block');
  assert.equal(page.elements.editDocTitle.textContent, 'Test document');
  assert.match(page.elements.editDocMeta.textContent, /参考样本：本所质证意见样本/);
  assert.equal(page.elements.pageBackLink.href, '/cases/case-1?view=documents');

  page.elements.backBtn.click();
  assert.equal(page.listView.style.display, 'block');
  assert.equal(page.elements.editView.style.display, 'none');
  assert.equal(page.location.searchParams.get('caseId'), 'case-1');
  assert.equal(page.location.searchParams.has('docId'), false);
  page.elements.refreshBtn.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.elements.editView.style.display, 'none');
  const reloaded = await loadPage(page.location.search);
  assert.equal(reloaded.panels[1].classList.contains('active'), true);
});

test('standalone and legacy document pages return safely without browser history', async () => {
  const page = await loadPage('?docId=legacy', [{
    id: 'legacy', typeName: 'Legacy document', caseFileName: 'Legacy case', status: 'draft',
    model: 'deepseek', createdAt: '2026-11-01T00:00:00Z', sections: [],
  }]);
  assert.equal(page.elements.pageBackLink.href, '/cases');
  assert.equal(page.elements.pageBackLabel.textContent, '返回案件列表');
  assert.equal(page.elements.caseListLink.hidden, true);
  assert.equal(page.elements.editDocTitle.textContent, 'Legacy document');
});

test('a document opened outside its case still links back to its actual case', async () => {
  const page = await loadPage('?docId=doc-2', [{
    id: 'doc-2', caseId: 'case-1', typeName: 'Case document', caseFileName: 'Test case',
    status: 'draft', model: 'deepseek', createdAt: '2026-11-01T00:00:00Z', sections: [],
  }]);
  assert.equal(page.elements.pageBackLink.href, '/cases/case-1?view=documents');
  assert.equal(page.elements.pageBackLabel.textContent, '返回本案文书');
});

test('invalid case view values fall back to the case document list', async () => {
  const page = await loadPage('?caseId=case-1&view=unknown');
  assert.equal(page.elements.pageBackLink.href, '/cases/case-1?view=documents');
});

test('switching from a document to drafting keeps the selected tab after reload', async () => {
  const page = await loadPage('?caseId=case-1&view=timeline&docId=doc-3', [{
    id: 'doc-3', caseId: 'case-1', typeName: 'Test document', caseFileName: 'Test case',
    status: 'draft', model: 'deepseek', createdAt: '2026-11-01T00:00:00Z', sections: [],
  }]);
  page.tabs[0].click();
  assert.equal(page.panels[0].classList.contains('active'), true);
  assert.equal(page.tabs[0]['aria-selected'], 'true');
  assert.equal(page.tabs[1]['aria-selected'], 'false');
  assert.equal(page.location.searchParams.has('docId'), false);
  assert.equal(page.location.searchParams.get('tab'), 'generate');
  assert.equal(page.location.searchParams.get('caseId'), 'case-1');
  assert.equal(page.location.searchParams.get('view'), 'timeline');
  const reloaded = await loadPage(page.location.search);
  assert.equal(reloaded.panels[0].classList.contains('active'), true);
});

test('historical documents list only unassigned documents and cannot generate new drafts', async () => {
  const page = await loadPage('', [
    { id: 'legacy', typeName: 'Legacy opinion', caseFileName: 'Old file', status: 'draft' },
    { id: 'assigned', caseId: 'case-1', typeName: 'Assigned opinion', caseFileName: 'Test case', status: 'draft' },
  ]);
  assert.equal(page.tabs[0].hidden, true);
  assert.equal(page.elements.generateBtn.disabled, true);
  assert.equal(page.panels[1].classList.contains('active'), true);
  assert.match(page.elements.docListContainer.innerHTML, /Legacy opinion/);
  assert.doesNotMatch(page.elements.docListContainer.innerHTML, /Assigned opinion/);
});

test('case drafting keeps document type visible and reset preserves the case', async () => {
  const page = await loadPage('?caseId=case-1');
  assert.doesNotMatch(html, /id="caseUpload"|id="caseContent"/);
  assert.equal(page.elements.docTypeGroup.hidden, false);
  assert.equal(page.elements.caseFileName.value, 'Test case');
  assert.equal(page.elements.caseMaterialLink.href, '/cases/case-1?view=materials');
  page.elements.clearBtn.click();
  assert.equal(page.elements.caseFileName.value, 'Test case');
  assert.equal(page.elements.generateBtn.disabled, false);
});

test('reference sample choices show the saved title and type and submit the selected sample', async () => {
  const sample = { id: 'sample-1', type: 'evidence_opinion', typeName: '质证意见', title: '本所质证意见样本' };
  const generated = { id: 'new-doc', caseId: 'case-1', typeName: '质证意见', caseFileName: 'Test case', status: 'draft', sections: [] };
  const page = await loadPage('?caseId=case-1', [], generated, [sample]);
  const option = page.elements.sampleSelect.children.find((item) => item.value === sample.id);

  assert.ok(option);
  assert.equal(option.textContent, '本所质证意见样本（质证意见）');

  page.elements.docType.value = 'evidence_opinion';
  page.elements.modelSelect.value = 'deepseek';
  page.elements.sampleSelect.value = sample.id;
  await page.elements.generateBtn.click();

  const request = page.requests.find((item) => item.options?.method === 'POST');
  assert.equal(JSON.parse(request.options.body).sampleId, sample.id);
});

test('an empty reference sample library is explicit and links to sample management', async () => {
  const page = await loadPage('?caseId=case-1');
  assert.equal(page.elements.sampleSelect.disabled, true);
  assert.equal(page.elements.sampleSelect.children[0].textContent, '暂无参考样本');
  assert.match(html, /id="sampleHelp"[\s\S]*?href="\/samples"/);
});

test('generating a case draft sends requirements to the case endpoint and opens the editor', async () => {
  const doc = { id: 'new-doc', caseId: 'case-1', typeName: 'Test opinion', caseFileName: 'Test case', status: 'draft', sections: [] };
  const page = await loadPage('?caseId=case-1&view=people', [], doc);
  page.elements.docType.value = 'evidence_opinion';
  page.elements.draftingRequirements.value = 'Review disputed statements';
  page.elements.modelSelect.value = 'deepseek';
  await page.elements.generateBtn.click();
  const request = page.requests.find((item) => item.options?.method === 'POST');
  assert.equal(request.url, '/api/cases/case-1/documents');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.caseFileName, 'Test case');
  assert.equal(payload.draftingRequirements, 'Review disputed statements');
  assert.equal('caseUploads' in payload, false);
  assert.equal(page.elements.editDocTitle.textContent, 'Test opinion');
  assert.equal(page.elements.draftingRequirements.value, 'Review disputed statements');
  assert.equal(page.elements.pageBackLink.href, '/cases/case-1?view=people');
  assert.equal(page.location.searchParams.get('docId'), 'new-doc');
});

test('direct case document links without caseId recover scope and the same-case list', async () => {
  const page = await loadPage('?docId=assigned', [
    { id: 'assigned', caseId: 'case-1', typeName: 'Assigned opinion', sections: [] },
    { id: 'legacy', typeName: 'Legacy opinion', sections: [] },
    { id: 'other', caseId: 'case-2', typeName: 'Other case opinion', sections: [] },
  ]);
  assert.equal(page.location.searchParams.get('caseId'), 'case-1');
  assert.equal(page.elements.generateBtn.disabled, false);
  page.elements.backBtn.click();
  assert.match(page.elements.docListContainer.innerHTML, /Assigned opinion/);
  assert.doesNotMatch(page.elements.docListContainer.innerHTML, /Legacy opinion|Other case opinion/);
});
