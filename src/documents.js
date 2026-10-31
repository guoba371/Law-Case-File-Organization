const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getProviderConfig } = require('./providers');
const { samplesForType } = require('./samples');
const { extractCaseFiles } = require('./case-files');

// 三种法律文书类型及其段落结构
const DOC_TYPES = {
  evidence_opinion: {
    name: '质证意见',
    desc: '对控方提交的证据逐一进行法律质证',
    sections: [
      { key: 'intro', title: '一、案件基本情况', hint: '简述案件性质、控方指控罪名、主要指控事实' },
      { key: 'evidence_summary', title: '二、控方证据概述', hint: '列举控方提交的主要证据类型与数量' },
      { key: 'evidence_cross', title: '三、主要证据质证', hint: '分证据类型进行质证，指出证据的合法性、关联性、真实性问题' },
      { key: 'legal_analysis', title: '四、法律分析', hint: '结合质证意见分析现有证据是否足以证明控方指控' },
      { key: 'conclusion', title: '五、辩护意见', hint: '明确提出无罪、罪轻或程序违法等辩护观点' },
      { key: 'relief', title: '六、诉讼请求', hint: '要求人民法院采纳质证意见，做出对被告人有利的裁判' },
    ],
  },
  prosecution_opinion: {
    name: '审查起诉阶段法律意见书',
    desc: '在审查起诉阶段向检察机关提交的完整法律意见',
    sections: [
      { key: 'intro', title: '一、案件基本情况', hint: '简述案件经过、控方指控、被告人基本信息' },
      { key: 'evidence_analysis', title: '二、证据分析', hint: '从合法性、关联性、真实性等方面分析控方证据' },
      { key: 'law_analysis', title: '三、法律分析', hint: '分析控方指控是否符合犯罪构成要素' },
      { key: 'leniency_factors', title: '四、法定从轻情节', hint: '分析被告人是否存在自首、立功等法定从轻情节' },
      { key: 'mitigating_factors', title: '五、酌定从轻情节', hint: '分析其他可酌定从轻的情节' },
      { key: 'request', title: '六、诉讼请求', hint: '明确要求检察机关的处理结果（不起诉、撤销批捕等）' },
    ],
  },
  detention_review: {
    name: '羁押必要性审查申请',
    desc: '在羁押阶段申请人民法院进行羁押必要性审查的法律文书',
    sections: [
      { key: 'intro', title: '一、案件基本情况', hint: '简述被告人身份、指控罪名、羁押情况' },
      { key: 'arrest_review', title: '二、逮捕决定合法性审查', hint: '分析逮捕决定是否满足法律规定的条件' },
      { key: 'danger_analysis', title: '三、社会危险性评估', hint: '分析被告人是否仍有社会危险性或继续羁押的必要' },
      { key: 'mitigation', title: '四、变更强制措施的条件', hint: '论证变更为监视居住、取保候审的可能性' },
      { key: 'personal_factors', title: '五、人格与家庭情况', hint: '介绍被告人的工作、家庭、社交背景等' },
      { key: 'relief', title: '六、审查请求', hint: '明确要求法院变更强制措施或释放被告人' },
    ],
  },
};

// 文书段落的状态值
const SECTION_STATES = {
  pending: '待确认', // 初始状态，未被律师审核
  confirmed: '已确认', // 律师确认无误
};

const DATA_DIR = process.env.DOCUMENTS_DIR || path.join(__dirname, '..', 'data', 'documents');
const MAX_CASE_FILE = 2 * 1024 * 1024; // 案卷上限 2MB
const MAX_FEEDBACK = 1 * 1024 * 1024; // 反馈上限 1MB

function docPath(docId) {
  return path.join(DATA_DIR, `${docId}.json`);
}

