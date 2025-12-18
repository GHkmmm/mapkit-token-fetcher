import { v4 as uuidv4 } from 'uuid';
import { Task, TaskStatus } from './types.js';

// 验证码超时时间（5 分钟）
const VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;

// 任务存储（内存）
const tasks: Map<string, Task> = new Map();

// 验证码等待回调
const verificationCallbacks: Map<string, {
  resolve: (code: string | null) => void;
  timer: NodeJS.Timeout;
}> = new Map();

/**
 * 创建新任务
 */
export function createTask(): Task {
  const now = new Date();
  const task: Task = {
    id: uuidv4(),
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + VERIFICATION_TIMEOUT_MS),
  };
  tasks.set(task.id, task);
  return task;
}

/**
 * 获取任务
 */
export function getTask(taskId: string): Task | null {
  const task = tasks.get(taskId);
  if (!task) return null;

  // 检查是否超时
  if (task.status === 'waiting_verification' && new Date() > task.expiresAt) {
    task.status = 'timeout';
    // 触发等待中的回调
    const callback = verificationCallbacks.get(taskId);
    if (callback) {
      clearTimeout(callback.timer);
      callback.resolve(null);
      verificationCallbacks.delete(taskId);
    }
  }

  return task;
}

/**
 * 更新任务状态
 */
export function updateTaskStatus(taskId: string, status: TaskStatus): boolean {
  const task = tasks.get(taskId);
  if (!task) return false;
  task.status = status;
  return true;
}

/**
 * 设置任务结果
 */
export function setTaskResult(taskId: string, result: { token?: string; error?: string }): boolean {
  const task = tasks.get(taskId);
  if (!task) return false;
  task.result = result;
  return true;
}

/**
 * 提交验证码
 * @returns 是否成功提交（任务存在且状态正确）
 */
export function submitVerificationCode(taskId: string, code: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  
  // 只有在等待验证码状态时才能提交
  if (task.status !== 'waiting_verification') {
    return false;
  }

  // 验证码格式检查
  if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
    return false;
  }

  task.verificationCode = code;
  task.status = 'verifying';

  // 触发等待中的回调
  const callback = verificationCallbacks.get(taskId);
  if (callback) {
    clearTimeout(callback.timer);
    callback.resolve(code);
    verificationCallbacks.delete(taskId);
  }

  return true;
}

/**
 * 等待验证码提交
 * @param taskId 任务 ID
 * @returns 验证码或 null（超时）
 */
export function waitForVerificationCode(taskId: string): Promise<string | null> {
  const task = getTask(taskId);
  if (!task) return Promise.resolve(null);

  // 更新状态为等待验证
  task.status = 'waiting_verification';
  // 重置过期时间
  task.expiresAt = new Date(Date.now() + VERIFICATION_TIMEOUT_MS);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const t = tasks.get(taskId);
      if (t && t.status === 'waiting_verification') {
        t.status = 'timeout';
      }
      verificationCallbacks.delete(taskId);
      resolve(null);
    }, VERIFICATION_TIMEOUT_MS);

    verificationCallbacks.set(taskId, { resolve, timer });
  });
}

/**
 * 取消任务
 */
export function cancelTask(taskId: string): boolean {
  const task = tasks.get(taskId);
  if (!task) return false;

  // 只能取消未完成的任务
  if (['completed', 'failed', 'cancelled'].includes(task.status)) {
    return false;
  }

  task.status = 'cancelled';

  // 触发等待中的回调
  const callback = verificationCallbacks.get(taskId);
  if (callback) {
    clearTimeout(callback.timer);
    callback.resolve(null);
    verificationCallbacks.delete(taskId);
  }

  return true;
}

/**
 * 重新发起任务（基于超时的任务创建新任务）
 * @returns 新任务或 null
 */
export function retryTask(taskId: string): Task | null {
  const oldTask = getTask(taskId);
  if (!oldTask) return null;

  // 只能重试超时或取消的任务
  if (!['timeout', 'cancelled', 'failed'].includes(oldTask.status)) {
    return null;
  }

  return createTask();
}

/**
 * 清理过期任务（可选，用于内存管理）
 */
export function cleanupExpiredTasks(): void {
  const now = new Date();
  for (const [id, task] of tasks.entries()) {
    // 清理 30 分钟前的已完成/失败/超时任务
    const cleanupTime = new Date(task.createdAt.getTime() + 30 * 60 * 1000);
    if (now > cleanupTime && ['completed', 'failed', 'timeout', 'cancelled'].includes(task.status)) {
      tasks.delete(id);
    }
  }
}

// 每 10 分钟清理一次过期任务
setInterval(cleanupExpiredTasks, 10 * 60 * 1000);
