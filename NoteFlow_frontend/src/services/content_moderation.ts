import request from '@/utils/request'

export interface ModerationModelOption {
  id: number
  provider_id: string
  provider_name: string
  model_name: string
  label: string
}

export interface ContentModerationConfig {
  configured: boolean
  selected: ModerationModelOption | null
  models: ModerationModelOption[]
}

export const contentModerationApi = {
  getConfig: () => request.get<unknown, ContentModerationConfig>('/admin/content_moderation/config'),
  updateConfig: (provider_id: string, model_name: string) =>
    request.put<unknown, ContentModerationConfig>('/admin/content_moderation/config', { provider_id, model_name }),
}
