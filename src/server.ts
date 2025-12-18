import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  createTask, 
  getTask, 
  submitVerificationCode, 
  cancelTask, 
  retryTask,
  updateTaskStatus,
  setTaskResult,
  waitForVerificationCode
} from './task-manager.js';
import { createNotifier, Notifier } from './notifier.js';
import { loadFullConfig } from './config.js';
import { refreshMapKitToken } from './browser.js';
import { writeFileSync } from 'fs';

// ESM 环境下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let notifier: Notifier;
let serverConfig: { port: number; base_url?: string };
let appleConfig: { username: string; password: string };
let outputPath: string | undefined;
let headless: boolean = true;
let useAuthCache: boolean = true;

/**
 * 启动 HTTP Server
 */
export function startServer(options: {
  port?: number;
  headless?: boolean;
  authCache?: boolean;
  out?: string;
}): void {
  const config = loadFullConfig();
  
  appleConfig = config.apple;
  serverConfig = {
    port: options.port || config.server?.port || 3000,
    base_url: config.server?.base_url
  };
  headless = options.headless ?? true;
  useAuthCache = options.authCache ?? true;
  outputPath = options.out;

  // 创建通知器
  const baseUrl = serverConfig.base_url || `http://localhost:${serverConfig.port}`;
  notifier = createNotifier(config.notification, baseUrl);

  const app = express();

  // 中间件
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // CORS 支持（开发环境）
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // ========== API 路由 ==========

  /**
   * POST /api/refresh - 触发刷新任务
   */
  app.post('/api/refresh', async (req: Request, res: Response) => {
    try {
      const task = createTask();
      console.log(`🆕 创建任务: ${task.id}`);

      res.json({
        success: true,
        taskId: task.id,
        status: task.status
      });

      // 异步执行刷新任务
      executeRefreshTask(task.id);
    } catch (error) {
      console.error('❌ 创建任务失败:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '创建任务失败'
      });
    }
  });

  /**
   * GET /api/task/:taskId - 获取任务状态
   */
  app.get('/api/task/:taskId', (req: Request, res: Response) => {
    const { taskId } = req.params;
    const task = getTask(taskId);

    if (!task) {
      res.status(404).json({
        success: false,
        error: '任务不存在'
      });
      return;
    }

    res.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        createdAt: task.createdAt,
        expiresAt: task.expiresAt,
        result: task.result
      }
    });
  });

  /**
   * POST /api/task/:taskId/verify - 提交验证码
   */
  app.post('/api/task/:taskId/verify', (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { code } = req.body;

    if (!code) {
      res.status(400).json({
        success: false,
        error: '请提供验证码'
      });
      return;
    }

    // 验证码格式检查
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({
        success: false,
        error: '验证码必须是 6 位数字'
      });
      return;
    }

    const task = getTask(taskId);
    if (!task) {
      res.status(404).json({
        success: false,
        error: '任务不存在'
      });
      return;
    }

    if (task.status === 'timeout') {
      res.status(400).json({
        success: false,
        error: '任务已超时，请重新发起'
      });
      return;
    }

    if (task.status !== 'waiting_verification') {
      res.status(400).json({
        success: false,
        error: `当前状态不允许提交验证码: ${task.status}`
      });
      return;
    }

    const submitted = submitVerificationCode(taskId, code);
    if (submitted) {
      console.log(`✅ 验证码已提交: ${taskId}`);
      res.json({
        success: true,
        message: '验证码已提交，正在验证...'
      });
    } else {
      res.status(400).json({
        success: false,
        error: '验证码提交失败'
      });
    }
  });

  /**
   * POST /api/task/:taskId/cancel - 取消任务
   */
  app.post('/api/task/:taskId/cancel', (req: Request, res: Response) => {
    const { taskId } = req.params;
    const cancelled = cancelTask(taskId);

    if (cancelled) {
      console.log(`🚫 任务已取消: ${taskId}`);
      res.json({
        success: true,
        message: '任务已取消'
      });
    } else {
      const task = getTask(taskId);
      if (!task) {
        res.status(404).json({
          success: false,
          error: '任务不存在'
        });
      } else {
        res.status(400).json({
          success: false,
          error: `无法取消状态为 ${task.status} 的任务`
        });
      }
    }
  });

  /**
   * POST /api/task/:taskId/retry - 重新发起任务
   */
  app.post('/api/task/:taskId/retry', async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const newTask = retryTask(taskId);

    if (newTask) {
      console.log(`🔄 重新发起任务: ${taskId} -> ${newTask.id}`);
      res.json({
        success: true,
        taskId: newTask.id,
        status: newTask.status
      });

      // 异步执行刷新任务
      executeRefreshTask(newTask.id);
    } else {
      const task = getTask(taskId);
      if (!task) {
        res.status(404).json({
          success: false,
          error: '任务不存在'
        });
      } else {
        res.status(400).json({
          success: false,
          error: `无法重试状态为 ${task.status} 的任务`
        });
      }
    }
  });

  /**
   * GET /refresh - 验证码输入页面
   */
  app.get('/refresh', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // 启动服务器
  app.listen(serverConfig.port, () => {
    console.log('');
    console.log('🍎 MapKit Token Refresh Server');
    console.log('═══════════════════════════════════════');
    console.log(`🌐 服务地址: http://localhost:${serverConfig.port}`);
    if (serverConfig.base_url) {
      console.log(`🔗 外部地址: ${serverConfig.base_url}`);
    }
    console.log(`🖥️  无头模式: ${headless ? '是' : '否'}`);
    console.log(`💾 登录缓存: ${useAuthCache ? '是' : '否'}`);
    if (outputPath) {
      console.log(`📄 输出路径: ${outputPath}`);
    }
    console.log('═══════════════════════════════════════');
    console.log('');
    console.log('📡 API 端点:');
    console.log('  POST /api/refresh           - 触发刷新任务');
    console.log('  GET  /api/task/:taskId      - 获取任务状态');
    console.log('  POST /api/task/:taskId/verify - 提交验证码');
    console.log('  POST /api/task/:taskId/cancel - 取消任务');
    console.log('  POST /api/task/:taskId/retry  - 重新发起任务');
    console.log('');
    console.log('💡 按 Ctrl+C 停止服务器');
  });
}

