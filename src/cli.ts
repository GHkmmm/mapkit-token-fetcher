#!/usr/bin/env node

import { Command } from 'commander';
import { openAppleDeveloperPortal, getTargetUrl, getMapKitToken, refreshMapKitToken } from './browser';
import { getCredentials } from './input';

const program = new Command();

program
  .name('mapkit-token-refresh')
  .description('自动刷新 Apple MapKit Server Token 的命令行工具')
  .version('1.0.0');

// open 命令 - 打开浏览器跳转到苹果开发者后台
program
  .command('open')
  .description('打开浏览器并跳转到 Apple Developer 后台的 MapKit Token 页面')
  .option('--headless', '使用无头模式（不显示浏览器界面）', false)
  .action(async (options) => {
    try {
      printBanner();
      console.log(`📎 目标地址: ${getTargetUrl()}`);
      console.log('');
      
      await openAppleDeveloperPortal(options.headless);
    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// get 命令 - 登录并获取现有 Token
program
  .command('get')
  .description('登录 Apple Developer 后台并获取现有 MapKit Token')
  .option('-u, --username <username>', 'Apple ID 用户名')
  .option('-p, --password <password>', 'Apple ID 密码')
  .option('--headless', '使用无头模式（不显示浏览器界面）', false)
  .action(async (options) => {
    try {
      printBanner();
      console.log('📋 功能: 登录并获取现有 MapKit Token');
      console.log('');

      // 获取凭证（交互式输入或命令行参数）
      const { username, password } = await getCredentials(
        options.username,
        options.password
      );

      if (!username || !password) {
        console.error('❌ 用户名和密码不能为空');
        process.exit(1);
      }

      console.log('');
      
      // 执行获取
      const token = await getMapKitToken(username, password, options.headless);
      
      if (token) {
        // Token 已在 getMapKitToken 中输出
        process.exit(0);
      } else {
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// refresh 命令 - 登录并创建新 Token
program
  .command('refresh')
  .description('登录 Apple Developer 后台并创建新的 MapKit Token')
  .option('-u, --username <username>', 'Apple ID 用户名')
  .option('-p, --password <password>', 'Apple ID 密码')
  .option('--headless', '使用无头模式（不显示浏览器界面）', false)
  .action(async (options) => {
    try {
      printBanner();
      console.log('📋 功能: 登录并创建新的 MapKit Token');
      console.log('');

      // 获取凭证（交互式输入或命令行参数）
      const { username, password } = await getCredentials(
        options.username,
        options.password
      );

      if (!username || !password) {
        console.error('❌ 用户名和密码不能为空');
        process.exit(1);
      }

      console.log('');
      
      // 执行刷新
      const token = await refreshMapKitToken(username, password, options.headless);
      
      if (token) {
        // Token 已在 refreshMapKitToken 中输出
        process.exit(0);
      } else {
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 发生错误:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * 打印工具 Banner
 */
function printBanner(): void {
  console.log('');
  console.log('🍎 MapKit Token Refresh Tool');
  console.log('═══════════════════════════════════════');
}

program.parse();
