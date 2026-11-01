const assert = require('node:assert/strict');
const test = require('node:test');
const { createHttpServer } = require('../src/server');

test('secondary pages provide an explicit route back to the case list', async (t) => {
  const server = createHttpServer({ casesService: {}, caseUpload: {}, caseQueue: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/documents', '/samples', '/settings', '/cases/example']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const main = html.slice(html.indexOf('<main'));
    assert.match(main, new RegExp('<a [^>]*href="/cases"[^>]*>.*?返回案件列表.*?</a>', 's'), route);
  }
});
