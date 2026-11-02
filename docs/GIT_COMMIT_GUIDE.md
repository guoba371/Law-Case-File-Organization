# Git 提交指南

## 提交前

从仓库根目录运行验证并检查待提交文件：

```bash
npm run validate
git status --short
git diff --check
```

确认 `.env`、`.env.local`、`data/`、案件样本、API Key 和 SMTP 授权码未进入暂存区。需要时使用 `git check-ignore -v <路径>` 检查忽略规则。

## 暂存与提交

优先按文件暂存，避免将本地配置或数据一并提交：

```bash
git add package.json package-lock.json src test docs README.md
git diff --cached --check
git diff --cached --stat
git commit -m "chore: describe the change"
```

检查暂存区内容后再推送当前分支：

```bash
git push origin main
```

如果当前分支不是 `main`，将命令中的分支名替换为实际分支。推送前先确认 `git status --short --branch` 和远端状态。
