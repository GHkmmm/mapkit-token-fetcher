import { type Browser, type Frame, type Locator, type Page } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { promptVerificationCode } from './input.js';
import type { BrowserResult, VerificationCodeProvider } from './types.js';
import { ACTION_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, OperationError, VERIFICATION_TIMEOUT_MS, abortable, within, asOperationError, withBrowser, type BrowserOptions } from './runtime.js';
import { saveDiagnostics } from './diagnostics.js';
import { assertNoAccessBlock, cleanupExpiredTokens, findToken, tokenDescription, waitForTokenList } from './token-list.js';

const APPLE_DEVELOPER_URL = 'https://developer.apple.com/account/resources/services/maps-tokens';
export const AUTH_STATE_FILE = path.join(process.env.DATA_DIR || process.cwd(), '.auth-state.json');
export function getTargetUrl(): string { return APPLE_DEVELOPER_URL; }

function isLoginPage(url: string): boolean {
  try { return ['idmsa.apple.com', 'appleid.apple.com', 'account.apple.com'].includes(new URL(url).hostname); }
  catch { return false; }
}

async function clickOrEnter(button: Locator, input: Locator): Promise<void> {
  if (await button.isVisible().catch(() => false)) await button.click();
  else await input.press('Enter');
}

/** One deadline shared by all frames, including frames attached after the first scan. */
export async function findLoginFrame(page: Page, selector = '#account_name_text_field', timeout = ACTION_TIMEOUT_MS): Promise<Frame> {
  return (await waitForLoginStep(page, selector, timeout, false))!;
}

