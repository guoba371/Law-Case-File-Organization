// 统一错误处理和自定义错误类
const { logger } = require('./logger');

// 自定义错误类
class AppError extends Error {
  constructor(message, statusCode = 400, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor(resource = '资源') {
    super(`${resource}不存在`, 404, 'NOT_FOUND');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '未授权访问') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '无权限执行此操作') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = '资源冲突') {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(message = '请求过于频繁，请稍后再试') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

class ExternalServiceError extends AppError {
  constructor(service, originalError) {
    super(`外部服务调用失败: ${service}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
    this.originalError = originalError?.message;
  }
}

// 错误处理中间件工厂函数
function createErrorHandler() {
  return (error, req, res) => {
    // 默认错误信息
    let statusCode = 400;
    let message = error.message || '请求处理失败';
    let code = 'APP_ERROR';
    let details = null;

    // 处理已知的应用错误
    if (error.isOperational) {
      statusCode = error.statusCode;
      message = error.message;
      code = error.code;
      details = error.details;
    }
    // 处理特定的系统错误
    else if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
      statusCode = 400;
      message = 'JSON 格式错误';
      code = 'INVALID_JSON';
    } else if (error.code === 'ENOENT') {
      statusCode = 404;
      message = '文件不存在';
      code = 'FILE_NOT_FOUND';
    } else if (error.code === 'EACCES') {
      statusCode = 403;
      message = '文件访问权限不足';
      code = 'FILE_ACCESS_DENIED';
    }
    // 兼容旧的错误检测逻辑
    else if (/案件不存在|案件编号无效/.test(error.message)) {
      statusCode = 404;
      message = error.message;
      code = 'CASE_NOT_FOUND';
    } else if (/请求体过大/.test(error.message)) {
      statusCode = 413;
      message = error.message;
      code = 'PAYLOAD_TOO_LARGE';
    }

    // 记录错误日志
    if (statusCode >= 500) {
      logger.error('服务器错误', {
        error: message,
        stack: error.stack,
        url: req?.url,
        method: req?.method,
        code,
      });
    } else if (statusCode >= 400) {
      logger.warn('客户端错误', {
        error: message,
        url: req?.url,
        method: req?.method,
        code,
      });
    }

    // 返回错误响应
    const response = {
      error: message,
      code,
    };

    // 开发环境返回详细信息
    if (process.env.NODE_ENV === 'development') {
      response.stack = error.stack;
      if (details) response.details = details;
    }

    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(response));
  };
}

// 包装异步路由处理器
function asyncHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const errorHandler = createErrorHandler();
      errorHandler(error, req, res);
    }
  };
}

// 验证工具函数
const validate = {
  // 验证必需字段
  required(value, fieldName) {
    if (value === undefined || value === null || value === '') {
      throw new ValidationError(`${fieldName} 是必需的`);
    }
    return value;
  },

  // 验证字符串
  string(value, fieldName, options = {}) {
    this.required(value, fieldName);
    if (typeof value !== 'string') {
      throw new ValidationError(`${fieldName} 必须是字符串`);
    }
    if (options.minLength && value.length < options.minLength) {
      throw new ValidationError(`${fieldName} 长度不能少于 ${options.minLength} 个字符`);
    }
    if (options.maxLength && value.length > options.maxLength) {
      throw new ValidationError(`${fieldName} 长度不能超过 ${options.maxLength} 个字符`);
    }
    if (options.pattern && !options.pattern.test(value)) {
      throw new ValidationError(`${fieldName} 格式不正确`);
    }
    return value;
  },

  // 验证数字
  number(value, fieldName, options = {}) {
    const num = Number(value);
    if (isNaN(num)) {
      throw new ValidationError(`${fieldName} 必须是数字`);
    }
    if (options.min !== undefined && num < options.min) {
      throw new ValidationError(`${fieldName} 不能小于 ${options.min}`);
    }
    if (options.max !== undefined && num > options.max) {
      throw new ValidationError(`${fieldName} 不能大于 ${options.max}`);
    }
    return num;
  },

  // 验证枚举值
  enum(value, fieldName, allowedValues) {
    this.required(value, fieldName);
    if (!allowedValues.includes(value)) {
      throw new ValidationError(`${fieldName} 必须是以下值之一: ${allowedValues.join(', ')}`);
    }
    return value;
  },

  // 验证文件扩展名
  fileExtension(filename, allowedExtensions) {
    const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
    if (!allowedExtensions.includes(ext)) {
      throw new ValidationError(`不支持的文件类型，仅支持: ${allowedExtensions.join(', ')}`);
    }
    return ext;
  },

  // 验证 UUID
  uuid(value, fieldName) {
    this.required(value, fieldName);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(value)) {
      throw new ValidationError(`${fieldName} 格式不正确`);
    }
    return value;
  },
};

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  createErrorHandler,
  asyncHandler,
  validate,
};
