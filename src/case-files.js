const path = require('node:path');
const fs = require('node:fs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const ALLOWED_EXTS = ['pdf', 'docx', 'txt'];
const MAX_FILES = 20;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL_FILE = 50 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;

function decodeFile(fileName, fileBase64) {
  const ext = path.extname(String(fileName || '')).slice(1).toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) throw new Error('案卷仅支持 PDF、DOCX、TXT 文件');
  const buffer = Buffer.from(String(fileBase64 || ''), 'base64');
  if (!buffer.length) throw new Error('上传的案卷文件为空');
  if (buffer.length > MAX_FILE) throw new Error('单个案卷文件不能超过 20MB');
  if (ext === 'pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('不是有效的 PDF 文件');
  if (ext === 'docx' && buffer.subarray(0, 2).toString() !== 'PK') throw new Error('不是有效的 DOCX 文件');
  return { ext, buffer, name: path.basename(String(fileName)) };
}

async function extractCaseFile(fileName, fileBase64) {
  const { ext, buffer, name } = decodeFile(fileName, fileBase64);
  let text = '';
  if (ext === 'txt') text = buffer.toString('utf8');
  if (ext === 'pdf') text = (await pdf(buffer)).text;
  if (ext === 'docx') text = (await mammoth.extractRawText({ buffer })).value;
  text = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('未能从案卷文件中提取文字，请确认文件包含可复制文本');
  if (text.length > MAX_TEXT) throw new Error('案卷提取文字超过 2MB，请拆分文件后上传');
  return { name, text };
}

function needsOcrError() {
  const error = new Error('未能从案卷文件中提取文字，需要 OCR');
  error.code = 'NEEDS_OCR';
  return error;
}

async function extractBuffer(fileName, buffer) {
  const ext = path.extname(String(fileName || '')).slice(1).toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) throw new Error('案卷仅支持 PDF、DOCX、TXT 文件');
  let text = '';
  if (ext === 'txt') text = buffer.toString('utf8');
  if (ext === 'pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('不是有效的 PDF 文件');
    text = (await pdf(buffer)).text;
  }
  if (ext === 'docx') {
    if (buffer.subarray(0, 2).toString() !== 'PK') throw new Error('不是有效的 DOCX 文件');
    text = (await mammoth.extractRawText({ buffer })).value;
  }
  text = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw needsOcrError();
  return {
    name: path.basename(String(fileName)),
    text,
    pages: [{ page: 1, startChar: 0, endChar: text.length }],
  };
}

async function extractCasePath(filePath, originalName) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error('案卷文件不存在');
  const buffer = fs.readFileSync(filePath);
  return extractBuffer(originalName, buffer);
}

async function extractCaseFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return [];
  if (files.length > MAX_FILES) throw new Error(`案卷文件最多上传 ${MAX_FILES} 份`);

  const totalBytes = files.reduce((sum, file) => {
    return sum + Buffer.from(String(file?.base64 || ''), 'base64').length;
  }, 0);
  if (totalBytes > MAX_TOTAL_FILE) throw new Error('案卷文件合计不能超过 50MB');

  const extracted = [];
  for (const file of files) {
    extracted.push(await extractCaseFile(file?.name, file?.base64));
  }
  return extracted;
}

module.exports = {
  ALLOWED_EXTS,
  MAX_FILES,
  MAX_FILE,
  MAX_TOTAL_FILE,
  extractBuffer,
  extractCaseFile,
  extractCaseFiles,
  extractCasePath,
};
