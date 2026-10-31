// 模型供应商配置：内置供应商清单 + 本地设置文件（选中供应商、模型、页面填写的密钥）
const fs = require('node:fs');
const path = require('node:path');

// 顺序即页面展示顺序：默认 DeepSeek，其次 Kimi、智谱
const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    envKey: 'DEEPSEEK_API_KEY',
    notice: '',
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [],
    envKey: 'KIMI_API_KEY',
    notice: '用户协议涉及将数据用于模型优化，书面澄清前不得用于真实案卷。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [],
    envKey: 'ZHIPU_API_KEY',
    notice: '数据使用条款尚未审核，审核前不得用于真实案卷。',
  },
];

const DEFAULT_PROVIDER = 'deepseek';

function settingsFile() {
  return process.env.SETTINGS_FILE || path.join(__dirname, '..', 'data', 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { active: DEFAULT_PROVIDER, providers: {} };
    throw err;
  }
}

function writeSettings(settings) {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

function findProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

// 页面填写的密钥优先，否则使用后台 .env 中的密钥
function resolveKey(provider, stored) {
  if (stored && stored.apiKey) return { apiKey: stored.apiKey, source: 'page' };
  const envValue = process.env[provider.envKey];
  if (envValue) return { apiKey: envValue, source: 'backend' };
  return { apiKey: '', source: 'none' };
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

function isEnabled(settings, id) {
  const stored = settings.providers[id] || {};
  const active = findProvider(settings.active) ? settings.active : DEFAULT_PROVIDER;
  return stored.enabled === true || (stored.enabled === undefined && id === active);
}

// 返回给前端的视图：绝不包含完整密钥
function listProviders() {
  const settings = readSettings();
  return {
    active: findProvider(settings.active) ? settings.active : DEFAULT_PROVIDER,
    providers: PROVIDERS.map((p) => {
      const stored = settings.providers[p.id] || {};
      const { apiKey, source } = resolveKey(p, stored);
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        models: p.models,
        model: stored.model || p.models[0] || '',
        hasKey: Boolean(apiKey),
        keySource: source,
        maskedKey: maskKey(apiKey),
        notice: p.notice,
        enabled: isEnabled(settings, p.id),
      };
    }),
  };
}

// body: { active, providers: { [id]: { model?, apiKey?, clearKey? } } }
function updateProviders(body) {
  const settings = readSettings();
  const currentActive = findProvider(settings.active) ? settings.active : DEFAULT_PROVIDER;
  const currentStored = settings.providers[currentActive] || {};
  if (currentStored.enabled === undefined) currentStored.enabled = true;
  settings.providers[currentActive] = currentStored;
  if (body.active !== undefined) {
    if (!findProvider(body.active)) throw new Error(`未知供应商：${body.active}`);
    if (!isEnabled(settings, body.active) && body.providers?.[body.active]?.enabled !== true) {
      throw new Error('不能选择已停用的供应商');
    }
    settings.active = body.active;
  }
  for (const [id, patch] of Object.entries(body.providers || {})) {
    if (!findProvider(id)) throw new Error(`未知供应商：${id}`);
    const stored = settings.providers[id] || {};
    if (typeof patch.enabled === 'boolean') stored.enabled = patch.enabled;
    if (typeof patch.model === 'string') stored.model = patch.model.trim();
    if (patch.clearKey) delete stored.apiKey;
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) stored.apiKey = patch.apiKey.trim();
    settings.providers[id] = stored;
  }
  if (!isEnabled(settings, settings.active)) {
    const fallback = PROVIDERS.find((provider) => isEnabled(settings, provider.id));
    if (!fallback) throw new Error('至少需要启用一个模型供应商');
    settings.active = fallback.id;
  }
  writeSettings(settings);
  return listProviders();
}

// 供后续案卷分析调用：返回实际可用的连接参数
function getProviderConfig(id) {
  const settings = readSettings();
  const provider = findProvider(id || settings.active) || findProvider(DEFAULT_PROVIDER);
  if (!isEnabled(settings, provider.id)) throw new Error(`供应商已停用：${provider.name}`);
  const stored = settings.providers[provider.id] || {};
  return {
    id: provider.id,
    baseUrl: provider.baseUrl,
    model: stored.model || provider.models[0] || '',
    apiKey: resolveKey(provider, stored).apiKey,
  };
}

// 连通性测试：只发送固定的 "ping"，不包含任何案卷内容
async function testProvider(id, fetchImpl = fetch) {
  if (!findProvider(id)) throw new Error(`未知供应商：${id}`);
  const cfg = getProviderConfig(id);
  if (!cfg.apiKey) return { ok: false, message: '未配置 API Key' };
  if (!cfg.model) return { ok: false, message: '未填写模型名称' };
  const started = Date.now();
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }),
    signal: AbortSignal.timeout(20000),
  });
  const ms = Date.now() - started;
  if (res.ok) return { ok: true, message: `连接成功（${cfg.model}，${ms} ms）` };
  const text = await res.text();
  return { ok: false, message: `HTTP ${res.status}：${text.slice(0, 200)}` };
}

module.exports = { PROVIDERS, listProviders, updateProviders, getProviderConfig, testProvider, maskKey };
