<div align="center">
  <h1>MapKit Token Fetcher</h1>
</div>

因业务需要在服务端调用 [MapKit Server API](https://developer.apple.com/documentation/AppleMapsServerAPI)，但此 API 需要创建 Token 后才能调用（并且 Token 过期时间很短）。由于身处中国大陆地区，无法直接通过 API 的方式创建/刷新 Token，需要频繁地在 [苹果开发者后台](https://developer.apple.com/account/resources/services/maps-tokens) 手动创建。手动创建的 Token 7 天过期，每一个星期都要创建一个并同步到服务端，十分繁琐。

`mapkit-token-fetcher` 应运而生，基于 Playwright，自动化完成 Token 创建与刷新。

## 功能特性

- 🐳 支持 Docker 部署（内置 Chromium）
- 🖥️ 支持 headed/headless 两种浏览器模式
- 📄 通过配置文件管理账号密码
- 🔐 自动处理两步验证和信任浏览器
- 📤 Token 直接输出到 stdout 或文件
- 🌐 **HTTP Server 模式** - 支持远程验证码输入
- 📱 **企业微信通知** - 遇到两步验证时自动发送通知

## 快速开始

### 方式一：Docker 部署（推荐）

#### 1. 克隆仓库

```bash
git clone https://github.com/GHkmmm/mapkit-token-fetcher.git
cd mapkit-token-fetcher
```

#### 2. 准备配置文件

```bash
cp config.yaml.example config.yaml
```

然后编辑 `config.yaml`，填写您的 Apple Developer 账户凭证：

```yaml
# config.yaml
apple:
  username: your-apple-id@example.com
  password: your-password
```

> ⚠️ **安全提示**: `config.yaml` 包含敏感凭证，该文件已自动添加到 `.gitignore`，请勿手动上传或分享。

#### 3. 构建镜像

```bash
docker-compose build
```

#### 4. 运行

> ⚠️ **重要**：如需输入两步验证码，必须使用交互式终端！

**首次运行（需要两步验证）：**

```bash
docker-compose run --rm mapkit-token-fetcher refresh --headless
```

**将 Token 输出到文件：**

```bash
docker-compose run --rm mapkit-token-fetcher refresh --headless -o /app/data/token.txt
```

> **提示**：`-o` 参数指定的路径是容器内路径。由于 `/app/data` 目录已挂载到宿主机的 `./data` 目录，Token 文件会自动同步到宿主机。

**查看帮助：**

```bash
docker-compose run --rm mapkit-token-fetcher --help
```

> **注意**：首次使用需要完成两步验证，生成 `.auth-state.json` 文件后会自动缓存到 `data` 目录。后续运行会自动使用缓存的登录状态，跳过两步验证。

---

### 方式二：本地安装

#### 1. 克隆仓库

```bash
git clone https://github.com/GHkmmm/mapkit-token-fetcher.git
cd mapkit-token-fetcher
```

#### 2. 安装依赖

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 构建项目
npm run build
```

#### 3. 配置

```bash
cp config.yaml.example config.yaml
```

然后编辑 `config.yaml`，填写您的 Apple Developer 账户凭证：

```yaml
# config.yaml
apple:
  username: your-apple-id@example.com
  password: your-password
```

> ⚠️ **安全提示**: `config.yaml` 包含敏感凭证，该文件已自动添加到 `.gitignore`，请勿手动上传或分享。

#### 4. 使用方法

**刷新（创建新）Token：**

```bash
npm run dev -- refresh
```

**将 Token 输出到文件：**

```bash
npm run dev -- refresh -o ./token.txt
npm run dev -- refresh --out ./new-token.txt
```

---

## 🌐 Server 模式（远程验证码输入）

Server 模式适用于服务器定时任务场景。当遇到两步验证时，会通过企业微信机器人发送通知，您可以在手机上点击链接输入验证码，无需登录服务器。

### 配置

在 `config.yaml` 中添加以下配置：

```yaml
apple:
  username: your-apple-id@example.com
  password: your-password

# 通知配置
notification:
  wecom:
    enabled: true
    webhook_url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key

# Server 配置
server:
  port: 3010
  # base_url 用于生成验证码页面链接（发送到企业微信的链接）
  # 如果不填写，则使用内置页面 http://localhost:port
  base_url: https://your-domain.com/tools/mapkit-token-fetcher
```

### 启动 Server

```bash
# 本地开发
npm run dev -- serve

# Docker
docker-compose run -d -p 3010:3010 mapkit-token-fetcher serve --headless -o /app/data/token.txt
```

### 触发刷新任务

```bash
curl -X POST http://localhost:3010/api/refresh
```

返回：
```json
{
  "success": true,
  "taskId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

### 工作流程

1. 服务器配置定时任务，每 5 天调用 `POST /api/refresh`
2. 任务执行时，如遇两步验证，自动发送企业微信通知
3. 您在企业微信点击卡片，进入验证码输入页面
4. 输入 6 位验证码并提交
5. 任务继续执行，完成后再次发送完成通知

### API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/refresh` | POST | 触发刷新任务 |
| `/api/task/:taskId` | GET | 获取任务状态 |
| `/api/task/:taskId/verify` | POST | 提交验证码 `{"code":"123456"}` |
| `/api/task/:taskId/cancel` | POST | 取消任务 |
| `/api/task/:taskId/retry` | POST | 重新发起任务（超时后使用）|
| `/refresh?taskId=xxx` | GET | 验证码输入页面 |

### 验证码超时

验证码输入有 **5 分钟** 的时效。超时后任务自动取消，需要重新发起。

---

## 命令行选项

```
Commands:
  open [options]     打开浏览器并跳转到 Apple Developer 后台
  get [options]      登录并获取现有 MapKit Token
  refresh [options]  登录并创建新的 MapKit Token
  serve [options]    启动 HTTP Server 模式

get/refresh 选项:
  -o, --out <path>           将 Token 输出到指定文件路径
  --headless                 使用无头模式（默认: false）
  --no-auth-cache            不使用缓存的登录状态（强制重新登录）

serve 选项:
  -p, --port <port>          服务端口（默认: 3000）
  -o, --out <path>           将 Token 输出到指定文件路径
  --headless                 使用无头模式（默认: true）
  --no-auth-cache            不使用缓存的登录状态（强制重新登录）
```

