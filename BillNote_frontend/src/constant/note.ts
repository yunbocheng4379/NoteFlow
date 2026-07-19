/* -------------------- 常量 -------------------- */
import {
  BiliBiliLogo,
  DouyinLogo,
  KuaishouLogo,
  LocalLogo,
  YoutubeLogo,
} from '@/components/Icons/platform.tsx'
import type { NoteStyle } from '@/services/note_style'

export const noteFormats = [
  { label: '目录', value: 'toc' },
  { label: '原片跳转', value: 'link' },
  { label: '原片截图', value: 'screenshot' },
  { label: 'AI总结', value: 'summary' },
] as const

/**
 * 笔记风格接口请求失败时的兜底数据，仅供 noteStyleStore 内部使用。
 * 与后端 SYSTEM_STYLES 保持同步；正常情况下风格列表应来自 /note_styles 接口。
 */
export const fallbackNoteStyles: NoteStyle[] = [
  { id: -1, name: '精简', value: 'minimal', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -2, name: '详细', value: 'detailed', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -3, name: '教程', value: 'tutorial', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -4, name: '学术', value: 'academic', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -5, name: '小红书', value: 'xiaohongshu', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -6, name: '生活向', value: 'life_journal', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -7, name: '任务导向', value: 'task_oriented', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -8, name: '商业风格', value: 'business', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
  { id: -9, name: '会议纪要', value: 'meeting_minutes', description: null, prompt: '', source: 'system', user_id: null, is_public: false, icon: null, created_at: null },
]

export const videoPlatforms = [
  { label: '哔哩哔哩', value: 'bilibili', logo: BiliBiliLogo },
  { label: 'YouTube', value: 'youtube', logo: YoutubeLogo },
  { label: '抖音', value: 'douyin', logo: DouyinLogo },
  { label: '快手', value: 'kuaishou', logo: KuaishouLogo },
  { label: '本地视频', value: 'local', logo: LocalLogo },
] as const

export type VideoPlatformValue = (typeof videoPlatforms)[number]['value']
export type OnlineVideoPlatformValue = Exclude<VideoPlatformValue, 'local'>

/** 从 URL 推断平台；无法识别返回 bilibili（默认） */
export const detectPlatform = (url: string): OnlineVideoPlatformValue => {
  const u = url.trim().toLowerCase()
  if (/bilibili\.com|b23\.tv/.test(u)) return 'bilibili'
  if (/youtube\.com|youtu\.be/.test(u)) return 'youtube'
  if (/douyin\.com|iesdouyin\.com/.test(u)) return 'douyin'
  if (/kuaishou\.com|kuaishou\.com\/short-video/.test(u)) return 'kuaishou'
  return 'bilibili'
}
