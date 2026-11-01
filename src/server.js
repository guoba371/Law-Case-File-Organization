// 本地后台仅监听 127.0.0.1，兼容现有文书接口并提供案件工作台 API。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { listProviders, updateProviders, testProvider } = require('./providers');
const { createSample, listSamples, deleteSample } = require('./samples');
const { generateDocument, generateCaseDocument, getDocument, listDocuments, deleteDocument, updateSectionStatus, reviseSectionContent, getDocumentTypes } = require('./documents');
const { exportDocument } = require('./document-export');
const store = require('./case-store');
const upload = require('./case-upload');
const { CASE_LIMITS } = require('./case-config');
const { createCasesService } = require('./cases');
const { createCaseQueue } = require('./case-queue');
const { renderCaseDiagram } = require('./case-diagrams');
const { createFeedbackService } = require('./feedback');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGE = path.join(PUBLIC_DIR, 'settings.html');
const SAMPLES_PAGE = path.join(PUBLIC_DIR, 'samples.html');
const DOCUMENTS_PAGE = path.join(PUBLIC_DIR, 'documents.html');
const CASES_PAGE = path.join(PUBLIC_DIR, 'cases.html');
const CASE_WORKSPACE_PAGE = path.join(PUBLIC_DIR, 'case-workspace.html');
const APP_CSS = path.join(PUBLIC_DIR, 'app.css');
const APP_JS = path.join(PUBLIC_DIR, 'app.js');
const CASES_JS = path.join(PUBLIC_DIR, 'cases.js');
const CASE_WORKSPACE_JS = path.join(PUBLIC_DIR, 'case-workspace.js');

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendDownload(res, file) {
  const encodedName = encodeURIComponent(file.fileName);
  res.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Length': file.buffer.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
    'Cache-Control': 'no-store',
  });
  res.end(file.buffer);
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('请求体过大'));
      return resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  const raw = await readBuffer(req, limit);
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    throw new Error('JSON 格式错误');
  }
}

function streamFile(res, filePath, contentType) {
  res.writeHead(200, { 'Content-Type': contentType });
  return fs.createReadStream(filePath).pipe(res);
}

function errorStatus(error) {
  if (/案件不存在|案件编号无效/.test(error.message)) return 404;
  return 400;
}

