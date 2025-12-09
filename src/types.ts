/**
 * 凭证类型定义
 */
export interface Credentials {
  username?: string;
  password?: string;
}

/**
 * CLI 选项类型定义
 */
export interface CLIOptions {
  username?: string;
  password?: string;
  headless?: boolean;
}

/**
 * 浏览器操作结果
 */
export interface BrowserResult {
  success: boolean;
  message: string;
  token?: string;
}
