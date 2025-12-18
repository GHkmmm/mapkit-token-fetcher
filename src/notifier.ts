/**
 * 通知模块 - 企业微信机器人
 */

export interface Notifier {
  /**
   * 发送验证码请求通知
   */
  sendVerificationRequired(taskId: string, verifyUrl: string): Promise<void>;

  /**
   * 发送任务完成通知
   */
  sendTaskCompleted(taskId: string, success: boolean, message: string): Promise<void>;
}

/**
 * 企业微信机器人通知器
 */
export class WeComNotifier implements Notifier {
  private webhookUrl: string;
  private baseUrl: string;

  constructor(webhookUrl: string, baseUrl: string) {
    this.webhookUrl = webhookUrl;
    this.baseUrl = baseUrl;
  }

  /**
   * 发送验证码请求通知（卡片消息）
   */
  async sendVerificationRequired(taskId: string, verifyUrl: string): Promise<void> {
    const message = {
      msgtype: 'template_card',
      template_card: {
        card_type: 'text_notice',
        main_title: {
          title: '🍎 MapKit Token 刷新',
          desc: '需要输入两步验证码'
        },
        sub_title_text: '请点击下方按钮输入 Apple ID 两步验证码以继续刷新 Token。验证码将在 5 分钟后过期。',
        horizontal_content_list: [
          {
            keyname: '任务 ID',
            value: taskId,
          },
          {
            keyname: '创建时间',
            value: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          }
        ],
        card_action: {
          type: 1,
          url: verifyUrl
        }
      }
    };

    await this.sendMessage(message);
  }

  /**
   * 发送任务完成通知
   */
  async sendTaskCompleted(taskId: string, success: boolean, message: string): Promise<void> {
    const content = {
      msgtype: 'markdown',
      markdown: {
        content: success
          ? `## ✅ MapKit Token 刷新成功\n\n**任务 ID**: ${taskId}...\n\n**时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n${message}`
          : `## ❌ MapKit Token 刷新失败\n\n**任务 ID**: ${taskId}...\n\n**时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n**错误**: ${message}`
      }
    };

    await this.sendMessage(content);
  }

  /**
   * 发送消息到企业微信
   */
  private async sendMessage(message: object): Promise<void> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        console.error(`❌ 企业微信通知发送失败: ${response.status} ${response.statusText}`);
      } else {
        const result = await response.json();
        if (result.errcode !== 0) {
          console.error(`❌ 企业微信通知发送失败: ${result.errmsg}`);
        } else {
          console.log('✅ 企业微信通知发送成功');
        }
      }
    } catch (error) {
      console.error('❌ 企业微信通知发送出错:', error instanceof Error ? error.message : error);
    }
  }
}

/**
 * 空通知器（不发送任何通知）
 */
export class NoopNotifier implements Notifier {
  async sendVerificationRequired(): Promise<void> {
    console.log('📭 通知已禁用，跳过发送验证码请求通知');
  }

  async sendTaskCompleted(): Promise<void> {
    console.log('📭 通知已禁用，跳过发送完成通知');
  }
}

/**
 * 创建通知器
 */
export function createNotifier(config?: { wecom?: { enabled: boolean; webhook_url: string } }, baseUrl?: string): Notifier {
  if (config?.wecom?.enabled && config.wecom.webhook_url) {
    console.log('📢 使用企业微信通知');
    return new WeComNotifier(config.wecom.webhook_url, baseUrl || '');
  }
  return new NoopNotifier();
}
