// 本次登录会话内"已关闭"过的 active update_log id 集合 key.
// 单独放在无依赖的 constant 模块, 因为 utils/request.ts 和 services/updateLog.ts
// 都需要引用它, 而 services/updateLog.ts 本身依赖 utils/request, 直接互相 import 会成环.
export const DISMISSED_UPDATE_LOG_SESSION_KEY = 'noteflow-update-log-dismissed'
