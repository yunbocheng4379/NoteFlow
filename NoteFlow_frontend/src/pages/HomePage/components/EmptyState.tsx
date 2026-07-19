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

/* ---------- 能力展示（静态） ---------- */
interface Capability {
  icon: string  // public/ 目录下的图片路径
  title: string
  desc: string
}

const capabilities: Capability[] = [
  {
    icon: '/home_icon/notes.png',
    title: '智能笔记结构',
    desc: 'AI 自动提炼要点，按章节组织内容，附目录与原片时间锚点。',
  },
  {
    icon: '/home_icon/map.png',
    title: '一键思维导图',
    desc: '笔记内容自动转成可交互思维导图，节点可点击跳转章节。',
  },
  {
    icon: '/home_icon/ask.png',
    title: 'AI 问答',
    desc: '基于视频内容自由提问，回答自动引用原文片段并定位原片。',
  },
  {
    icon: '/home_icon/video.png',
    title: '原片回溯',
    desc: '点击笔记中的「原片 @ 时间」，跳回视频对应时间继续观看。',
  },
  {
    icon: '/home_icon/formats.png',
    title: '多格式导出',
    desc: '支持 Markdown / PDF / Word / HTML / 图片，沉淀到任意工作流。',
  },
  {
    icon: '/home_icon/comparison.png',
    title: '多版本对比',
    desc: '同一视频可生成多种风格的笔记版本，随时切换比对结果。',
  },
]

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

  const handleQuickGenerate = async () => {
    const url = videoUrl.trim()
    if (!url) {
      toast.error('请先粘贴视频链接')
      return
    }
    try {
      new URL(url)
    } catch {
      toast.error('请输入正确的视频链接')
      return
    }

    if (modelList.length === 0) {
      toast.error('请先添加 AI 模型')
      navigate('/settings/model')
      return
    }

    const model = modelList[0]
    const payload = {
      video_url: url,
      platform,
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
      const meta = info
        ? {
            title: info.title,
            cover_url: info.cover_url,
            duration: info.duration,
            platform: info.platform,
            video_id: info.video_id,
          }
        : undefined
      addPendingTask(data.task_id, platform, payload, meta)
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

        {/* 输入区 */}
        <div className="w-full max-w-2xl">
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
          <div className="mt-3 min-h-[3.5rem]">
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

          {/* 支持平台（紧贴输入区） */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
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

        {/* 能力展示 */}
        <div className="mt-14 w-full">
          <div className="mb-6 flex flex-col items-center text-center">
            <h2 className="text-xl font-semibold text-neutral-800">NoteFlow 能为你做什么</h2>
            <p className="mt-1.5 text-sm text-neutral-500">
              不仅是把视频转成文字，更帮你结构化、可检索、可追溯。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(cap => (
              <div
                key={cap.title}
                className="group flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-[#167a6e]/30 hover:shadow-md hover:shadow-[#167a6e]/10"
              >
                <img
                  src={cap.icon}
                  alt={cap.title}
                  className="h-[80px] w-[80px] shrink-0 object-contain"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-800">{cap.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-500">{cap.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

export default EmptyState
