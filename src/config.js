// 统一配置管理
const path = require('node:path');

const config = {
  // 服务器配置
  server: {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  // 数据存储路径
  paths: {
    data: path.join(__dirname, '..', 'data'),
    public: path.join(__dirname, '..', 'public'),
    temp: path.join(__dirname, '..', '.tmp-export'),
  },

  // 模型供应商配置
  providers: {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-reasoner',
      baseURL: 'https://api.deepseek.com',
    },
    kimi: {
      apiKey: process.env.KIMI_API_KEY || '',
      model: process.env.KIMI_MODEL || 'moonshot-v1-32k',
      baseURL: 'https://api.moonshot.cn',
    },
    zhipu: {
      apiKey: process.env.ZHIPU_API_KEY || '',
      model: process.env.ZHIPU_MODEL || '',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    },
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: true,
    enableFile: process.env.NODE_ENV === 'production',
  },

  // 安全配置
  security: {
    rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 100,
    allowedOrigins: ['http://127.0.0.1', 'http://localhost'],
  },
};

// 验证必需配置
function validateConfig() {
  const errors = [];

  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('PORT 必须在 1-65535 之间');
  }

  if (errors.length > 0) {
    throw new Error(`配置验证失败:\n${errors.join('\n')}`);
  }
}

// 获取激活的模型供应商
function getActiveProviders() {
  const active = [];
  if (config.providers.deepseek.apiKey) active.push('deepseek');
  if (config.providers.kimi.apiKey) active.push('kimi');
  if (config.providers.zhipu.apiKey) active.push('zhipu');
  return active;
}

module.exports = {
  config,
  validateConfig,
  getActiveProviders,
};