// 创建新文书
// params: { caseContent, caseFileName, caseUploads, draftingRequirements, docType, sampleId, model }
// 返回: { id, docType, typeName, status, createdAt, sections: [{key, title, state, ...}] }
async function generateDocument(params) {
  let { caseContent, caseFileName, caseUploads, caseUploadName, caseUploadBase64, draftingRequirements, docType, sampleId, model } = params;
  
  if (!DOC_TYPES[docType]) throw new Error('文书类型无效');
  caseContent = typeof caseContent === 'string' ? caseContent.trim() : '';
  // 保留旧版单文件字段兼容性，新版统一使用 caseUploads 数组。
  if (!Array.isArray(caseUploads)) {
    caseUploads = caseUploadBase64 ? [{ name: caseUploadName, base64: caseUploadBase64 }] : [];
  }
  if (caseUploads.length) {
    const extractedFiles = await extractCaseFiles(caseUploads);
    const uploadedText = extractedFiles
      .map((file) => `【案卷文件：${file.name}】\n${file.text}`)
      .join('\n\n');
    caseContent = [caseContent, uploadedText].filter(Boolean).join('\n\n');
    if (!caseFileName) caseFileName = extractedFiles[0]?.name;
  }
  if (!caseContent) throw new Error('请粘贴案卷内容或上传案卷文件');
  if (caseContent.length > MAX_CASE_FILE) throw new Error('案卷提取文字与补充正文合计超过 2MB，请分批生成');
  draftingRequirements = String(draftingRequirements || '').trim();
  if (draftingRequirements.length > 10000) throw new Error('文书生成要求不能超过 10000 字');
  
  const docId = crypto.randomUUID();
  const typeDef = DOC_TYPES[docType];
  const cfg = getProviderConfig(model);
  
  if (!cfg.apiKey) throw new Error(`模型 ${model} 未配置 API Key`);
  
  // 收集参考样本
  const samples = samplesForType(docType);
  const refSample = sampleId ? samples.find(s => s.id === sampleId) : samples[0];
  
  // 构建生成提示词
  const systemPrompt = buildSystemPrompt(typeDef, refSample);
  const userPrompt = buildUserPrompt(typeDef, caseContent, refSample, caseFileName, draftingRequirements);
  
  // 调用 LLM 生成初稿
  const generated = await callLLM(cfg, systemPrompt, userPrompt);
  const sections = parseSections(typeDef, generated);
  
  // 构建文书数据结构
  const doc = {
    id: docId,
    docType,
    typeName: typeDef.name,
    status: 'draft', // draft -> reviewing -> completed
    model,
    caseFileName: caseFileName || 'case.txt',
    caseContentLength: caseContent.length,
    sourceFileCount: caseUploads.length,
    draftingRequirements,
    sampleId: refSample?.id || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections: sections.map(s => ({
      key: s.key,
      title: s.title,
      hint: s.hint,
      content: s.content,
      state: 'pending',
      confirmHistory: [],
    })),
  };
  
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(docPath(docId), JSON.stringify(doc, null, 2));
  
  return summary(doc);
}

function referencesFromChunks(chunks) {
  return (Array.isArray(chunks) ? chunks : []).map((chunk) => ({
    chunkId: chunk.id,
    fileId: chunk.fileId,
    fileName: chunk.fileName,
    pageStart: chunk.pageStart ?? null,
    pageEnd: chunk.pageEnd ?? null,
  }));
}

