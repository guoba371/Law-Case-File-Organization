# 案件研判工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有同步文书生成页升级为可上传整案、后台分批解析、查看时间轴/人物关系/事件进展，并与法律文书双向跳转的案件研判工作台。

**Architecture:** 保持现有 Node.js 原生 HTTP 服务和静态 HTML，不引入前端框架。新增案件仓储、分片上传、持久化任务队列、文本切片、分级摘要和结构化研判模块；前端增加 `/cases` 和 `/cases/:id`，采用案件内导航与右侧来源抽屉。

**Tech Stack:** Node.js 22、原生 HTTP/HTML/CSS/JavaScript、pdf-parse、mammoth、现有 DeepSeek/Kimi/智谱 OpenAI 兼容接口、Node test runner、SVG。

**Spec:** `docs/superpowers/specs/2026-11-01-case-ingestion-analysis-design.md`

## Global Constraints

- 服务继续只监听 `127.0.0.1`。
- 只处理律师确认已经脱敏的案卷。
- 单文件不超过 100MB；单案件最多 500 份；单案件文件合计不超过 2GB。
- 上传分片固定为 5MB；原始临时文件在文字提取完成后删除。
- 扫描版或无法提取文字的文件标记为 `needs_ocr`，不得伪装为成功。
- 片段目标 12,000 字符，相邻片段重叠约 500 字符。
- 模型只接收必要片段，不接收原始文件或本地存储路径。
- 首版视图为时间轴、人物关系、事件进展和轻量证据研判。
- 所有模型关系和事实提取均标记为候选，律师确认前不能显示为确定事实。
- 现有文书、逐段确认、Word/PDF 下载和旧接口保持兼容。

---

## File Structure

- Create `src/case-config.js`: 案件容量、分片、切片和轮询常量。
- Create `src/case-store.js`: 案件、文件、片段、摘要和研判 JSON 的原子读写。
- Create `src/case-upload.js`: 分片初始化、写入、合并、文件头校验和临时文件清理。
- Create `src/text-chunker.js`: 按自然段切片并生成来源定位。
- Create `src/case-analysis.js`: 分级摘要、结构化时间轴/人物/事件/证据候选提取。
- Create `src/case-queue.js`: 串行任务队列、阶段进度、失败隔离和重启恢复。
- Create `src/cases.js`: 案件业务接口和文书生成上下文查询。
- Create `public/cases.html`: 案件列表和新建案件入口。
- Create `public/case-workspace.html`: 案件概览、材料、三类图、证据和文书页面。
- Create `public/case-workspace.js`: 案件导航、轮询、SVG 图和来源抽屉。
- Modify `src/server.js`: 注册案件、上传、处理、状态、视图和案件文书接口。
- Modify `src/case-files.js`: 支持从磁盘文件提取并返回页/段定位；保留旧 Base64 接口。
- Modify `src/documents.js`: 接收 `caseId` 和来源范围，保存 `sourceRefs`。
- Modify `public/documents.html`: 全局导航增加案件；支持按 `caseId` 筛选和跳转。
- Modify `public/samples.html`, `public/settings.html`, `public/app.css`: 统一新导航与案件工作台布局。
- Test `test/case-store.test.js`, `test/case-upload.test.js`, `test/text-chunker.test.js`, `test/case-queue.test.js`, `test/case-analysis.test.js`, `test/case-documents.test.js`, `test/case-api.test.js`.

---

### Task 1: 案件配置与持久化仓储

**Files:**
- Create: `src/case-config.js`
- Create: `src/case-store.js`
- Test: `test/case-store.test.js`

**Interfaces:**
- Produces: `createCase(input)`, `getCase(id)`, `listCases()`, `updateCase(id, updater)`, `casePaths(id)`, `deleteCase(id)`.
- Produces: `CASE_LIMITS = { maxFileBytes, maxFiles, maxCaseBytes, uploadChunkBytes, textChunkChars, textOverlapChars }`.

- [ ] **Step 1: Write failing storage tests**

