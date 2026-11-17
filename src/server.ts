import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore } from './task-manager.js';
import { createNotifier, type Notifier } from './notifier.js';
import { loadFullConfig } from './config.js';
import { refreshMapKitToken } from './browser.js';
import { asOperationError, abortable, browserRecoveryRequired, OperationError, within } from './runtime.js';
import { cleanupMessage, writeTokenFile } from './results.js';
import type { FullConfig, Task } from './types.js';

interface ServerOptions { port?: number; headless?: boolean; authCache?: boolean; out?: string }
interface Dependencies {
  store?: TaskStore;
  refresh?: typeof refreshMapKitToken;
  notifier?: Notifier;
  recoveryRequired?: () => boolean;
  writeToken?: typeof writeTokenFile;
}

/** Injectable boundaries allow route/lifecycle tests without Apple or webhook access. */
export function createRefreshApp(config: FullConfig, options: ServerOptions = {}, dependencies: Dependencies = {}) {
  const store = dependencies.store ?? new TaskStore();
  const refresh = dependencies.refresh ?? refreshMapKitToken;
  const recoveryRequired = dependencies.recoveryRequired ?? browserRecoveryRequired;
  const persist = dependencies.writeToken ?? writeTokenFile;
  const port = options.port ?? config.server?.port ?? 3010;
  const baseUrl = config.server?.base_url ?? `http://localhost:${port}`;
  const notifier = dependencies.notifier ?? createNotifier(config.notification, baseUrl);
  const app = express();
  const publicPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  let stopping = false;
  const cleanupTimer = setInterval(() => store.cleanupExpiredTasks(), 10 * 60_000);
  cleanupTimer.unref();

  const notify = async (send: Promise<void>) => {
    await within(send, 10_000, new Error('通知超时')).catch(() => console.error('⚠️ 任务通知发送失败或超时'));
  };
  async function execute(task: Task): Promise<void> {
    const signal = store.getSignal(task.id);
    try {
      store.updateTaskStatus(task.id, 'running');
      console.log(`🚀 开始执行任务: ${task.id}`);
      const result = await refresh(config.apple.username, config.apple.password,
        options.headless ?? true, options.authCache ?? true, async () => {
          signal.throwIfAborted();
          const code = store.waitForVerificationCode(task.id);
          await abortable(notify(notifier.sendVerificationRequired(task.id, `${baseUrl}/refresh?taskId=${task.id}`)), signal);
          return code;
        }, { signal });
      signal.throwIfAborted();
      if (options.out) {
        try { await abortable(persist(options.out, result.token, signal), signal); }
        catch (error) {
          signal.throwIfAborted();
          throw new OperationError('TOKEN_OUTPUT_FAILED', `Token 输出文件写入失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      signal.throwIfAborted();
      store.complete(task.id, 'completed', result);
    } catch (error) {
      const failure = asOperationError(signal.aborted ? signal.reason : error);
      store.complete(task.id, ['TASK_TIMEOUT', 'VERIFICATION_TIMEOUT'].includes(failure.code) ? 'timeout' : 'failed', { error: failure.message, errorCode: failure.code });
    }
  }

  async function run(task: Task): Promise<void> {
    try {
      await execute(task);
    } finally {
      store.releaseTask(task.id);
    }
    const current = store.getTask(task.id)!;
    const result = current.result;
    const message = current.status === 'completed'
      ? `${result?.warnings?.length ? '刷新成功，但清理未全部完成' : 'Token 刷新成功'}\n${result?.cleanup ? cleanupMessage(result.cleanup) : ''}\n${result?.warnings?.join('\n') ?? ''}`
      : `${result?.errorCode ?? current.status}: ${result?.error ?? '任务结束'}`;
    await notify(notifier.sendTaskCompleted(task.id, current.status === 'completed', message));
  }

  app.use(express.json());
  app.use(express.static(publicPath));
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });

  const start = (res: Response, retryId?: string) => {
    if (stopping || recoveryRequired()) {
      res.status(503).json({ success: false, errorCode: 'BROWSER_RECOVERY_REQUIRED', error: '服务正在退出或浏览器回收异常，请重启服务' });
      return;
    }
    if (retryId) {
      const old = store.getTask(retryId);
      if (!old) { res.status(404).json({ success: false, error: '任务不存在' }); return; }
      if (!['timeout', 'cancelled', 'failed'].includes(old.status)) {
        res.status(400).json({ success: false, error: `无法重试状态为 ${old.status} 的任务` }); return;
      }
    }
    const existing = store.getActiveTask();
    const task = existing ?? store.createTask();
    res.json({ success: true, taskId: task.id, status: task.status });
    if (!existing) void run(task).catch(() => console.error(`❌ 任务执行异常: ${task.id}`));
  };
  app.post('/api/refresh', (_req, res) => start(res));
  app.post('/api/task/:taskId/retry', (req: Request<{ taskId: string }>, res: Response) => start(res, req.params.taskId));
  app.get('/api/task/:taskId', (req: Request<{ taskId: string }>, res: Response) => {
    const task = store.getTask(req.params.taskId);
    if (!task) { res.status(404).json({ success: false, error: '任务不存在' }); return; }
    const { id, status, createdAt, expiresAt, deadlineAt, result } = task;
    res.json({ success: true, task: { id, status, createdAt, expiresAt, deadlineAt, result } });
  });
  app.post('/api/task/:taskId/verify', (req: Request<{ taskId: string }>, res: Response) => {
    const task = store.getTask(req.params.taskId);
    if (!task) { res.status(404).json({ success: false, error: '任务不存在' }); return; }
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) { res.status(400).json({ success: false, error: '验证码必须是 6 位数字' }); return; }
    if (!store.submitVerificationCode(task.id, code)) { res.status(400).json({ success: false, error: `当前状态不允许提交验证码: ${task.status}` }); return; }
    res.json({ success: true, message: '验证码已提交，正在验证...' });
  });
  app.post('/api/task/:taskId/cancel', (req: Request<{ taskId: string }>, res: Response) => {
    const task = store.getTask(req.params.taskId);
    if (!task) { res.status(404).json({ success: false, error: '任务不存在' }); return; }
    if (!store.cancelTask(task.id)) { res.status(400).json({ success: false, error: `无法取消状态为 ${task.status} 的任务` }); return; }
    res.json({ success: true, message: '任务已取消，正在释放浏览器' });
  });
  app.get('/refresh', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')));
  return { app, store, shutdown() { stopping = true; clearInterval(cleanupTimer); store.shutdown(); } };
}

export function startServer(options: ServerOptions): void {
  const config = loadFullConfig();
  const service = createRefreshApp(config, options);
  const port = options.port ?? config.server?.port ?? 3010;
  const server = service.app.listen(port, () => console.log(`🍎 MapKit Token Refresh Server: http://localhost:${port}`));
  const shutdown = () => {
    service.shutdown();
    server.close();
    server.closeIdleConnections();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
