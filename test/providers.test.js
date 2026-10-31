const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'providers-'));
process.env.SETTINGS_FILE = path.join(tmp, 'settings.json');
process.env.DEEPSEEK_API_KEY = 'sk-backend-1234567890';
delete process.env.KIMI_API_KEY;
delete process.env.ZHIPU_API_KEY;

const p = require('../src/providers');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('默认 DeepSeek，顺序为 DeepSeek、Kimi、智谱，使用后台密钥', () => {
  const view = p.listProviders();
  assert.strictEqual(view.active, 'deepseek');
  assert.deepStrictEqual(view.providers.map((x) => x.id), ['deepseek', 'kimi', 'zhipu']);
  const ds = view.providers[0];
  assert.strictEqual(ds.model, 'deepseek-flash');
  assert.strictEqual(ds.keySource, 'backend');
  assert.strictEqual(ds.enabled, true);
  assert.strictEqual(ds.maskedKey, 'sk-****7890');
  assert.strictEqual(view.providers[1].hasKey, false);
});

test('接口返回不含完整密钥', () => {
  p.updateProviders({ providers: { kimi: { apiKey: 'sk-page-abcdefghij' } } });
  const json = JSON.stringify(p.listProviders());
  assert.ok(!json.includes('sk-backend-1234567890'));
  assert.ok(!json.includes('sk-page-abcdefghij'));
});

test('页面密钥优先，清除后回退到后台密钥', () => {
  p.updateProviders({ providers: { deepseek: { apiKey: 'sk-page-0000000000' } } });
  assert.strictEqual(p.getProviderConfig('deepseek').apiKey, 'sk-page-0000000000');
  p.updateProviders({ providers: { deepseek: { apiKey: '' } } });
  assert.strictEqual(p.getProviderConfig('deepseek').apiKey, 'sk-page-0000000000', '空值不覆盖');
  p.updateProviders({ providers: { deepseek: { clearKey: true } } });
  assert.strictEqual(p.getProviderConfig('deepseek').apiKey, 'sk-backend-1234567890');
});

test('切换供应商与模型，拒绝未知供应商', () => {
  const view = p.updateProviders({ active: 'zhipu', providers: { deepseek: { model: 'deepseek-v4-pro' }, zhipu: { enabled: true } } });
  assert.strictEqual(view.active, 'zhipu');
  assert.strictEqual(p.getProviderConfig('deepseek').model, 'deepseek-v4-pro');
  assert.throws(() => p.updateProviders({ active: 'openai' }), /未知供应商/);
});

test('供应商可停用，停用后不能被选择或调用', () => {
  let view = p.updateProviders({ providers: { kimi: { enabled: false } } });
  assert.strictEqual(view.providers.find((x) => x.id === 'kimi').enabled, false);
  assert.throws(() => p.updateProviders({ active: 'kimi' }), /已停用/);
  assert.throws(() => p.getProviderConfig('kimi'), /已停用/);
  view = p.updateProviders({ providers: { kimi: { enabled: true } }, active: 'kimi' });
  assert.strictEqual(view.active, 'kimi');
});

test('停用当前供应商时自动切换到其他已启用供应商', () => {
  const view = p.updateProviders({ providers: { kimi: { enabled: false } } });
  assert.strictEqual(view.active, 'deepseek');
});

test('测试连接只发送 ping，使用 OpenAI 兼容接口', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true };
  };
  const r = await p.testProvider('deepseek', fakeFetch);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(captured.url, 'https://api.deepseek.com/chat/completions');
  const body = JSON.parse(captured.opts.body);
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'ping' }]);
  assert.strictEqual(captured.opts.headers.Authorization, 'Bearer sk-backend-1234567890');
});

test('缺少密钥时不发起请求', async () => {
  const r = await p.testProvider('zhipu', () => assert.fail('不应请求'));
  assert.deepStrictEqual(r, { ok: false, message: '未配置 API Key' });
});
