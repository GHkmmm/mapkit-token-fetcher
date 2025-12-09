# MapKit Token Refresh Tool

自动刷新 Apple MapKit Server Token 的命令行工具，基于 Playwright 实现浏览器自动化操作。

## 功能特性

- 🚀 使用 `npx` 命令快速调用
- 🐳 支持 Docker 部署（内置 Chromium）
- 🖥️ 支持 headed/headless 两种浏览器模式
- 📄 通过配置文件管理账号密码
- 🔐 自动处理两步验证和信任浏览器
- 📤 Token 直接输出到 stdout

## 快速开始

### 方式一：Docker 部署（推荐）

#### 1. 构建镜像

```bash
docker build -t mapkit-token-fetcher .
```

#### 2. 准备配置文件

在项目根目录创建 `config.yaml` 文件：

```yaml
# config.yaml
apple:
  username: your-apple-id@example.com
  password: your-password
```

#### 3. 运行容器

> ⚠️ **重要**：如需输入两步验证码，必须使用 `-it` 参数启用交互式终端！

**首次运行（需要两步验证）：**

```bash
docker run --rm -it \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/data:/app/data \
  mapkit-token-fetcher get --headless
```

**后续运行（已有认证缓存）：**

```bash
docker run --rm \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/data:/app/data \
  mapkit-token-fetcher get --headless
```

**刷新（创建新）Token：**

```bash
docker run --rm -it \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -v $(pwd)/data:/app/data \
  mapkit-token-fetcher refresh --headless
```

**查看帮助：**

```bash
docker run --rm mapkit-token-fetcher --help
```

#### 4. 使用 Docker Compose

```bash
# 获取 Token（交互式，支持两步验证）
docker-compose run --rm mapkit-token-fetcher get --headless

# 刷新 Token
docker-compose run --rm mapkit-token-fetcher refresh --headless
```

#### 5. 定时任务示例（Docker）

```bash
# 每天凌晨 2 点刷新 Token
0 2 * * * docker run --rm -v /path/to/config.yaml:/app/config.yaml:ro -v /path/to/data:/app/data mapkit-token-fetcher refresh --headless >> /var/log/mapkit-token.log 2>&1
```

> **注意**：首次使用需要先在本地完成两步验证，生成 `.auth-state.json` 文件后再复制到服务器的 `data` 目录中。

---

### 方式二：本地安装

#### 1. 安装依赖

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 构建项目
npm run build
```

#### 2. 配置

在项目根目录创建 `config.yaml` 文件，填写您的 Apple Developer 账户凭证：

```yaml
# config.yaml
apple:
  username: your-apple-id@example.com
  password: your-password
```

> ⚠️ **安全提示**: `config.yaml` 包含敏感凭证，该文件已自动添加到 `.gitignore`，请勿手动上传或分享。

您可以参考 `config.yaml.example` 文件作为模板。

#### 3. 使用方法

**刷新 MapKit Token：**

```bash
npm run dev -- refresh
```

**获取现有 Token：**

```bash
npm run dev -- get
```

**仅打开浏览器：**

```bash
npm run dev -- open
```

**将 Token 输出到文件：**

```bash
npm run dev -- get -o ./token.txt
npm run dev -- refresh --out ./new-token.txt
```

## 命令行选项

```
Commands:
  open [options]     打开浏览器并跳转到 Apple Developer 后台
  get [options]      登录并获取现有 MapKit Token
  refresh [options]  登录并创建新的 MapKit Token

get/refresh 选项:
  -o, --out <path>           将 Token 输出到指定文件路径
  --headless                 使用无头模式（默认: false）
  --no-auth-cache            不使用缓存的登录状态（强制重新登录）
```

## 登录流程说明

1. **账号密码登录** - 自动填充账号密码并提交
2. **记住账户** - 自动勾选"记住我的账户"选项
3. **两步验证** - 检测到时会在终端提示输入6位验证码
4. **信任浏览器** - 自动点击"信任"按钮（如出现）
5. **Token 提取** - 登录成功后自动提取并输出 Token

## 登录状态持久化

工具支持缓存登录状态，首次登录后可跳过两步验证：

### 工作原理

- 首次登录成功后，登录状态会保存到 `.auth-state.json` 文件
- 本地运行：保存到项目根目录
- Docker 运行：保存到 `/app/data` 目录（需挂载）
- 后续运行时自动加载该文件，跳过登录和两步验证流程
- 登录状态通常在 30 天内有效

### 使用方式

```bash
# 首次登录（需要两步验证）- 本地
npm run dev -- get

# 后续使用（自动跳过两步验证）
npm run dev -- get

# 强制重新登录（忽略缓存）
npm run dev -- get --no-auth-cache
```

> ⚠️ **安全提示**: `.auth-state.json` 包含敏感的登录凭证，该文件已自动添加到 `.gitignore`，请勿手动上传或分享。

## Docker 镜像说明

Docker 镜像基于 `mcr.microsoft.com/playwright:v1.49.1-noble` 构建，已内置：

- Node.js 运行时
- Chromium 浏览器及其依赖
- Playwright 自动化框架

镜像大小约 1.5GB，包含完整的浏览器运行环境。

### 数据目录

容器内的 `/app/data` 目录用于持久化登录状态，建议挂载到宿主机：

```bash
-v /host/path/data:/app/data
```

### 配置文件

容器内的 `/app/config.yaml` 用于读取凭证配置：

```bash
-v /host/path/config.yaml:/app/config.yaml:ro
```

## 项目结构

```
mapkit-token-fetcher/
├── Dockerfile            # Docker 构建文件
├── docker-compose.yml    # Docker Compose 配置
├── .dockerignore         # Docker 构建排除文件
├── package.json          # npm 配置
├── tsconfig.json         # TypeScript 配置
├── README.md             # 项目文档
├── config.yaml           # 凭证配置（需手动创建）
├── config.yaml.example   # 配置文件模板
├── data/                 # 数据目录（Docker 挂载）
│   └── .auth-state.json  # 登录状态缓存
├── src/
│   ├── cli.ts            # CLI 入口
│   ├── browser.ts        # 浏览器自动化
│   ├── config.ts         # 配置文件读取
│   ├── input.ts          # 交互式输入
│   └── types.ts          # 类型定义
└── dist/                 # 编译输出
```

## 常见问题

### Q: Docker 中如何处理两步验证？

A: 首次需要在本地以非 headless 模式运行，完成两步验证后会生成 `.auth-state.json` 文件。将此文件复制到服务器的 `data` 目录后，后续 Docker 运行时会自动加载，跳过两步验证。

### Q: Token 有效期是多久？

A: MapKit Server Token 通常有效期为 1 年。建议定期刷新以确保服务可用性。

### Q: 为什么需要 Chromium？

A: Apple Developer 后台使用复杂的 JavaScript 渲染和安全验证，需要真实浏览器环境才能正确操作。Playwright + Chromium 提供了可靠的浏览器自动化能力。

## License

MIT
