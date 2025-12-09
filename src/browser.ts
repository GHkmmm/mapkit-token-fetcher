import { chromium, Browser, Page, BrowserContext, Frame, FrameLocator } from 'playwright';
import { promptVerificationCode } from './input';
import path from 'path';
import { existsSync } from 'fs';

const APPLE_DEVELOPER_URL = 'https://developer.apple.com/account/resources/services/maps-tokens';

// 登录状态存储文件路径
// 支持通过 DATA_DIR 环境变量配置数据目录（用于 Docker 环境）
const DATA_DIR = process.env.DATA_DIR || process.cwd();
export const AUTH_STATE_FILE = path.join(DATA_DIR, '.auth-state.json');

/**
 * 打开浏览器并跳转到苹果开发者后台
 */
export async function openAppleDeveloperPortal(headless: boolean = false): Promise<void> {
  console.log('🚀 正在启动浏览器...');
  
  const browser = await chromium.launch({
    headless,
    args: ['--window-size=1280,800']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN'
  });

  const page = await context.newPage();

  console.log(`📍 正在跳转到: ${APPLE_DEVELOPER_URL}`);
  await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded' });

  console.log('✅ 浏览器已打开，页面已加载');
  console.log('💡 提示: 按 Ctrl+C 关闭程序和浏览器');
  
  const cleanup = async () => {
    console.log('\n🔒 正在关闭浏览器...');
    await browser.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await new Promise(() => {});
}

/**
 * 获取目标 URL
 */
export function getTargetUrl(): string {
  return APPLE_DEVELOPER_URL;
}

/**
 * 登录并获取现有 MapKit Token
 */
export async function getMapKitToken(
  username: string,
  password: string,
  headless: boolean = false,
  useAuthCache: boolean = true
): Promise<string | null> {
  console.log('🚀 正在启动浏览器...');
  
  // 检查是否存在登录状态文件
  const hasAuthState = existsSync(AUTH_STATE_FILE) && useAuthCache;
  
  const browser = await chromium.launch({
    headless,
    args: ['--window-size=1280,800']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    ...(hasAuthState ? { storageState: AUTH_STATE_FILE } : {})
  });

  if (hasAuthState) {
    console.log('🔄 已加载缓存的登录状态');
  }

  const page = await context.newPage();

  try {
    // 跳转到目标页面
    console.log(`📍 正在跳转到: ${APPLE_DEVELOPER_URL}`);
    await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    const currentUrl = page.url();
    console.log(`📍 当前页面: ${currentUrl}`);

    // 检测是否需要登录
    if (isLoginPage(currentUrl)) {
      console.log('🔐 检测到登录页面，正在登录...');
      
      const loginSuccess = await performLogin(page, username, password);
      if (!loginSuccess) {
        console.error('❌ 登录失败');
        await browser.close();
        return null;
      }
      
      console.log('✅ 登录成功');
      
      // 保存登录状态
      console.log('💾 保存登录状态...');
      await context.storageState({ path: AUTH_STATE_FILE });
      console.log('✅ 登录状态已保存');
      
      await page.waitForTimeout(3000);
    }

    // 确保在 Token 页面
    const afterLoginUrl = page.url();
    if (!afterLoginUrl.includes('maps-tokens')) {
      console.log('📍 正在跳转到 Token 管理页面...');
      await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'networkidle', timeout: 60000 });
    }

    // 提取 Token
    console.log('⏳ 等待页面加载...');
    await page.waitForTimeout(5000);

    console.log('🔍 正在查找 Token...');
    const token = await extractToken(page);

    if (token) {
      console.log('\n═══════════════════════════════════════');
      console.log('✅ Token 获取成功！');
      console.log('═══════════════════════════════════════\n');
      console.log(token);
      console.log('');
    } else {
      console.log('\n⚠️  未能自动提取 Token');
      console.log('💡 请在浏览器中手动操作，完成后按 Ctrl+C 退出');
      
      await new Promise((resolve) => {
        process.on('SIGINT', async () => {
          await browser.close();
          resolve(null);
        });
      });
    }

    // 保存最新的登录状态
    console.log('💾 保存登录状态...');
    await context.storageState({ path: AUTH_STATE_FILE });
    
    await browser.close();
    return token;

  } catch (error) {
    console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
    await browser.close();
    return null;
  }
}