async function generateCaseDocument(params, context, fetchImpl = fetch) {
  const { docType, model, sampleId } = params;
  if (!DOC_TYPES[docType]) throw new Error('文书类型无效');
  if (!context?.caseId) throw new Error('案件编号无效');
  const chunks = Array.isArray(context.chunks) ? context.chunks : [];
  if (!context.summary && chunks.length === 0) throw new Error('案件暂无可用研判内容');
  const draftingRequirements = String(params.draftingRequirements || '').trim();
  if (draftingRequirements.length > 10000) throw new Error('文书生成要求不能超过 10000 字');

  const typeDef = DOC_TYPES[docType];
  const cfg = getProviderConfig(model);
  if (!cfg.apiKey) throw new Error(`模型 ${model} 未配置 API Key`);
  const samples = samplesForType(docType);
  const refSample = sampleId ? samples.find((sample) => sample.id === sampleId) : samples[0];
  const caseSummary = typeof context.summary === 'string' ? context.summary : context.summary?.summary || JSON.stringify(context.summary || {});
  const selectedMaterial = chunks.map((chunk) => `【来源：${chunk.fileName} / ${chunk.id}】\n${chunk.text}`).join('\n\n');
  const caseContent = [`【案件研判摘要】\n${caseSummary}`, selectedMaterial].filter(Boolean).join('\n\n');
  const generated = await callLLM(
    cfg,
    buildSystemPrompt(typeDef, refSample),
    buildUserPrompt(typeDef, caseContent, refSample, params.caseFileName || '案件研判材料', draftingRequirements),
    fetchImpl,
  );
  const parsed = parseSections(typeDef, generated);
  const sourceRefs = referencesFromChunks(chunks);
  const now = new Date().toISOString();
  const doc = {
    id: crypto.randomUUID(),
    caseId: context.caseId,
    docType,
    typeName: typeDef.name,
    status: 'draft',
    model,
    caseFileName: params.caseFileName || '案件研判材料',
    caseContentLength: caseContent.length,
    sourceFileCount: new Set(chunks.map((chunk) => chunk.fileId)).size,
    draftingRequirements,
    sampleId: refSample?.id || null,
    scope: context.scope || null,
    createdAt: now,
    updatedAt: now,
    sections: parsed.map((section) => ({
      key: section.key,
      title: section.title,
      hint: section.hint,
      content: section.content,
      state: 'pending',
      sourceRefs,
      confirmHistory: [],
    })),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(docPath(doc.id), JSON.stringify(doc, null, 2));
  return summary(doc);
}

// 调用大模型 API
async function callLLM(cfg, systemPrompt, userPrompt, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 16000,
    }),
    signal: AbortSignal.timeout(60000),
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API 失败（HTTP ${res.status}）：${text.slice(0, 500)}`);
  }
  
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) {
    console.error('[FORMAT ERROR]', JSON.stringify(data).slice(0, 200));
    throw new Error('LLM 返回格式异常');
  }
  
  return data.choices[0].message.content;
}

// 构建系统提示词
function buildSystemPrompt(typeDef, refSample) {
  const sampleRef = refSample?.text 
    ? `\n\n参考样本：\n${refSample.text.slice(0, 1000)}...` 
    : '';
  
  return `你是一位资深刑事律师。你的任务是帮助生成${typeDef.name}。\n\n文书结构：${
    typeDef.sections.map(s => `\n${s.title}：${s.hint}`).join('')
  }\n\n要求：\n1. 严格按照段落顺序生成\n2. 每段包含完整的论证与分析\n3. 使用专业的法律术语\n4. 逻辑清晰，易于阅卷机关理解${sampleRef}`;
}

// 构建用户提示词
function buildUserPrompt(typeDef, caseContent, refSample, fileName, draftingRequirements) {
  const requirements = draftingRequirements ? `\n\n律师提出的文书生成要求：\n${draftingRequirements}` : '';
  return `案卷文件名：${fileName || 'case.txt'}\n\n案卷内容：\n${caseContent}${requirements}\n\n请按照以下结构逐段生成${
    typeDef.name
  }：\n${
    typeDef.sections.map(s => `\n【${s.title}】\n${s.hint}`).join('')
  }\n\n每段内容应该独立完整，可以被律师单独修改。`;
}

// 解析 LLM 生成的内容为段落结构
function parseSections(typeDef, generated) {
  const sections = [];
  
  for (const def of typeDef.sections) {
    const titlePattern = def.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 匹配【标题】或标题：的内容
    const regex = new RegExp(`【?${titlePattern}】?[:：]?\\s*([\\s\\S]*?)(?=【|$|\\n(?=【|一、|二、|三、|四、|五、|六、))`, 'g');
    const match = regex.exec(generated);
    
    let content = match ? match[1].trim() : '';
    // 如果未找到，尝试按顺序截取
    if (!content) {
      const startIdx = generated.indexOf(def.title);
      if (startIdx !== -1) {
        const nextDef = typeDef.sections[typeDef.sections.indexOf(def) + 1];
        const endIdx = nextDef ? generated.indexOf(nextDef.title, startIdx) : generated.length;
        content = generated.slice(startIdx + def.title.length, endIdx).trim();
      }
    }
    
    sections.push({
      key: def.key,
      title: def.title,
      hint: def.hint,
      content: content || `[${def.title}内容生成失败，请手动编辑]`,
    });
  }
  
  return sections;
}

// 返回给前端的摘要（不含完整内容）
function summary(doc) {
  return {
    id: doc.id,
    caseId: doc.caseId,
    docType: doc.docType,
    typeName: doc.typeName,
    status: doc.status,
    model: doc.model,
    caseFileName: doc.caseFileName,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    sections: doc.sections.map(s => ({
      key: s.key,
      title: s.title,
      state: s.state,
    })),
  };
}

// 获取单个文书完整内容
function getDocument(docId) {
  const file = docPath(docId);
  if (!fs.existsSync(file)) throw new Error('文书不存在');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 列出所有文书摘要
function listDocuments() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(summary);
}

// 删除文书
function deleteDocument(docId) {
  const file = docPath(docId);
  if (!fs.existsSync(file)) throw new Error('文书不存在');
  fs.rmSync(file);
  return { ok: true };
}

// 律师确认段落内容。需要调整时直接使用修改接口重新生成该段。
// params: { status: 'confirmed' }
async function updateSectionStatus(docId, sectionKey, params) {
  const { status } = params;
  if (status !== 'confirmed') throw new Error('状态值无效');
  
  const doc = getDocument(docId);
  const section = doc.sections.find(s => s.key === sectionKey);
  if (!section) throw new Error('段落不存在');
  
  section.state = 'confirmed';
  section.confirmHistory.push({
    timestamp: new Date().toISOString(),
    action: 'confirmed',
  });
  
  doc.updatedAt = new Date().toISOString();
  fs.writeFileSync(docPath(docId), JSON.stringify(doc, null, 2));
  
  return { ok: true };
}

// 根据律师反馈修改段落内容并重新生成
// params: { feedback, model? }
async function reviseSectionContent(docId, sectionKey, params) {
  const { feedback, model } = params;
  if (!feedback || typeof feedback !== 'string') throw new Error('反馈不能为空');
  if (feedback.length > MAX_FEEDBACK) throw new Error('反馈过长');
  
  const doc = getDocument(docId);
  const section = doc.sections.find(s => s.key === sectionKey);
  if (!section) throw new Error('段落不存在');
  
  // 记录旧内容
  const oldContent = section.content;
  section.confirmHistory.push({
    timestamp: new Date().toISOString(),
    action: 'revised',
    feedback,
    oldContent,
  });
  
  // 调用 LLM 重新生成
  const cfg = getProviderConfig(model || doc.model);
  if (!cfg.apiKey) throw new Error('模型 API Key 未配置');
  
  const revisePrompt = `\n\n用户的修改意见：${feedback}\n\n请基于此反馈重新生成【${section.title}】的内容，确保满足反馈要求。`;
  const systemPrompt = `你是一位资深刑事律师。你的任务是修改${doc.typeName}中的某个段落。\n\n原内容如下：\n${oldContent}`;
  const userPrompt = revisePrompt;
  
  const newContent = await callLLM(cfg, systemPrompt, userPrompt);
  section.content = newContent.trim();
  section.state = 'pending'; // 重置为待确认
  
  doc.updatedAt = new Date().toISOString();
  fs.writeFileSync(docPath(docId), JSON.stringify(doc, null, 2));
  
  return { ok: true };
}

// 返回文书类型定义（给前端用于显示选项与帮助）
function getDocumentTypes() {
  return Object.entries(DOC_TYPES).map(([key, val]) => ({
    id: key,
    name: val.name,
    desc: val.desc,
    sectionCount: val.sections.length,
  }));
}

module.exports = {
  DOC_TYPES,
  SECTION_STATES,
  generateDocument,
  generateCaseDocument,
  getDocument,
  listDocuments,
  deleteDocument,
  updateSectionStatus,
  reviseSectionContent,
  getDocumentTypes,
};
