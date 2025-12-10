<div align="center">
  <h1>MapKit Token Fetcher</h1>
</div>

因业务需要在服务端调用 [MapKit Server API](https://developer.apple.com/documentation/AppleMapsServerAPI)，但此 API 需要创建 Token 后才能调用（并且 Token 过期时间很短）。由于身处中国大陆地区，无法直接通过 API 的方式创建/刷新 Token，需要频繁地在 [苹果开发者后台](https://developer.apple.com/account/resources/services/maps-tokens) 手动创建。手动创建的 Token 7 天过期，每一个星期都要创建一个并同步到服务端，十分繁琐。

`mapkit-token-fetcher` 应运而生，基于 Playwright ，自动化完成 Token 创建与刷新。

## 功能特性

- 🐳 支持 Docker 部署（内置 Chromium）
- 🖥️ 支持 headed/headless 两种浏览器模式
- 📄 通过配置文件管理账号密码
- 🔐 自动处理两步验证和信任浏览器
- 📤 Token 直接输出到 stdout 或文件

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
