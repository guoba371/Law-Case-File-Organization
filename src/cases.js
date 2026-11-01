const caseStore = require('./case-store');
const caseUpload = require('./case-upload');
const { extractCasePath } = require('./case-files');
const { chunkText } = require('./text-chunker');
const analysis = require('./case-analysis');
const documentStore = require('./documents');

function createCasesService(dependencies = {}) {
  const store = dependencies.store || caseStore;
  const upload = dependencies.upload || caseUpload;
  const extract = dependencies.extractCasePath || extractCasePath;
  const makeChunks = dependencies.chunkText || chunkText;
  const summarizeChunk = dependencies.summarizeChunk || analysis.summarizeChunk;
  const mergeFileSummary = dependencies.mergeFileSummary || analysis.mergeFileSummary;
  const mergeCaseSummary = dependencies.mergeCaseSummary || analysis.mergeCaseSummary;
  const buildCaseViews = dependencies.buildCaseViews || analysis.buildCaseViews;
  const listDocuments = dependencies.listDocuments || documentStore.listDocuments;

  function replaceFile(caseId, fileId, patch) {
    const files = store.readCaseData(caseId, 'files', []);
    const index = files.findIndex((file) => file.id === fileId);
    if (index < 0) throw new Error('案卷文件不存在');
    files[index] = { ...files[index], ...patch, updatedAt: new Date().toISOString() };
    store.writeCaseData(caseId, 'files', files);
    return files[index];
  }

  async function processCase(caseId, report = () => {}) {
    const item = store.assertRedactedConfirmed(caseId);
    const files = store.readCaseData(caseId, 'files', []);
    const allChunks = [];
    const chunkSummaries = [];
    const fileSummaries = [];
    let failedFiles = 0;
    let readyFiles = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      report({ stage: 'extracting', percent: Math.floor((index / Math.max(files.length, 1)) * 70), processedFiles: index, failedFiles });
      try {
        const extracted = await extract(upload.completedFilePath(caseId, file.id), file.name);
        replaceFile(caseId, file.id, { status: 'chunking', error: null });
        const chunks = makeChunks({
          fileId: file.id,
          fileName: file.name,
          text: extracted.text,
          pages: extracted.pages,
        });
        allChunks.push(...chunks);
        store.writeCaseData(caseId, 'chunks', allChunks);

        replaceFile(caseId, file.id, { status: 'summarizing', chunkCount: chunks.length });
        const summaries = [];
        for (const chunk of chunks) {
          const summary = await summarizeChunk(chunk, item.model);
          summaries.push(summary);
          chunkSummaries.push({ chunkId: chunk.id, fileId: file.id, summary });
          store.writeCaseData(caseId, 'summaries', { chunks: chunkSummaries, files: fileSummaries, case: null });
        }
        const fileSummary = await mergeFileSummary(file, summaries, item.model);
        fileSummaries.push({ fileId: file.id, fileName: file.name, summary: fileSummary });
        store.writeCaseData(caseId, 'summaries', { chunks: chunkSummaries, files: fileSummaries, case: null });
        replaceFile(caseId, file.id, { status: 'ready', error: null });
        readyFiles += 1;
      } catch (error) {
        failedFiles += 1;
        replaceFile(caseId, file.id, {
          status: error.code === 'NEEDS_OCR' ? 'needs_ocr' : 'failed',
          error: error.message,
        });
      } finally {
        upload.removeTempFile(caseId, file.id);
      }
      report({
        stage: 'summarizing',
        percent: Math.floor(((index + 1) / Math.max(files.length, 1)) * 70),
        processedFiles: index + 1,
        failedFiles,
      });
    }

    let caseSummary = null;
    let views = { caseId, timeline: [], people: [], relations: [], events: [], evidence: [] };
    if (fileSummaries.length) {
      report({ stage: 'analyzing', percent: 85, processedFiles: files.length, failedFiles });
      caseSummary = await mergeCaseSummary(fileSummaries.map((entry) => entry.summary), item.model);
      views = buildCaseViews(caseId, caseSummary);
    }
    store.writeCaseData(caseId, 'summaries', { chunks: chunkSummaries, files: fileSummaries, case: caseSummary });
    store.writeCaseData(caseId, 'views', views);

    const status = readyFiles === files.length && files.length > 0
      ? 'ready'
      : readyFiles > 0
        ? 'partial_ready'
        : 'failed';
    const progress = {
      stage: status,
      percent: 100,
      processedFiles: files.length,
      totalFiles: files.length,
      failedFiles,
    };
    return { status, progress };
  }

  function restoreCaseViews(caseId) {
    const views = store.readCaseData(caseId, 'views', {});
    if (['timeline', 'people', 'relations', 'events', 'evidence'].some((field) => views[field]?.length)) return false;
    const summaries = store.readCaseData(caseId, 'summaries', { chunks: [], files: [], case: null });
    const candidates = summaries.chunks.map((entry) => entry.summary);
    if (!candidates.length) return false;
    const restored = analysis.mergeAnalyses(candidates);
    if (!['timeline', 'people', 'relations', 'events', 'evidence'].some((field) => restored[field].length)) return false;
    if (summaries.case?.summary) restored.summary = summaries.case.summary;
    store.writeCaseData(caseId, 'summaries', { ...summaries, case: restored });
    store.writeCaseData(caseId, 'views', buildCaseViews(caseId, restored));
    return true;
  }

  function getCaseWorkspace(caseId) {
    return {
      case: store.getCase(caseId),
      files: store.readCaseData(caseId, 'files', []),
      chunks: store.readCaseData(caseId, 'chunks', []),
      summaries: store.readCaseData(caseId, 'summaries', { chunks: [], files: [], case: null }),
      views: store.readCaseData(caseId, 'views', { timeline: [], people: [], relations: [], events: [], evidence: [] }),
      documents: listDocuments().filter((document) => document.caseId === caseId),
    };
  }

  function getCaseDocumentContext(caseId, options = {}) {
    const workspace = getCaseWorkspace(caseId);
    const scope = options.scope || {};
    const keywordValue = Array.isArray(scope.keywords) ? scope.keywords : String(options.keywords || '').split(/\s+/);
    const keywords = keywordValue.map((keyword) => String(keyword).trim()).filter(Boolean);
    const selected = [
      workspace.views.people.find((item) => item.id === scope.personId),
      workspace.views.events.find((item) => item.id === scope.eventId),
      workspace.views.evidence.find((item) => item.id === scope.evidenceId),
    ].filter(Boolean);
    const selectedChunkIds = new Set(selected.flatMap((item) => item.sourceRefs || []).map((reference) => reference.chunkId));
    const hasScope = keywords.length > 0 || selectedChunkIds.size > 0;
    const chunks = hasScope
      ? workspace.chunks.filter((chunk) => selectedChunkIds.has(chunk.id) || keywords.some((keyword) => chunk.text.includes(keyword)))
      : workspace.chunks;
    return {
      caseId,
      summary: workspace.summaries.case,
      chunks: chunks.slice(0, Number(options.maxChunks) || 12),
      scope: options.scope || null,
    };
  }

  return {
    createCase: store.createCase,
    deleteCase: store.deleteCase,
    getCaseDocumentContext,
    getCaseWorkspace,
    listCases: store.listCases,
    processCase,
    restoreCaseViews,
  };
}

module.exports = { createCasesService };