// ========== 辅助函数 ==========

/**
 * 判断是否为登录页面
 */
function isLoginPage(url: string): boolean {
  return url.includes('idmsa.apple.com') || url.includes('appleid.apple.com');
}

/**
 * 执行登录流程
 */
async function performLogin(page: Page, username: string, password: string): Promise<boolean> {
  try {
    console.log('⏳ 等待登录表单加载...');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    
    // 查找登录表单所在的 frame
    const loginFrame = await findLoginFrame(page);
    if (!loginFrame) {
      console.error('❌ 未找到登录表单');
      return false;
    }
    console.log('✅ 找到登录表单');

    // 输入账号
    console.log('📝 输入账号...');
    await loginFrame.locator('#account_name_text_field').fill(username);
    await page.waitForTimeout(1000);

    // 点击继续
    console.log('🔘 点击继续...');
    const signInBtn = loginFrame.locator('#sign-in');
    if (await signInBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await signInBtn.click();
    } else {
      await loginFrame.locator('#account_name_text_field').press('Enter');
    }

    // 等待密码输入框
    console.log('⏳ 等待密码输入框...');
    await page.waitForTimeout(3000);
    
    const passwordFrame = await findLoginFrame(page);
    if (!passwordFrame) {
      console.error('❌ 页面变化后未找到登录表单');
      return false;
    }

    try {
      await passwordFrame.locator('#password_text_field').waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      console.error('❌ 未找到密码输入框');
      return false;
    }

    // 输入密码
    console.log('📝 输入密码...');
    await passwordFrame.locator('#password_text_field').fill(password);
    await page.waitForTimeout(1000);

    // 勾选"记住我的账户"
    console.log('☑️  勾选"记住我的账户"...');
    try {
      // 点击 label 而不是 checkbox，因为 checkbox 被样式元素遮挡
      const rememberMeLabel = passwordFrame.locator('#remember-me-label');
      if (await rememberMeLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        const checkbox = passwordFrame.locator('#remember-me');
        const isChecked = await checkbox.isChecked().catch(() => false);
        if (!isChecked) {
          await rememberMeLabel.click({ timeout: 5000 });
        }
      }
    } catch (e) {
      // 勾选失败不影响登录流程，继续执行
      console.log('⚠️  未能勾选"记住我的账户"，继续登录...');
    }
    await page.waitForTimeout(500);

    // 点击登录
    console.log('🔘 点击登录...');
    const loginBtn = passwordFrame.locator('#sign-in');
    if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loginBtn.click();
    } else {
      await passwordFrame.locator('#password_text_field').press('Enter');
    }

    // 等待登录处理
    console.log('⏳ 等待登录处理...');
    await page.waitForTimeout(5000);

    // 检测并处理两步验证
    if (await check2FAPage(page)) {
      console.log('📱 检测到两步验证...');
      if (!await handle2FA(page)) {
        return false;
      }
    }

    // 处理"信任此浏览器"页面
    await handleTrustBrowser(page);

    // 等待到达目标页面
    console.log('⏳ 等待页面跳转...');
    const targetReached = await waitForTargetPage(page, 30000);
    
    if (targetReached) {
      return true;
    }
    
    // 检查登录状态
    const currentUrl = page.url();
    if (isLoginPage(currentUrl)) {
      const errorMsg = await getErrorMessage(page);
      if (errorMsg) {
        console.error(`❌ 登录错误: ${errorMsg}`);
        return false;
      }
      
      // 再次尝试两步验证和信任浏览器
      if (await check2FAPage(page)) {
        if (!await handle2FA(page)) return false;
        await handleTrustBrowser(page);
        return await waitForTargetPage(page, 15000);
      }
      
      await handleTrustBrowser(page);
      return await waitForTargetPage(page, 10000);
    }

    return true;
  } catch (error) {
    console.error('❌ 登录过程出错:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * 获取错误消息
 */
async function getErrorMessage(page: Page): Promise<string | null> {
  const frame = await findLoginFrame(page);
  if (!frame) return null;
  
  const errorMsg = frame.locator('.form-message-wrapper, .error, [role="alert"]').first();
  if (await errorMsg.isVisible({ timeout: 1000 }).catch(() => false)) {
    const text = await errorMsg.textContent();
    return text?.trim() || null;
  }
  return null;
}

/**
 * 处理"信任此浏览器"页面
 */
async function handleTrustBrowser(page: Page): Promise<void> {
  try {
    await page.waitForTimeout(2000);
    
    const trustSelectors = [
      'button:has-text("信任")',
      'button:has-text("Trust")',
      'button.button-rounded-rectangle:has-text("信任")',
    ];
    
    for (const selector of trustSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('🔘 点击"信任"按钮...');
        await btn.click();
        await page.waitForTimeout(2000);
        return;
      }
    }
    
    // 检查 iframe
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      for (const selector of trustSelectors) {
        try {
          const btn = frame.locator(selector).first();
          if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            console.log('🔘 在 iframe 中点击"信任"按钮...');
            await btn.click();
            await page.waitForTimeout(2000);
            return;
          }
        } catch { continue; }
      }
    }
  } catch { /* 没有信任按钮 */ }
}

