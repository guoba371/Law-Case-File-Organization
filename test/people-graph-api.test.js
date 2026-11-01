const assert = require('node:assert/strict');
const test = require('node:test');
const { createHttpServer } = require('../src/server');

test('workspace serves its person graph assets locally without a CDN', async (t) => {
  const server = createHttpServer({ casesService: {}, caseQueue: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/people-graph-data.js', '/people-graph.js', '/vendor/g6.min.js']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.ok((await response.text()).length > 100);
  }
  const html = await (await fetch(base + '/cases/synthetic')).text();
  assert.match(html, /src="\/people-graph-data.js"/);
  assert.match(html, /src="\/people-graph.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});
