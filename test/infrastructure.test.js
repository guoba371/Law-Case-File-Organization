// 测试配置、日志、错误处理和速率限制
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { config, validateConfig, getActiveProviders } = require('../src/config');
const { Logger } = require('../src/logger');
const { ValidationError, NotFoundError, validate } = require('../src/errors');
const { RateLimiter } = require('../src/rate-limiter');

describe('配置管理', () => {
  it('应该加载默认配置', () => {
    assert.strictEqual(config.server.host, '127.0.0.1');
    assert.strictEqual(typeof config.server.port, 'number');
    assert.ok(config.server.port > 0 && config.server.port <= 65535);
  });

  it('应该返回激活的供应商列表', () => {
    const active = getActiveProviders();
    assert.ok(Array.isArray(active));
  });

  it('应该验证配置', () => {
    assert.strictEqual(typeof validateConfig, 'function');
    assert.doesNotThrow(() => validateConfig());
  });
});

describe('日志系统', () => {
  it('应该创建日志实例', () => {
    const logger = new Logger({ level: 'debug', enableConsole: false, enableFile: false });
    assert.ok(logger);
  });

  it('应该过滤敏感信息', () => {
    const logger = new Logger({ level: 'debug', enableConsole: false, enableFile: false });
    const sanitized = logger._sanitizeMeta({
      apiKey: 'secret',
      DEEPSEEK_API_KEY: 'secret',
      FEEDBACK_SMTP_PASS: 'secret',
      name: 'test',
    });
    assert.strictEqual(sanitized.apiKey, '***REDACTED***');
    assert.strictEqual(sanitized.DEEPSEEK_API_KEY, '***REDACTED***');
    assert.strictEqual(sanitized.FEEDBACK_SMTP_PASS, '***REDACTED***');
    assert.strictEqual(sanitized.name, 'test');
  });

  it('应该过滤嵌套敏感信息', () => {
    const logger = new Logger({ level: 'debug', enableConsole: false, enableFile: false });
    const sanitized = logger._sanitizeMeta({
      user: { token: 'secret', id: 123 },
    });
    assert.strictEqual(sanitized.user.token, '***REDACTED***');
    assert.strictEqual(sanitized.user.id, 123);
  });
});

describe('错误处理', () => {
  it('应该创建验证错误', () => {
    const error = new ValidationError('字段验证失败');
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.code, 'VALIDATION_ERROR');
    assert.ok(error.isOperational);
  });

  it('应该创建 404 错误', () => {
    const error = new NotFoundError('案件');
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.message, '案件不存在');
  });

  it('应该验证必需字段', () => {
    assert.throws(() => validate.required(null, '字段名'), ValidationError);
    assert.throws(() => validate.required('', '字段名'), ValidationError);
    assert.strictEqual(validate.required('value', '字段名'), 'value');
  });

  it('应该验证字符串', () => {
    assert.throws(() => validate.string(123, '字段名'), ValidationError);
    assert.throws(() => validate.string('ab', '字段名', { minLength: 3 }), ValidationError);
    assert.throws(() => validate.string('abcdef', '字段名', { maxLength: 5 }), ValidationError);
    assert.strictEqual(validate.string('test', '字段名'), 'test');
  });

  it('应该验证数字', () => {
    assert.strictEqual(validate.number('123', '字段名'), 123);
    assert.throws(() => validate.number('abc', '字段名'), ValidationError);
    assert.throws(() => validate.number('5', '字段名', { min: 10 }), ValidationError);
    assert.throws(() => validate.number('100', '字段名', { max: 50 }), ValidationError);
  });

  it('应该验证枚举值', () => {
    assert.strictEqual(validate.enum('a', '字段名', ['a', 'b', 'c']), 'a');
    assert.throws(() => validate.enum('d', '字段名', ['a', 'b', 'c']), ValidationError);
  });

  it('应该验证文件扩展名', () => {
    assert.strictEqual(validate.fileExtension('test.pdf', ['.pdf', '.doc']), '.pdf');
    assert.throws(() => validate.fileExtension('test.exe', ['.pdf', '.doc']), ValidationError);
  });

  it('应该验证 UUID', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    assert.strictEqual(validate.uuid(validUuid, '字段名'), validUuid);
    assert.throws(() => validate.uuid('not-a-uuid', '字段名'), ValidationError);
  });
});

describe('速率限制', () => {
  it('应该创建速率限制器', () => {
    const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 10 });
    assert.ok(limiter);
    limiter.stop();
  });

  it('应该允许在限制内的请求', () => {
    const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 5 });
    const req = { socket: { remoteAddress: '127.0.0.1' } };

    const info1 = limiter.check(req);
    assert.strictEqual(info1.current, 1);
    assert.strictEqual(info1.remaining, 4);

    const info2 = limiter.check(req);
    assert.strictEqual(info2.current, 2);
    assert.strictEqual(info2.remaining, 3);

    limiter.stop();
  });

  it('应该拒绝超过限制的请求', () => {
    const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 2 });
    const req = { socket: { remoteAddress: '127.0.0.1' } };

    limiter.check(req);
    limiter.check(req);

    assert.throws(
      () => limiter.check(req),
      (err) => {
        return err.message.includes('请求过于频繁');
      }
    );

    limiter.stop();
  });

  it('应该为不同 IP 分别计数', () => {
    const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 2 });
    const req1 = { socket: { remoteAddress: '127.0.0.1' } };
    const req2 = { socket: { remoteAddress: '192.168.1.1' } };

    limiter.check(req1);
    limiter.check(req1);

    // req2 应该仍然可以请求
    const info = limiter.check(req2);
    assert.strictEqual(info.current, 1);

    limiter.stop();
  });
});
