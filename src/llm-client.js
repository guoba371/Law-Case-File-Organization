const { getProviderConfig } = require('./providers');

function stripJsonFence(value) {
  return String(value || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function callChat(providerId, messages, options = {}, fetchImpl = fetch) {
  const cfg = getProviderConfig(providerId);
  if (!cfg.apiKey) throw new Error(`模型 ${providerId} 未配置 API Key`);
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 8000,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`LLM API 失败（HTTP ${res.status}）：${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回格式异常');
  return content;
}

async function callChatJson(providerId, messages, options = {}, fetchImpl = fetch) {
  const maxAttempts = options.maxAttempts ?? 2;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const content = await callChat(providerId, messages, {
        ...options,
        responseFormat: { type: 'json_object' },
      }, fetchImpl);
      const parsed = JSON.parse(stripJsonFence(content));
      if (options.validate) options.validate(parsed);
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`模型结构化输出解析失败：${lastError.message}`);
}

module.exports = { callChat, callChatJson, stripJsonFence };
