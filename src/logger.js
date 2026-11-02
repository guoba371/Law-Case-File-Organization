// 日志系统 - 支持不同级别和敏感信息过滤
const fs = require('node:fs');
const path = require('node:path');
const { config } = require('./config');

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  constructor(options = {}) {
    this.level = LOG_LEVELS[options.level || config.logging.level] || LOG_LEVELS.info;
    this.enableConsole = options.enableConsole ?? config.logging.enableConsole;
    this.enableFile = options.enableFile ?? config.logging.enableFile;
    this.logDir = path.join(config.paths.data, 'logs');

    if (this.enableFile) {
      this._ensureLogDir();
    }
  }

  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(this._sanitizeMeta(meta))}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  // 过滤敏感信息
  _sanitizeMeta(meta) {
    const sanitized = { ...meta };
    const sensitiveKeys = [
      'apikey',
      'password',
      'passwd',
      'pass',
      'token',
      'secret',
      'authorization',
    ];

    for (const key of Object.keys(sanitized)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (sensitiveKeys.some((sk) => normalizedKey.includes(sk))) {
        sanitized[key] = '***REDACTED***';
      }
      // 递归处理嵌套对象
      if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this._sanitizeMeta(sanitized[key]);
      }
    }

    return sanitized;
  }

  _writeToFile(level, message) {
    if (!this.enableFile) return;

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `${date}.log`);

    try {
      fs.appendFileSync(logFile, message + '\n', 'utf8');
    } catch (error) {
      console.error('写入日志文件失败:', error.message);
    }
  }

  _log(level, message, meta = {}) {
    if (LOG_LEVELS[level] < this.level) return;

    const formatted = this._formatMessage(level, message, meta);

    if (this.enableConsole) {
      const logFn =
        level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      logFn(formatted);
    }

    this._writeToFile(level, formatted);
  }

  debug(message, meta) {
    this._log('debug', message, meta);
  }

  info(message, meta) {
    this._log('info', message, meta);
  }

  warn(message, meta) {
    this._log('warn', message, meta);
  }

  error(message, meta) {
    this._log('error', message, meta);
  }

  // HTTP 请求日志（过滤敏感路径和参数）
  logRequest(req, res, duration) {
    const { method, url } = req;
    const statusCode = res.statusCode;
    const sanitizedUrl = this._sanitizeUrl(url);

    this.info(`${method} ${sanitizedUrl} ${statusCode} - ${duration}ms`);
  }

  _sanitizeUrl(url) {
    // 移除可能包含敏感信息的查询参数
    try {
      const urlObj = new URL(url, 'http://localhost');
      const sensitiveParams = ['token', 'key', 'secret', 'password'];

      for (const param of sensitiveParams) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '***');
        }
      }

      return urlObj.pathname + urlObj.search;
    } catch {
      return url;
    }
  }
}

// 单例模式
const logger = new Logger();

module.exports = { Logger, logger };
