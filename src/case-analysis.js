const crypto = require('node:crypto');
const { callChatJson } = require('./llm-client');

const LANES = new Set(['案件事实', '人员行为', '资金与物品', '侦查程序', '强制措施']);

function sourceRef(chunk) {
  return {
    chunkId: chunk.id,
    fileId: chunk.fileId,
    fileName: chunk.fileName,
    pageStart: chunk.pageStart ?? null,
    pageEnd: chunk.pageEnd ?? null,
  };
}

function inferPrecision(value) {
  const text = String(value || '').trim();
  if (!text || /不详|未知|待确认/.test(text)) return 'unknown';
  if (/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(text) || /\d{4}年\d{1,2}月\d{1,2}日/.test(text)) return 'day';
  if (/^\d{4}[-/.年]\d{1,2}/.test(text) || /\d{4}年\d{1,2}月/.test(text)) return 'month';
  if (/^\d{4}年?$/.test(text)) return 'year';
  return 'unknown';
}

function normalizeList(list, defaults, reference) {
  return (Array.isArray(list) ? list : []).map((item, index) => ({
    id: item.id || crypto.createHash('sha1').update(`${defaults.prefix}:${index}:${JSON.stringify(item)}`).digest('hex').slice(0, 12),
    ...item,
    ...defaults.values,
    sourceRefs: Array.isArray(item.sourceRefs) && item.sourceRefs.length ? item.sourceRefs : reference ? [reference] : [],
  }));
}

function normalizeAnalysis(raw, reference) {
  const people = normalizeList(raw.people, { prefix: 'person', values: { confidence: 'candidate' } }, reference);
  const timeline = normalizeList(raw.timeline, { prefix: 'timeline', values: {} }, reference).map((item) => ({
    ...item, precision: item.precision || inferPrecision(item.date),
  }));
  const relations = normalizeList(raw.relations, { prefix: 'relation', values: { confidence: 'candidate' } }, reference);
  const events = normalizeList(raw.events, { prefix: 'event', values: {} }, reference).map((item) => ({
    ...item, lane: LANES.has(item.lane) ? item.lane : '案件事实', precision: item.precision || inferPrecision(item.date),
  }));
  const evidence = normalizeList(raw.evidence, { prefix: 'evidence', values: { status: 'candidate' } }, reference);
  return { summary: String(raw.summary || ''), people, timeline, relations, events, evidence };
}

async function summarizeChunk(chunk, providerId, options = {}) {
  const system = `你是刑事案卷材料整理助手。只提取材料明确记载的内容，不判断有罪，不补造日期、页码、身份或关系。共同出现只能标记为材料共同提及。返回 JSON，字段为 summary、people、timeline、relations、events、evidence。所有内容均为待律师核对的候选。`;
  const user = `来源文件：${chunk.fileName}\n来源片段：${chunk.id}\n页码：${chunk.pageStart ?? '未知'}-${chunk.pageEnd ?? '未知'}\n\n片段原文：\n${chunk.text}`;
  const raw = await callChatJson(providerId, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { maxAttempts: 2, maxTokens: 8000 }, options.fetchImpl);
  return normalizeAnalysis(raw, sourceRef(chunk));
}

async function mergeFileSummary(file, summaries, providerId, options = {}) {
  const raw = await callChatJson(providerId, [
    { role: 'system', content: '合并同一案卷文件的片段摘要，去除重复，保留 sourceRefs，不增加原摘要中不存在的事实。返回 JSON。' },
    { role: 'user', content: JSON.stringify({ file: { id: file.id, name: file.name }, summaries }) },
  ], { maxAttempts: 2, maxTokens: 8000 }, options.fetchImpl);
  return normalizeAnalysis(raw);
}

async function mergeCaseSummary(fileSummaries, providerId, options = {}) {
  const raw = await callChatJson(providerId, [
    { role: 'system', content: '合并案件文件摘要，保留冲突和不确定性，禁止有罪概率、撒谎判断和虚构来源。返回 JSON。' },
    { role: 'user', content: JSON.stringify({ fileSummaries }) },
  ], { maxAttempts: 2, maxTokens: 12000 }, options.fetchImpl);
  return normalizeAnalysis(raw);
}

function buildCaseViews(caseId, caseSummary = {}) {
  const normalized = normalizeAnalysis(caseSummary);
  return {
    caseId,
    timeline: normalized.timeline,
    people: normalized.people,
    relations: normalized.relations,
    events: normalized.events,
    evidence: normalized.evidence,
  };
}

module.exports = {
  buildCaseViews,
  inferPrecision,
  mergeCaseSummary,
  mergeFileSummary,
  normalizeAnalysis,
  summarizeChunk,
};
