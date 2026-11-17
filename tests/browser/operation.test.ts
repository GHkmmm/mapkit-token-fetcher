import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { OperationError } from '../../src/runtime.js';

let root: string;
let operations: typeof import('../../src/browser.js');
let diagnostics: typeof import('../../src/diagnostics.js');
let previousDataDir: string | undefined;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync(chromium.executablePath()) ? undefined : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'mapkit-offline-'));
  previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  operations = await import('../../src/browser.js');
  diagnostics = await import('../../src/diagnostics.js');
});
after(async () => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
  await rm(root, { recursive: true, force: true });
});

async function offlineLaunch(html: string, onClose: () => void) {
  return async (options: Parameters<typeof chromium.launch>[0]) => {
    const browser = await chromium.launch({ ...options, executablePath });
    browser.once('disconnected', onClose);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
      return context;
    };
    return browser;
  };
}

async function portal(expiration: string) {
  return (await readFile(new URL('../fixtures/token-list.html', import.meta.url), 'utf8')).replace('</body>', `
  <button id="add-token">Add Token</button>
  <div id="create-dialog" hidden>
    <input type="radio" name="tokenType" value="serverAPI">
    <input type="radio" name="tokenEnvironment" value="test">
    <input placeholder="Description"><button id="create-token">Create</button>
  </div>
  <script>
  records = [{ description: 'old-record', token: 'old-value', expiration: ${JSON.stringify(expiration)}, creation: '2020-01-01' }]; render();
  document.querySelector('#add-token').onclick = () => { document.querySelector('#create-dialog').hidden = false; };
  document.querySelector('#create-token').onclick = () => {
    records.unshift({ description: document.querySelector('input[placeholder="Description"]').value,
      token: 'the-exact-new-token', creation: '2099-01-01', expiration: '2099-12-31' });
    document.querySelector('#create-dialog').hidden = true; render();
  };
  </script></body>`);
}

test('full refresh cleans expired records then returns the exact newly created token and closes', async () => {
  let closed = 0;
  const result = await operations.refreshMapKitToken('offline-user', 'offline-password', true, false, undefined, {
    launch: await offlineLaunch(await portal('2020-01-02'), () => { closed++; }),
  });
  assert.equal(result.token, 'the-exact-new-token');
  assert.equal(result.cleanup.revoked, 1, JSON.stringify(result.cleanup) + result.warnings.join(';'));
  assert.deepEqual(result.warnings, []);
  assert.equal(closed, 1);
  assert.ok(existsSync(path.join(root, '.auth-state.json')));
});

test('full refresh still delivers the new token when cleanup skips an unknown date', async () => {
  let closed = 0;
  const result = await operations.refreshMapKitToken('offline-user', 'offline-password', true, false, undefined, {
    launch: await offlineLaunch(await portal('unknown-date'), () => { closed++; }),
  });
  assert.equal(result.token, 'the-exact-new-token');
  assert.equal(result.cleanup.complete, false);
  assert.ok(result.warnings.length);
  assert.equal(closed, 1);
});

test('agreement failure captures sanitized diagnostics and releases real Chromium', async () => {
  let closed = 0;
  const secret = 'extremely-sensitive-token-string-1234567890';
  await assert.rejects(operations.refreshMapKitToken('offline-user', 'offline-password', true, false, undefined, {
    launch: await offlineLaunch(`<h1>Access Unavailable</h1><p>Account Holder must agree to the latest Program License Agreement.</p><input value="${secret}"><div class="limit-name">${secret}</div>`, () => { closed++; }),
  }), { code: 'AGREEMENT_REQUIRED' });
  assert.equal(closed, 1);
  const folders = await readdir(path.join(root, 'diagnostics'));
  const folder = path.join(root, 'diagnostics', folders.at(-1)!);
  assert.ok(existsSync(path.join(folder, 'page.png')));
  assert.ok(!(await readFile(path.join(folder, 'structure.json'), 'utf8')).includes(secret));
});

test('diagnostic retention removes older entries after twenty runs', async () => {
  for (let index = 0; index < 21; index++) await diagnostics.saveDiagnostics(undefined, new OperationError('TEST', 'test'));
  assert.equal((await readdir(path.join(root, 'diagnostics'))).length, 20);
});


test('creation can reset to a Next wizard while the list reloads without triggering another create', async () => {
  let html = await portal('2099-12-31');
  html = html.replace('<div id="create-dialog" hidden>', '<div id="create-dialog" role="dialog" hidden><h2>Create Maps Token</h2>');
  html = html.replace("document.querySelector('#create-dialog').hidden = true; render();", `
    const dialog = document.querySelector('#create-dialog');
    dialog.innerHTML = '<h2>Create Maps Token</h2><button id="reset-next">Next</button><button id="reset-cancel">Cancel</button>';
    document.querySelector('#reset-next').onclick = () => { throw new Error('must not paginate the wizard'); };
    document.querySelector('#reset-cancel').onclick = () => { dialog.hidden = true; };
    const table = document.querySelector('table');
    const placeholder = document.createElement('div'); table.replaceWith(placeholder);
    setTimeout(() => { placeholder.replaceWith(table); render(); }, 250);
  `);
  const result = await operations.refreshMapKitToken('offline-user', 'offline-password', true, false, undefined, {
    launch: await offlineLaunch(html, () => {}),
  });
  assert.equal(result.token, 'the-exact-new-token');
});
