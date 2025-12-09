import * as readline from 'readline';

/**
 * 创建 readline 接口
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * 提示用户输入（普通文本）
 */
export async function prompt(question: string): Promise<string> {
  const rl = createReadlineInterface();
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * 提示用户输入密码（完全隐藏输入，macOS 风格）
 */
export async function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    
    if (process.stdin.isTTY) {
      // 设置终端为原始模式以隐藏输入
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (char: string) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            process.exit(0);
            break;
          case '\u007F': // Backspace
          case '\b':
            if (password.length > 0) {
              password = password.slice(0, -1);
              // 不显示任何内容，保持静默
            }
            break;
          default:
            // 不显示 *，完全静默输入
            password += char;
            break;
        }
      };
      
      process.stdin.on('data', onData);
    } else {
      // 非 TTY 环境，直接读取（无法隐藏）
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/**
 * 交互式获取凭证
 * @param existingUsername 已有的用户名（如果通过命令行传入）
 * @param existingPassword 已有的密码（如果通过命令行传入）
 */
export async function getCredentials(
  existingUsername?: string,
  existingPassword?: string
): Promise<{ username: string; password: string }> {
  let username = existingUsername || '';
  let password = existingPassword || '';

  if (!username) {
    username = await prompt('📧 请输入 Apple ID: ');
  } else {
    console.log(`📧 Apple ID: ${username}`);
  }

  if (!password) {
    password = await promptPassword('🔑 请输入密码（输入时不显示）: ');
  } else {
    console.log(`🔑 密码: ${'*'.repeat(password.length)}`);
  }

  return { username, password };
}

/**
 * 提示用户输入验证码
 */
export async function promptVerificationCode(): Promise<string> {
  console.log('');
  console.log('📱 检测到需要两步验证');
  const code = await prompt('🔢 请输入验证码: ');
  return code;
}
