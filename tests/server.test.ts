import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRefreshApp } from '../src/server.js';
import { TaskStore } from '../src/task-manager.js';
import { withBrowser, abortable, OperationError } from '../src/runtime.js';
import type { refreshMapKitToken } from '../src/browser.js';
import type { BrowserResult } from '../src/types.js';

const result: BrowserResult = { token: 'fresh', warnings: ['无法识别部分到期日期'], cleanup: { scanned: 3, expired: 1, revoked: 1, failed: 0, skipped: 1, complete: false } };
const config = { apple: { username: 'test', password: 'test' } };
const noop = { async sendVerificationRequired() {}, async sendTaskCompleted() {} };

test('登录元素超时属于失败，保留错误码供调用方判断', async () => {
  const service = await fixture({ refresh: async () => { throw new OperationError('ELEMENT_TIMEOUT', '等待登录输入框超时'); } });
  try {
    const response = await service.post('/api/refresh');
    await until(() => !service.store.getActiveTask());
    const task = service.store.getTask(response.body.taskId)!;
    assert.equal(task.status, 'failed');
    assert.equal(task.result?.errorCode, 'ELEMENT_TIMEOUT');
  } finally { await service.close(); }
});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!check()) { if (Date.now() > deadline) assert.fail('condition timed out'); await tick(); }
}
async function fixture(dependencies: Parameters<typeof createRefreshApp>[2], out?: string) {
  const service = createRefreshApp(config, { out }, { notifier: noop, ...dependencies });
  const server = service.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  return { ...service, post: async (route: string) => {
    const response = await fetch(url + route, { method: 'POST' });
    return { status: response.status, body: await response.json() as any };
  }, async close() { service.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test('duplicate refresh and cancelled retry retain reservation until browser finishes closing', async () => {
  let launched = 0;
  let finishClose!: () => void;
  const store = new TaskStore();
  const refresh = (async (_u, _p, _h, _cache, _provider, options) => withBrowser(true, async (_browser, signal) => {
    return abortable(new Promise<BrowserResult>(() => {}), signal);
  }, { ...options, launch: async () => {
    launched++;
    return { close: () => new Promise<void>(resolve => { finishClose = resolve; }) } as any;
  } })) as typeof refreshMapKitToken;
  const service = await fixture({ store, refresh });
  try {
    const first = await service.post('/api/refresh');
    const id = first.body.taskId;
    const repeats = await Promise.all(Array.from({ length: 5 }, () => service.post('/api/refresh')));
    assert.ok(repeats.every(response => response.body.taskId === id));
    assert.equal(launched, 1);
    await service.post(`/api/task/${id}/cancel`);
    await until(() => !!finishClose);
    assert.equal((await service.post(`/api/task/${id}/retry`)).body.taskId, id);
    assert.equal(launched, 1);
    finishClose();
    await until(() => !store.getActiveTask());
    assert.equal(store.getTask(id)?.status, 'cancelled');
    const next = await service.post(`/api/task/${id}/retry`);
    assert.notEqual(next.body.taskId, id);
    await service.post(`/api/task/${next.body.taskId}/cancel`);
    await tick(); finishClose();
    await until(() => !store.getActiveTask());
    assert.equal(launched, 2);
  } finally { await service.close(); }
});

test('cleanup warnings survive success and completion happens after file persistence', async () => {
  let allowWrite!: () => void;
  const store = new TaskStore();
  const service = await fixture({ store, refresh: async () => result, writeToken: async () => new Promise<void>(resolve => { allowWrite = resolve; }) }, '/ignored/test-token');
  try {
    const { body } = await service.post('/api/refresh');
    await until(() => !!allowWrite);
    assert.equal(store.getTask(body.taskId)?.status, 'running');
    allowWrite();
    await until(() => !store.getActiveTask());
    assert.equal(store.getTask(body.taskId)?.status, 'completed');
    assert.deepEqual(store.getTask(body.taskId)?.result, result);
  } finally { await service.close(); }
});

test('output failures and agreements retain useful error codes', async () => {
  const service = await fixture({ refresh: async () => result, writeToken: async () => { throw new Error('disk unavailable'); } }, '/ignored/token');
  try {
    const { body } = await service.post('/api/refresh');
    await until(() => !service.store.getActiveTask());
    assert.equal(service.store.getTask(body.taskId)?.status, 'failed');
    assert.equal(service.store.getTask(body.taskId)?.result?.errorCode, 'TOKEN_OUTPUT_FAILED');
  } finally { await service.close(); }
  const agreement = await fixture({ refresh: async () => { throw new OperationError('AGREEMENT_REQUIRED', '请同意协议'); } });
  try {
    const { body } = await agreement.post('/api/refresh');
    await until(() => !agreement.store.getActiveTask());
    assert.equal(agreement.store.getTask(body.taskId)?.result?.errorCode, 'AGREEMENT_REQUIRED');
  } finally { await agreement.close(); }
});

test('recovery failure returns 503 without launching a browser', async () => {
  let calls = 0;
  const service = await fixture({ recoveryRequired: () => true, refresh: async () => { calls++; return result; } });
  try {
    const response = await service.post('/api/refresh');
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  } finally { await service.close(); }
});
