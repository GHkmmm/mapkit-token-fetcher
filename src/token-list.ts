import { createHash, randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import type { CleanupSummary } from './types.js';
import { OperationError, within } from './runtime.js';

export interface ParsedDate { value: number; dateOnly: boolean; day: string }
export function parseTokenDate(text: string): ParsedDate | null {
  const input = text.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(input);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(input);
  if (iso) { year = +iso[1]; month = +iso[2]; day = +iso[3]; }
  else if (us) { year = +us[3]; if (year < 100) year += 2000; month = +us[1]; day = +us[2]; }
  else return null;
  const value = Date.UTC(year, month - 1, day);
  const date = new Date(value);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const instant = iso?.[4] ? Date.parse(input) : value;
  if (!Number.isFinite(instant)) return null;
  return { value: instant, dateOnly: !iso?.[4], day: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function todayInShanghai(now: Date): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function isExpired(date: ParsedDate, now = new Date()): boolean {
  return date.dateOnly ? date.day < todayInShanghai(now) : date.value <= now.getTime();
}

export interface TokenRow {
  key: string; description: string; token: string; creation: string; expiration: string;
  tableIndex: number; rowIndex: number;
}
export interface TokenListPage { rows: TokenRow[]; signature: string }

/** Unsupported structures are errors, never interpreted as an empty account. */
export async function readTokenPage(page: Page): Promise<TokenListPage> {
  // A literal script also works under tsx, whose named-function helpers cannot cross into the page.
  const result = await page.evaluate(String.raw`(() => {
    const aliases = {
      description: /^(description|描述)$/i, token: /^(token|令牌)$/i,
      creation: /^(creation|created|creation date|创建|创建时间|创建日期)$/i,
      expiration: /^(expiration|expires|expiration date|到期|到期时间|到期日期|过期时间)$/i,
    };
    const fieldValue = (cell, field) => {
      if (!cell) return '';
      const machine = cell.querySelector('time[datetime]')?.getAttribute('datetime')
        ?? cell.getAttribute('data-' + field) ?? cell.getAttribute('datetime');
      return (machine || (field === 'token' ? cell.querySelector('.limit-name')?.textContent : '') || cell.textContent || '').trim();
    };
    const tables = Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]'));
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
      const table = tables[tableIndex];
      const headers = Array.from(table.querySelectorAll(table.tagName === 'TABLE' ? 'thead th, thead td, tr:first-child th' : '[role="columnheader"]'));
      const indexes = Object.fromEntries(Object.entries(aliases).map(([field, pattern]) => [field, headers.findIndex(header =>
        header.querySelector('[data-id="' + field + '"]') || header.getAttribute('data-id') === field || pattern.test(header.textContent?.trim() ?? ''))]));
      if (Object.values(indexes).some(index => index < 0)) continue;
      const rows = Array.from(table.querySelectorAll('tbody tr, [role="row"]')).filter(row => row.querySelector('td, [role="cell"], [role="gridcell"]'));
      return rows.map((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
        return { tableIndex, rowIndex, description: fieldValue(cells[indexes.description], 'description'),
          token: fieldValue(cells[indexes.token], 'token'), creation: fieldValue(cells[indexes.creation], 'creation'),
          expiration: fieldValue(cells[indexes.expiration], 'expiration') };
      });
    }
    const semanticRows = Array.from(document.querySelectorAll('.token-row, [role="row"], [data-token-row]')).filter(row => row.querySelector('[data-field="token"], [data-column="token"]'));
    if (semanticRows.length) return semanticRows.map((row, rowIndex) => ({ tableIndex: -1, rowIndex,
      ...Object.fromEntries(Object.keys(aliases).map(field => [field, fieldValue(row.querySelector('[data-field="' + field + '"], [data-column="' + field + '"]') ?? undefined, field)])),
    }));
    return null;
  })()`) as Array<Omit<TokenRow, 'key'>> | null;
  if (!result) throw new OperationError('TOKEN_LIST_UNRECOGNIZED', '无法识别 Token 列表结构');
  const rows = result.map(raw => {
    const row = raw as Omit<TokenRow, 'key'>;
    return { ...row, key: createHash('sha256').update([row.token, row.description, row.creation, row.expiration].join('\0')).digest('hex') };
  });
  return { rows, signature: rows.map(row => row.key).join('|') };
}

export async function waitForTokenList(page: Page, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  do {
    await assertNoAccessBlock(page);
    try {
      await readTokenPage(page);
      if (!(await page.locator('[aria-busy="true"], .loading-spinner').first().isVisible().catch(() => false))) return;
    } catch (error) {
      if (!(error instanceof OperationError) || error.code !== 'TOKEN_LIST_UNRECOGNIZED') throw error;
    }
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  throw new OperationError('TOKEN_LIST_UNRECOGNIZED', '等待 Token 列表超时或无法识别页面结构');
}

export async function assertNoAccessBlock(page: Page): Promise<void> {
  for (const frame of page.frames()) {
    const text = await frame.locator('body').innerText({ timeout: 1_000 }).catch(() => '');
    if (/must agree[\s\S]{0,160}(?:agreement|license)|(?:agree to|accept)[\s\S]{0,100}(?:latest|updated|new)[\s\S]{0,80}(?:agreement|license)|(?:同意|接受)[\s\S]{0,80}(?:最新|新版|更新)[\s\S]{0,80}(?:协议|许可)/i.test(text)) {
      throw new OperationError('AGREEMENT_REQUIRED', 'Apple 要求账号持有人同意最新开发者协议，请在后台手动处理后重试');
    }
    if (/Access Unavailable|don't have access to this membership resource|无法访问.*(?:会员|资源)/i.test(text)) {
      throw new OperationError('ACCESS_UNAVAILABLE', 'Apple 账号当前无法访问会员资源，请检查后台权限提示');
    }
  }
}

function rowLocator(page: Page, row: TokenRow): Locator {
  if (!row.token) throw new OperationError('TOKEN_ROW_UNIDENTIFIABLE', '无法唯一定位待撤销记录，已保留');
  const rows = row.tableIndex >= 0
    ? page.locator('table, [role="table"], [role="grid"]').nth(row.tableIndex).locator('tbody tr, [role="row"]')
    : page.locator('.token-row, [role="row"], [data-token-row]');
  let target = rows.filter({ has: page.getByText(row.token, { exact: true }) });
  if (row.description) target = target.filter({ has: page.getByText(row.description, { exact: true }) });
  return target;
}

function pagination(page: Page, direction: 'next' | 'previous'): Locator {
  const name = direction === 'next' ? /^(next(?: page)?|下一页|下页|›|»|>)$/i : /^(previous(?: page)?|prev|上一页|上页|‹|«|<)$/i;
  return page.locator(`[rel="${direction === 'next' ? 'next' : 'prev'}"], [data-page="${direction}"]`)
    .or(page.getByRole('button', { name })).or(page.getByRole('link', { name }))
    // A wizard's Next/Previous buttons never paginate the token list.
    .and(page.locator(':not([role="dialog"] *, dialog *, .modal *, [aria-modal="true"] *)')).first();
}
async function turnPage(page: Page, direction: 'next' | 'previous', budget: number | (() => number)): Promise<boolean> {
  const remaining = () => typeof budget === 'function' ? budget() : budget;
  remaining();
  const button = pagination(page, direction);
  if (!await button.isVisible().catch(() => false) || await button.isDisabled() || await button.getAttribute('aria-disabled') === 'true') return false;
  const before = (await readTokenPage(page)).signature;
  await button.click({ timeout: remaining() });
  const deadline = Date.now() + remaining();
  do {
    remaining();
    await assertNoAccessBlock(page);
    if ((await readTokenPage(page)).signature !== before) return true;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw new OperationError('PAGINATION_STALLED', '翻页后 Token 列表未发生变化');
}
async function firstPage(page: Page, timeout: number | (() => number)): Promise<void> {
  const seen = new Set<string>();
  while (true) {
    const signature = (await readTokenPage(page)).signature;
    if (seen.has(signature)) throw new OperationError('PAGINATION_STALLED', '返回第一页时检测到分页循环');
    seen.add(signature);
    if (!await turnPage(page, 'previous', timeout)) return;
  }
}

export async function listAllTokens(page: Page, timeout = 15_000): Promise<TokenRow[]> {
  await firstPage(page, timeout);
  const records = new Map<string, TokenRow>();
  const seen = new Set<string>();
  do {
    const current = await readTokenPage(page);
    if (seen.has(current.signature)) throw new OperationError('PAGINATION_STALLED', '检测到重复 Token 分页');
    seen.add(current.signature);
    for (const row of current.rows) records.set(row.key, row);
  } while (await turnPage(page, 'next', timeout));
  return [...records.values()];
}

/** Use issuance time only to disambiguate equal displayed creation dates, never for authentication. */
export function latestCreatedToken(rows: TokenRow[]): TokenRow | undefined {
  const dated = rows.map(row => ({ row, creation: parseTokenDate(row.creation) })).filter(entry => entry.creation !== null);
  if (!dated.length) return undefined;
  const latest = Math.max(...dated.map(entry => entry.creation!.value));
  const tied = dated.filter(entry => entry.creation!.value === latest);
  if (tied.length === 1 || tied.every(entry => !entry.creation!.dateOnly)) return tied[0].row;
  const issued = tied.map(entry => {
    try {
      const payload = JSON.parse(Buffer.from(entry.row.token.split('.')[1], 'base64url').toString('utf8'));
      const value = payload.iat;
      if (Number.isSafeInteger(value) && value > 0 && todayInShanghai(new Date(value * 1000)) === entry.creation!.day) {
        return { row: entry.row, value };
      }
    } catch { /* Unknown token formats must not silently decide which record is newest. */ }
    return null;
  });
  if (issued.some(entry => entry === null)) throw new OperationError('TOKEN_CREATION_AMBIGUOUS', '多条 Token 创建日期相同，无法确认最新记录的签发时间');
  const sorted = issued.filter(entry => entry !== null).sort((a, b) => b.value - a.value);
  if (sorted.length > 1 && sorted[0].value === sorted[1].value && sorted[0].row.token !== sorted[1].row.token) {
    throw new OperationError('TOKEN_CREATION_AMBIGUOUS', '多条 Token 的签发时间相同，无法唯一确认最新记录');
  }
  return sorted[0].row;
}

export async function findToken(page: Page, description?: string): Promise<string> {
  const rows = await listAllTokens(page);
  const candidates = rows.filter(row => {
    if (!row.token) return false;
    if (description !== undefined) return row.description === description;
    const expiration = parseTokenDate(row.expiration);
    return expiration !== null && (expiration.dateOnly ? expiration.day > todayInShanghai(new Date()) : !isExpired(expiration));
  });
  const selected = description !== undefined ? candidates[0] : latestCreatedToken(candidates);
  if (!selected || description !== undefined && candidates.length !== 1) throw new OperationError('TOKEN_NOT_FOUND', '未找到唯一的新 Token 或可确认有效的最新 Token');
  return selected.token;
}

export function tokenDescription(): string {
  return `auto-refresh-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

export async function cleanupExpiredTokens(page: Page, options: { budgetMs?: number; actionMs?: number; now?: Date; signal?: AbortSignal } = {}): Promise<{ cleanup: CleanupSummary; warnings: string[] }> {
  const cleanup: CleanupSummary = { scanned: 0, expired: 0, revoked: 0, failed: 0, skipped: 0, complete: true };
  const warnings: string[] = [];
  const deadline = Date.now() + (options.budgetMs ?? 120_000);
  const remaining = () => {
    options.signal?.throwIfAborted();
    const ms = Math.min(options.actionMs ?? 15_000, deadline - Date.now());
    if (ms <= 0) throw new OperationError('CLEANUP_TIMEOUT', '过期 Token 清理超过时间预算');
    return ms;
  };
  const bounded = <T>(promise: Promise<T>) => within(promise, remaining(), new OperationError('CLEANUP_TIMEOUT', '清理操作超时'));
  const scanned = new Set<string>();
  const attempted = new Set<string>();
  const visited = new Set<string>();
  try {
    await bounded(firstPage(page, remaining));
    while (true) {
      remaining();
      await bounded(assertNoAccessBlock(page));
      const current = await bounded(readTokenPage(page));
      const signature = current.signature;
      if (visited.has(signature)) throw new OperationError('CLEANUP_STALLED', '清理列表重复，已停止以避免循环');
      visited.add(signature);
      let changed = false;
      for (const row of current.rows) {
        remaining();
        if (scanned.has(row.key)) continue;
        scanned.add(row.key);
        cleanup.scanned++;
        const expiration = parseTokenDate(row.expiration);
        if (!expiration) { cleanup.skipped++; warnings.push('部分 Token 的到期时间无法识别，已保留'); continue; }
        if (!isExpired(expiration, options.now ?? new Date())) continue;
        cleanup.expired++;
        if (attempted.has(row.key)) continue;
        attempted.add(row.key);
        try {
          const fresh = (await bounded(readTokenPage(page))).rows.find(candidate => candidate.key === row.key);
          if (!fresh) throw new OperationError('TOKEN_ROW_CHANGED', '待撤销记录已变化');
          const locator = rowLocator(page, fresh);
          if (await locator.count() !== 1) throw new OperationError('TOKEN_ROW_UNIDENTIFIABLE', '待撤销记录不唯一，已保留');
          // 悬停具体单元格，避免表格行中心落在边框间隙而无法命中。
          await locator.locator('td, [role="cell"], [role="gridcell"]').first().hover({ timeout: remaining() });
          const revoke = locator.locator('.action-remove').or(locator.getByRole('button', { name: /^(Revoke|撤销|吊销)$/i })).first();
          await revoke.click({ timeout: remaining() });
          const dialog = page.locator('[role="dialog"], .modal').filter({ has: page.getByRole('button', { name: /^(Revoke|撤销|吊销)$/i }) }).first();
          const confirm = page.locator('#action-confirm').or(dialog.getByRole('button', { name: /^(Revoke|撤销|吊销)$/i })).first();
          await confirm.click({ timeout: remaining() });
          const confirmationDeadline = Date.now() + remaining();
          while ((await bounded(readTokenPage(page))).rows.some(candidate => candidate.key === row.key)) {
            if (Date.now() >= confirmationDeadline) throw new OperationError('REVOKE_UNCONFIRMED', '点击撤销后记录仍然存在');
            await page.waitForTimeout(Math.min(100, remaining()));
          }
          cleanup.revoked++;
          changed = true;
          break;
        } catch (error) {
          options.signal?.throwIfAborted();
          cleanup.failed++;
          warnings.push(error instanceof OperationError ? error.message : '撤销过期 Token 失败');
          // A failed dialog must not cover subsequent rows or token creation.
          const cancel = page.getByRole('button', { name: /^(Cancel|取消|关闭|Close)$/i }).first();
          if (await cancel.isVisible().catch(() => false)) await cancel.click({ timeout: remaining() }).catch(() => {});
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
      if (changed) {
        visited.clear();
        await bounded(firstPage(page, remaining));
        continue;
      }
      if (!await bounded(turnPage(page, 'next', remaining))) break;
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    cleanup.complete = false;
    warnings.push(error instanceof OperationError ? error.message : '无法完整清理过期 Token');
  }
  cleanup.complete &&= cleanup.failed === 0 && cleanup.skipped === 0;
  return { cleanup, warnings: [...new Set(warnings)] };
}
