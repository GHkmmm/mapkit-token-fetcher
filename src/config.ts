import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import path from 'path';
import { FullConfig } from './types.js';

/**
 * 配置文件接口（向后兼容）
 */
export interface Config {
  apple: {
    username: string;
    password: string;
  };
}

/**
 * 获取配置文件路径
 * 配置文件位于项目根目录 config.yaml
 */
function getConfigPath(): string {
  // 使用当前工作目录作为根目录
  return path.join(process.cwd(), 'config.yaml');
}

/**
 * 加载配置文件（基础版，向后兼容）
 * @returns 配置对象
 * @throws 配置文件不存在或格式错误时抛出异常
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    console.error('❌ 配置文件不存在');
    console.error('');
    console.error('请在项目根目录创建 config.yaml 文件，格式如下：');
    console.error('');
    console.error('apple:');
    console.error('  username: your-apple-id@example.com');
    console.error('  password: your-password');
    console.error('');
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = parse(content) as Config;

    // 验证必要字段
    if (!config.apple?.username || !config.apple?.password) {
      throw new Error('配置文件格式错误：缺少 apple.username 或 apple.password');
    }

    return config;
  } catch (error) {
    if (error instanceof Error && error.message.includes('配置文件')) {
      throw error;
    }
    throw new Error(`解析配置文件失败: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * 加载完整配置文件（包含通知和服务器配置）
 * @returns 完整配置对象
 * @throws 配置文件不存在或格式错误时抛出异常
 */
export function loadFullConfig(): FullConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    console.error('❌ 配置文件不存在');
    console.error('');
    console.error('请在项目根目录创建 config.yaml 文件，格式如下：');
    console.error('');
    console.error('apple:');
    console.error('  username: your-apple-id@example.com');
    console.error('  password: your-password');
    console.error('');
    console.error('# 可选配置');
    console.error('notification:');
    console.error('  wecom:');
    console.error('    enabled: true');
    console.error('    webhook_url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx');
    console.error('');
    console.error('server:');
    console.error('  port: 3000');
    console.error('  base_url: https://your-domain.com/path');
    console.error('');
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = parse(content) as FullConfig;

    // 验证必要字段
    if (!config.apple?.username || !config.apple?.password) {
      throw new Error('配置文件格式错误：缺少 apple.username 或 apple.password');
    }

    return config;
  } catch (error) {
    if (error instanceof Error && error.message.includes('配置文件')) {
      throw error;
    }
    throw new Error(`解析配置文件失败: ${error instanceof Error ? error.message : error}`);
  }
}

