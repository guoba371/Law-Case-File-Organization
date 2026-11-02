# 律所案卷脱敏与可视化分析系统

本系统专为律所刑事案件案卷脱敏与内部研判设计，提供案卷管理、脱敏处理、结构化分析和辅助文书生成等功能。

## 功能特性

- **案卷管理**：支持 PDF、DOCX、TXT 案卷批量导入、材料目录整理
- **脱敏确认**：上传或分析前要求律师确认材料已脱敏
- **结构化分析**：事件提取、人物关系图谱、时间轴可视化
- **辅助文书生成**：质证意见、法律意见书、羁押必要性审查申请（分段确认）
- **模型供应商管理**：支持 DeepSeek、Kimi、智谱 GLM

## 技术架构

- **运行环境**：Node.js >= 22.13
- **核心依赖**：
  - PDF 解析：`pdf-parse`
  - 文档生成：`docx`, `pdfkit`
  - 图谱可视化：`@antv/g6`
  - 流程图：`beautiful-mermaid`

## 快速开始

### 1. 环境准备

```bash
# 安装依赖
npm install

# 复制环境变量配置
cp .env.example .env
```

### 2. 配置模型服务

模型密钥可在模型设置页配置；如需通过环境变量提供后台默认密钥，可编辑 `.env`：

```env
DEEPSEEK_API_KEY=your_api_key_here
PORT=3000
```

### 3. 启动服务

```bash
npm start
```

服务启动后访问：
- 案件管理：http://127.0.0.1:3000/cases
- 模型设置：http://127.0.0.1:3000/settings
- 参考样本：http://127.0.0.1:3000/samples
- 文书生成：http://127.0.0.1:3000/documents

## 数据处理说明

⚠️ **案卷材料可能包含高度敏感信息**

- 案卷文件和分析结果保存在运行本系统的本地 `data/` 目录。
- 创建案件时必须确认材料已脱敏；系统会阻止未确认的案件上传或分析，但不会自动证明脱敏完整。
- 分析和文书生成会将相关材料发送给所选模型供应商。使用前应核实脱敏结果及供应商的数据处理条款。
- 当前版本面向律所内部单机使用，不提供多用户身份认证、案件级权限隔离或完整审计日志。

详见 [PRD 文档](docs/PRD-v0.1.md) 和 [数据边界 ADR](docs/adr/0001-original-material-boundary.md)

## 项目结构

```
.
├── src/                    # 源代码
│   ├── server.js          # HTTP 服务器主入口
│   ├── providers.js       # 模型供应商管理
│   ├── samples.js         # 参考样本管理
│   ├── documents.js       # 文书生成核心逻辑
│   ├── document-export.js # 文档导出（DOCX/PDF）
│   ├── cases.js           # 案件管理服务
│   ├── case-store.js      # 案件数据存储
│   ├── case-upload.js     # 文件上传处理
│   ├── case-queue.js      # 任务队列管理
│   ├── case-analysis.js   # 案件分析（事件/关系提取）
│   ├── case-diagrams.js   # 图谱生成
│   ├── llm-client.js      # 大模型客户端
│   └── feedback.js        # 用户反馈
├── public/                 # 前端静态资源
├── data/                   # 数据存储目录
│   ├── documents/         # 生成的文书
│   ├── samples/           # 参考样本
│   └── cases/             # 案件文件
├── docs/                   # 项目文档
│   ├── PRD-v0.1.md        # 产品需求文档
│   ├── CONTEXT.md         # 领域词汇表
│   └── adr/               # 架构决策记录
└── test/                   # 测试文件

```

## 开发指南

### 运行测试

```bash
npm test
```

### 代码规范

- 使用 ESLint 进行代码检查
- 提交前运行 `npm test` 确保测试通过
- 关键业务逻辑需添加中文注释

### API 文档

主要 API 端点：

- `GET /api/cases` - 获取案件列表
- `POST /api/cases` - 创建新案件
- `GET /api/cases/:id` - 获取案件详情
- `POST /api/cases/:id/process` - 提交案件分析任务
- `GET /api/cases/:id/status` - 查询分析状态
- `POST /api/documents` - 生成辅护文书
- `GET /api/documents/:id/export?format=docx` - 导出文书

详细 API 说明见 [API.md](docs/API.md)。

## 部署说明

### 本地部署（推荐用于原始材料处理）

```bash
# 生产模式启动
NODE_ENV=production npm start
```

### 配置说明

- `PORT`：服务监听端口（默认 3000）
- `DEEPSEEK_API_KEY`：DeepSeek API 密钥
- `KIMI_API_KEY`、`ZHIPU_API_KEY`：其他模型供应商密钥（可选）

## 安全注意事项

1. **API 密钥保护**：切勿将 `.env` 文件提交到版本控制
2. **敏感数据**：原始案卷文件存储在 `data/` 目录，已在 `.gitignore` 中排除
3. **内部使用**：服务默认仅监听 `127.0.0.1`，不要直接暴露到公网或未受控的局域网

## 故障排查

### 常见问题

**Q: 启动时提示端口被占用？**
```bash
# 修改 .env 中的 PORT 配置或关闭占用进程
lsof -ti:3000 | xargs kill -9  # macOS/Linux
netstat -ano | findstr :3000   # Windows
```

**Q: 模型调用失败？**
- 检查 API Key 是否正确配置
- 确认网络可访问模型服务
- 查看控制台日志获取详细错误信息

**Q: PDF 解析失败？**
- 确认 PDF 文件未加密
- 检查单文件大小是否超过 100MB
- 扫描件需要 OCR 支持（待实现）

## 许可证

Private - 仅供本所内部使用

## 联系方式

如有问题或建议，请联系项目负责人。

---

**版本**：v0.1.0