/**
 * 执行刷新任务
 */
async function executeRefreshTask(taskId: string): Promise<void> {
  const baseUrl = serverConfig.base_url || `http://localhost:${serverConfig.port}`;

  try {
    updateTaskStatus(taskId, 'running');
    console.log(`🚀 开始执行任务: ${taskId}`);

    // 创建验证码提供者
    const verificationCodeProvider = async (): Promise<string | null> => {
      // 发送通知
      const verifyUrl = `${baseUrl}/refresh?taskId=${taskId}`;
      console.log(`📱 等待验证码，页面地址: ${verifyUrl}`);
      await notifier.sendVerificationRequired(taskId, verifyUrl);

      // 等待验证码
      const code = await waitForVerificationCode(taskId);
      return code;
    };

    // 执行刷新
    const token = await refreshMapKitToken(
      appleConfig.username,
      appleConfig.password,
      headless,
      useAuthCache,
      verificationCodeProvider
    );

    if (token) {
      updateTaskStatus(taskId, 'completed');
      setTaskResult(taskId, { token });
      console.log(`✅ 任务完成: ${taskId}`);

      // 保存到文件
      if (outputPath) {
        writeFileSync(outputPath, token, 'utf-8');
        console.log(`📄 Token 已保存到: ${outputPath}`);
      }

      // 发送完成通知
      await notifier.sendTaskCompleted(taskId, true, 'Token 刷新成功');
    } else {
      const task = getTask(taskId);
      if (task?.status === 'cancelled') {
        console.log(`🚫 任务已取消: ${taskId}`);
        await notifier.sendTaskCompleted(taskId, false, '任务已取消');
      } else if (task?.status === 'timeout') {
        console.log(`⏰ 任务超时: ${taskId}`);
        await notifier.sendTaskCompleted(taskId, false, '验证码输入超时');
      } else {
        updateTaskStatus(taskId, 'failed');
        setTaskResult(taskId, { error: 'Token 刷新失败' });
        console.log(`❌ 任务失败: ${taskId}`);
        await notifier.sendTaskCompleted(taskId, false, 'Token 刷新失败');
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    updateTaskStatus(taskId, 'failed');
    setTaskResult(taskId, { error: errorMsg });
    console.error(`❌ 任务出错: ${taskId}`, error);
    await notifier.sendTaskCompleted(taskId, false, errorMsg);
  }
}
