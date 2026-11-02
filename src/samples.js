// 参考样本：律师确认已脱敏的本所文书样本，按文书类型归类，仅作结构与文风参考
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractCaseFile } = require('./case-files');

const TYPES = {
  evidence_opinion: '质证意见',
  prosecution_opinion: '审查起诉阶段法律意见书',
  detention_review: '羁押必要性审查申请',
};
const EXTS = ['pdf', 'docx', 'txt'];
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TEXT = 200 * 1000;

const dir = () => process.env.SAMPLES_DIR || path.join(__dirname, '..', 'data', 'samples');
const metaPath = (id) => path.join(dir(), `${id}.json`);

// 简单校验文件头，避免扩展名与内容不符
function checkMagic(ext, buf) {
  if (ext === 'pdf' && buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('不是有效的 PDF 文件');
  if (ext === 'docx' && buf.subarray(0, 2).toString() !== 'PK') throw new Error('不是有效的 DOCX 文件');
}

async function createSample({ type, title, text, fileName, fileBase64, confirmedRedacted } = {}) {
  if (!TYPES[type]) throw new Error('文书类型无效');
  if (confirmedRedacted !== true) throw new Error('请先确认样本已脱敏');
  title = String(title || '').trim();
  if (!title) throw new Error('请填写样本标题');
  text = String(text || '').trim();
  if (text.length > MAX_TEXT) throw new Error('正文过长');
  if (!text && !fileBase64) throw new Error('请粘贴正文或上传文件');

  const id = crypto.randomUUID();
  let file = null;
  if (fileBase64) {
    const ext = path.extname(String(fileName || '')).slice(1).toLowerCase();
    if (!EXTS.includes(ext)) throw new Error('仅支持 PDF、DOCX、TXT 文件');
    const buf = Buffer.from(String(fileBase64), 'base64');
    if (!buf.length) throw new Error('文件为空');
    if (buf.length > MAX_FILE) throw new Error('文件不能超过 10MB');
    checkMagic(ext, buf);
    if (!text) {
      try {
        text = (await extractCaseFile(fileName, fileBase64)).text;
      } catch (error) {
        if (/未能从案卷文件中提取文字/.test(error.message)) {
          throw new Error('未能从样本文件中提取文字，请上传含可复制文本的文件或粘贴正文', { cause: error });
        }
        throw error;
      }
    }
    if (text.length > MAX_TEXT) throw new Error('正文过长');
    file = { name: path.basename(String(fileName)), ext, size: buf.length };
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `${id}.${ext}`), buf);
  }

  const meta = { id, type, title, text, file, confirmedRedacted: true, createdAt: new Date().toISOString() };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
  return summary(meta);
}

function readAll() {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function summary(m) {
  return { id: m.id, type: m.type, typeName: TYPES[m.type], title: m.title, textLength: m.text.length, file: m.file, createdAt: m.createdAt };
}

function listSamples(type) {
  return readAll().filter((m) => !type || m.type === type).map(summary);
}

// 供后续文书生成调用：只返回同类型样本（含正文）
function samplesForType(type) {
  return readAll().filter((m) => m.type === type);
}

function deleteSample(id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new Error('样本不存在');
  if (!fs.existsSync(metaPath(id))) throw new Error('样本不存在');
  const meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
  if (meta.file) fs.rmSync(path.join(dir(), `${id}.${meta.file.ext}`), { force: true });
  fs.rmSync(metaPath(id));
  return { ok: true };
}

module.exports = { TYPES, createSample, listSamples, samplesForType, deleteSample };
