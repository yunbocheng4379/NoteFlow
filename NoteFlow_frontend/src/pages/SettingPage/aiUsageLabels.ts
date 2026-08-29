export interface AiUsageSceneDefinition {
  label: string
  description: string
}

export const AI_USAGE_SCENES: Record<string, AiUsageSceneDefinition> = {
  note_generation: { label: '视频笔记生成', description: '将视频内容转成结构化笔记' },
  note_merge: { label: '笔记合并', description: '把多篇笔记合并成一篇内容' },
  workbench_chat: { label: '视频笔记问答', description: '围绕已生成笔记进行问答' },
  knowledge_base_chat: { label: '知识库问答', description: '基于知识库内容进行问答' },
  flashcard_generation: { label: '闪记卡生成', description: '根据笔记生成记忆卡片' },
  model_direct: { label: '模型直接调用', description: '系统功能发起的普通模型调用' },
  model_test: { label: '模型连通性测试', description: '管理员测试模型接口是否可用' },
  content_moderation: { label: '内容审核', description: '审核笔记风格或内容是否合规' },
  product_assistant: { label: '产品助手', description: '产品帮助与使用说明问答' },
}

export const AI_USAGE_STATUS_LABELS: Record<string, string> = {
  success: '成功',
  failed: '失败',
  timeout: '超时',
  cancelled: '取消',
  started: '进行中',
}

export function getSceneDefinition(scene?: string | null): AiUsageSceneDefinition {
  if (scene && AI_USAGE_SCENES[scene]) return AI_USAGE_SCENES[scene]
  return { label: '未知场景', description: '系统未登记的调用场景' }
}

export function formatScene(scene?: string | null) {
  const code = scene || 'unknown'
  return `${getSceneDefinition(scene).label}（${code}）`
}

export function formatStatus(status?: string | null) {
  if (!status) return '未知'
  return AI_USAGE_STATUS_LABELS[status] || status
}
