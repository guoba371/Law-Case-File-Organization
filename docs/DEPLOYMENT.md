# 部署指南

本文档说明如何在不同环境中部署本系统。

当前服务默认仅绑定 `127.0.0.1`，且没有用户认证或案件级权限控制，适用范围是安装服务的本机。不要按下方 Docker、反向代理或防火墙示例将服务开放给其他机器；容器和代理部署尚未适配本机监听限制。

## 环境要求

- **Node.js**: >= 22.13
- **操作系统**: Windows 10/11, macOS 12+, Linux (Ubuntu 20.04+)
- **内存**: 最低 2GB，推荐 4GB+
- **磁盘空间**: 最低 10GB（用于案件文件存储）
- **网络**: 需要访问模型服务 API（DeepSeek、Kimi 或智谱 GLM）

## 本地开发环境部署

### 1. 克隆项目（如适用）

```bash
git clone <repository-url>
cd Law-Case-File-Organization
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入您的 API 密钥
notepad .env  # Windows
nano .env     # Linux/macOS
```

可选配置项：
- `DEEPSEEK_API_KEY`、`KIMI_API_KEY` 或 `ZHIPU_API_KEY`：在服务端提供模型后台密钥；也可在模型设置页配置
- `PORT`：监听端口（默认 3000）

### 4. 启动开发服务器

```bash
npm run dev
```

开发服务器会自动监听文件变化并重启。

### 5. 验证部署

访问 http://127.0.0.1:3000/health 检查服务状态：

```bash
curl http://127.0.0.1:3000/health
```

预期响应：
```json
{
  "status": "ok",
  "timestamp": "2025-01-20T12:00:00.000Z",
  "uptime": 123.456,
  "environment": "development",
  "version": "0.1.0"
}
```

## 生产环境部署

### 1. 环境准备

```bash
# 设置生产环境变量
export NODE_ENV=production
export PORT=3000
export DEEPSEEK_API_KEY=your-production-key

# 或使用 .env 文件
echo "NODE_ENV=production" >> .env
```

### 2. 安装依赖（仅生产依赖）

```bash
npm install --production
```

### 3. 启动服务

```bash
npm start
```

### 4. 使用进程管理器（推荐）

#### 使用 PM2

```bash
# 全局安装 PM2
npm install -g pm2

# 启动应用
pm2 start src/server.js --name law-case-system

# 查看状态
pm2 status

# 查看日志
pm2 logs law-case-system

# 设置开机自启
pm2 startup
pm2 save

# 重启应用
pm2 restart law-case-system

# 停止应用
pm2 stop law-case-system
```

#### 使用 systemd (Linux)

创建服务文件 `/etc/systemd/system/law-case-system.service`：

```ini
[Unit]
Description=Law Case File Organization System
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/Law-Case-File-Organization
Environment="NODE_ENV=production"
EnvironmentFile=/path/to/Law-Case-File-Organization/.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable law-case-system
sudo systemctl start law-case-system
sudo systemctl status law-case-system
```

## Docker 部署

### 1. 创建 Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用代码
COPY . .

# 创建数据目录
RUN mkdir -p data/cases data/documents data/samples data/logs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["npm", "start"]
```

### 2. 创建 docker-compose.yml

```yaml
version: '3.8'

services:
  law-case-system:
    build: .
    container_name: law-case-system
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    networks:
      - law-case-network

networks:
  law-case-network:
    driver: bridge
```

### 3. 构建和运行

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

## 反向代理配置（可选）

### Nginx 配置

如果需要通过域名访问或启用 HTTPS，可以配置 Nginx 反向代理：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 仅允许内网访问
    allow 192.168.0.0/16;
    allow 10.0.0.0/8;
    deny all;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # 文件上传大小限制
        client_max_body_size 100M;
    }
}
```

## 数据备份

### 自动备份脚本

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/path/to/backups"
DATA_DIR="/path/to/Law-Case-File-Organization/data"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 压缩数据目录
tar -czf "$BACKUP_DIR/data_backup_$DATE.tar.gz" -C "$DATA_DIR" .

# 保留最近 30 天的备份
find "$BACKUP_DIR" -name "data_backup_*.tar.gz" -mtime +30 -delete

echo "备份完成: $BACKUP_DIR/data_backup_$DATE.tar.gz"
```

设置定时任务（crontab）：

```bash
# 每天凌晨 2 点备份
0 2 * * * /path/to/backup.sh >> /var/log/law-case-backup.log 2>&1
```

## 监控和日志

### 日志位置

- **应用日志**: `data/logs/YYYY-MM-DD.log`
- **PM2 日志**: `~/.pm2/logs/`
- **systemd 日志**: `journalctl -u law-case-system`

### 日志轮转配置

创建 `/etc/logrotate.d/law-case-system`：

```
/path/to/Law-Case-File-Organization/data/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 your-user your-group
}
```

## 安全加固

### 1. 防火墙配置

```bash
# UFW (Ubuntu)
sudo ufw allow from 192.168.0.0/16 to any port 3000
sudo ufw enable

# firewalld (CentOS)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.0.0/16" port port="3000" protocol="tcp" accept'
sudo firewall-cmd --reload
```

### 2. 文件权限

```bash
# 设置数据目录权限
chmod 700 data
chmod 600 .env

# 仅应用用户可访问
chown -R your-user:your-group .
```

### 3. 环境变量保护

- 不要将 `.env` 文件提交到版本控制
- 生产环境使用专用的 API 密钥
- 定期轮换 API 密钥

## 性能优化

### 1. Node.js 调优

```bash
# 增加内存限制（如需要）
node --max-old-space-size=4096 src/server.js
```

### 2. 并发限制

在 `.env` 中调整：

```env
QUEUE_CONCURRENCY=4
RATE_LIMIT_PER_MINUTE=200
```

## 故障排查

### 服务无法启动

```bash
# 检查端口占用
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# 检查日志
tail -f data/logs/$(date +%Y-%m-%d).log

# 检查配置
npm run validate
```

### 内存占用过高

```bash
# 查看进程内存使用
ps aux | grep node

# 重启服务释放内存
pm2 restart law-case-system
```

### API 调用失败

- 检查 API 密钥是否正确
- 验证网络连接：`curl https://api.deepseek.com`
- 查看错误日志中的详细信息

## 升级指南

### 1. 备份数据

```bash
./backup.sh
```

### 2. 更新代码

```bash
git pull origin main
npm install
```

### 3. 重启服务

```bash
pm2 restart law-case-system
# 或
sudo systemctl restart law-case-system
```

### 4. 验证升级

```bash
curl http://127.0.0.1:3000/health
```

---

**注意**：生产部署前请务必：
1. 完成安全评估
2. 设置适当的备份策略
3. 配置监控告警
4. 进行负载测试
