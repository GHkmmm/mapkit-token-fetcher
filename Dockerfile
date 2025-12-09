# 使用 Playwright 官方镜像，内置 Chromium 浏览器
FROM mcr.microsoft.com/playwright:v1.57.0-noble

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制源码和配置
COPY tsconfig.json ./
COPY src ./src

# 安装开发依赖并构建
RUN npm install && npm run build && npm prune --production

# 创建数据目录
RUN mkdir -p /app/data

# 设置环境变量
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV DATA_DIR=/app/data

# 默认使用 headless 模式
ENV HEADLESS=true

# 入口点
ENTRYPOINT ["node", "dist/cli.js"]

# 默认命令
CMD ["--help"]