/** 登录控件等待期间允许缓存会话自动跳回已就绪的令牌列表。 */
async function waitForLoginStep(page: Page, selector: string, timeout = ACTION_TIMEOUT_MS, allowPortal = true): Promise<Frame | null> {
  const deadline = Date.now() + timeout;
  do {
    await assertNoAccessBlock(page);
    if (allowPortal && page.url().startsWith(APPLE_DEVELOPER_URL)) {
      try { await waitForTokenList(page, 1); return null; }
      catch (error) {
        if (!(error instanceof OperationError) || error.code !== 'TOKEN_LIST_UNRECOGNIZED') throw error;
      }
    }
    for (const frame of page.frames()) {
      if (await frame.locator(selector).first().isVisible().catch(() => false)) return frame;
    }
    await assertNoAccessBlock(page);
    await page.waitForTimeout(Math.min(200, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new OperationError('ELEMENT_TIMEOUT', '等待登录输入框超时');
}

async function trustBrowser(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const trust = frame.getByRole('button', { name: /^(Trust|信任)$/i }).first();
    if (await trust.isVisible().catch(() => false)) { await trust.click(); return; }
  }
}

function verificationInput(frame: Frame): Locator {
  return frame.locator('.form-security-code-input, #security-code, input[name="security-code"]').first();
}

async function verify(page: Page, frame: Frame, signal: AbortSignal, provider?: VerificationCodeProvider): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new OperationError('VERIFICATION_TIMEOUT', '验证码输入超时')), VERIFICATION_TIMEOUT_MS);
  try {
    const code = await abortable(provider ? provider() : promptVerificationCode(controller.signal), controller.signal);
    signal.throwIfAborted();
    if (!code || !/^\d{6}$/.test(code)) throw new OperationError('VERIFICATION_FAILED', '未收到有效验证码');
    const inputs = frame.locator('.form-security-code-input');
    const count = await inputs.count();
    if (count === 6) {
      for (let index = 0; index < count; index++) await inputs.nth(index).fill(code[index]);
    } else await verificationInput(frame).fill(code);
    const submit = frame.getByRole('button', { name: /^(Continue|Verify|继续|验证)$/i }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export async function performLogin(page: Page, username: string, password: string, signal: AbortSignal, provider?: VerificationCodeProvider): Promise<void> {
  const accountFrame = await waitForLoginStep(page, '#account_name_text_field');
  signal.throwIfAborted();
  if (!accountFrame) return;
  const account = accountFrame.locator('#account_name_text_field');
  await account.fill(username);
  await clickOrEnter(accountFrame.locator('#sign-in'), account);
  const passwordFrame = await waitForLoginStep(page, '#password_text_field');
  signal.throwIfAborted();
  if (!passwordFrame) return;
  const passwordInput = passwordFrame.locator('#password_text_field');
  await passwordInput.fill(password);
  const remember = passwordFrame.locator('#remember-me-label');
  if (await remember.isVisible().catch(() => false)) {
    const checked = await passwordFrame.locator('#remember-me').isChecked().catch(() => true);
    if (!checked) await remember.click({ timeout: 3_000 }).catch(() => {});
  }
  await clickOrEnter(passwordFrame.locator('#sign-in'), passwordInput);
  let verified = false;
  let deadline = Date.now() + 60_000;
  do {
    signal.throwIfAborted();
    await assertNoAccessBlock(page);
    if (page.url().startsWith('https://developer.apple.com/')) return;
    for (const frame of page.frames()) {
      const error = frame.locator('.form-message-wrapper, .error, [role="alert"]').first();
      if (await error.isVisible().catch(() => false) && (await error.innerText()).trim()) {
        // Do not include arbitrary page text that might contain credentials.
        throw new OperationError('LOGIN_FAILED', 'Apple 登录失败，请检查账号状态');
      }
      if (!verified && await verificationInput(frame).isVisible().catch(() => false)) {
        await verify(page, frame, signal, provider);
        verified = true;
        deadline = Date.now() + 60_000;
      }
    }
    await trustBrowser(page);
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  throw new OperationError('LOGIN_FAILED', '登录后未能进入 Apple Developer 后台');
}

async function createNewToken(page: Page): Promise<string> {
  const description = tokenDescription();
  // Prefer the actual accessible control, keep the known SVG as a compatibility fallback.
  const semantic = page.getByRole('button', { name: /^(Add(?: Token)?|Create Token|添加(?:令牌|Token)?|新增(?:令牌|Token)?)$/i });
  const add = semantic.or(page.locator('svg[color="#0070c9"]')).first();
  await add.waitFor({ state: 'visible' });
  await add.click();
  await page.locator('input[name="tokenType"][value="serverAPI"]').check();
  await page.locator('input[name="tokenEnvironment"][value="test"]').check();
  const descriptionInput = page.getByRole('textbox', { name: /description|描述/i })
    .or(page.locator('input[placeholder*="Description"]')).first();
  await descriptionInput.fill(description);
  const create = page.getByRole('button', { name: /^(Create|创建)$/i });
  await create.click();
  await create.waitFor({ state: 'hidden' });
  // Apple may reset the successful creation wizard back to its first step.
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^(Create Maps Token|创建地图令牌)$/i }) }).first();
  if (await dialog.isVisible().catch(() => false)) {
    const next = dialog.getByRole('button', { name: /^(Next|下一步)$/i });
    if (await next.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: /^(Cancel|取消|Close|关闭)$/i }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
  }
  await waitForTokenList(page);
  // Creation may update the table after the modal has closed.
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  do {
    await assertNoAccessBlock(page);
    try { return await findToken(page, description); }
    catch (error) {
      if (!(error instanceof OperationError) || !['TOKEN_NOT_FOUND', 'TOKEN_LIST_UNRECOGNIZED'].includes(error.code)) throw error;
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  throw new OperationError('TOKEN_NOT_FOUND', '创建后未能读取本次生成的 Token');
}

async function operation(
  mode: 'get' | 'refresh', username: string, password: string, headless: boolean,
  useAuthCache: boolean, provider: VerificationCodeProvider | undefined, options: BrowserOptions,
): Promise<BrowserResult> {
  return withBrowser(headless, async (browser, signal, setPage) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
      ...(useAuthCache && existsSync(AUTH_STATE_FILE) ? { storageState: AUTH_STATE_FILE } : {}),
    });
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    signal.throwIfAborted();
    const page = await context.newPage();
    setPage(page);
    try {
      await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded' });
      await assertNoAccessBlock(page);
      // Wait for either the redirect to the login provider or a recognizable token page.
      const deadline = Date.now() + ACTION_TIMEOUT_MS;
      while (!isLoginPage(page.url())) {
        try { await waitForTokenList(page, 500); break; }
        catch (error) { if (!(error instanceof OperationError) || error.code !== 'TOKEN_LIST_UNRECOGNIZED') throw error; }
        if (Date.now() >= deadline) throw new OperationError('TOKEN_LIST_UNRECOGNIZED', '未能进入登录页面或识别 Token 列表');
      }
      if (isLoginPage(page.url())) await performLogin(page, username, password, signal, provider);
      await assertNoAccessBlock(page);
      if (!page.url().includes('/maps-tokens')) await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded' });
      await assertNoAccessBlock(page);
      // Authentication succeeded even if a later portal layout change interrupts the task.
      await mkdir(path.dirname(AUTH_STATE_FILE), { recursive: true });
      await context.storageState({ path: AUTH_STATE_FILE });
      await waitForTokenList(page);
      const result = await cleanupExpiredTokens(page, { signal });
      if (!result.cleanup.complete) await within(saveDiagnostics(page, new OperationError('CLEANUP_INCOMPLETE', '过期 Token 清理未全部完成')), 5_000, new Error('诊断超时')).catch(() => {});
      signal.throwIfAborted();
      // Restore the list after a failed confirmation dialog before continuing.
      if (!result.cleanup.complete) {
        await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded' });
        await waitForTokenList(page);
      }
      const token = mode === 'refresh' ? await createNewToken(page) : await findToken(page);
      signal.throwIfAborted();
      await mkdir(path.dirname(AUTH_STATE_FILE), { recursive: true });
      await context.storageState({ path: AUTH_STATE_FILE });
      return { token, ...result };
    } catch (error) {
      signal.throwIfAborted();
      await assertNoAccessBlock(page);
      throw asOperationError(error);
    }
  }, { ...options, onFailure: options.onFailure ?? saveDiagnostics });
}

export function refreshMapKitToken(
  username: string, password: string, headless = false, useAuthCache = true,
  provider?: VerificationCodeProvider, options: BrowserOptions = {},
): Promise<BrowserResult> {
  return operation('refresh', username, password, headless, useAuthCache, provider, options);
}

export function getMapKitToken(
  username: string, password: string, headless = false, useAuthCache = true, options: BrowserOptions = {},
): Promise<BrowserResult> {
  return operation('get', username, password, headless, useAuthCache, undefined, options);
}

export async function openAppleDeveloperPortal(headless = false): Promise<void> {
  await withBrowser(headless, async (browser: Browser, signal, setPage) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    setPage(page);
    await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    console.log('💡 浏览器已打开，关闭窗口或按 Ctrl+C 退出');
    await abortable(new Promise<void>(resolve => browser.once('disconnected', () => resolve())), signal);
  }, { timeoutMs: 0, onFailure: saveDiagnostics });
}
