const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CASE_LIMITS } = require('./case-config');
const store = require('./case-store');

const ALLOWED_EXTS = new Set(['.pdf', '.docx', '.txt']);

function safeFileName(value) {
  const name = path.basename(String(value || '')).replace(/[<>:"/\|?*\u0000-\u001f]/g, '-').trim();
  if (!name) throw new Error('文件名不能为空');
  return name;
}

function getFile(caseId, fileId) {
  const files = store.readCaseData(caseId, 'files', []);
  const file = files.find((item) => item.id === fileId);
  if (!file) throw new Error('案卷文件不存在');
  return { files, file };
}

function chunkDirectory(caseId, fileId) {
  return path.join(store.casePaths(caseId).tempDir, fileId);
}

function completedFilePath(caseId, fileId) {
  return path.join(store.casePaths(caseId).tempDir, `${fileId}.complete`);
}

function initFile(caseId, metadata = {}) {
  store.assertRedactedConfirmed(caseId);
  const name = safeFileName(metadata.name);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error('案卷仅支持 PDF、DOCX、TXT 文件');
  const size = Number(metadata.size);
  const totalChunks = Number(metadata.totalChunks);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('文件大小无效');
  if (size > CASE_LIMITS.maxFileBytes) throw new Error('单文件不能超过 100MB');
  if (!Number.isSafeInteger(totalChunks) || totalChunks <= 0) throw new Error('分片数量无效');
  if (totalChunks > size) throw new Error('分片数量与文件大小不匹配');

  const files = store.readCaseData(caseId, 'files', []);
  if (files.length >= CASE_LIMITS.maxFiles) throw new Error('单案件最多 500 份文件');
  const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalSize + size > CASE_LIMITS.maxCaseBytes) throw new Error('单案件文件合计不能超过 2GB');

  const file = {
    id: crypto.randomUUID(),
    name,
    ext: ext.slice(1),
    size,
    totalChunks,
    uploadedChunks: 0,
    status: 'uploading',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  files.push(file);
  store.writeCaseData(caseId, 'files', files);
  fs.mkdirSync(chunkDirectory(caseId, file.id), { recursive: true });
  store.updateCase(caseId, (item) => ({
    ...item,
    progress: { ...item.progress, totalFiles: files.length },
  }));
  return file;
}

function writeChunk(caseId, fileId, index, buffer) {
  store.assertRedactedConfirmed(caseId);
  const { files, file } = getFile(caseId, fileId);
  const chunkIndex = Number(index);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= file.totalChunks) {
    throw new Error('分片序号无效');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('分片内容为空');
  if (buffer.length > CASE_LIMITS.uploadChunkBytes) throw new Error('单个分片不能超过 5MB');
  const target = path.join(chunkDirectory(caseId, fileId), `${String(chunkIndex).padStart(6, '0')}.part`);
  if (fs.existsSync(target)) throw new Error('分片已上传');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer, { flag: 'wx' });
  file.uploadedChunks += 1;
  file.updatedAt = new Date().toISOString();
  store.writeCaseData(caseId, 'files', files);
  return { ok: true, uploadedChunks: file.uploadedChunks, totalChunks: file.totalChunks };
}

function validateHeader(filePath, ext) {
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(5);
  const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
  fs.closeSync(fd);
  const prefix = header.subarray(0, bytesRead);
  if (ext === 'pdf' && prefix.subarray(0, 5).toString() !== '%PDF-') throw new Error('不是有效的 PDF 文件');
  if (ext === 'docx' && prefix.subarray(0, 2).toString() !== 'PK') throw new Error('不是有效的 DOCX 文件');
}

function completeFile(caseId, fileId) {
  store.assertRedactedConfirmed(caseId);
  const { files, file } = getFile(caseId, fileId);
  const sourceDir = chunkDirectory(caseId, fileId);
  for (let index = 0; index < file.totalChunks; index += 1) {
    const part = path.join(sourceDir, `${String(index).padStart(6, '0')}.part`);
    if (!fs.existsSync(part)) throw new Error(`缺少分片 ${index}`);
  }

  const target = completedFilePath(caseId, fileId);
  const output = fs.openSync(target, 'w');
  try {
    for (let index = 0; index < file.totalChunks; index += 1) {
      const part = path.join(sourceDir, `${String(index).padStart(6, '0')}.part`);
      const input = fs.openSync(part, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        let bytesRead;
        while ((bytesRead = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
          fs.writeSync(output, buffer, 0, bytesRead);
        }
      } finally {
        fs.closeSync(input);
      }
    }
  } finally {
    fs.closeSync(output);
  }

  const actualSize = fs.statSync(target).size;
  if (actualSize !== file.size) {
    fs.rmSync(target, { force: true });
    throw new Error('文件大小不一致');
  }
  try {
    validateHeader(target, file.ext);
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  }

  fs.rmSync(sourceDir, { recursive: true, force: true });
  file.status = 'uploaded';
  file.uploadedChunks = file.totalChunks;
  file.updatedAt = new Date().toISOString();
  store.writeCaseData(caseId, 'files', files);
  return file;
}

function removeTempFile(caseId, fileId) {
  fs.rmSync(chunkDirectory(caseId, fileId), { recursive: true, force: true });
  fs.rmSync(completedFilePath(caseId, fileId), { force: true });
}

module.exports = {
  chunkDirectory,
  completeFile,
  completedFilePath,
  initFile,
  removeTempFile,
  safeFileName,
  writeChunk,
};