```js
test('creates and atomically updates a case', () => {
  const created = store.createCase({ name: '李某诈骗案', model: 'deepseek' });
  assert.equal(created.status, 'uploading');
  store.updateCase(created.id, (item) => ({ ...item, status: 'queued' }));
  assert.equal(store.getCase(created.id).status, 'queued');
});

test('lists newest cases first and removes the whole directory', () => {
  const older = store.createCase({ name: '旧案', model: 'deepseek' });
  const newer = store.createCase({ name: '新案', model: 'deepseek' });
  assert.deepEqual(store.listCases().map((item) => item.id), [newer.id, older.id]);
  store.deleteCase(older.id);
  assert.throws(() => store.getCase(older.id), /案件不存在/);
});
```

- [ ] **Step 2: Run the storage tests and verify failure**

Run: `node --test test/case-store.test.js`
Expected: FAIL because `src/case-store.js` does not exist.

- [ ] **Step 3: Implement configuration and atomic JSON writes**

```js
const CASE_LIMITS = Object.freeze({
  maxFileBytes: 100 * 1024 * 1024,
  maxFiles: 500,
  maxCaseBytes: 2 * 1024 * 1024 * 1024,
  uploadChunkBytes: 5 * 1024 * 1024,
  textChunkChars: 12_000,
  textOverlapChars: 500,
});
```

Use `writeFileSync(tempPath)` followed by `renameSync(tempPath, targetPath)` for every JSON mutation. Store case files under `process.env.CASES_DIR || data/cases`.

- [ ] **Step 4: Run the storage tests**

Run: `node --test test/case-store.test.js`
Expected: PASS.

### Task 2: 分片上传与文件完整性

**Files:**
- Create: `src/case-upload.js`
- Test: `test/case-upload.test.js`

**Interfaces:**
- Consumes: `CASE_LIMITS`, `casePaths`, `getCase`, `updateCase`.
- Produces: `initFile(caseId, metadata)`, `writeChunk(caseId, fileId, index, buffer)`, `completeFile(caseId, fileId)`, `removeTempFile(caseId, fileId)`.

- [ ] **Step 1: Write failing chunk tests**

Test valid TXT assembly, duplicate chunk rejection, missing chunk rejection, extension/header mismatch, 100MB per-file validation, 500-file validation, and 2GB case total validation using stubbed metadata sizes rather than allocating giant buffers.

- [ ] **Step 2: Run upload tests and verify failure**

Run: `node --test test/case-upload.test.js`
Expected: FAIL because upload functions do not exist.

- [ ] **Step 3: Implement chunk upload**

Store chunks as `temp/<fileId>/<zero-padded-index>.part`. `completeFile` verifies `0..totalChunks-1`, streams them into `temp/<fileId>.complete`, checks the final byte count and magic header, and records status `uploaded` in `files.json`. Never concatenate an entire 100MB file in memory.

- [ ] **Step 4: Run upload tests**

Run: `node --test test/case-upload.test.js`
Expected: PASS.

### Task 3: 磁盘文件提取与文字切片

**Files:**
- Modify: `src/case-files.js`
- Create: `src/text-chunker.js`
- Test: `test/text-chunker.test.js`
- Modify: `test/case-files.test.js`

**Interfaces:**
- Produces: `extractCasePath(filePath, originalName) -> { name, text, pages }`.
- Produces: `chunkText({ fileId, fileName, text, pages }) -> Chunk[]`.
- `Chunk = { id, fileId, fileName, index, startChar, endChar, pageStart, pageEnd, text }`.

- [ ] **Step 1: Write failing extraction and chunk tests**

Cover: long natural paragraphs, hard split of a paragraph longer than 12,000 chars, 500-char overlap, stable chunk IDs, and source page propagation. Add a scanned/empty PDF fixture assertion that produces a typed `NEEDS_OCR` error.

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `node --test test/case-files.test.js test/text-chunker.test.js`
Expected: FAIL on missing `extractCasePath` and `chunkText`.

- [ ] **Step 3: Implement streaming-safe extraction and chunking**

For TXT and DOCX, return a single logical page when physical pages are unavailable. For PDF, use available page separation from `pdf-parse`; if the library cannot reliably preserve page boundaries, set `pageStart/pageEnd` to `null` and retain chunk number rather than inventing page numbers.

- [ ] **Step 4: Run extraction tests**

