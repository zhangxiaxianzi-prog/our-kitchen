import config from './厨房服务配置.json';
// 切换前仍访问旧厨房，只有迁移和云端验证通过后才启用微信后台。
export function kitchenApi(path: '/api/login' | '/api/kitchen') {
  return (config.启用微信后台 ? config.微信后台地址 : '') + path;
}
// 新后台换了签名密钥时要重新输入共同口令，不能把旧登录票据当成新票据。
export const kitchenTokenKey = config.启用微信后台 ? 'kitchen-wechat-key' : 'kitchen-key';
