const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CASES_DIR = process.env.CASES_DIR || path.join(__dirname, '..', 'data', 'cases');
const CASE_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const REDACTION_REQUIRED_MESSAGE = '请确认案卷已完成必要脱敏，未脱敏材料不得上传或分析';

function assertCaseId(caseId) {
  if (!CASE_ID_PATTERN.test(String(caseId || ''))) throw new Error('案件编号无效');
}

function casePaths(caseId) {
  assertCaseId(caseId);
  const root = path.join(CASES_DIR, caseId);
  return {
    root,
    caseFile: path.join(root, 'case.json'),
    filesFile: path.join(root, 'files.json'),
    chunksFile: path.join(root, 'chunks.json'),
    summariesFile: path.join(root, 'summaries.json'),
    viewsFile: path.join(root, 'views.json'),
    tempDir: path.join(root, 'temp'),
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createCase(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('案件名称不能为空');
  if (input.redactedConfirmed !== true) throw new Error(REDACTION_REQUIRED_MESSAGE);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const item = {
    id,
    name,
    model: String(input.model || 'deepseek'),
    redactedConfirmed: true,
    docType: input.docType || null,
    draftingRequirements: String(input.draftingRequirements || '').trim(),
    supplementaryText: String(input.supplementaryText || '').trim(),
    status: 'uploading',
    progress: { stage: 'uploading', percent: 0, processedFiles: 0, totalFiles: 0, failedFiles: 0 },
    createdAt: now,
    updatedAt: now,
  };
  const paths = casePaths(id);
  fs.mkdirSync(paths.tempDir, { recursive: true });
  atomicWriteJson(paths.caseFile, item);
  atomicWriteJson(paths.filesFile, []);
  atomicWriteJson(paths.chunksFile, []);
  atomicWriteJson(paths.summariesFile, { chunks: [], files: [], case: null });
  atomicWriteJson(paths.viewsFile, { timeline: [], people: [], relations: [], events: [], evidence: [] });
  return item;
}

function assertRedactedConfirmed(itemOrId) {
  const item = typeof itemOrId === 'string' ? getCase(itemOrId) : itemOrId;
  if (!item || item.redactedConfirmed !== true) throw new Error(REDACTION_REQUIRED_MESSAGE);
  return item;
}

function getCase(caseId) {
  const filePath = casePaths(caseId).caseFile;
  if (!fs.existsSync(filePath)) throw new Error('案件不存在');
  return readJson(filePath);
}

function updateCase(caseId, updater) {
  const current = getCase(caseId);
  const next = updater({ ...current });
  if (!next || next.id !== current.id) throw new Error('案件更新结果无效');
  next.updatedAt = new Date().toISOString();
  atomicWriteJson(casePaths(caseId).caseFile, next);
  return next;
}

function listCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && CASE_ID_PATTERN.test(entry.name))
    .map((entry) => {
      try {
        return getCase(entry.name);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function deleteCase(caseId) {
  const paths = casePaths(caseId);
  if (!fs.existsSync(paths.root)) throw new Error('案件不存在');
  fs.rmSync(paths.root, { recursive: true, force: true });
  return { ok: true };
}

function readCaseData(caseId, key, fallback) {
  const paths = casePaths(caseId);
  const mapping = { files: paths.filesFile, chunks: paths.chunksFile, summaries: paths.summariesFile, views: paths.viewsFile };
  if (!mapping[key]) throw new Error('案件数据类型无效');
  return readJson(mapping[key], fallback);
}

function writeCaseData(caseId, key, value) {
  const paths = casePaths(caseId);
  const mapping = { files: paths.filesFile, chunks: paths.chunksFile, summaries: paths.summariesFile, views: paths.viewsFile };
  if (!mapping[key]) throw new Error('案件数据类型无效');
  atomicWriteJson(mapping[key], value);
  return value;
}

module.exports = {
  CASES_DIR,
  REDACTION_REQUIRED_MESSAGE,
  assertRedactedConfirmed,
  atomicWriteJson,
  casePaths,
  createCase,
  deleteCase,
  getCase,
  listCases,
  readCaseData,
  updateCase,
  writeCaseData,
};