Run: `node --test test/case-files.test.js test/text-chunker.test.js`
Expected: PASS.

### Task 4: 持久化后台任务队列

**Files:**
- Create: `src/case-queue.js`
- Test: `test/case-queue.test.js`

**Interfaces:**
- Consumes: upload completion metadata and a supplied async processor.
- Produces: `createCaseQueue({ store, processCase })`, with `enqueue(caseId)`, `getStatus(caseId)`, `recover()`, `whenIdle()`.

- [ ] **Step 1: Write failing queue tests**

Cover one active job at a time, progress persistence, file-level failure isolation, duplicate enqueue prevention, and restart recovery changing `extracting|chunking|summarizing` back to `queued`.

- [ ] **Step 2: Run queue tests and verify failure**

Run: `node --test test/case-queue.test.js`
Expected: FAIL because the queue module is missing.

- [ ] **Step 3: Implement the minimal serial queue**

Do not introduce Redis or a worker framework. Persist stage, percent, processed files, failed files and `updatedAt` after each file/stage. Catch processor errors and set `failed` without crashing the HTTP server.

- [ ] **Step 4: Run queue tests**

Run: `node --test test/case-queue.test.js`
Expected: PASS.

### Task 5: 分级摘要与结构化研判提取

**Files:**
- Create: `src/llm-client.js`
- Create: `src/case-analysis.js`
- Test: `test/case-analysis.test.js`
- Modify: `src/documents.js`

**Interfaces:**
- Produces: `callChatJson(providerId, messages, options, fetchImpl)`.
- Produces: `summarizeChunk(chunk, providerId)`, `mergeFileSummary(file, summaries, providerId)`, `mergeCaseSummary(fileSummaries, providerId)`.
- Produces: `buildCaseViews(caseId, caseSummary, chunks, providerId) -> { timeline, people, relations, events, evidence }`.

- [ ] **Step 1: Write failing analysis tests with a fake fetch**

Assert that each model request contains at most one text chunk during chunk summarization, JSON fences are stripped, malformed JSON retries once, and all extracted items preserve `sourceRefs`. Test uncertain dates such as `2024年3月` remain month precision.

- [ ] **Step 2: Run analysis tests and verify failure**

Run: `node --test test/case-analysis.test.js`
Expected: FAIL because the analysis functions do not exist.

- [ ] **Step 3: Extract the shared LLM client and implement hierarchical prompts**

The structured output shape must be:

```js
{
  summary: '',
  people: [{ id, name, role, aliases, sourceRefs }],
  timeline: [{ id, date, precision, title, detail, peopleIds, category, sourceRefs }],
  relations: [{ id, from, to, type, label, confidence: 'candidate', sourceRefs }],
  events: [{ id, lane, date, title, detail, peopleIds, sourceRefs }],
  evidence: [{ id, proposition, direction, material, status: 'candidate', sourceRefs }],
}
```

Prompts explicitly forbid guilt scoring, invented dates, invented page numbers and upgrading co-mentions to criminal relationships.

- [ ] **Step 4: Run analysis and existing provider/document tests**

Run: `node --test test/case-analysis.test.js test/providers.test.js test/documents-review.test.js`
Expected: PASS.

### Task 6: 案件处理器与业务接口

**Files:**
- Create: `src/cases.js`
- Test: `test/cases.test.js`

**Interfaces:**
- Consumes: store, upload, extraction, chunking, analysis and queue modules.
- Produces: `createCase`, `listCases`, `getCaseWorkspace`, `startProcessing`, `retryFailedFiles`, `getCaseDocumentContext`, `deleteCase`.

- [ ] **Step 1: Write failing end-to-end service tests**

Use two TXT files where one is valid and one empty. Assert the valid file becomes `ready`, empty becomes `needs_ocr`, case becomes `partial_ready`, chunks and views are persisted, and temporary originals are removed.

- [ ] **Step 2: Run service tests and verify failure**

Run: `node --test test/cases.test.js`
Expected: FAIL because `src/cases.js` does not exist.

- [ ] **Step 3: Implement processing stages**

Process files independently, persist after every file, summarize available chunks, build views, then delete completed temporary files. `getCaseDocumentContext` selects the case summary plus source chunks matching document-section keywords and an optional selected person/event/evidence scope.