function createHttpServer(dependencies = {}) {
  const casesService = dependencies.casesService || createCasesService({ store, upload });
  const caseUpload = dependencies.caseUpload || upload;
  const caseQueue = dependencies.caseQueue || createCaseQueue({ store, processCase: casesService.processCase });
  const feedbackService = dependencies.feedbackService || createFeedbackService();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${HOST}`);
      const { pathname } = url;
      if (req.method === 'GET' && pathname === '/app.css') return streamFile(res, APP_CSS, 'text/css; charset=utf-8');
      if (req.method === 'GET' && pathname === '/app.js') return streamFile(res, APP_JS, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/cases.js') return streamFile(res, CASES_JS, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/case-workspace.js') return streamFile(res, CASE_WORKSPACE_JS, 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/case-diagrams.js') return streamFile(res, path.join(PUBLIC_DIR, 'case-diagrams.js'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && ['/people-graph.js', '/people-graph-data.js'].includes(pathname)) return streamFile(res, path.join(PUBLIC_DIR, pathname.slice(1)), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/vendor/g6.min.js') return streamFile(res, path.join(__dirname, '..', 'node_modules', '@antv', 'g6', 'dist', 'g6.min.js'), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname === '/') return streamFile(res, CASES_PAGE, 'text/html; charset=utf-8');
      if (req.method === 'GET' && pathname === '/settings') return streamFile(res, PAGE, 'text/html; charset=utf-8');
      if (req.method === 'GET' && pathname === '/cases') return streamFile(res, CASES_PAGE, 'text/html; charset=utf-8');
      if (req.method === 'GET' && /^\/cases\/[^/]+$/.test(pathname)) return streamFile(res, CASE_WORKSPACE_PAGE, 'text/html; charset=utf-8');
      if (req.method === 'GET' && pathname === '/samples') return streamFile(res, SAMPLES_PAGE, 'text/html; charset=utf-8');
      if (req.method === 'GET' && pathname === '/documents') return streamFile(res, DOCUMENTS_PAGE, 'text/html; charset=utf-8');

      if (pathname === '/api/providers' && req.method === 'GET') return send(res, 200, listProviders());
      if (pathname === '/api/providers' && req.method === 'PUT') return send(res, 200, updateProviders(await readJson(req)));
      const providerTest = pathname.match(/^\/api\/providers\/([a-z]+)\/test$/);
      if (providerTest && req.method === 'POST') return send(res, 200, await testProvider(providerTest[1]));

      if (pathname === '/api/feedback' && req.method === 'POST') {
        return send(res, 201, await feedbackService.submitFeedback(await readJson(req, 36 * 1024 * 1024)));
      }

      if (pathname === '/api/samples' && req.method === 'GET') return send(res, 200, listSamples(url.searchParams.get('type')));
      if (pathname === '/api/samples' && req.method === 'POST') return send(res, 201, await createSample(await readJson(req, 15 * 1024 * 1024)));
      const sample = pathname.match(/^\/api\/samples\/([^/]+)$/);
      if (sample && req.method === 'DELETE') return send(res, 200, deleteSample(sample[1]));

      if (pathname === '/api/doc-types' && req.method === 'GET') return send(res, 200, getDocumentTypes());
      if (pathname === '/api/documents' && req.method === 'GET') return send(res, 200, listDocuments());
      if (pathname === '/api/documents' && req.method === 'POST') return send(res, 201, await generateDocument(await readJson(req, 80 * 1024 * 1024)));
      const exportMatch = pathname.match(/^\/api\/documents\/([^/]+)\/export$/);
      if (exportMatch && req.method === 'GET') return sendDownload(res, await exportDocument(getDocument(exportMatch[1]), url.searchParams.get('format') || 'docx'));
      const documentMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
      if (documentMatch && req.method === 'GET') return send(res, 200, getDocument(documentMatch[1]));
      if (documentMatch && req.method === 'DELETE') return send(res, 200, deleteDocument(documentMatch[1]));
      const section = pathname.match(/^\/api\/documents\/([^/]+)\/sections\/([^/]+)$/);
      if (section && req.method === 'PUT') return send(res, 200, await updateSectionStatus(section[1], section[2], await readJson(req, 1024 * 1024)));
      if (section && req.method === 'POST') return send(res, 200, await reviseSectionContent(section[1], section[2], await readJson(req, 1024 * 1024)));

      if (pathname === '/api/cases' && req.method === 'GET') return send(res, 200, casesService.listCases());
      if (pathname === '/api/cases' && req.method === 'POST') return send(res, 201, casesService.createCase(await readJson(req, 1024 * 1024)));
      const initFile = pathname.match(/^\/api\/cases\/([^/]+)\/files\/init$/);
      if (initFile && req.method === 'POST') return send(res, 201, caseUpload.initFile(initFile[1], await readJson(req, 1024 * 1024)));
      const chunk = pathname.match(/^\/api\/cases\/([^/]+)\/files\/([^/]+)\/chunks\/(\d+)$/);
      if (chunk && req.method === 'PUT') {
        const buffer = await readBuffer(req, CASE_LIMITS.uploadChunkBytes + 64 * 1024);
        return send(res, 200, caseUpload.writeChunk(chunk[1], chunk[2], Number(chunk[3]), buffer));
      }
      const completeFile = pathname.match(/^\/api\/cases\/([^/]+)\/files\/([^/]+)\/complete$/);
      if (completeFile && req.method === 'POST') return send(res, 200, caseUpload.completeFile(completeFile[1], completeFile[2]));
      const processCase = pathname.match(/^\/api\/cases\/([^/]+)\/process$/);
      if (processCase && req.method === 'POST') {
        const enqueued = caseQueue.enqueue(processCase[1]);
        return send(res, 202, { status: 'queued', enqueued });
      }
      const caseStatus = pathname.match(/^\/api\/cases\/([^/]+)\/status$/);
      if (caseStatus && req.method === 'GET') return send(res, 200, caseQueue.getStatus(caseStatus[1]));
      const diagramMatch = pathname.match(new RegExp('^/api/cases/([^/]+)/diagrams/([^/]+)$'));
      if (diagramMatch && req.method === 'GET') {
        const workspace = casesService.getCaseWorkspace(diagramMatch[1]);
        const diagram = await renderCaseDiagram(workspace.views, diagramMatch[2], {
          theme: url.searchParams.get('theme'), relationType: url.searchParams.get('relationType'),
        });
        res.setHeader('Cache-Control', 'no-store');
        if (url.searchParams.get('format') === 'svg') {
          if (!diagram.svg) return send(res, 404, { error: '暂无数据' });
          return sendDownload(res, { fileName: `${diagram.title}-候选研判.svg`, contentType: 'image/svg+xml; charset=utf-8', buffer: Buffer.from(diagram.svg) });
        }
        return send(res, 200, diagram);
      }
      const caseDocuments = pathname.match(/^\/api\/cases\/([^/]+)\/documents$/);
      if (caseDocuments && req.method === 'POST') {
        const body = await readJson(req, 1024 * 1024);
        const context = casesService.getCaseDocumentContext(caseDocuments[1], { scope: body.scope || {}, maxChunks: body.maxChunks });
        return send(res, 201, await generateCaseDocument(body, context));
      }
      const caseItem = pathname.match(/^\/api\/cases\/([^/]+)$/);
      if (caseItem && req.method === 'GET') return send(res, 200, casesService.getCaseWorkspace(caseItem[1]));
      if (caseItem && req.method === 'DELETE') return send(res, 200, casesService.deleteCase(caseItem[1]));

      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, errorStatus(error), { error: error.message });
    }
  });
}

if (require.main === module) {
  const casesService = createCasesService({ store, upload });
  const caseQueue = createCaseQueue({ store, processCase: casesService.processCase });
  caseQueue.recover();
  const server = createHttpServer({ casesService, caseUpload: upload, caseQueue });
  server.listen(PORT, HOST, () => {
    console.log(`模型供应商设置：http://${HOST}:${PORT}/settings`);
    console.log(`参考样本：http://${HOST}:${PORT}/samples`);
    console.log(`文书生成：http://${HOST}:${PORT}/documents`);
  });
}

module.exports = { createHttpServer, readBuffer, readJson };
