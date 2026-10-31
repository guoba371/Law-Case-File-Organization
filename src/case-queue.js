const RECOVERABLE_STATES = new Set(['queued', 'extracting', 'chunking', 'summarizing', 'analyzing', 'generating']);

function createCaseQueue({ store, processCase }) {
  const pending = [];
  const scheduled = new Set();
  let running = false;
  let idleResolvers = [];

  function resolveIdle() {
    if (running || pending.length) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  function report(caseId, patch) {
    store.updateCase(caseId, (item) => ({
      ...item,
      status: patch.stage || item.status,
      progress: { ...item.progress, ...patch },
      error: null,
    }));
  }

  async function drain() {
    if (running) return;
    running = true;
    while (pending.length) {
      const caseId = pending.shift();
      try {
        store.updateCase(caseId, (item) => ({
          ...item,
          status: 'queued',
          error: null,
          progress: { ...item.progress, stage: 'queued' },
        }));
        const result = await processCase(caseId, (patch) => report(caseId, patch));
        store.updateCase(caseId, (item) => ({
          ...item,
          ...result,
          progress: { ...item.progress, ...(result?.progress || {}) },
          error: null,
        }));
      } catch (error) {
        store.updateCase(caseId, (item) => ({
          ...item,
          status: 'failed',
          error: error.message,
          progress: { ...item.progress, stage: 'failed' },
        }));
      } finally {
        scheduled.delete(caseId);
      }
    }
    running = false;
    resolveIdle();
  }

  function enqueue(caseId) {
    store.assertRedactedConfirmed(caseId);
    if (scheduled.has(caseId)) return false;
    scheduled.add(caseId);
    pending.push(caseId);
    queueMicrotask(drain);
    return true;
  }

  function recover() {
    const recovered = [];
    for (const item of store.listCases()) {
      if (!RECOVERABLE_STATES.has(item.status)) continue;
      try {
        store.assertRedactedConfirmed(item);
      } catch (error) {
        store.updateCase(item.id, (current) => ({
          ...current,
          status: 'failed',
          error: error.message,
          progress: { ...current.progress, stage: 'failed' },
        }));
        continue;
      }
      store.updateCase(item.id, (current) => ({
        ...current,
        status: 'queued',
        progress: { ...current.progress, stage: 'queued' },
      }));
      enqueue(item.id);
      recovered.push(item.id);
    }
    return recovered;
  }

  function whenIdle() {
    if (!running && pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleResolvers.push(resolve));
  }

  function getStatus(caseId) {
    return store.getCase(caseId);
  }

  return { enqueue, getStatus, recover, whenIdle };
}

module.exports = { RECOVERABLE_STATES, createCaseQueue };
