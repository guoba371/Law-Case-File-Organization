const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-doc-review-'));
process.env.DOCUMENTS_DIR = dataDir;
const { getDocument, updateSectionStatus } = require('../src/documents');

function seedDocument(id) {
  fs.writeFileSync(path.join(dataDir, `${id}.json`), JSON.stringify({
    id,
    updatedAt: '2026-11-01T00:00:00.000Z',
    sections: [{ key: 'intro', state: 'pending', confirmHistory: [] }],
  }));
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('审阅流程只接受确认，不再接受驳回', async () => {
  seedDocument('review-flow');

  await assert.rejects(
    updateSectionStatus('review-flow', 'intro', { status: 'rejected' }),
    /状态值无效/,
  );
  assert.equal(getDocument('review-flow').sections[0].state, 'pending');

  await updateSectionStatus('review-flow', 'intro', { status: 'confirmed' });
  assert.equal(getDocument('review-flow').sections[0].state, 'confirmed');
});