/**
 * 等待到达目标页面
 */
async function waitForTargetPage(page: Page, timeout: number): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const currentUrl = page.url();
    
    if (currentUrl.startsWith('https://developer.apple.com/')) {
      console.log('✅ 已到达开发者后台');
      return true;
    }
    
    await handleTrustBrowser(page);
    await page.waitForTimeout(1000);
  }
  
  return false;
}

/**
 * 查找登录表单所在的 frame
 */
async function findLoginFrame(page: Page): Promise<Page | Frame | FrameLocator | null> {
  // 检查主框架
  const mainInput = page.locator('#account_name_text_field');
  if (await mainInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    return page;
  }

  // 检查 iframe
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const input = frame.locator('#account_name_text_field');
      if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('📍 登录表单在 iframe 中');
        return frame;
      }
    } catch { continue; }
  }

  return null;
}

/**
 * 检测是否为两步验证页面
 */
async function check2FAPage(page: Page): Promise<boolean> {
  const selectors = ['.form-security-code-input', '#security-code', 'input[name="security-code"]'];

  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      return true;
    }
  }

  // 检查 iframe
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const el = frame.locator('.form-security-code-input').first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        return true;
      }
    } catch { continue; }
  }

  return false;
}

/**
 * 处理两步验证
 */
async function handle2FA(page: Page): Promise<boolean> {
  try {
    const code = await promptVerificationCode();
    
    if (!code || code.length !== 6) {
      console.error('❌ 请输入6位验证码');
      return false;
    }

    console.log('📝 输入验证码...');

    // 查找验证码输入框所在的 frame
    let codeFrame: Page | Frame | null = null;
    
    if (await page.locator('.form-security-code-input').count() > 0) {
      codeFrame = page;
    } else {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          if (await frame.locator('.form-security-code-input').count() > 0) {
            codeFrame = frame;
            break;
          }
        } catch { continue; }
      }
    }

    if (!codeFrame) {
      console.error('❌ 未找到验证码输入框');
      return false;
    }

    // 输入6位验证码
    const digitInputs = codeFrame.locator('.form-security-code-input');
    const count = await digitInputs.count();
    console.log(`📝 找到 ${count} 个验证码输入框`);
    
    const digits = code.split('');
    for (let i = 0; i < Math.min(count, digits.length); i++) {
      await digitInputs.nth(i).fill(digits[i]);
      await page.waitForTimeout(100);
    }

    console.log('⏳ 等待验证...');
    await page.waitForTimeout(3000);

    // 尝试点击继续按钮
    const submitSelectors = [
      'button:has-text("继续")',
      'button:has-text("验证")',
      'button:has-text("Trust")',
      'button:has-text("Continue")',
    ];
    
    for (const selector of submitSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('🔘 点击继续...');
        await btn.click();
        break;
      }
    }

    await page.waitForTimeout(5000);
    console.log('✅ 验证码已提交');
    return true;

  } catch (error) {
    console.error('❌ 两步验证处理出错:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * 提取 MapKit Token
 */
async function extractToken(page: Page): Promise<string | null> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const tokenSelectors = [
      'textarea[readonly]',
      'pre code',
      'code',
      '.token-value',
      'input[readonly][value*="eyJ"]',
    ];

    for (const selector of tokenSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          let tokenText = tagName === 'input' || tagName === 'textarea'
            ? await element.inputValue()
            : await element.textContent() || '';

          tokenText = tokenText.trim();
          
          if (tokenText && (tokenText.startsWith('eyJ') || tokenText.length > 100)) {
            return tokenText;
          }
        }
      } catch { continue; }
    }

    // 尝试从页面内容中提取 JWT Token
    const pageContent = await page.content();
    const jwtMatch = pageContent.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) {
      return jwtMatch[0];
    }

    return null;
  } catch (error) {
    console.error('提取 Token 出错:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 生成 Token 描述（格式：auto-refresh-YYYY-MM-DD-HH-mm-ss）
 */
function generateTokenDescription(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `auto-refresh-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/**
 * 创建新 Token
 */
async function createNewToken(page: Page): Promise<string | null> {
  try {
    console.log('🔍 正在查找添加 Token 按钮...');
    
    // 点击添加按钮（带有特定颜色的 SVG 图标）
    const addButton = page.locator('svg[color="#0070c9"]').first();
    if (!await addButton.isVisible({ timeout: 10000 })) {
      console.error('❌ 未找到添加 Token 按钮');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }
    
    console.log('🔘 点击添加 Token 按钮...');
    await addButton.click();
    await page.waitForTimeout(2000);

    // 等待弹窗出现
    console.log('⏳ 等待弹窗加载...');
    
    // 选择 Token Type: Server API
    console.log('📝 选择 Token Type: Server API...');
    const serverAPIRadio = page.locator('input[name="tokenType"][value="serverAPI"]');
    if (!await serverAPIRadio.isVisible({ timeout: 5000 })) {
      console.error('❌ 未找到 Token Type 选择框');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }
    await serverAPIRadio.click();
    await page.waitForTimeout(500);

    // 选择 Restriction Type: None
    console.log('📝 选择 Restriction Type: None...');
    const noneRestrictionRadio = page.locator('input[name="tokenEnvironment"][value="test"]');
    if (!await noneRestrictionRadio.isVisible({ timeout: 5000 })) {
      console.error('❌ 未找到 Restriction Type 选择框');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }
    await noneRestrictionRadio.click();
    await page.waitForTimeout(500);

    // 填写 Token Description
    const description = generateTokenDescription();
    console.log(`📝 填写 Token Description: ${description}...`);
    const descriptionInput = page.locator('input[placeholder*="Description"]');
    if (!await descriptionInput.isVisible({ timeout: 5000 })) {
      console.error('❌ 未找到 Description 输入框');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }
    await descriptionInput.fill(description);
    await page.waitForTimeout(500);

    // 点击 Create 按钮
    console.log('🔘 点击 Create 按钮...');
    const createButton = page.locator('button:has-text("Create")');
    if (!await createButton.isVisible({ timeout: 5000 })) {
      console.error('❌ 未找到 Create 按钮');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }
    await createButton.click();
    
    // 等待创建完成，页面刷新
    console.log('⏳ 等待 Token 创建完成...');
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // 从列表中获取最新的 Token（最后一个 .limit-name 元素）
    console.log('🔍 正在获取新创建的 Token...');
    const tokenElements = page.locator('.limit-name');
    const count = await tokenElements.count();
    
    if (count === 0) {
      console.error('❌ 未找到 Token 列表');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }

    // 获取最后一个（最新添加的）Token
    const lastToken = tokenElements.nth(count - 1);
    const tokenText = await lastToken.textContent();
    
    if (!tokenText || tokenText.trim().length === 0) {
      console.error('❌ Token 值为空');
      console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
      await waitForUserExit();
      return null;
    }

    return tokenText.trim();

  } catch (error) {
    console.error('❌ 创建 Token 出错:', error instanceof Error ? error.message : error);
    console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
    await waitForUserExit();
    return null;
  }
}

/**
 * 等待用户手动退出
 */
async function waitForUserExit(): Promise<void> {
  await new Promise(() => {
    // 保持程序运行，等待用户 Ctrl+C
  });
}

/**
 * 登录并刷新（创建新）MapKit Token
 */
export async function refreshMapKitToken(
  username: string,
  password: string,
  headless: boolean = false,
  useAuthCache: boolean = true
): Promise<string | null> {
  console.log('🚀 正在启动浏览器...');
  
  // 检查是否存在登录状态文件
  const hasAuthState = existsSync(AUTH_STATE_FILE) && useAuthCache;
  
  const browser = await chromium.launch({
    headless,
    args: ['--window-size=1280,800']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    ...(hasAuthState ? { storageState: AUTH_STATE_FILE } : {})
  });

  if (hasAuthState) {
    console.log('🔄 已加载缓存的登录状态');
  }

  const page = await context.newPage();

  try {
    // 跳转到目标页面
    console.log(`📍 正在跳转到: ${APPLE_DEVELOPER_URL}`);
    await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    const currentUrl = page.url();
    console.log(`📍 当前页面: ${currentUrl}`);

    // 检测是否需要登录
    if (isLoginPage(currentUrl)) {
      console.log('🔐 检测到登录页面，正在登录...');
      
      const loginSuccess = await performLogin(page, username, password);
      if (!loginSuccess) {
        console.error('❌ 登录失败');
        console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
        await waitForUserExit();
        return null;
      }
      
      console.log('✅ 登录成功');
      
      // 保存登录状态
      console.log('💾 保存登录状态...');
      await context.storageState({ path: AUTH_STATE_FILE });
      console.log('✅ 登录状态已保存');
      
      await page.waitForTimeout(3000);
    }

    // 确保在 Token 页面
    const afterLoginUrl = page.url();
    if (!afterLoginUrl.includes('maps-tokens')) {
      console.log('📍 正在跳转到 Token 管理页面...');
      await page.goto(APPLE_DEVELOPER_URL, { waitUntil: 'networkidle', timeout: 60000 });
    }

    // 等待页面加载
    console.log('⏳ 等待页面加载...');
    await page.waitForTimeout(5000);

    // 创建新 Token
    console.log('🆕 正在创建新 Token...');
    const token = await createNewToken(page);

    if (token) {
      console.log('\n═══════════════════════════════════════');
      console.log('✅ Token 创建成功！');
      console.log('═══════════════════════════════════════\n');
      console.log(token);
      console.log('');
    }

    // 保存最新的登录状态
    console.log('💾 保存登录状态...');
    await context.storageState({ path: AUTH_STATE_FILE });
    
    await browser.close();
    return token;

  } catch (error) {
    console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
    console.log('💡 请手动操作，完成后按 Ctrl+C 退出');
    await waitForUserExit();
    return null;
  }
}