- [ ] **Step 4: Run service tests**

Run: `node --test test/cases.test.js`
Expected: PASS.

### Task 7: 案件 HTTP API

**Files:**
- Modify: `src/server.js`
- Test: `test/case-api.test.js`

**Interfaces:**
- Produces the exact routes in the spec plus `GET /api/cases`, `GET /api/cases/:id`, `DELETE /api/cases/:id`, and `POST /api/cases/:id/documents`.

- [ ] **Step 1: Write failing HTTP tests**

Test create, init file, raw binary chunk PUT, complete, process, poll status, workspace payload, delete and 404 handling. Verify chunk bodies are read as buffers with a 5MB plus small-header limit rather than JSON.

- [ ] **Step 2: Run API tests and verify failure**

Run: `node --test test/case-api.test.js`
Expected: FAIL with route 404 responses.

- [ ] **Step 3: Implement routes and binary body reader**

Add `readBuffer(req, limit)` next to `readJson`. Keep legacy `/api/documents` unchanged. Start the queue during server initialization and call `recover()` before listening.

- [ ] **Step 4: Run API tests and existing tests**

Run: `node --test test/case-api.test.js test/case-files.test.js test/providers.test.js`
Expected: PASS.

### Task 8: 案件列表、新建案件与上传进度

**Files:**
- Create: `public/cases.html`
- Create: `public/cases.js`
- Modify: `public/app.css`
- Modify: `public/documents.html`
- Modify: `public/samples.html`
- Modify: `public/settings.html`
- Test: `test/cases-ui.test.js`

**Interfaces:**
- Consumes: case create/list and upload endpoints.
- Produces: browser functions `createAndUploadCase()`, `uploadFileInChunks()`, `renderCaseList()`.

- [ ] **Step 1: Write static UI contract tests**

