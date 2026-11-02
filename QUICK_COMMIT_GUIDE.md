# 快速提交指南

提交前在仓库根目录运行：

```bash
npm run validate
git status --short
git diff --check
```

确认 `.env`、`.env.local`、`data/` 和案件样本未被暂存后，再暂存需要提交的代码与文档：

```bash
git add <需要提交的文件>
git diff --cached --check
git diff --cached --stat
git commit -m "chore: describe the change"
git push origin main
```

不要用 `git add .` 跳过暂存区检查。案件资料和模型密钥不得提交。
