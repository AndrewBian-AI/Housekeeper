import { getSettingValue } from "../db/settings.js";

export const DEFAULT_WECHAT_HELP_MESSAGE = `记账助手使用指南：
直接发送消费或收入信息即可记录，例如：
  "午饭花了35块"
  "打车20元"
  "发工资了15000"
  "补录 5月20日 午饭23元"
  "昨天买菜68元"

命令：
  /help - 查看帮助
  /recent - 查看家庭最近5笔记录
  /balance - 查看家庭本月收支`;

export function getWechatHelpMessage(): string {
  return getSettingValue("wechat.help_message") || DEFAULT_WECHAT_HELP_MESSAGE;
}
