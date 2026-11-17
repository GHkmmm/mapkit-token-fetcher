import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { performLogin } from '../../src/browser.js';

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
const target = 'https://developer.apple.com/account/resources/services/maps-tokens';

for (const passwordStep of [false, true]) {
  test(passwordStep ? '提交账号后自动进入列表，不再等待密码' : '等待账号期间会话自动恢复，继续识别列表', async () => {
    const context = await browser.newContext();
    try {
      const portal = await readFile(new URL('../fixtures/token-list.html', import.meta.url), 'utf8');
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
        route.request().url().startsWith(target) ? portal : passwordStep
          ? `<input id="account_name_text_field"><button id="sign-in" onclick="location.href='${target}'">Continue</button>`
          : `<script>setTimeout(() => location.href='${target}', 300)</script>` }));
      const page = await context.newPage();
      await page.goto('https://idmsa.apple.com/login');
      await performLogin(page, 'offline-user', 'offline-password', new AbortController().signal);
      assert.equal(page.url(), target);
      assert.equal(await page.locator('table').count(), 1);
    } finally { await context.close(); }
  });
}
