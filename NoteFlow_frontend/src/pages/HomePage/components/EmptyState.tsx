import { FC, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Clock,
  Loader2,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

import { getVideoInfo, type VideoInfo, generateNote } from '@/services/note.ts'
import { useModelStore } from '@/store/modelStore'
import { useTaskStore } from '@/store/taskStore'
import { Input } from '@/components/ui/input.tsx'
import { Button } from '@/components/ui/button.tsx'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import { BiliBiliLogo, YoutubeLogo, DouyinLogo, KuaishouLogo } from '@/components/Icons/platform.tsx'
import { detectPlatform } from '@/constant/note.ts'
import { cn } from '@/lib/utils.ts'
import ExplorePanel from '@/pages/HomePage/components/ExplorePanel'

interface EmptyStateProps {
  /** 用户点击「更多设置」时回调，打开新建笔记弹窗（透传 url/platform 用于预填） */
  onMoreSettings: (prefill: { video_url: string; platform: string }) => void
}

const apiBase = String(import.meta.env.VITE_API_BASE_URL || 'api').replace(/\/$/, '')
const proxiedCover = (url?: string) =>
  url ? `${apiBase}/image_proxy?url=${encodeURIComponent(url)}` : ''

const formatDuration = (sec?: number) => {
  if (!sec || sec <= 0) return ''
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

const platformLabel: Record<string, string> = {
  bilibili: 'B站',
  youtube: 'YouTube',
  douyin: '抖音',
  kuaishou: '快手',
}

const platformLogo: Record<string, FC> = {
  bilibili: BiliBiliLogo,
  youtube: YoutubeLogo,
  douyin: DouyinLogo,
  kuaishou: KuaishouLogo,
}

const supportedPlatforms = [
  { key: 'bilibili', label: 'B站', Logo: BiliBiliLogo },
  { key: 'youtube', label: 'YouTube', Logo: YoutubeLogo },
  { key: 'douyin', label: '抖音', Logo: DouyinLogo },
  { key: 'kuaishou', label: '快手', Logo: KuaishouLogo },
]

const EmptyState: FC<EmptyStateProps> = ({ onMoreSettings }) => {
  const [videoUrl, setVideoUrl] = useState<string>('')
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'link' | 'explore'>('link')
  const parseSeqRef = useRef(0)

  const navigate = useNavigate()
  const { modelList, loadEnabledModels } = useModelStore()
  const addPendingTask = useTaskStore(s => s.addPendingTask)

  const platform = useMemo(() => detectPlatform(videoUrl), [videoUrl])
  const PlatformLogo = platformLogo[platform]

  useEffect(() => {
    if (modelList.length === 0) loadEnabledModels()
  }, [])

  // URL 防抖解析
  useEffect(() => {
    const url = videoUrl.trim()
    let valid = false
    try {
      const u = new URL(url)
      valid = ['http:', 'https:'].includes(u.protocol)
    } catch {
      valid = false
    }
    if (!valid) {
      setInfo(null)
      setParsing(false)
      return
    }
    const seq = ++parseSeqRef.current
    setParsing(true)
    setInfo(null)
    const timer = setTimeout(async () => {
      const res = await getVideoInfo(url, platform)
      if (seq !== parseSeqRef.current) return
      setInfo(res)
      setParsing(false)
    }, 600)
    return () => clearTimeout(timer)
  }, [videoUrl, platform])

  /**
   * 内部提交实现：接受一个必然带 video_url + platform 的 prefill，
   * 供「链接」Tab 的输入区与「探索」Tab 的搜索结果卡片共用。
   * 探索 Tab 点击卡片时不经过 URL 输入框防抖解析，因此 `info`（含标题/封面）
   * 可能为 null；此时不附带 meta，任务列表会退化为纯 URL 展示。
   */
  const submitForPrefill = async (prefill: { video_url: string; platform: string }) => {
    const url = prefill.video_url.trim()
    if (!url) {
      toast.error('请先选择视频')
      return
    }
    try {
      new URL(url)
    } catch {
      toast.error('视频链接无效')
      return
    }

    if (modelList.length === 0) {
      toast.error('请先添加 AI 模型')
      navigate('/settings/model')
      return
    }

    const targetPlatform = prefill.platform
    const model = modelList[0]
    const payload = {
      video_url: url,
      platform: targetPlatform,
      quality: 'medium' as const,
      model_name: model.model_name,
      provider_id: model.provider_id,
      format: ['toc', 'link', 'summary'],
      style: 'minimal',
      video_understanding: false,
      video_interval: 6,
      grid_size: [2, 2] as [number, number],
      task_id: '',
      free_generate: true,
    }

    setSubmitting(true)
    try {
      const data: any = await generateNote(payload as any)
      // `info` 始终是「链接」Tab 输入框 `videoUrl` 的防抖解析结果，因此
      // 用字符串相等判定即可判断 meta 是否属于当前 URL：
      // - 链接 Tab 走 handleQuickGenerate，url === videoUrl.trim() → 命中；
      //   短链（b23.tv / v.douyin.com 等）即便 info.video_id 不在原始 URL
      //   里，只要没换过输入框内容，cover/title/duration 仍会带上，避免
      //   pending 卡片退化为纯 URL 展示。
      // - 探索 Tab 走卡片点击，url 是搜索结果的规范化链接，与当前 videoUrl
      //   不一致 → 自动丢弃，避免残留 meta 污染新任务。
      const meta =
        info && url === videoUrl.trim()
          ? {
              title: info.title,
              cover_url: info.cover_url,
              duration: info.duration,
              platform: info.platform,
              video_id: info.video_id,
            }
          : undefined
      addPendingTask(data.task_id, targetPlatform, payload, meta)
    } catch (e: any) {
      if (e?.data?.reason === 'transcriber_model_not_ready') {
        toast.error('转写模型尚未下载，请先去「音频转写配置」页下载')
        navigate('/settings/transcriber')
      } else {
        toast.error('提交任务失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuickGenerate = () => submitForPrefill({ video_url: videoUrl, platform })

  const cover = info ? proxiedCover(info.cover_url) : ''
  const duration = info ? formatDuration(info.duration) : ''

  return (
    <ScrollArea className="h-full w-full bg-gradient-to-b from-[#e6f7f5]/50 via-white to-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-16 pt-20">
        {/* 顶部电力横幅 */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-1.5 text-sm text-amber-800 shadow-sm">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-[10px] font-bold text-white shadow">
            ¥
          </span>
          <span className="font-medium">100 电力已到账</span>
          <span className="text-amber-400">·</span>
          <span className="text-amber-700/80">约 5 篇短视频 或 2 篇 30 分钟课程</span>
        </div>

        {/* Hero 文案 */}
        <h1 className="mb-3 text-center text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
          粘贴视频链接，生成 AI 笔记
        </h1>
        <p className="mb-8 max-w-xl text-center text-sm text-neutral-500">
          AI 自动整理结构化笔记，可生成思维导图与原片回溯。
        </p>

        {/* 输入区：链接 / 探索 双 Tab */}
        <div className={cn('w-full', activeTab === 'link' ? 'max-w-2xl' : 'max-w-5xl')}>
          {/* Tab 切换 */}
          <div className="mb-4 flex justify-center gap-1 border-b border-neutral-200">
            <button
              type="button"
              onClick={() => setActiveTab('link')}
              className={cn(
                'px-4 pb-2 text-sm font-medium transition-colors',
                activeTab === 'link'
                  ? 'border-primary text-primary -mb-px border-b-2'
                  : 'text-neutral-500 hover:text-neutral-700'
              )}
            >
              链接
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('explore')}
              className={cn(
                'px-4 pb-2 text-sm font-medium transition-colors',
                activeTab === 'explore'
                  ? 'border-primary text-primary -mb-px border-b-2'
                  : 'text-neutral-500 hover:text-neutral-700'
              )}
            >
              探索
            </button>
          </div>

          {activeTab === 'explore' ? (
            <ExplorePanel
              onQuickGenerate={submitForPrefill}
              onMoreSettings={prefill => onMoreSettings(prefill)}
            />
          ) : (
          <div className="w-full">
          <div className="flex items-center gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg shadow-[#167a6e]/10">
            {/*
              还没有生成内容时（EmptyState 仅在 status === 'idle' 渲染）展示扫光动画：
              relative + overflow-hidden 圈定范围，伪元素做 -20° 斜向高光条，从左向右无限滑动。
              仅作用于输入框所在容器，不套在 input 标签本身上，也不影响右侧「更多设置」/「生成」按钮。
            */}
            <div
              className="relative flex flex-1 items-center gap-2 overflow-hidden px-3 before:absolute before:inset-y-0 before:left-0 before:w-1/4 before:-skew-x-[20deg] before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent before:content-[''] before:pointer-events-none before:animate-[sweep_1.5s_linear_infinite]"
            >
              {videoUrl.trim() && PlatformLogo && (
                <div className="h-4 w-4 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                  <PlatformLogo />
                </div>
              )}
              <Input
                autoFocus
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !submitting) handleQuickGenerate()
                }}
                placeholder="粘贴视频链接，例如 https://www.bilibili.com/video/..."
                className="h-10 flex-1 border-none bg-transparent shadow-none focus-visible:ring-0"
              />
            </div>

            {/* 更多设置（嵌入式次级按钮） */}
            <button
              type="button"
              onClick={() => onMoreSettings({ video_url: videoUrl.trim(), platform })}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
              title="自定义模型、风格、画质等"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">更多设置</span>
            </button>

            <Button
              type="button"
              onClick={handleQuickGenerate}
              disabled={!videoUrl.trim() || submitting}
              className="bg-primary hover:bg-primary/90 h-10 shrink-0 gap-1.5 px-5 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  提交中…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  免费生成
                </>
              )}
            </Button>
          </div>

          {/* 解析预览 */}
          <div className="mt-3 min-h-0">
            {parsing && (
              <div className="animate-in fade-in flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm duration-300">
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-neutral-100">
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-neutral-100 via-neutral-200 to-neutral-100" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
                    正在解析链接…
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    拉取标题 / 封面 / 时长（通常几秒内完成）
                  </p>
                </div>
              </div>
            )}

            {!parsing && info && (
              <div className="animate-in fade-in slide-in-from-top-1 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm duration-300">
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-neutral-100">
                  {cover ? (
                    <img
                      src={cover}
                      alt={info.title}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-neutral-200" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="line-clamp-2 text-sm font-medium text-neutral-800"
                    title={info.title}
                  >
                    {info.title || '未命名视频'}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                    <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
                      {PlatformLogo && (
                        <span className="inline-block h-3 w-3 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                          <PlatformLogo />
                        </span>
                      )}
                      {platformLabel[platform]}
                    </span>
                    {duration && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 text-neutral-400" />
                        {duration}
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 text-emerald-600">
                      <Check className="h-3.5 w-3.5" />
                      已识别
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 支持平台 */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
            {supportedPlatforms.map(({ key, label, Logo }) => (
              <div
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/70 px-2.5 py-1 text-xs text-neutral-500"
              >
                <span className="inline-block h-3 w-3 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                  <Logo />
                </span>
                {label}
              </div>
            ))}
          </div>
          </div>
          )}
        </div>

      </div>
    </ScrollArea>
  )
}

export default EmptyState
