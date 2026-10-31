const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function clearModules() {
  for (const modulePath of ['../src/case-store', '../src/case-upload', '../src/cases', '../src/server']) {
    delete require.cache[require.resolve(modulePath)];
  }
}

test('案件 API 支持创建、二进制分片、处理、查询和删除', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'law-case-api-'));
  process.env.CASES_DIR = root;
  process.env.DEEPSEEK_API_KEY ||= 'test-key';
  clearModules();
  const store = require('../src/case-store');
  const upload = require('../src/case-upload');
  const { createCasesService } = require('../src/cases');
  const { createHttpServer } = require('../src/server');
  const service = createCasesService({ store, upload });
  const queue = {
    enqueue(caseId) {
      store.updateCase(caseId, (item) => ({ ...item, status: 'queued', progress: { ...item.progress, stage: 'queued' } }));
      return true;
    },
    getStatus: store.getCase,
    recover() { return []; },
  };
  const server = createHttpServer({ casesService: service, caseUpload: upload, caseQueue: queue });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const homeRes = await fetch(`${base}/`);
  assert.equal(homeRes.status, 200);
  assert.match(await homeRes.text(), /<title>案件 - 案卷研判<\/title>/);

  const createRes = await fetch(`${base}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '王某盗窃案', model: 'deepseek', redactedConfirmed: true }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.redactedConfirmed, true);

  const unconfirmedRes = await fetch(`${base}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '未确认脱敏案', model: 'deepseek' }),
  });
  assert.equal(unconfirmedRes.status, 400);
  assert.match((await unconfirmedRes.json()).error, /未脱敏材料不得上传或分析/);

  const listRes = await fetch(`${base}/api/cases`);
  assert.equal(listRes.status, 200);
  assert.equal((await listRes.json())[0].id, created.id);

  const content = Buffer.from('王某于2024年4月进入商店。');
  const initRes = await fetch(`${base}/api/cases/${created.id}/files/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '笔录.txt', size: content.length, totalChunks: 1 }),
  });
  assert.equal(initRes.status, 201);
  const file = await initRes.json();

  const chunkRes = await fetch(`${base}/api/cases/${created.id}/files/${file.id}/chunks/0`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  });
  assert.equal(chunkRes.status, 200);
  assert.equal((await chunkRes.json()).uploadedChunks, 1);

  const completeRes = await fetch(`${base}/api/cases/${created.id}/files/${file.id}/complete`, { method: 'POST' });
  assert.equal(completeRes.status, 200);
  assert.equal((await completeRes.json()).status, 'uploaded');

  const processRes = await fetch(`${base}/api/cases/${created.id}/process`, { method: 'POST' });
  assert.equal(processRes.status, 202);
  assert.equal((await processRes.json()).status, 'queued');

  const statusRes = await fetch(`${base}/api/cases/${created.id}/status`);
  assert.equal((await statusRes.json()).status, 'queued');

  const workspaceRes = await fetch(`${base}/api/cases/${created.id}`);
  assert.equal(workspaceRes.status, 200);
  assert.equal((await workspaceRes.json()).files[0].name, '笔录.txt');

  const missingRes = await fetch(`${base}/api/cases/not-a-case`);
  assert.equal(missingRes.status, 404);

  const deleteRes = await fetch(`${base}/api/cases/${created.id}`, { method: 'DELETE' });
  assert.equal(deleteRes.status, 200);
  assert.equal((await deleteRes.json()).ok, true);
});
