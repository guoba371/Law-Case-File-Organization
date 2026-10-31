const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samples-'));
process.env.SAMPLES_DIR = tmp;

const s = require('../src/samples');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const b64 = (str) => Buffer.from(str).toString('base64');
const base = { type: 'evidence_opinion', title: '样本一', text: '质证意见正文', confirmedRedacted: true };

test('文书类型无效被拒', () => {
  assert.throws(() => s.createSample({ ...base, type: 'other' }), /文书类型无效/);
});

test('未确认脱敏被拒', () => {
  assert.throws(() => s.createSample({ ...base, confirmedRedacted: 'true' }), /请先确认样本已脱敏/);
});

test('正文和文件都为空被拒', () => {
  assert.throws(() => s.createSample({ ...base, text: '  ' }), /请粘贴正文或上传文件/);
});

test('保存纯文本样本', () => {
  const r = s.createSample(base);
  assert.strictEqual(r.typeName, '质证意见');
  assert.strictEqual(r.textLength, 6);
  assert.strictEqual(r.file, null);
  assert.ok(fs.existsSync(path.join(tmp, `${r.id}.json`)));
});

test('保存 PDF 样本并落盘原文件', () => {
  const r = s.createSample({ ...base, type: 'detention_review', text: '', fileName: 'a.PDF', fileBase64: b64('%PDF-1.4 x') });
  assert.strictEqual(r.file.ext, 'pdf');
  assert.ok(fs.existsSync(path.join(tmp, `${r.id}.pdf`)));
});

test('TXT 未填正文时用文件内容作正文', () => {
  const r = s.createSample({ ...base, type: 'prosecution_opinion', text: '', fileName: 'b.txt', fileBase64: b64('法律意见正文') });
  assert.strictEqual(r.textLength, 6);
});

test('扩展名非法、文件头不符被拒', () => {
  assert.throws(() => s.createSample({ ...base, fileName: 'a.exe', fileBase64: b64('MZ') }), /仅支持 PDF、DOCX、TXT/);
  assert.throws(() => s.createSample({ ...base, fileName: 'a.pdf', fileBase64: b64('hello') }), /不是有效的 PDF/);
  assert.throws(() => s.createSample({ ...base, fileName: 'a.docx', fileBase64: b64('hello') }), /不是有效的 DOCX/);
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
