const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createEmailNotifier, createFeedbackService } = require('../src/feedback');
const { createHttpServer } = require('../src/server');

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('feedback-fixture'),
]);

function image(overrides = {}) {
  return {
    name: '页面问题.png',
    type: 'image/png',
    data: png.toString('base64'),
    ...overrides,
  };
}

test('反馈先保存文字和图片，再发送带附件的邮件通知', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-feedback-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  let notification;
  const service = createFeedbackService({
    rootDir,
    notify: async (payload) => { notification = payload; },
  });

  const result = await service.submitFeedback({
    description: '案件列表中的状态文字显示不完整。',
    pageUrl: '/cases',
    images: [image()],
  });

  assert.equal(result.notificationStatus, 'sent');
  const feedbackDir = path.join(rootDir, result.id);
  const metadata = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'feedback.json'), 'utf8'));
  assert.equal(metadata.description, '案件列表中的状态文字显示不完整。');
  assert.equal(metadata.pageUrl, '/cases');
  assert.equal(metadata.notificationStatus, 'sent');
  assert.equal(metadata.images.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(feedbackDir, metadata.images[0].fileName)), png);
  assert.equal(notification.feedback.id, result.id);
  assert.equal(notification.attachments.length, 1);
  assert.equal(notification.attachments[0].path, path.join(feedbackDir, metadata.images[0].fileName));
});

test('邮件发送失败时仍保留反馈并返回可识别状态', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-feedback-failed-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const service = createFeedbackService({
    rootDir,
    notify: async () => { throw new Error('SMTP unavailable'); },
  });

  const result = await service.submitFeedback({ description: '提交按钮没有响应。', images: [] });

  assert.equal(result.notificationStatus, 'failed');
  const metadata = JSON.parse(fs.readFileSync(path.join(rootDir, result.id, 'feedback.json'), 'utf8'));
  assert.equal(metadata.notificationStatus, 'failed');
  assert.ok(metadata.notificationError);
});

test('邮件账号或收件人未配置时不会使用代码中的默认地址', async () => {
  const notify = createEmailNotifier({
    FEEDBACK_SMTP_PASS: 'test-auth-code',
    FEEDBACK_SMTP_HOST: '127.0.0.1',
    FEEDBACK_SMTP_PORT: '1',
  });

  await assert.rejects(
    () => notify({ feedback: {}, attachments: [] }),
    (error) => error.code === 'SMTP_NOT_CONFIGURED',
  );
});

test('反馈拒绝空描述、非法图片和超出数量上限的图片', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'law-feedback-validation-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const service = createFeedbackService({ rootDir, notify: async () => {} });

  await assert.rejects(() => service.submitFeedback({ description: ' ', images: [] }), /请填写问题描述/);
  await assert.rejects(
    () => service.submitFeedback({ description: '图片格式错误', images: [image({ type: 'image/gif' })] }),
    /仅支持 PNG、JPG 或 WEBP/,
  );
  await assert.rejects(
    () => service.submitFeedback({ description: '图片数量过多', images: Array.from({ length: 6 }, () => image()) }),
    /最多上传 5 张图片/,
  );
});

test('反馈 API 接收首页提交内容并返回邮件通知状态', async (t) => {
  let received;
  const feedbackService = {
    async submitFeedback(body) {
      received = body;
      return { id: 'feedback-1', notificationStatus: 'sent', submittedAt: '2026-11-01T00:00:00.000Z' };
    },
  };
  const server = createHttpServer({ casesService: {}, caseUpload: {}, caseQueue: {}, feedbackService });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: '首页反馈', pageUrl: '/cases', images: [image()] }),
  });

  assert.equal(response.status, 201);
  assert.equal((await response.json()).notificationStatus, 'sent');
  assert.equal(received.description, '首页反馈');
  assert.equal(received.images.length, 1);
});
