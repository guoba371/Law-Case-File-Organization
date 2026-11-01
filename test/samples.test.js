const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Document, Packer, Paragraph } = require('docx');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samples-'));
process.env.SAMPLES_DIR = tmp;

const s = require('../src/samples');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const b64 = (str) => Buffer.from(str).toString('base64');
const base = { type: 'evidence_opinion', title: '样本一', text: '质证意见正文', confirmedRedacted: true };

async function createDocx(text) {
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));
}

test('文书类型无效被拒', async () => {
  await assert.rejects(async () => s.createSample({ ...base, type: 'other' }), /文书类型无效/);
});

test('未确认脱敏被拒', async () => {
  await assert.rejects(async () => s.createSample({ ...base, confirmedRedacted: 'true' }), /请先确认样本已脱敏/);
});

test('正文和文件都为空被拒', async () => {
  await assert.rejects(async () => s.createSample({ ...base, text: '  ' }), /请粘贴正文或上传文件/);
});

test('保存纯文本样本', async () => {
  const r = await s.createSample(base);
  assert.strictEqual(r.typeName, '质证意见');
  assert.strictEqual(r.textLength, 6);
  assert.strictEqual(r.file, null);
  assert.ok(fs.existsSync(path.join(tmp, `${r.id}.json`)));
});

test('只上传 PDF 时提取正文并落盘原文件', async () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf'));
  const r = await s.createSample({ ...base, type: 'detention_review', text: '', fileName: 'a.PDF', fileBase64: file.toString('base64') });
  assert.strictEqual(r.file.ext, 'pdf');
  assert.ok(r.textLength > 0);
  assert.match(s.samplesForType('detention_review').find((sample) => sample.id === r.id).text, /Because traces are in SSA form/);
  assert.ok(fs.existsSync(path.join(tmp, `${r.id}.pdf`)));
});

test('只上传 DOCX 时提取正文用于参考', async () => {
  const file = await createDocx('DOCX reference sample wording');
  const r = await s.createSample({ ...base, text: '', fileName: 'sample.docx', fileBase64: file.toString('base64') });
  assert.match(s.samplesForType('evidence_opinion').find((sample) => sample.id === r.id).text, /DOCX reference sample wording/);
  s.deleteSample(r.id);
});

test('TXT 未填正文时用文件内容作正文', async () => {
  const r = await s.createSample({ ...base, type: 'prosecution_opinion', text: '', fileName: 'b.txt', fileBase64: b64('法律意见正文') });
  assert.strictEqual(r.textLength, 6);
});

test('扩展名非法、文件头不符被拒', async () => {
  await assert.rejects(async () => s.createSample({ ...base, fileName: 'a.exe', fileBase64: b64('MZ') }), /仅支持 PDF、DOCX、TXT/);
  await assert.rejects(async () => s.createSample({ ...base, fileName: 'a.pdf', fileBase64: b64('hello') }), /不是有效的 PDF/);
  await assert.rejects(async () => s.createSample({ ...base, fileName: 'a.docx', fileBase64: b64('hello') }), /不是有效的 DOCX/);
});

test('列表、按类型筛选，samplesForType 只返回同类型且含正文', () => {
  assert.strictEqual(s.listSamples().length, 3);
  const ev = s.listSamples('evidence_opinion');
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].text, undefined);
  const full = s.samplesForType('detention_review');
  assert.strictEqual(full.length, 1);
  assert.strictEqual(full[0].type, 'detention_review');
  assert.strictEqual(typeof full[0].text, 'string');
});

test('删除样本连同原文件，非法 id 被拒', () => {
  const [pdf] = s.listSamples('detention_review');
  assert.deepStrictEqual(s.deleteSample(pdf.id), { ok: true });
  assert.ok(!fs.existsSync(path.join(tmp, `${pdf.id}.pdf`)));
  assert.throws(() => s.deleteSample('../../settings'), /样本不存在/);
  assert.throws(() => s.deleteSample(pdf.id), /样本不存在/);
});
