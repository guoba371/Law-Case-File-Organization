# 贡献指南

感谢您对本项目的关注！本文档说明如何参与项目开发。

## 开发环境设置

### 1. 克隆项目

```bash
git clone <repository-url>
cd Law-Case-File-Organization
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境

```bash
cp .env.example .env
# 编辑 .env 填入开发用的 API 密钥
```

### 4. 运行开发服务器

```bash
npm run dev
```

## 开发流程

### 分支策略

- `main`: 主分支，保持稳定可部署
- `develop`: 开发分支
- `feature/xxx`: 新功能分支
- `bugfix/xxx`: 问题修复分支
- `hotfix/xxx`: 紧急修复分支

### 提交代码

1. 创建功能分支

```bash
git checkout -b feature/your-feature-name
```

2. 进行开发并提交

```bash
git add .
git commit -m "feat: 添加新功能描述"
```

3. 运行验证

```bash
npm run validate
```

4. 推送并创建 Pull Request

```bash
git push origin feature/your-feature-name
```

### 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式：

```
<类型>(<范围>): <描述>

[可选的正文]

[可选的脚注]
```

**类型**：
- `feat`: 新功能
- `fix`: 问题修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构（既不是新功能也不是修复）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

**示例**：
```
feat(documents): 添加文书批量生成功能

- 支持同时生成多个文书
- 添加进度跟踪
- 优化模型调用次数

Closes #123
```

## 代码规范

### JavaScript 风格

遵循 ESLint 配置：

```bash
# 检查代码
npm run lint

# 自动修复
npm run lint:fix
```

### 格式化

使用 Prettier：

```bash
# 格式化代码
npm run format

# 检查格式
npm run format:check
```

### 命名约定

- **文件名**: 小写字母，使用连字符（kebab-case）
  - ✅ `case-analysis.js`
  - ❌ `caseAnalysis.js`, `case_analysis.js`

- **变量和函数**: 驼峰命名（camelCase）
  - ✅ `getUserName()`, `caseId`
  - ❌ `get_user_name()`, `case_id`

- **类名**: 大驼峰命名（PascalCase）
  - ✅ `class CaseManager`
  - ❌ `class caseManager`

- **常量**: 全大写，下划线分隔
  - ✅ `const MAX_FILE_SIZE = 50`
  - ❌ `const maxFileSize = 50`

### 注释规范

- 使用中文注释
- 关键业务逻辑必须添加注释
- 复杂算法需要说明思路

```javascript
// ✅ 好的注释
// 根据案件代号映射表替换敏感信息，保持同案一致性
function redactSensitiveInfo(text, mappingTable) {
  // ...
}

// ❌ 不必要的注释
// 返回用户名
function getUserName() {
  return user.name; // 返回名字
}
```

## 测试

### 编写测试

所有新功能都应该包含测试：

```javascript
// test/your-feature.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('功能模块', () => {
  it('应该正确处理输入', () => {
    const result = yourFunction(input);
    assert.strictEqual(result, expected);
  });
});
```

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch
```

### 测试覆盖率目标

- 核心业务逻辑: 80%+
- 工具函数: 90%+
- 错误处理: 必须覆盖

## 文档

### 更新文档

代码变更时，同步更新相关文档：

- `README.md`: 项目说明和快速开始
- `docs/API.md`: API 接口变更
- `CHANGELOG.md`: 记录变更
- 代码注释: 复杂逻辑说明

### 文档风格

- 使用清晰的标题层级
- 提供代码示例
- 说明参数和返回值
- 标注注意事项

## Pull Request 清单

提交 PR 前请确认：

- [ ] 代码已通过 `npm run validate`
- [ ] 添加了必要的测试
- [ ] 更新了相关文档
- [ ] 提交信息符合规范
- [ ] 没有遗留的调试代码
- [ ] 没有敏感信息（API Key、密码等）

## 代码审查

### 审查者关注点

- 功能是否符合需求
- 代码逻辑是否正确
- 是否有潜在的安全问题
- 性能是否合理
- 代码可读性
- 测试覆盖率

### 被审查者

- 积极回应审查意见
- 清楚说明设计决策
- 及时更新代码
- 保持专业和友好

## 问题报告

### 报告 Bug

使用 Issue 模板，包含：

1. **问题描述**: 简洁明确的描述
2. **复现步骤**: 详细的重现方式
3. **预期行为**: 应该发生什么
4. **实际行为**: 实际发生了什么
5. **环境信息**: Node.js 版本、操作系统等
6. **日志信息**: 相关的错误日志
7. **截图**: 如果适用

### 功能请求

说明：

1. **需求背景**: 为什么需要这个功能
2. **使用场景**: 具体的应用场景
3. **期望方案**: 您期望的实现方式
4. **替代方案**: 其他可能的方案

## 安全问题

**请勿公开报告安全漏洞！**

如发现安全问题，请通过以下方式私密报告：

- 邮件联系项目维护者
- 说明漏洞详情和影响范围
- 提供复现步骤（如果可能）

我们会尽快响应并协调修复。

## 开发最佳实践

### 1. 数据安全

```javascript
// ✅ 过滤敏感信息
logger.info('处理案件', { caseId, status });

// ❌ 记录敏感数据
logger.info('处理案件', { apiKey, personalInfo });
```

### 2. 错误处理

```javascript
// ✅ 使用自定义错误
throw new ValidationError('案件编号格式不正确');

// ❌ 抛出字符串
throw '案件编号格式不正确';
```

### 3. 异步处理

```javascript
// ✅ 使用 async/await
async function processCase(caseId) {
  try {
    const data = await fetchCaseData(caseId);
    return await analyzeData(data);
  } catch (error) {
    logger.error('处理失败', { caseId, error: error.message });
    throw error;
  }
}

// ❌ 回调地狱
function processCase(caseId, callback) {
  fetchCaseData(caseId, (err, data) => {
    if (err) return callback(err);
    analyzeData(data, (err, result) => {
      if (err) return callback(err);
      callback(null, result);
    });
  });
}
```

### 4. 资源清理

```javascript
// ✅ 确保资源释放
const limiter = new RateLimiter();
try {
  // 使用 limiter
} finally {
  limiter.stop();
}
```

### 5. 输入验证

```javascript
// ✅ 验证所有外部输入
function createCase(data) {
  validate.required(data.title, '案件标题');
  validate.string(data.title, '案件标题', { maxLength: 200 });
  // ...
}
```

## 获取帮助

- 查看现有文档和示例代码
- 搜索已有的 Issues
- 在开发群组中提问
- 联系项目维护者

## 行为准则

- 尊重所有贡献者
- 保持专业和友好的交流
- 接受建设性批评
- 关注项目目标
- 保护用户隐私和数据安全

---

感谢您的贡献！
