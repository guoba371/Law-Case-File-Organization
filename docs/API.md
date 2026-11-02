# API 文档

## 基础信息

- Base URL：`http://127.0.0.1:3000`
- JSON 接口使用 UTF-8；文件分片使用 `application/octet-stream`
- 当前无用户认证，服务默认仅监听本机地址
- 速率限制按客户端 IP 计数：普通 API 每分钟 100 次、文件接口 20 次、案件处理及文书接口 30 次；响应不包含限流状态头

成功响应直接返回资源或操作结果，不统一包裹 `data`。错误响应格式为：

```json
{
  "error": "错误描述",
  "code": "APP_ERROR"
}
```

## 健康检查

```http
GET /health
```

返回 `status`、`timestamp`、`uptime`、`environment` 和应用 `version`。

## 模型供应商

```http
GET /api/providers
PUT /api/providers
POST /api/providers/{provider}/test
```

供应商为 `deepseek`、`kimi`、`zhipu`。列表包含当前供应商、启用状态、模型名、密钥是否已配置及掩码密钥，不返回完整密钥。

更新示例：

```json
{
  "active": "deepseek",
  "providers": {
    "deepseek": {
      "enabled": true,
      "apiKey": "在本机设置的密钥",
      "model": "deepseek-flash"
    }
  }
}
```

密钥保存在服务端本地设置文件中；也可通过 `DEEPSEEK_API_KEY`、`KIMI_API_KEY` 或 `ZHIPU_API_KEY` 提供后台默认密钥。连接测试仅发送固定的 `ping`，不发送案卷内容。

## 案件与案卷

```http
GET    /api/cases
POST   /api/cases
GET    /api/cases/{caseId}
DELETE /api/cases/{caseId}
```

创建案件示例：

```json
{
  "name": "案件标题",
  "model": "deepseek",
  "redactedConfirmed": true,
  "docType": "evidence_opinion",
  "draftingRequirements": "重点核对资金流向"
}
```

`name` 必填，且必须明确传入 `redactedConfirmed: true`。系统会阻止未确认脱敏的材料上传或分析，但不会自动判断脱敏是否充分。案件详情包含 `case`、`files`、`chunks`、`summaries`、`views` 和关联的 `documents`。

文件分片上传：

```http
POST /api/cases/{caseId}/files/init
PUT  /api/cases/{caseId}/files/{fileId}/chunks/{chunkIndex}
POST /api/cases/{caseId}/files/{fileId}/complete
```

初始化请求体：

```json
{
  "name": "案卷材料.pdf",
  "size": 10485760,
  "totalChunks": 2
}
```

案件文件支持 PDF、DOCX、TXT，单文件最大 100MB，每份分片最大 5MB。分片序号从 `0` 开始，分片请求体为二进制内容。

案件分析与图表：

```http
POST /api/cases/{caseId}/process
GET  /api/cases/{caseId}/status
GET  /api/cases/{caseId}/diagrams/{type}?theme=light
GET  /api/cases/{caseId}/diagrams/{type}?theme=light&format=svg
```

`process` 返回排队状态；`status` 返回案件状态和进度。图表类型为 `people`、`timeline`、`events`。默认返回含 SVG、来源索引和提示的 JSON；`format=svg` 下载 SVG 文件。暂无图表内容时，JSON 提示为“暂无数据”。

## 参考样本

```http
GET    /api/samples?type={docType}
POST   /api/samples
DELETE /api/samples/{sampleId}
```

文书类型 ID 为 `evidence_opinion`、`prosecution_opinion`、`detention_review`。创建样本请求体：

```json
{
  "type": "evidence_opinion",
  "title": "本所样本",
  "text": "已脱敏的文书正文",
  "confirmedRedacted": true
}
```

也可提交 `fileName` 和 Base64 编码的 `fileBase64`，文件需为 PDF、DOCX 或 TXT，最大 10MB。确认字段必须为布尔值 `true`。

## 文书

```http
GET    /api/doc-types
GET    /api/documents
POST   /api/documents
GET    /api/documents/{docId}
DELETE /api/documents/{docId}
GET    /api/documents/{docId}/export?format=docx
PUT    /api/documents/{docId}/sections/{sectionKey}
POST   /api/documents/{docId}/sections/{sectionKey}
POST   /api/cases/{caseId}/documents
```

生成文书的类型 ID 与样本相同。独立生成的请求体示例：

```json
{
  "docType": "evidence_opinion",
  "model": "deepseek",
  "caseFileName": "案卷材料.pdf",
  "caseContent": "已脱敏案卷正文",
  "draftingRequirements": "生成要求",
  "sampleId": "可选的参考样本 UUID"
}
```

也可用 `caseUploads` 数组上传多个 `{ "name": "材料.pdf", "base64": "..." }` 文件。提取文字与补充正文合计最大 2MB，生成要求最大 10000 字。

基于案件生成时，使用 `POST /api/cases/{caseId}/documents`，请求字段包括 `docType`、`model`、`sampleId`、`draftingRequirements`、`scope` 和 `maxChunks`。`scope` 可按 `keywords`、`personId`、`eventId`、`evidenceId` 缩小材料范围。

段落状态只支持 `pending` 和 `confirmed`。确认请求体为 `{ "status": "confirmed" }`；修改段落请求体为 `{ "feedback": "请增加对物证的分析", "model": "可选供应商 ID" }`。修改后段落会重置为待确认。导出格式支持 `docx`、`pdf`，默认 `docx`。

## 问题反馈

```http
POST /api/feedback
```

请求体：

```json
{
  "description": "问题描述",
  "pageUrl": "/cases",
  "images": [
    { "name": "截图.png", "type": "image/png", "data": "Base64 图片内容" }
  ]
}
```

描述必填，最多 5000 字；最多 5 张 PNG、JPG 或 WEBP 图片，每张最大 5MB。邮件通知需配置 `.env` 中的 SMTP 变量。接口会返回通知状态；即使邮件未配置或发送失败，反馈仍会保存在本地。

---

案件分析为异步任务，使用 `GET /api/cases/{caseId}/status` 轮询进度。当前版本不提供 WebSocket 或用户身份认证。
