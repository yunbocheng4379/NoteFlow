import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form.tsx'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { Link as RouterLink } from 'react-router-dom'
import { billingApi } from '@/services/billing'
import { platformAPI } from '@/services/platform'
import { useUserStore } from '@/store/userStore'
import {
  generateNote,
  generateNotesBatch,
  getChannelVideos,
  getVideoInfo,
  type ChannelVideoItem,
  type VideoInfo,
} from '@/services/note.ts'
import { uploadFile } from '@/services/upload.ts'
import { useTaskStore } from '@/store/taskStore'
import { useModelStore } from '@/store/modelStore'
import { useNoteStyleStore } from '@/store/noteStyleStore'
import { useCollectionStore } from '@/store/collectionStore'
import { Button } from '@/components/ui/button.tsx'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { detectPlatform, noteFormats, videoPlatforms } from '@/constant/note.ts'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

/* ---------- Schema ---------- */
const formSchema = z
  .object({
    video_url: z.string().optional(),
    platform: z.string().nonempty('请选择平台'),
    quality: z.enum(['fast', 'medium', 'slow']),
    model_name: z.string().nonempty('请选择模型'),
    format: z.array(z.string()).default([]),
    style: z.string().nonempty('请选择笔记生成风格'),
    extras: z.string().optional(),
    video_understanding: z.boolean().optional(),
    video_interval: z.coerce.number().min(1).max(30).default(6).optional(),
    grid_size: z
      .tuple([z.coerce.number().min(1).max(10), z.coerce.number().min(1).max(10)])
      .default([2, 2])
      .optional(),
    collection_id: z.string().optional(),
    // 批量模式下跳过 video_url 必填校验；提交时另走 handleBatchSubmit 的选中列表校验
    _batch_mode: z.boolean().optional(),
  })
  .superRefine(({ video_url, platform, _batch_mode }, ctx) => {
    if (_batch_mode) return
    if (!video_url) {
      ctx.addIssue({
        code: 'custom',
        message: platform === 'local' ? '本地视频路径不能为空' : '视频链接不能为空',
        path: ['video_url'],
      })
    } else if (platform !== 'local') {
      try {
        const url = new URL(video_url)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      } catch {
        ctx.addIssue({ code: 'custom', message: '请输入正确的视频链接', path: ['video_url'] })
      }
    }
  })

export type NoteFormValues = z.infer<typeof formSchema>

/* ---------- Model avatar letter ---------- */
const modelInitial = (name: string) => name.charAt(0).toUpperCase()
const MODEL_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500',
]
const avatarColor = (name: string) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return MODEL_COLORS[Math.abs(h) % MODEL_COLORS.length]
}

/* ---------- Multi-select format dropdown ---------- */
const FormatMultiSelect = ({
  value,
  onChange,
  screenshotDisabled,
  linkDisabled,
  scrollAreaRef,
}: {
  value: string[]
  onChange: (v: string[]) => void
  screenshotDisabled: boolean
  linkDisabled: boolean
  scrollAreaRef: React.RefObject<HTMLElement | null>
}) => {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const openDropdown = () => {
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 打开后：① 让下拉面板跟随触发器滚动（监听可滚动祖先的 scroll/resize）
  //        ② 同时锁定背后的表单可滚动区，阻止滚轮 / 键盘 / 惯性把它向下推
  useEffect(() => {
    if (!open) return
    const update = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect())
    }

    const scrollAncestors: Element[] = []
    let el: Element | null = triggerRef.current?.parentElement ?? null
    while (el && el !== document.documentElement.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        scrollAncestors.push(el)
      }
      el = el.parentElement
    }

    // 锁定背后的表单滚动容器：拦截 wheel，禁用 overscroll-behavior，被动滚动时立刻回弹
    const scrollArea = scrollAreaRef.current
    const savedScrollTop = scrollArea?.scrollTop ?? 0
    const prevOverscrollBehavior = scrollArea?.style.overscrollBehavior ?? ''
    const prevOverscrollBehaviorY = scrollArea?.style.overscrollBehaviorY ?? ''
    if (scrollArea) {
      scrollArea.style.overscrollBehavior = 'contain'
      scrollArea.style.overscrollBehaviorY = 'contain'
    }
    const lockScroll = (e: Event) => {
      if (!scrollArea) return
      // 若滚轮命中了下拉面板内部（dropRef 内的子元素），让浏览器默认行为发生即可
      const target = e.target as Node | null
      if (target && dropRef.current?.contains(target)) return
      e.preventDefault()
    }
    const enforceTop = () => {
      if (scrollArea && scrollArea.scrollTop !== savedScrollTop) {
        scrollArea.scrollTop = savedScrollTop
      }
    }
    if (scrollArea) {
      scrollArea.addEventListener('wheel', lockScroll, { passive: false })
      scrollArea.addEventListener('scroll', enforceTop, { passive: true })
    }

    scrollAncestors.forEach(sa => sa.addEventListener('scroll', update, { passive: true }))
    window.addEventListener('resize', update)
    return () => {
      scrollAncestors.forEach(sa => sa.removeEventListener('scroll', update))
      window.removeEventListener('resize', update)
      if (scrollArea) {
        scrollArea.removeEventListener('wheel', lockScroll)
        scrollArea.removeEventListener('scroll', enforceTop)
        scrollArea.style.overscrollBehavior = prevOverscrollBehavior
        scrollArea.style.overscrollBehaviorY = prevOverscrollBehaviorY
        scrollArea.scrollTop = savedScrollTop
      }
    }
  }, [open, scrollAreaRef])

  const disabledMap: Record<string, boolean> = {
    screenshot: screenshotDisabled,
    link: linkDisabled,
  }

  const toggle = (v: string) => {
    if (disabledMap[v]) return
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  }

  const selectedLabels = noteFormats
    .filter(f => value.includes(f.value))
    .map(f => f.label)

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex h-9 w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm hover:border-neutral-300 focus:outline-none"
      >
        <span className="truncate text-neutral-600">
          {selectedLabels.length > 0 ? selectedLabels.join('、') : '请选择笔记格式'}
        </span>
        <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 text-neutral-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && rect && createPortal(
        <div
          ref={dropRef}
          data-dialog-ignore="true"
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999, pointerEvents: 'auto' }}
          className="max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {noteFormats.map(({ label, value: v }) => {
            const disabled = disabledMap[v]
            const checked = value.includes(v)
            return (
              <button
                key={v}
                type="button"
                disabled={disabled}
                onClick={() => toggle(v)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                  disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-neutral-50',
                )}
              >
                <div className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  checked ? 'border-primary bg-primary' : 'border-neutral-300',
                )}>
                  {checked && <Check className="h-3 w-3 text-white" />}
                </div>
                <span className="flex-1 text-left">{label}</span>
                {v === 'screenshot' && disabled && (
                  <span className="text-xs text-amber-500">需开启视频理解</span>
                )}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

