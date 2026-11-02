// 速率限制中间件 - 防止 API 滥用
const { RateLimitError } = require('./errors');
const { config } = require('./config');

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000; // 1分钟
    this.maxRequests = options.maxRequests || config.security.rateLimitPerMinute;
    this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
    this.keyGenerator = options.keyGenerator || this._defaultKeyGenerator;

    // 存储请求记录 { key: { count: number, resetTime: number } }
    this.requests = new Map();

    // 定期清理过期记录
    this._startCleanup();
  }

  _defaultKeyGenerator(req) {
    // 使用 IP 地址作为限制键
    return req.socket.remoteAddress || 'unknown';
  }

  _startCleanup() {
    // 每分钟清理一次过期记录
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.requests.entries()) {
        if (record.resetTime < now) {
          this.requests.delete(key);
        }
      }
    }, 60000);
    this.cleanupInterval.unref?.();
  }

  check(req) {
    const key = this.keyGenerator(req);
    const now = Date.now();

    let record = this.requests.get(key);

    // 如果记录不存在或已过期，创建新记录
    if (!record || record.resetTime < now) {
      record = {
        count: 0,
        resetTime: now + this.windowMs,
      };
      this.requests.set(key, record);
    }

    // 增加请求计数
    record.count++;

    // 检查是否超过限制
    if (record.count > this.maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      throw new RateLimitError(`请求过于频繁，请在 ${retryAfter} 秒后重试`);
    }

    return {
      limit: this.maxRequests,
      current: record.count,
      remaining: Math.max(0, this.maxRequests - record.count),
      resetTime: record.resetTime,
    };
  }

  middleware() {
    return (req, res, next) => {
      try {
        const info = this.check(req);

        // 设置速率限制响应头
        res.setHeader('X-RateLimit-Limit', info.limit);
        res.setHeader('X-RateLimit-Remaining', info.remaining);
        res.setHeader('X-RateLimit-Reset', new Date(info.resetTime).toISOString());

        next();
      } catch (error) {
        if (error instanceof RateLimitError) {
          const retryAfter = Math.ceil(
            (this.requests.get(this.keyGenerator(req)).resetTime - Date.now()) / 1000
          );
          res.setHeader('Retry-After', retryAfter);
        }
        throw error;
      }
    };
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// 创建不同端点的限制器
function createRateLimiters() {
  return {
    // 一般 API 限制
    general: new RateLimiter({
      windowMs: 60000,
      maxRequests: config.security.rateLimitPerMinute,
    }),

    // 严格限制（用于敏感操作）
    strict: new RateLimiter({
      windowMs: 60000,
      maxRequests: 10,
    }),

    // 文件上传限制
    upload: new RateLimiter({
      windowMs: 60000,
      maxRequests: 20,
    }),

    // 模型调用限制
    llm: new RateLimiter({
      windowMs: 60000,
      maxRequests: 30,
    }),
  };
}

module.exports = { RateLimiter, createRateLimiters };
