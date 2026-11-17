// 单次真实验收，复用挂载凭证和缓存；输出仅包含脱敏摘要。
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { loadFullConfig } from '../dist/config.js';
import { refreshMapKitToken } from '../dist/browser.js';
import { OperationError } from '../dist/runtime.js';
import { writeTokenFile } from '../dist/results.js';

const config = loadFullConfig();
try {
  const result = await refreshMapKitToken(config.apple.username, config.apple.password, true, true,
    async () => { throw new OperationError('VERIFICATION_REQUIRED', '真实验收需要账号持有人输入验证码'); });
  await writeTokenFile('/app/output/apple_server_api_token.txt', result.token, new AbortController().signal);
  const audit = { success: true, time: new Date().toISOString(), cleanup: result.cleanup,
    warnings: result.warnings, fingerprint: createHash('sha256').update(result.token).digest('hex').slice(0, 12) };
  await writeFile('/app/data/live-audit-20261117.json', JSON.stringify(audit, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(audit));
} catch (error) {
  console.log(JSON.stringify({ success: false, errorCode: error.code ?? 'UNKNOWN', time: new Date().toISOString() }));
  process.exitCode = 1;
}