interface NoteFormProps {
  onSubmitSuccess?: () => void
  /** 'create' = 新建笔记（始终新建任务）；'regenerate' = 基于当前任务重新生成（覆盖） */
  mode?: 'create' | 'regenerate'
  /** 新建模式下首次挂载时的预填值（来自首页空态的链接 + 平台） */
  prefill?: { video_url?: string; platform?: string }
}

/* ---------- 视频信息预览卡片 ---------- */
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

const VideoInfoPreview = ({
  parsing,
  info,
  platform,
}: {
  parsing: boolean
  info: VideoInfo | null
  platform: string
}) => {
  if (parsing) {
    return (
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
    )
  }

  if (!info) return null

  const cover = proxiedCover(info.cover_url)
  const duration = formatDuration(info.duration)
  const platformMeta = videoPlatforms.find(p => p.value === platform)
  const PlatformLogo = platformMeta?.logo

  return (
    <div className="animate-in fade-in slide-in-from-top-1 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm duration-300">
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-neutral-100">
        {cover ? (
          <img src={cover} alt={info.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-300">
            <Upload className="h-5 w-5" />
          </div>
        )}
        {duration && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
            {duration}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-neutral-800" title={info.title}>
          {info.title || '未命名视频'}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
          {platformMeta && (
            <span className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
              {PlatformLogo && (
                <span className="inline-block h-3 w-3 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                  <PlatformLogo />
                </span>
              )}
              {platformMeta.label === '哔哩哔哩' ? 'B站' : platformMeta.label}
            </span>
          )}
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
  )
}

/* ---------- Main component ---------- */
const NoteForm = ({ onSubmitSuccess, mode = 'create', prefill }: NoteFormProps) => {
  const navigate = useNavigate()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [modelDropOpen, setModelDropOpen] = useState(false)
  const [modelDropRect, setModelDropRect] = useState<DOMRect | null>(null)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  // 表单可滚动内容区：下拉打开时锁定，阻止滚轮/键盘/惯性把表单向下推
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // 视频信息预览（粘贴链接后即时解析封面/标题）
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [parsing, setParsing] = useState(false)
  const parseSeqRef = useRef(0)

  // 平台禁用提示（从后端 /platforms 获取）
  const [platformDisabled, setPlatformDisabled] = useState<string | null>(null)

  // ==== 批量模式 ====
  const [batchMode, setBatchMode] = useState(false)
  const [channelUrl, setChannelUrl] = useState('')
  const [batchUrlsText, setBatchUrlsText] = useState('')
  const [batchResolving, setBatchResolving] = useState(false)
  const [batchPreview, setBatchPreview] = useState<
    Array<ChannelVideoItem & { platform: string; checked: boolean }>
  >([])
  const [batchSubmitting, setBatchSubmitting] = useState(false)

  const { addPendingTask, currentTaskId, getCurrentTask, retryTask } = useTaskStore()
  const { loadEnabledModels, modelList } = useModelStore()
  const { loadStyles, styles: noteStyles } = useNoteStyleStore()
  const { loadCollections, collections } = useCollectionStore()

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      platform: prefill?.platform || 'bilibili',
      video_url: prefill?.video_url || '',
      quality: 'medium',
      model_name: modelList[0]?.model_name || '',
      style: 'minimal',
      video_interval: 6,
      grid_size: [2, 2],
      format: [],
      _batch_mode: false,
    },
  })
  const currentTask = getCurrentTask()

  const platform = useWatch({ control: form.control, name: 'platform' })
  const videoUrl = useWatch({ control: form.control, name: 'video_url' })
  const modelName = useWatch({ control: form.control, name: 'model_name' })
  const videoUnderstandingEnabled = useWatch({ control: form.control, name: 'video_understanding' })
  const videoInterval = useWatch({ control: form.control, name: 'video_interval' })
  const gridSize = useWatch({ control: form.control, name: 'grid_size' })

  const isLocal = platform === 'local'
  const detectedPlatform = useMemo(() => detectPlatform(videoUrl || ''), [videoUrl])
  const onlinePlatformMeta = videoPlatforms.find(p => p.value === detectedPlatform)
  const OnlinePlatformLogo = onlinePlatformMeta?.logo

  useEffect(() => {
    if (isLocal) return
    if (platform !== detectedPlatform) {
      form.setValue('platform', detectedPlatform, { shouldValidate: true })
    }
  }, [detectedPlatform, form, isLocal, platform])

  // ==== 电力成本预览 ====
  const userCredits = useUserStore((s) => s.credits)
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const currentUserId = useUserStore((s) => s.user?.id)
  const [costPreview, setCostPreview] = useState<{ required: number; sufficient: boolean; duration_sec: number | null } | null>(null)

  useEffect(() => {
    if (!modelName || !videoUrl || isLocal) {
      setCostPreview(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      // 拿真实视频 duration 后再预估, 与后端生成时的 duration 计费口径保持一致.
      try {
        const info = await getVideoInfo(videoUrl, platform)
        if (cancelled) return
        const durationSec = info?.duration || 0
        const preview = await billingApi.pricingPreview(modelName, durationSec)
        if (cancelled) return
        setCostPreview({
          required: preview.required_credits,
          sufficient: preview.sufficient,
          duration_sec: durationSec || null,
        })
      } catch {
        if (cancelled) return
        // 拿不到 duration 时按 1 分钟 rate 兜底展示
        try {
          const preview = await billingApi.pricingPreview(modelName, 0)
          if (cancelled) return
          setCostPreview({
            required: preview.required_credits,
            sufficient: preview.sufficient,
            duration_sec: null,
          })
        } catch {
          if (!cancelled) setCostPreview(null)
        }
      }
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [videoUrl, modelName, platform, isLocal, userCredits])

  useEffect(() => {
    loadEnabledModels()
    loadStyles()
    loadCollections()
    // 加载平台列表，检查当前平台是否被禁用
    platformAPI.list().then(platforms => {
      const cur = platforms.find((p: any) => p.platform_id === platform)
      if (cur && !cur.is_enabled) {
        setPlatformDisabled(cur.name || platform)
      }
    }).catch(() => {})
  }, [])

  // 笔记风格按来源分组：系统内置 / 我的自定义 / 公开广场（公开广场排除自己创建的，避免同一 value 在两组间重复选中）
  const styleValue = useWatch({ control: form.control, name: 'style' })
  const groupedStyles = useMemo(() => {
    const system = noteStyles.filter((s) => s.source === 'system')
    const mine = noteStyles.filter((s) => s.source === 'user' && s.user_id === currentUserId)
    const isPublic = noteStyles.filter((s) => s.is_public && s.user_id !== currentUserId)
    return { system, mine, isPublic }
  }, [noteStyles, currentUserId])

  // 若当前选中的风格已不在可用列表中（如被作者删除或取消公开），回退到默认系统风格
  useEffect(() => {
    if (noteStyles.length === 0 || !styleValue) return
    const exists = noteStyles.some((s) => s.value === styleValue)
    if (!exists) {
      form.setValue('style', 'minimal', { shouldValidate: true })
      toast.error('所选笔记风格已不可用，已切换为默认风格')
    }
  }, [noteStyles, styleValue])

  // 在线链接输入后，防抖解析视频封面/标题做即时预览
  useEffect(() => {
    if (isLocal) {
      setVideoInfo(null)
      setParsing(false)
      return
    }
    const url = (videoUrl || '').trim()
    // 基本合法性校验，避免无效输入打后端
    let valid = false
    try {
      const u = new URL(url)
      valid = ['http:', 'https:'].includes(u.protocol)
    } catch {
      valid = false
    }
    if (!valid) {
      setVideoInfo(null)
      setParsing(false)
      return
    }

    const seq = ++parseSeqRef.current
    setParsing(true)
    setVideoInfo(null)
    const timer = setTimeout(async () => {
      const info = await getVideoInfo(url, platform)
      // 防止竞态：仅采用最新一次请求的结果
      if (seq !== parseSeqRef.current) return
      setVideoInfo(info)
      setParsing(false)
    }, 600)

    return () => clearTimeout(timer)
  }, [videoUrl, platform, isLocal])

  useEffect(() => {
    if (modelList.length > 0 && !form.getValues('model_name')) {
      form.setValue('model_name', modelList[0].model_name, { shouldValidate: false })
    }
  }, [modelList.length])

  useEffect(() => {
    // 仅在「重新生成」模式下，用当前任务数据回填表单；新建笔记保持空白
    if (mode !== 'regenerate' || !currentTask) return
    const { formData } = currentTask
    form.reset({
      platform: formData.platform || 'bilibili',
      video_url: formData.video_url || '',
      model_name: formData.model_name || modelList[0]?.model_name || '',
      style: formData.style || 'minimal',
      quality: formData.quality || 'medium',
      extras: formData.extras || '',
      video_understanding: formData.video_understanding ?? false,
      video_interval: formData.video_interval ?? 6,
      grid_size: formData.grid_size ?? [2, 2],
      format: formData.format ?? [],
    })
  }, [mode, currentTaskId, modelList.length, currentTask?.formData])

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelDropOpen) return
    const handler = (e: MouseEvent) => {
      if (
        modelTriggerRef.current?.contains(e.target as Node) ||
        document.getElementById('model-drop-panel')?.contains(e.target as Node)
      ) return
      setModelDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelDropOpen])

  // 打开模型下拉后：
  // ① 监听可滚动祖先 + 窗口尺寸变化，让下拉面板跟随触发器滚动
  // ② 锁定背后的表单可滚动区，阻止滚轮 / 键盘 / 惯性把它向下推
  useEffect(() => {
    if (!modelDropOpen) return
    const update = () => {
      if (modelTriggerRef.current) setModelDropRect(modelTriggerRef.current.getBoundingClientRect())
    }

    const scrollAncestors: Element[] = []
    let el: Element | null = modelTriggerRef.current?.parentElement ?? null
    while (el && el !== document.documentElement.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        scrollAncestors.push(el)
      }
      el = el.parentElement
    }

    // 锁定背后的表单滚动容器
    const scrollArea = scrollAreaRef.current
    const savedScrollTop = scrollArea?.scrollTop ?? 0
    const prevOverscrollBehavior = scrollArea?.style.overscrollBehavior ?? ''
    const prevOverscrollBehaviorY = scrollArea?.style.overscrollBehaviorY ?? ''
    const panel = () => document.getElementById('model-drop-panel')
    if (scrollArea) {
      scrollArea.style.overscrollBehavior = 'contain'
      scrollArea.style.overscrollBehaviorY = 'contain'
    }
    const lockScroll = (e: Event) => {
      const target = e.target as Node | null
      if (target && panel()?.contains(target)) return
      e.preventDefault()
    }
    const enforceTop = () => {
      if (scrollArea && scrollArea.scrollTop !== savedScrollTop) {
        scrollArea.scrollTop = savedScrollTop
      }
    }
    if (scrollArea) {
      scrollArea.addEventListener('wheel', lockScroll, { passive: false })
      scrollArea.addEventListener('scroll', enforceTop, { passive: true })
    }

    scrollAncestors.forEach(sa => sa.addEventListener('scroll', update, { passive: true }))
    window.addEventListener('resize', update)
    return () => {
      scrollAncestors.forEach(sa => sa.removeEventListener('scroll', update))
      window.removeEventListener('resize', update)
      if (scrollArea) {
        scrollArea.removeEventListener('wheel', lockScroll)
        scrollArea.removeEventListener('scroll', enforceTop)
        scrollArea.style.overscrollBehavior = prevOverscrollBehavior
        scrollArea.style.overscrollBehaviorY = prevOverscrollBehaviorY
        scrollArea.scrollTop = savedScrollTop
      }
    }
  }, [modelDropOpen, scrollAreaRef])

  // When video_understanding is disabled, remove screenshot from format
  useEffect(() => {
    if (!videoUnderstandingEnabled) {
      const fmt = form.getValues('format')
      if (fmt.includes('screenshot')) {
        form.setValue('format', fmt.filter(f => f !== 'screenshot'))
      }
    }
  }, [videoUnderstandingEnabled])

  const isGenerating = () => !['SUCCESS', 'FAILED', undefined].includes(getCurrentTask()?.status)
  const generating = isGenerating()

  const handleFileUpload = async (file: File, cb: (url: string) => void) => {
    setIsUploading(true)
    setUploadSuccess(false)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const data = await uploadFile(fd)
      cb(data.url)
      setUploadSuccess(true)
    } catch {
      toast.error('文件上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  const CHANNEL_RESOLVABLE_PLATFORMS = ['bilibili', 'youtube']

  // 解析 UP主/频道链接，把结果合并进预览列表（按 video_url 去重）
  const handleResolveChannel = async () => {
    const url = channelUrl.trim()
    if (!url) return
    const detected = detectPlatform(url)
    if (!CHANNEL_RESOLVABLE_PLATFORMS.includes(detected)) {
      toast.error('频道/合集自动解析仅支持 B站和 YouTube，其余平台请手动粘贴视频链接')
      return
    }
    setBatchResolving(true)
    try {
      const videos = await getChannelVideos(url, detected)
      if (videos.length === 0) {
        toast.error('未解析到任何视频，请检查链接')
        return
      }
      setBatchPreview(prev => {
        const existing = new Set(prev.map(v => v.video_url))
        const added = videos
          .filter(v => !existing.has(v.video_url))
          .map(v => ({ ...v, platform: detected, checked: true }))
        return [...prev, ...added]
      })
      toast.success(`解析到 ${videos.length} 个视频`)
    } catch (e) {
      console.error('解析频道/合集失败：', e)
      toast.error('解析失败，请检查链接或稍后重试')
    } finally {
      setBatchResolving(false)
    }
  }

  // 解析手动粘贴的多个视频链接（逗号或换行分隔），逐条调用 /video_info 预览
  const handleResolveManualUrls = async () => {
    const urls = batchUrlsText
      .split(/[\n,，]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (urls.length === 0) return

    const existing = new Set(batchPreview.map(v => v.video_url))
    const uniqueUrls = [...new Set(urls)].filter(u => !existing.has(u))
    if (uniqueUrls.length === 0) return

    setBatchResolving(true)
    try {
      const results = await Promise.all(
        uniqueUrls.map(async url => {
          const detected = detectPlatform(url)
          const info = await getVideoInfo(url, detected)
          return {
            video_url: url,
            title: info?.title || url,
            cover_url: info?.cover_url || '',
            duration: info?.duration || 0,
            platform: detected,
            checked: true,
          }
        }),
      )
      setBatchPreview(prev => [...prev, ...results])
      setBatchUrlsText('')
    } finally {
      setBatchResolving(false)
    }
  }

  const toggleBatchItem = (videoUrl: string) => {
    setBatchPreview(prev =>
      prev.map(v => (v.video_url === videoUrl ? { ...v, checked: !v.checked } : v)),
    )
  }

  const removeBatchItem = (videoUrl: string) => {
    setBatchPreview(prev => prev.filter(v => v.video_url !== videoUrl))
  }

  const handleBatchSubmit = async (values: NoteFormValues) => {
    const selected = batchPreview.filter(v => v.checked)
    if (selected.length === 0) {
      toast.error('请至少选择一个视频')
      return
    }
    if (selected.length > 30) {
      toast.error('单批最多支持 30 个视频，请减少选择数量')
      return
    }
    setBatchSubmitting(true)
    try {
      const { batch_id, results } = await generateNotesBatch({
        items: selected.map(v => ({ video_url: v.video_url, platform: v.platform })),
        quality: values.quality,
        model_name: values.model_name,
        provider_id: modelList.find(m => m.model_name === values.model_name)!.provider_id,
        format: values.format,
        style: values.style,
        extras: values.extras,
        video_understanding: values.video_understanding,
        video_interval: values.video_interval,
        grid_size: values.grid_size as unknown as number[],
        collection_id: values.collection_id ? Number(values.collection_id) : undefined,
      })

      let successCount = 0
      for (const r of results) {
        if (r.success && r.task_id) {
          const source = selected.find(v => v.video_url === r.video_url)
          addPendingTask(
            r.task_id,
            source?.platform || 'bilibili',
            { video_url: r.video_url, platform: source?.platform, quality: values.quality, model_name: values.model_name },
            source ? { title: source.title, cover_url: source.cover_url, duration: source.duration, platform: source.platform } : undefined,
            batch_id,
          )
          successCount++
        }
      }
      const failCount = results.length - successCount
      if (failCount > 0) {
        toast.error(`${successCount} 个任务已提交，${failCount} 个失败`)
      } else {
        toast.success(`已提交 ${successCount} 个批量生成任务`)
      }
      setBatchPreview([])
      onSubmitSuccess?.()
    } catch (e) {
      console.error('批量提交失败：', e)
      toast.error('批量提交失败，请稍后重试')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const onSubmit = async (values: NoteFormValues) => {
    if (batchMode) {
      await handleBatchSubmit(values)
      return
    }
    const isRegenerate = mode === 'regenerate' && !!currentTaskId
    const payload = {
      ...values,
      provider_id: modelList.find(m => m.model_name === values.model_name)!.provider_id,
      task_id: isRegenerate ? currentTaskId : '',
      collection_id: values.collection_id ? Number(values.collection_id) : undefined,
    }
    if (isRegenerate) {
      retryTask(currentTaskId, payload)
      onSubmitSuccess?.()
      return
    }
    try {
      const data = await generateNote(payload)
      const meta = videoInfo && !isLocal
        ? {
            title: videoInfo.title,
            cover_url: videoInfo.cover_url,
            duration: videoInfo.duration,
            platform: videoInfo.platform,
            video_id: videoInfo.video_id,
          }
        : undefined
      addPendingTask(data.task_id, values.platform, payload, meta)
      onSubmitSuccess?.()
    } catch (e: any) {
      if (e?.data?.reason === 'transcriber_model_not_ready') {
        const downloading = e?.data?.downloading
        toast.error(
          downloading
            ? '转写模型正在下载中，请稍候再提交'
            : '转写模型尚未下载，请先去「音频转写配置」页下载',
        )
        if (!downloading) navigate('/settings/transcriber')
        return
      }
      // 平台禁用错误
      const msg = e?.data?.msg || e?.message
      if (msg && (msg.includes('已暂停服务') || msg.includes('已禁用'))) {
        toast.error(msg)
        return
      }
      console.error('提交任务失败：', e)
    }
  }

  const onInvalid = (errors: FieldErrors<NoteFormValues>) => {
    const firstMsg = Object.values(errors).find(e => e?.message)?.message
    if (firstMsg) toast.error(String(firstMsg))
  }

  /* ---------- Render ---------- */
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* 可滚动内容区 */}
        <div ref={scrollAreaRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">

          {/* ── Video source tabs ── */}
          <div>
            <div className="mb-3 flex border-b border-neutral-200">
              <button
                type="button"
                onClick={() => {
                  setBatchMode(false)
                  form.setValue('_batch_mode', false)
                  form.setValue('platform', 'bilibili')
                }}
                className={cn(
                  'px-4 pb-2 text-sm font-medium transition-colors',
                  !isLocal && !batchMode
                    ? 'border-b-2 border-primary text-primary -mb-px'
                    : 'text-neutral-500 hover:text-neutral-700',
                )}
              >
                在线链接
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatchMode(false)
                  form.setValue('_batch_mode', false)
                  form.setValue('platform', 'local')
                }}
                className={cn(
                  'px-4 pb-2 text-sm font-medium transition-colors',
                  isLocal && !batchMode
                    ? 'border-b-2 border-primary text-primary -mb-px'
                    : 'text-neutral-500 hover:text-neutral-700',
                )}
              >
                本地文件
              </button>
              {mode === 'create' && (
                <button
                  type="button"
                  onClick={() => {
                    setBatchMode(true)
                    form.setValue('_batch_mode', true)
                  }}
                  className={cn(
                    'px-4 pb-2 text-sm font-medium transition-colors',
                    batchMode
                      ? 'border-b-2 border-primary text-primary -mb-px'
                      : 'text-neutral-500 hover:text-neutral-700',
                  )}
                >
                  批量模式
                </button>
              )}
            </div>

            {batchMode ? (
              /* Batch: channel/collection URL + manual multi-URL textarea + preview list */
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    UP主/频道/合集链接（仅支持 B站、YouTube 自动解析）
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="粘贴 UP主空间 / 合集 / 收藏夹 / YouTube 频道链接…"
                      value={channelUrl}
                      onChange={e => setChannelUrl(e.target.value)}
                      className="h-9 flex-1 shadow-none"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={batchResolving || !channelUrl.trim()}
                      onClick={handleResolveChannel}
                    >
                      {batchResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : '解析'}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">
                    或粘贴多个视频链接（每行一个，或使用逗号分隔）
                  </label>
                  <Textarea
                    placeholder="https://... &#10;https://..."
                    value={batchUrlsText}
                    onChange={e => setBatchUrlsText(e.target.value)}
                    className="min-h-20 shadow-none text-sm"
                  />
                  <div className="mt-1.5 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={batchResolving || !batchUrlsText.trim()}
                      onClick={handleResolveManualUrls}
                    >
                      {batchResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : '添加到预览列表'}
                    </Button>
                  </div>
                </div>

                {batchPreview.length > 0 && (
                  <div className="rounded-lg border border-neutral-200">
                    <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                      <p className="text-xs text-neutral-500">
                        预览列表（{batchPreview.filter(v => v.checked).length}/{batchPreview.length} 已选，最多 30 个）
                      </p>
                      <button
                        type="button"
                        onClick={() => setBatchPreview([])}
                        className="text-xs text-neutral-400 hover:text-red-500"
                      >
                        清空
                      </button>
                    </div>
                    <div className="max-h-64 divide-y divide-neutral-50 overflow-y-auto">
                      {batchPreview.map(v => (
                        <div key={v.video_url} className="flex items-center gap-2 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={v.checked}
                            onChange={() => toggleBatchItem(v.video_url)}
                            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-neutral-800">
                              {v.title || v.video_url}
                            </p>
                            <p className="truncate text-[11px] text-neutral-400">{v.video_url}</p>
                          </div>
                          {v.duration > 0 && (
                            <span className="shrink-0 text-[11px] text-neutral-400">
                              {formatDuration(v.duration)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeBatchItem(v.video_url)}
                            className="shrink-0 text-neutral-300 hover:text-red-500"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : isLocal ? (
              /* Local: file drop zone */
              <FormField
                control={form.control}
                name="video_url"
                render={({ field }) => (
                  <FormItem>
                    <div
                      className={cn(
                        'hover:border-primary flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-colors',
                        uploadSuccess ? 'border-emerald-400 bg-emerald-50' : 'border-neutral-200 bg-neutral-50',
                      )}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                      onDrop={e => {
                        e.preventDefault()
                        const file = e.dataTransfer.files?.[0]
                        if (file) handleFileUpload(file, field.onChange)
                      }}
                      onClick={() => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = 'video/*'
                        input.onchange = e => {
                          const file = (e.target as HTMLInputElement).files?.[0]
                          if (file) handleFileUpload(file, field.onChange)
                        }
                        input.click()
                      }}
                    >
                      {isUploading ? (
                        <><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="text-sm text-neutral-500">上传中…</p></>
                      ) : uploadSuccess ? (
                        <><Check className="h-6 w-6 text-emerald-500" /><p className="text-sm text-emerald-600">上传成功</p></>
                      ) : (
                        <><Upload className="h-6 w-6 text-neutral-400" /><p className="text-sm text-neutral-500">拖拽或点击选择视频文件</p></>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              /* Online: auto-detected platform + URL input */
              <div className="space-y-2">
                <div className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="video_url"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <div className="flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 transition-colors focus-within:border-neutral-300">
                          {videoUrl?.trim() && OnlinePlatformLogo && (
                            <span className="h-4 w-4 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                              <OnlinePlatformLogo />
                            </span>
                          )}
                          <Input
                            placeholder="粘贴视频链接…"
                            className="h-auto flex-1 border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
                            {...field}
                          />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 视频信息预览：解析中骨架 / 解析成功卡片 */}
                <VideoInfoPreview parsing={parsing} info={videoInfo} platform={platform} />

                {/* 平台禁用警告 */}
                {platformDisabled && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    <p className="text-sm text-amber-700">
                      <span className="font-medium">{platformDisabled}</span> 当前已暂停服务，请稍后再试或联系管理员
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 生成参数 section ── */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">生成参数</p>

            {/* AI 模型 */}
            <FormField
              control={form.control}
              name="model_name"
              render={({ field }) => (
                <FormItem>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">AI 模型</label>
                  {modelList.length === 0 ? (
                    <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/settings/model')}>
                      请先添加模型
                    </Button>
                  ) : (
                    <div className="relative">
                      <button
                        ref={modelTriggerRef}
                        type="button"
                        onClick={() => {
                          if (modelDropOpen) {
                            setModelDropOpen(false)
                          } else {
                            if (modelTriggerRef.current) setModelDropRect(modelTriggerRef.current.getBoundingClientRect())
                            setModelDropOpen(true)
                          }
                        }}
                        className="flex h-9 w-full items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 hover:border-neutral-300 focus:outline-none"
                      >
                        {field.value ? (
                          <>
                            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold text-white', avatarColor(field.value))}>
                              {modelInitial(field.value)}
                            </span>
                            <span className="flex-1 truncate text-left text-sm text-neutral-800">{field.value}</span>
                          </>
                        ) : (
                          <span className="text-sm text-neutral-400">请选择模型</span>
                        )}
                        <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-neutral-400 transition-transform', modelDropOpen && 'rotate-180')} />
                      </button>

                      {modelDropOpen && modelDropRect && createPortal(
                        <div
                          id="model-drop-panel"
                          data-dialog-ignore="true"
                          style={{ position: 'fixed', top: modelDropRect.bottom + 4, left: modelDropRect.left, width: modelDropRect.width, zIndex: 9999, pointerEvents: 'auto' }}
                          className="max-h-60 overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-lg"
                        >
                          {modelList.map(m => {
                            const selected = field.value === m.model_name
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => { field.onChange(m.model_name); setModelDropOpen(false) }}
                                className={cn(
                                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-50',
                                  selected && 'bg-primary/5',
                                )}
                              >
                                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white', avatarColor(m.model_name))}>
                                  {modelInitial(m.model_name)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <span className="truncate text-sm font-medium text-neutral-800">{m.model_name}</span>
                                </div>
                                {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                              </button>
                            )
                          })}
                        </div>,
                        document.body,
                      )}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 笔记风格 */}
            <FormField
              control={form.control}
              name="style"
              render={({ field }) => (
                <FormItem>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">笔记风格</label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {groupedStyles.system.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>内置风格</SelectLabel>
                          {groupedStyles.system.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {groupedStyles.mine.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>我的风格</SelectLabel>
                          {groupedStyles.mine.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {groupedStyles.isPublic.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>公开风格</SelectLabel>
                          {groupedStyles.isPublic.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.name}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* ── 视频理解 toggle (BEFORE 笔记格式) ── */}
          <FormField
            control={form.control}
            name="video_understanding"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-neutral-700">视频理解</p>
                    <p className="text-xs text-neutral-400">将视频截图发给多模态模型辅助分析</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      field.onChange(!field.value)
                    }}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
                      field.value ? 'bg-primary' : 'bg-neutral-300',
                    )}
                  >
                    <span className={cn(
                      'pointer-events-none inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow-sm transition-transform duration-200',
                      field.value ? 'translate-x-4' : 'translate-x-0.5',
                    )} />
                  </button>
                </div>

                {/* Expanded settings when enabled */}
                {field.value && (
                  <div className="mt-3 space-y-3 rounded-lg bg-neutral-50 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-600">采样间隔（秒）</label>
                        <Input
                          type="number"
                          value={videoInterval ?? 6}
                          onChange={e => form.setValue('video_interval', +e.target.value)}
                          className="h-8 shadow-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-600">拼图尺寸（列 × 行）</label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            value={gridSize?.[0] ?? 2}
                            onChange={e => form.setValue('grid_size', [+e.target.value, gridSize?.[1] ?? 2])}
                            className="h-8 min-w-0 flex-1 shadow-none text-sm"
                          />
                          <span className="shrink-0 text-xs text-neutral-400">×</span>
                          <Input
                            type="number"
                            value={gridSize?.[1] ?? 2}
                            onChange={e => form.setValue('grid_size', [gridSize?.[0] ?? 2, +e.target.value])}
                            className="h-8 min-w-0 flex-1 shadow-none text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ── 笔记格式 multi-select ── */}
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <label className="mb-1 block text-sm font-medium text-neutral-700">笔记格式</label>
                <FormatMultiSelect
                  value={field.value}
                  onChange={field.onChange}
                  screenshotDisabled={!videoUnderstandingEnabled}
                  linkDisabled={isLocal}
                  scrollAreaRef={scrollAreaRef}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ── 补充说明 ── */}
          <FormField
            control={form.control}
            name="extras"
            render={({ field }) => (
              <FormItem>
                <label className="mb-1 block text-sm font-medium text-neutral-700">补充说明</label>
                <Textarea
                  placeholder="笔记需要罗列出 xxx 关键点…"
                  className="resize-none text-sm"
                  rows={2}
                  {...field}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ── 输出与归类 section ── */}
          {mode !== 'regenerate' && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">输出与归类</p>
              <FormField
                control={form.control}
                name="collection_id"
                render={({ field }) => (
                  <FormItem>
                    <label className="mb-1 block text-sm font-medium text-neutral-700">存入合集（可选）</label>
                    <Select value={field.value || '__none__'} onValueChange={v => field.onChange(v === '__none__' ? '' : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full shadow-none">
                          <SelectValue placeholder="生成后自动归入该合集" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">不存入合集</SelectItem>
                        {collections.map(c => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

        </div>

        {/* 固定底部：成本预览 + 提交按钮 */}
        <div className="shrink-0 space-y-3 border-t border-neutral-200 px-6 py-4">
          {costPreview && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                costPreview.sufficient
                  ? 'border-teal-200 bg-teal-50/60 text-teal-700'
                  : 'border-red-200 bg-red-50/60 text-red-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />
                  <span>
                    预计消耗 <b className="font-semibold">{costPreview.required}</b> 电力
                    {costPreview.duration_sec != null && (
                      <span className="ml-1 text-neutral-500">
                        (视频 {Math.ceil(costPreview.duration_sec / 60)} 分钟)
                      </span>
                    )}
                  </span>
                </div>
                <div className="text-neutral-500">
                  当前余额 <b className={costPreview.sufficient ? 'text-teal-600' : 'text-red-500'}>{userCredits}</b>
                </div>
              </div>
              {!costPreview.sufficient && (
                <div className="mt-1.5 flex items-center justify-between">
                  <span>电力不足，无法生成笔记</span>
                  <RouterLink to="/upgrade" className="font-medium text-red-600 underline underline-offset-2">
                    去充值 →
                  </RouterLink>
                </div>
              )}
            </div>
          )}

            <Button
            type="submit"
            className="w-full"
            disabled={
              batchMode
                ? batchSubmitting || batchPreview.filter(v => v.checked).length === 0
                : generating || (costPreview !== null && !costPreview.sufficient) || !!platformDisabled
            }
          >
            {(batchMode ? batchSubmitting : generating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {batchMode
              ? batchSubmitting
                ? '正在提交…'
                : `批量生成 (${batchPreview.filter(v => v.checked).length})`
              : generating
              ? '正在生成…'
              : costPreview
              ? `消耗 ${costPreview.required} 电力生成笔记`
              : '生成笔记'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

export default NoteForm