Assert all pages contain global navigation `案件/全部文书/样本/模型`, upload input has `multiple`, upload copy contains `100MB`, `500份`, `2GB`, and “超长案卷将自动分批解析”. Verify no `2MB` copy remains in the upload UI.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test test/cases-ui.test.js`
Expected: FAIL because the page and navigation do not exist.

- [ ] **Step 3: Implement upload page**

Use `file.slice(offset, offset + 5MB)` and `fetch(..., { method: 'PUT', body: blob })`. Show one aggregate progress bar plus per-file status. On successful upload call `/process` and navigate to `/cases/<id>`. Do not Base64 encode files.

- [ ] **Step 4: Run UI contract tests and parse every inline script**

Run: `node --test test/cases-ui.test.js` and use `new Function()` against inline scripts.
Expected: PASS.

### Task 9: 案件工作台与来源抽屉

**Files:**
- Create: `public/case-workspace.html`
- Create: `public/case-workspace.js`
- Modify: `public/app.css`
- Test: `test/case-workspace-ui.test.js`

**Interfaces:**
- Consumes: `GET /api/cases/:id`.
- Produces: `activateCaseView(view)`, `openSourceDrawer(sourceRefs)`, `navigateWithScope(view, scope)`, `pollCaseStatus()`.

- [ ] **Step 1: Write workspace contract tests**

Assert the seven case navigation items exist, the source drawer has file/fragment/original-excerpt fields, desktop uses `case-sidebar/main/source-drawer`, and mobile CSS converts navigation to horizontal scrolling and drawer to a bottom sheet.

- [ ] **Step 2: Run workspace UI tests and verify failure**

Run: `node --test test/case-workspace-ui.test.js`
Expected: FAIL because workspace files do not exist.

- [ ] **Step 3: Implement overview and materials views**

Render status stages, material coverage, file failures, case summary, pending-review items and generated documents. Poll every 1.5 seconds while status is not `ready|partial_ready|failed`; stop polling on terminal status or page unload.

- [ ] **Step 4: Implement source drawer and cross-view state**

Store active view, selected entity and filters in URL query parameters: `?view=timeline&person=p1&event=e4`. Browser back/forward must restore them.

- [ ] **Step 5: Run workspace UI tests**

Run: `node --test test/case-workspace-ui.test.js`
Expected: PASS.

### Task 10: 时间轴、人物关系与事件进展图

**Files:**
- Modify: `public/case-workspace.js`
- Modify: `public/app.css`
- Test: `test/case-visualizations-ui.test.js`

**Interfaces:**
- Produces: `renderTimeline(items)`, `renderPeopleGraph(people, relations)`, `renderEventLanes(events)`.

- [ ] **Step 1: Write visualization behavior tests**

Use DOM fixture data to assert unknown dates appear under “时间待确认”, clicking a timeline node calls `openSourceDrawer`, relation filters hide nonmatching edges, and five event lanes are always ordered `案件事实/人员行为/资金与物品/侦查程序/强制措施`.

- [ ] **Step 2: Run visualization tests and verify failure**

Run: `node --test test/case-visualizations-ui.test.js`
Expected: FAIL because renderers are missing.

- [ ] **Step 3: Implement timeline and event lanes**

Use semantic buttons for event nodes so keyboard users can open sources. Date precision controls formatting; never synthesize day values.

- [ ] **Step 4: Implement the SVG relationship graph**

Use deterministic circular initial layout, SVG lines and buttons layered over SVG nodes. Support zoom via `viewBox`, pointer dragging, person search and relation-type filters. Do not use edge thickness as an implicit guilt/confidence score.

- [ ] **Step 5: Run visualization tests**

Run: `node --test test/case-visualizations-ui.test.js`
Expected: PASS.

### Task 11: 证据研判与文书双向联动

**Files:**
- Modify: `src/documents.js`
- Modify: `src/cases.js`
- Modify: `src/server.js`
- Modify: `public/case-workspace.js`
- Modify: `public/documents.html`
- Test: `test/case-documents.test.js`

**Interfaces:**
- Consumes: `getCaseDocumentContext(caseId, scope)`.
- Produces: case-scoped document creation, document `caseId`, section `sourceRefs`, and URLs `/documents?caseId=<id>&docId=<id>` and `/cases/<id>?view=<view>&source=<ref>`.

- [ ] **Step 1: Write failing linkage tests**

Assert document prompts contain case summary and selected relevant chunks but exclude unrelated chunks. Assert saved sections contain `sourceRefs`, legacy documents without `caseId` still load, and case workspace lists only its documents.

- [ ] **Step 2: Run linkage tests and verify failure**

Run: `node --test test/case-documents.test.js`
Expected: FAIL because case context is not supported.

- [ ] **Step 3: Implement case-scoped generation**

Add `POST /api/cases/:id/documents` with `{ docType, draftingRequirements, sampleId, model, scope }`. Reuse the existing section parser and review flow, but build prompts from selected case context.

- [ ] **Step 4: Implement cross-navigation UI**

Add “生成文书” to every analysis view. Add source tags under each document section. Source tags link back to the case workspace and automatically open the source drawer.

- [ ] **Step 5: Run linkage and export tests**

Run: `node --test test/case-documents.test.js test/document-export.test.js test/documents-review.test.js`
Expected: PASS.

### Task 12: 完成度、隐私和回归验证

**Files:**
- Modify: relevant source and tests only when verification finds defects.
- Test: all `test/*.test.js` and API smoke scripts.

**Interfaces:**
- Verifies all prior task interfaces together.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: all tests pass with no skipped tests.

- [ ] **Step 2: Run dependency and secret checks**

Run: `npm audit --omit=dev` and `rg -n "sk-[A-Za-z0-9]\{10,\}" public src test docs --glob '!*.env*'`
Expected: zero vulnerabilities and no exposed API key.

- [ ] **Step 3: Run a local end-to-end smoke case**

Create a test case with at least two TXT files totaling more than the former 2MB text limit, process it with a mocked model endpoint, open all seven workspace views, generate a document, modify and confirm a section, then download DOCX and PDF.

- [ ] **Step 4: Verify cleanup and backward compatibility**

Confirm processed temp originals are deleted, deleting the case removes its entire case directory, old documents still open, and `/api/documents` legacy generation still passes.

- [ ] **Step 5: Restart the local service and verify routes**

Verify HTTP 200 for `/cases`, `/documents`, `/samples`, `/settings` and one `/cases/<id>` workspace. Confirm the task queue recovers an interrupted test case.

