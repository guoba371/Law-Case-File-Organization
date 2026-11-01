const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/png': { extension: 'png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { extension: 'jpg', signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/webp': { extension: 'webp', signature: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
};

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function normalizePageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/cases';
  try {
    const url = new URL(raw, 'http://localhost');
    return `${url.pathname}${url.search}`.slice(0, 1000);
  } catch {
    return '/cases';
  }
}

function decodeImage(input, index) {
  const type = String(input?.type || '').toLowerCase();
  const imageType = IMAGE_TYPES[type];
  if (!imageType) throw new Error('截图仅支持 PNG、JPG 或 WEBP 格式');
  if (typeof input.data !== 'string' || !input.data) throw new Error(`第 ${index + 1} 张截图内容为空`);
  const buffer = Buffer.from(input.data, 'base64');
  if (!buffer.length || !imageType.signature(buffer)) throw new Error(`第 ${index + 1} 张截图内容与格式不符`);
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 5MB');
  return {
    buffer,
    type,
    originalName: path.basename(String(input.name || `截图-${index + 1}`)).replace(/[\u0000-\u001f]/g, '').slice(0, 120),
    fileName: `image-${String(index + 1).padStart(2, '0')}.${imageType.extension}`,
  };
}

function createEmailNotifier(env = process.env) {
  return async function notifyByEmail({ feedback, attachments }) {
    const user = env.FEEDBACK_SMTP_USER;
    const recipient = env.FEEDBACK_NOTIFY_EMAIL;
    const pass = env.FEEDBACK_SMTP_PASS;
    if (!user || !recipient || !pass) {
      const error = new Error('反馈邮件服务尚未配置');
      error.code = 'SMTP_NOT_CONFIGURED';
      throw error;
    }
    const port = Number(env.FEEDBACK_SMTP_PORT || 465);
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: env.FEEDBACK_SMTP_HOST || 'smtp.qq.com',
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: `案卷研判反馈 <${user}>`,
      to: recipient,
      subject: `[案卷研判] 新问题反馈 ${feedback.id}`,
      text: [
        '收到一条新的问题反馈。',
        '',
        `提交时间：${feedback.submittedAt}`,
        `页面：${feedback.pageUrl}`,
        `编号：${feedback.id}`,
        '',
        feedback.description,
      ].join('\n'),
      attachments: attachments.map((item) => ({ filename: item.originalName, path: item.path, contentType: item.type })),
    });
  };
}

function createFeedbackService(options = {}) {
  const rootDir = options.rootDir || process.env.FEEDBACK_DIR || path.join(__dirname, '..', 'data', 'feedback');
  const notify = options.notify || createEmailNotifier(options.env || process.env);

  async function submitFeedback(input = {}) {
    const description = String(input.description || '').trim();
    if (!description) throw new Error('请填写问题描述');
    if (description.length > MAX_DESCRIPTION_LENGTH) throw new Error('问题描述不能超过 5000 字');
    const images = Array.isArray(input.images) ? input.images : [];
    if (images.length > MAX_IMAGES) throw new Error('最多上传 5 张图片');
    const decodedImages = images.map(decodeImage);

    const id = crypto.randomUUID();
    const submittedAt = new Date().toISOString();
    const feedbackDir = path.join(rootDir, id);
    fs.mkdirSync(feedbackDir, { recursive: true });
    const savedImages = decodedImages.map((image) => {
      const imagePath = path.join(feedbackDir, image.fileName);
      fs.writeFileSync(imagePath, image.buffer);
      return { fileName: image.fileName, originalName: image.originalName, type: image.type, size: image.buffer.length, path: imagePath };
    });
    const feedback = {
      id,
      description,
      pageUrl: normalizePageUrl(input.pageUrl),
      submittedAt,
      notificationStatus: 'pending',
      images: savedImages.map(({ path: _path, ...image }) => image),
    };
    const metadataPath = path.join(feedbackDir, 'feedback.json');
    atomicWriteJson(metadataPath, feedback);

    try {
      await notify({ feedback, attachments: savedImages });
      feedback.notificationStatus = 'sent';
    } catch (error) {
      feedback.notificationStatus = error.code === 'SMTP_NOT_CONFIGURED' ? 'not_configured' : 'failed';
      feedback.notificationError = error.code === 'SMTP_NOT_CONFIGURED' ? '反馈邮件服务尚未配置' : '邮件发送失败';
    }
    atomicWriteJson(metadataPath, feedback);
    return { id, submittedAt, notificationStatus: feedback.notificationStatus };
  }

  return { submitFeedback };
}

module.exports = {
  MAX_DESCRIPTION_LENGTH,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  createEmailNotifier,
  createFeedbackService,
};
