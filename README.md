# MapKit Token Refresh Tool

自动刷新 Apple MapKit Server Token 的命令行工具，基于 Playwright 实现浏览器自动化操作。

## 功能特性

- 🚀 使用 `npx` 命令快速调用
- 🖥️ 支持 headed/headless 两种浏览器模式
- ⌨️ 交互式终端输入账号密码（密码隐藏显示）
- 🔧 命令行参数支持，可跳过交互
- 🔐 自动处理两步验证和信任浏览器
- 📤 Token 直接输出到 stdout

## 安装

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 构建项目
npm run build
```

## 使用方法

### 刷新 MapKit Token

#### 交互式模式（推荐）

```bash
npm run dev -- refresh
```

程序会提示输入账号和密码，密码输入时完全隐藏：

```
🍎 MapKit Token Refresh Tool
═══════════════════════════════════════

📧 请输入 Apple ID: your@email.com
🔑 请输入密码（输入时不显示）: 
```

#### 参数模式（适用于脚本/定时任务）

```bash
npm run dev -- refresh --username "your@email.com" --password "yourpassword"
```

### 仅打开浏览器

```bash
npm run dev -- open
```

### 命令行选项

```
Commands:
  open [options]     打开浏览器并跳转到 Apple Developer 后台
  refresh [options]  登录并刷新 MapKit Token

refresh 选项:
  -u, --username <username>    Apple ID 用户名
  -p, --password <password>    Apple ID 密码
  --headless                   使用无头模式（默认: false）
```

## 登录流程说明

1. **账号密码登录** - 自动填充账号密码并提交
2. **两步验证** - 检测到时会在终端提示输入6位验证码
3. **信任浏览器** - 自动点击"信任"按钮（如出现）
4. **Token 提取** - 登录成功后自动提取并输出 Token

## Linux 服务器部署

```bash
# 安装系统依赖
npx playwright install-deps chromium

# 定时任务示例（每天凌晨 2 点）
0 2 * * * cd /path/to/tool && node dist/cli.js refresh -u "email" -p "pass" --headless >> /var/log/mapkit-token.log 2>&1
```

## 项目结构

```
mapkit-token-refresh-tool/
├── package.json          # npm 配置
├── tsconfig.json         # TypeScript 配置
├── README.md             # 项目文档
├── src/
│   ├── cli.ts            # CLI 入口
│   ├── browser.ts        # 浏览器自动化
│   ├── input.ts          # 交互式输入
│   └── types.ts          # 类型定义
└── dist/                 # 编译输出
```

## License

MIT
