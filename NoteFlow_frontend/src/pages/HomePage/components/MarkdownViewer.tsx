import { useState, useEffect, useRef, useMemo, useCallback, memo, FC } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button.tsx'
import { Copy, Download, ArrowRight, Play, ExternalLink } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Error from '@/components/Lottie/error.tsx'
import Spinner from '@/components/Spinner.tsx'
import StepBar from '@/pages/HomePage/components/StepBar.tsx'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark as codeStyle } from 'react-syntax-highlighter/dist/esm/styles/prism'
import Zoom from 'react-medium-image-zoom'
import 'react-medium-image-zoom/dist/styles.css'
import gfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeSlug from 'rehype-slug'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown-light.css'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import { useTaskStore } from '@/store/taskStore'
import { useNoteStyleStore } from '@/store/noteStyleStore'
import { MarkdownHeader } from '@/pages/HomePage/components/MarkdownHeader.tsx'
import TranscriptViewer from '@/pages/HomePage/components/transcriptViewer.tsx'
import MarkmapEditor from '@/pages/HomePage/components/MarkmapComponent.tsx'
import ChatPanel from '@/pages/HomePage/components/ChatPanel.tsx'
import VideoBanner from '@/pages/HomePage/components/VideoBanner.tsx'
import EmptyState from '@/pages/HomePage/components/EmptyState.tsx'
import EmbeddedVideoPlayer, {
  isEmbeddable,
  type SeekSignal,
} from '@/pages/HomePage/components/EmbeddedVideoPlayer.tsx'
import { exportNote, type ExportFormat } from '@/services/export'
import { updateNoteContent } from '@/services/note'

/**
 * 清理紧跟在 markdown 链接 `](url)` 后面的孤立 `*` / `**`。
 *
 * 后端历史版本只吞掉 `*Content-[mm:ss]*` 标记的前一个 `*`，导致链接末尾留下
 * 一个孤立的 `*`，被前端 markdown 渲染器当成斜体/粗体起始符，在标题行末尾
 * 渲染为黑色字符/方块（即用户反馈的"黑色符号"）。
 *
 * 只删除「紧跟 `](...)` 之后、且后接空白/换行/标点/字符串结尾」的连续 `*`，
 * 不影响正文里紧跟其他字符（如加粗 **重要**）的 markdown 强调标记。
 */
function stripTrailingAsterisksAfterLinks(markdown: string): string {
  if (!markdown) return markdown
  const SAFE_AFTER = new Set([
    ' ', '\t', '\n', '\r',
    '，', '。', '、', '；',
    ',', '.', ';', ':', '!', '?',
    '）', ')', '！', '？', '：',
  ])
  return markdown.replace(
    /(\]\([^)]*\))([*]+)([^\n]?)/g,
    (match, linkPart, _asterisks, after) => {
      if (!after || SAFE_AFTER.has(after)) {
        return linkPart + after
      }
      return match
    },
  )
}

interface VersionNote {
  ver_id: string
  content: string
  style: string
  model_name: string
  created_at?: string
}

interface MarkdownViewerProps {
  status: 'idle' | 'loading' | 'success' | 'failed' | 'initializing'
  currentTaskId: string | null
  onNewNote?: (prefill?: { video_url?: string; platform?: string }) => void
  onRegenerate?: () => void
}

const steps = [
  { label: '解析链接', key: 'PARSING' },
  { label: '下载音频', key: 'DOWNLOADING' },
  { label: '转写文字', key: 'TRANSCRIBING' },
  { label: '总结内容', key: 'SUMMARIZING' },
  { label: '保存完成', key: 'SUCCESS' },
]

/** 各阶段的引导文案，让等待更有“呼吸感” */
const STAGE_COPY: Record<string, { title: string; hint: string }> = {
  PENDING: { title: '正在排队，马上开始', hint: '任务已提交，正在准备资源…' },
  PARSING: { title: '正在解析视频链接', hint: '读取视频基本信息，请稍候…' },
  DOWNLOADING: { title: '正在下载音频', hint: '从源站拉取音频流，速度取决于视频长度' },
  TRANSCRIBING: { title: '正在转写文字', hint: '把语音逐句转成文字，越长的视频耗时越久' },
  SUMMARIZING: { title: 'AI 正在总结内容', hint: '模型正在理解并提炼要点，请稍候…' },
  FORMATTING: { title: '正在排版整理', hint: '梳理结构、生成标题与要点…' },
  SAVING: { title: '正在保存笔记', hint: '收尾中，即将完成' },
  SUCCESS: { title: '生成完成', hint: '笔记已就绪，正在呈现…' },
}

/**
 * 进度条「脚本化」节奏：进度不被后端瞬时状态牵着跳，而是按固定节奏走完。
 * 前 3 个节点（解析/下载/转写）用随机时长自动推进，营造真实感；
 * 走到 HOLD_STEP「总结内容」停下，等待后端真正完成；
 * 后端返回 SUCCESS 后跳到 FINAL_STEP「保存完成」收尾，再展示正文。
 *
 * 这样前端无需高频盯着后端中间状态，轮询只为等待最终结果，显著降低后端压力。
 */
const STEP_RANGES: Array<[number, number]> = [
  [4000, 6000], // 解析链接 4~6s
  [2500, 3500], // 下载音频 2.5~3.5s
  [1500, 2500], // 转写文字 1.5~2.5s
]
const HOLD_STEP = 3 // 总结内容：卡在此处等待后端
const FINAL_STEP = 4 // 保存完成
const randMs = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))

const remarkPlugins = [gfm, remarkMath]
const rehypePlugins = [rehypeKatex, rehypeSlug]

/**
 * 构建 ReactMarkdown components 对象，baseURL 用于修正图片路径。
 * 使用函数 + useMemo 避免每次渲染都创建新的函数实例。
 */
function createMarkdownComponents(
  baseURL: string,
  onSeek: (seconds: number) => void,
  embeddable: boolean
) {
  return {
    h1: ({ children, ...props }: any) => (
      <h1
        className="text-gray-900 my-6 scroll-m-20 text-3xl font-extrabold tracking-tight lg:text-4xl"
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }: any) => (
      <h2
        className="text-gray-900 mt-10 mb-4 scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0"
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: any) => (
      <h3
        className="text-gray-900 mt-8 mb-4 scroll-m-20 text-xl font-semibold tracking-tight"
        {...props}
      >
        {children}
      </h3>
    ),
    h4: ({ children, ...props }: any) => (
      <h4
        className="text-gray-900 mt-6 mb-2 scroll-m-20 text-lg font-semibold tracking-tight"
        {...props}
      >
        {children}
      </h4>
    ),
    p: ({ children, ...props }: any) => (
      <p className="leading-7 [&:not(:first-child)]:mt-6" {...props}>
        {children}
      </p>
    ),
    a: ({ href, children, ...props }: any) => {
      const isOriginLink =
        typeof children[0] === 'string' &&
        (children[0] as string).startsWith('原片 @')

      if (isOriginLink) {
        const timeMatch = (children[0] as string).match(/原片 @ (\d{1,2}):(\d{2})/)
        const timeText = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : '原片'

        // 可嵌入平台（B站/YouTube）：点击在页面内播放器定位播放
        if (embeddable && timeMatch) {
          const seconds = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10)
          return (
            <span className="origin-link my-2 inline-flex">
              <button
                type="button"
                onClick={() => onSeek(seconds)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-100"
              >
                <Play className="h-3.5 w-3.5" />
                <span>原片（{timeText}）</span>
              </button>
            </span>
          )
        }

        // 不可嵌入平台（抖音/本地等）：保持新标签页打开外部视频
        return (
          <span className="origin-link my-2 inline-flex">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-100"
              {...props}
            >
              <Play className="h-3.5 w-3.5" />
              <span>原片（{timeText}）</span>
            </a>
          </span>
        )
      }

      // 处理笔记内部锚点链接（如目录跳转）
      if (href?.startsWith('#')) {
        const handleAnchorClick = (e: React.MouseEvent) => {
          e.preventDefault()
          const id = decodeURIComponent(href.slice(1))
          // 跳转范围限定在正文容器内，避免匹配到目录自身或页面其它标题
          const scope =
            (e.currentTarget as HTMLElement).closest('.markdown-body') || document

          // 1. 优先精确匹配 id
          let target =
            (scope.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null) ||
            document.getElementById(id)

          // 2. 精确失败时按 heading 文本模糊匹配
          // 后端目录锚点（去标点/空格）与 rehype-slug 生成的 heading id
          // （用 - 连接、保留部分字符）并不完全一致，需归一化后比对。
          if (!target) {
            // 仅保留字母/数字/各类文字（含中日韩），剔除标点、空格与符号
            const normalize = (s: string) =>
              s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
            const search = normalize(id)
            if (search) {
              const headings = scope.querySelectorAll('h1, h2, h3, h4, h5, h6')
              for (const h of headings) {
                const text = normalize(h.textContent || '')
                if (!text) continue
                if (text.includes(search) || search.includes(text)) {
                  target = h as HTMLElement
                  break
                }
              }
            }
          }

          if (!target) {
            toast.error('未找到对应章节')
            return
          }

          // 笔记正文渲染在 Radix ScrollArea 的 Viewport 内（其子层为 display:table），
          // 原生 scrollIntoView 在这种结构下常常不生效。这里显式找到可滚动的
          // Viewport 容器，用真实渲染位置（getBoundingClientRect）计算偏移后滚动，
          // 不受 display:table 包裹层影响。
          const viewport = target.closest(
            '[data-slot="scroll-area-viewport"]'
          ) as HTMLElement | null

          if (viewport) {
            const top =
              target.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top +
              viewport.scrollTop
            viewport.scrollTo({ top: Math.max(top - 12, 0), behavior: 'smooth' })
          } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }

        return (
          <a
            href={href}
            onClick={handleAnchorClick}
            className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 font-medium underline underline-offset-4"
            {...props}
          >
            {children}
          </a>
        )
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5 font-medium underline underline-offset-4"
          {...props}
        >
          {children}
          {href?.startsWith('http') && (
            <ExternalLink className="ml-0.5 inline-block h-3 w-3" />
          )}
        </a>
      )
    },
    img: ({ node, ...props }: any) => {
      let src = props.src
      if (src.startsWith('/')) {
        src = baseURL + src
      }
      props.src = src

      return (
        <div className="my-8 flex justify-center">
          <Zoom>
            <img
              {...props}
              className="max-w-full cursor-zoom-in rounded-lg object-cover shadow-md transition-all hover:shadow-lg"
              style={{ maxHeight: '500px' }}
            />
          </Zoom>
        </div>
      )
    },
    strong: ({ children, ...props }: any) => (
      <strong className="text-gray-900 font-bold" {...props}>
        {children}
      </strong>
    ),
    li: ({ children, ordered, ...props }: any) => {
      const rawText = String(children)
      const isFakeHeading = /^(\*\*.+\*\*)$/.test(rawText.trim())

      if (isFakeHeading) {
        return (
          <div className="text-gray-900 my-4 text-lg font-bold">{children}</div>
        )
      }

      return (
        <li className="my-1" {...props}>
          {children}
        </li>
      )
    },
    ul: ({ children, ordered, ...props }: any) => (
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ordered, ...props }: any) => (
      <ol className="my-6 ml-6 list-decimal [&>li]:mt-2" {...props}>
        {children}
      </ol>
    ),
    blockquote: ({ children, ...props }: any) => (
      <blockquote
        className="border-primary/20 text-muted-foreground mt-6 border-l-4 pl-4 italic"
        {...props}
      >
        {children}
      </blockquote>
    ),
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const codeContent = String(children).replace(/\n$/, '')

      if (!inline && match) {
        return (
          <div className="group bg-muted relative my-6 overflow-hidden rounded-lg border shadow-sm">
            <div className="bg-muted text-muted-foreground flex items-center justify-between px-4 py-1.5 text-sm font-medium">
              <div>{match[1].toUpperCase()}</div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(codeContent)
                  toast.success('代码已复制')
                }}
                className="bg-background/80 hover:bg-background flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                复制
              </button>
            </div>
            <SyntaxHighlighter
              style={codeStyle}
              language={match[1]}
              PreTag="div"
              className="!bg-muted !m-0 !p-0"
              customStyle={{
                margin: 0,
                padding: '1rem',
                background: 'transparent',
                fontSize: '0.9rem',
              }}
              {...props}
            >
              {codeContent}
            </SyntaxHighlighter>
          </div>
        )
      }

      return (
        <code
          className="bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm"
          {...props}
        >
          {children}
        </code>
      )
    },
    table: ({ children, ...props }: any) => (
      <div className="my-6 w-full overflow-y-auto">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: any) => (
      <th
        className="border-muted-foreground/20 border px-4 py-2 text-left font-medium [&[align=center]]:text-center [&[align=right]]:text-right"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }: any) => (
      <td
        className="border-muted-foreground/20 border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
        {...props}
      >
        {children}
      </td>
    ),
    hr: ({ ...props }: any) => (
      <hr className="border-muted-foreground/20 my-8" {...props} />
    ),
  }
}

const MarkdownViewer: FC<MarkdownViewerProps> = ({ status, currentTaskId, onNewNote, onRegenerate }) => {
  const [copied, setCopied] = useState(false)
  const [currentVerId, setCurrentVerId] = useState<string>('')
  const [selectedContent, setSelectedContent] = useState<string>('')
  const [modelName, setModelName] = useState<string>('')
  const [style, setStyle] = useState<string>('')
  const [createTime, setCreateTime] = useState<string>('')
  // 确保baseURL没有尾部斜杠
  const baseURL = (String(import.meta.env.VITE_API_BASE_URL || '').replace('/api','') || '').replace(/\/$/, '')
  const getCurrentTask = useTaskStore.getState().getCurrentTask
  const currentTask = useTaskStore(state => state.getCurrentTask())
  const taskStatus = currentTask?.status || 'PENDING'
  const retryTask = useTaskStore.getState().retryTask
  const isMultiVersion = Array.isArray(currentTask?.markdown)
  const { loadStyles, styles: noteStyles } = useNoteStyleStore()
  useEffect(() => {
    loadStyles()
  }, [])
  const noteStyleOptions = useMemo(
    () => noteStyles.map((s) => ({ value: s.value, label: s.name })),
    [noteStyles]
  )
  const [showTranscribe, setShowTranscribe] = useState(false)
  const [showChat, setShowChat] = useState<false | 'half' | 'full'>(false)
  const [viewMode, setViewMode] = useState<'map' | 'preview'>('preview')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const overwriteVersionContent = useTaskStore.getState().overwriteVersionContent
  const svgRef = useRef<SVGSVGElement>(null)

  /* ---------- 原片内嵌播放器 ---------- */
  const [playerSeek, setPlayerSeek] = useState<SeekSignal | null>(null)
  const embeddable = isEmbeddable(currentTask?.audioMeta)
  const handleSeek = useCallback((seconds: number) => {
    setPlayerSeek(prev => ({ seconds, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])
  // 切换任务时收起播放器
  useEffect(() => {
    setPlayerSeek(null)
  }, [currentTask?.id])

  /* ---------- 脚本化进度时间线 ---------- */
  // 进度条按固定节奏走完，不被后端瞬时状态牵着跳；总结阶段等后端真正完成再收尾。
  const isLoading = status === 'loading'
  const backendSuccess = currentTask?.status === 'SUCCESS'
  const [vStep, setVStep] = useState(0)
  const [timelineFinished, setTimelineFinished] = useState(false)
  const animTaskRef = useRef<string | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const releasingRef = useRef(false)
  // 记录上一次的 isLoading，用于识别「重新进入生成中」的上升沿
  const prevLoadingRef = useRef(false)

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  // 进入「生成中」时，为该任务一次性排好前三段的定时器链（解析→下载→转写→停在总结）。
  // 用 ref + 定时器链，避免轮询重渲染反复清除导致进度卡死。
  // 重启条件：从非 loading 进入 loading（重新生成会复用同一 task id，靠上升沿识别），
  // 或在 loading 中切换到了另一个任务。
  useEffect(() => {
    const wasLoading = prevLoadingRef.current
    prevLoadingRef.current = isLoading
    if (!isLoading) return

    const startedLoading = !wasLoading
    const switchedTask = animTaskRef.current !== currentTask?.id
    if (!startedLoading && !switchedTask) return

    animTaskRef.current = currentTask?.id ?? null
    clearTimers()
    releasingRef.current = false
    setVStep(0)
    setTimelineFinished(false)

    let acc = 0
    for (let i = 0; i < HOLD_STEP; i++) {
      acc += randMs(...STEP_RANGES[i])
      const next = i + 1
      timersRef.current.push(setTimeout(() => setVStep(next), acc))
    }
  }, [isLoading, currentTask?.id])

  // 卸载时清理定时器
  useEffect(() => () => clearTimers(), [])

  // 总结内容阶段：等后端完成 → 跳到「保存完成」→ 丝滑停留后放行正文。
  // 整条收尾链只触发一次（releasingRef），且不随 vStep 变化被清除，避免提前中断。
  useEffect(() => {
    if (animTaskRef.current !== currentTask?.id || timelineFinished) return
    if (vStep !== HOLD_STEP || !backendSuccess || releasingRef.current) return
    releasingRef.current = true
    timersRef.current.push(
      setTimeout(() => setVStep(FINAL_STEP), 500),
      setTimeout(() => setTimelineFinished(true), 1500),
    )
  }, [vStep, backendSuccess, timelineFinished, currentTask?.id])

  // 是否处于「播放进度条」状态：正在为当前任务播放且尚未结束
  const showTimeline =
    (status === 'loading' || status === 'success') &&
    animTaskRef.current === currentTask?.id &&
    !timelineFinished


  // 缓存 ReactMarkdown components，仅在 baseURL / 跳转回调 / 可嵌入状态变化时重建
  const markdownComponents = useMemo(
    () => createMarkdownComponents(baseURL, handleSeek, embeddable),
    [baseURL, handleSeek, embeddable]
  )

  // 当 currentTaskId 变化时（特别是删除任务后），强制清空状态
  useEffect(() => {
    if (!currentTaskId) {
      // 当前任务ID为空时，清空所有内容状态
      setCurrentVerId('')
      setModelName('')
      setStyle('')
      setCreateTime('')
      setSelectedContent('')
      setPlayerSeek(null) // 同时关闭视频播放器
    }
    // 切换任务时退出编辑态，避免草稿内容串到另一篇笔记
    setIsEditing(false)
    setDraftContent('')
  }, [currentTaskId])

  // 多版本内容处理
  useEffect(() => {
    if (!currentTask) {
      // 当没有当前任务时，清空所有内容状态
      setCurrentVerId('')
      setModelName('')
      setStyle('')
      setCreateTime('')
      setSelectedContent('')
      return
    }

    if (!isMultiVersion) {
      setCurrentVerId('') // 清空旧版本 ID
      setModelName(currentTask.formData.model_name)
      setStyle(currentTask.formData.style)
      setCreateTime(currentTask.createdAt)
      setSelectedContent(currentTask?.markdown)
    } else {
      const latestVersion = [...currentTask.markdown].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]

      if (latestVersion) {
        setCurrentVerId(latestVersion.ver_id)
      }
    }
  }, [currentTask?.id, taskStatus, currentTask?.markdown])
  useEffect(() => {
    // 切换版本时退出编辑态，避免草稿内容串到另一个版本
    setIsEditing(false)
    setDraftContent('')

    if (!currentTask || !isMultiVersion) {
      // 如果没有任务或不是多版本，确保清空状态
      if (!currentTask) {
        setModelName('')
        setStyle('')
        setCreateTime('')
        setSelectedContent('')
      }
      return
    }

    const currentVer = currentTask.markdown.find(v => v.ver_id === currentVerId)
    if (currentVer) {
      setModelName(currentVer.model_name)
      setStyle(currentVer.style)
      setCreateTime(currentVer.created_at || '')
      setSelectedContent(currentVer.content)
    } else {
      // 如果找不到指定版本，清空状态
      setModelName('')
      setStyle('')
      setCreateTime('')
      setSelectedContent('')
    }
  }, [currentVerId, currentTask?.id, currentTask?.markdown])
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selectedContent)
      setCopied(true)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      toast.error('复制失败')
    }
  }
  const handleStartEdit = () => {
    setDraftContent(selectedContent)
    setIsEditing(true)
  }
  const handleCancelEdit = () => {
    setIsEditing(false)
    setDraftContent('')
  }
  const handleSaveEdit = async () => {
    if (!currentTask) return
    setIsSaving(true)
    try {
      await updateNoteContent(currentTask.id, draftContent)
      overwriteVersionContent(currentTask.id, isMultiVersion ? currentVerId : null, draftContent)
      setSelectedContent(draftContent)
      setIsEditing(false)
      setDraftContent('')
      toast.success('已保存')
    } catch (e) {
      console.error('保存笔记编辑失败：', e)
      toast.error('保存失败，请稍后重试')
    } finally {
      setIsSaving(false)
    }
  }
  const alertButton = {
    id: 'alert',
    title: '测试警告',
    content: '⚠️',
    onClick: () => alert('你点击了自定义按钮！'),
  }
  const exportButton = {
    id: 'export',
    title: '导出思维导图',
    content: '⤓',
    onClick: () => {
      const svgEl = svgRef.current
      if (!svgEl) return
      // 同上面的序列化逻辑
      const serializer = new XMLSerializer()
      const source = serializer.serializeToString(svgEl)
      const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>', source], {
        type: 'image/svg+xml;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mindmap.svg'
      a.click()
      URL.revokeObjectURL(url)
    },
  }
  const handleDownload = async (format: ExportFormat = 'md') => {
    const task = getCurrentTask()
    const title = task?.audioMeta?.title || 'note'

    if (format === 'md') {
      // Markdown 直接本地生成，无需后端
      const blob = new Blob([selectedContent], { type: 'text/markdown;charset=utf-8' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${title}.md`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }

    const toastId = toast.loading(`正在导出 ${format.toUpperCase()}…`)
    try {
      await exportNote({ content: selectedContent, format, title })
      toast.success('导出成功', { id: toastId })
    } catch (e: any) {
      const msg = e?.response?.data instanceof Blob
        ? await e.response.data.text().then((t: string) => { try { return JSON.parse(t)?.detail } catch { return null } })
        : null
      toast.error(msg || '导出失败，请稍后重试', { id: toastId })
    }
  }

  if (status === 'initializing') {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  if (showTimeline) {
    const hasMeta = !!(currentTask?.audioMeta?.title || currentTask?.audioMeta?.cover_url)
    const stepKey = steps[Math.min(vStep, FINAL_STEP)].key
    const copy = STAGE_COPY[stepKey] || STAGE_COPY.PENDING
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-6 px-6 text-neutral-500">
        {/* 下载阶段拿到封面/标题后即时展示，正文继续生成 */}
        {hasMeta && (
          <div className="w-full max-w-xl">
            <VideoBanner
              audioMeta={currentTask!.audioMeta}
              videoUrl={currentTask!.formData?.video_url}
            />
          </div>
        )}

        <StepBar key={currentTask?.id} steps={steps} currentStep={stepKey} />

        {/* 动态文案 */}
        <div className="animate-in fade-in mt-1 text-center duration-500" key={stepKey}>
          <div className="flex items-center justify-center gap-2">
            {vStep < FINAL_STEP && <Spinner className="h-5 w-5" />}
            <p className="text-base font-semibold text-neutral-700">{copy.title}</p>
          </div>
          <p className="mt-2 text-xs text-neutral-400">{copy.hint}</p>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  if (status === 'success' && !selectedContent) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center space-y-3 text-neutral-500">
        <Spinner className="h-7 w-7" />
        <p className="text-sm">加载笔记内容中…</p>
      </div>
    )
  }

  if (status === 'idle') {
    return (
      <EmptyState
        onMoreSettings={prefill => onNewNote?.(prefill)}
      />
    )
  }

  if (status === 'failed' && !isMultiVersion) {
    const reason = currentTask?.errorMessage?.trim() || '请检查后台或稍后再试'
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 space-y-3 px-4">
        <Error />
        <div className="max-w-xl text-center">
          <p className="text-lg font-bold text-red-500">笔记生成失败</p>
          <p className="mt-2 mb-2 text-xs leading-relaxed text-red-400">{reason}</p>

          <Button onClick={() => retryTask(currentTask.id)} size="lg">
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MarkdownHeader
        currentTask={currentTask}
        isMultiVersion={isMultiVersion}
        currentVerId={currentVerId}
        setCurrentVerId={setCurrentVerId}
        modelName={modelName}
        style={style}
        noteStyles={noteStyleOptions}
        onCopy={handleCopy}
        onDownload={handleDownload}
        createAt={createTime}
        showTranscribe={showTranscribe}
        setShowTranscribe={setShowTranscribe}
        showChat={showChat}
        setShowChat={setShowChat}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onRegenerate={onRegenerate}
        isEditing={isEditing}
        isSaving={isSaving}
        onStartEdit={handleStartEdit}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
      />

      {viewMode === 'map' ? (
        <div className="flex w-full flex-1 overflow-hidden bg-white">
          <div className={'w-full'}>
            <MarkmapEditor
              value={selectedContent}
              onChange={() => {}}
              height="100%" // 根据需求可以设定百分比或固定高度
              title={currentTask?.audioMeta?.title || '思维导图'}
            />
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-hidden bg-white py-2"
          style={{
            display: 'grid',
            gridTemplateColumns:
              showChat === 'full'
                ? '1fr'
                : showTranscribe || showChat === 'half'
                  ? '1fr 1fr'
                  : '1fr',
            gap: '8px',
          }}
        >
          {isEditing ? (
            <div className="h-full w-full overflow-hidden px-2">
              <textarea
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                disabled={isSaving}
                className="h-full w-full resize-none rounded-md border border-neutral-200 p-3 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
                spellCheck={false}
                autoFocus
              />
            </div>
          ) : selectedContent && selectedContent !== 'loading' && selectedContent !== 'empty' ? (
            <>
              {showChat === 'full' && currentTask ? (
                <div className="h-full w-full overflow-hidden">
                  <ChatPanel taskId={currentTask.id} mode="full" onModeChange={setShowChat} />
                </div>
              ) : (
              <>
              <div className="flex h-full flex-col overflow-hidden">
                {playerSeek && embeddable && (
                  <div className="px-2 pt-1">
                    <EmbeddedVideoPlayer
                      audioMeta={currentTask?.audioMeta}
                      seek={playerSeek}
                      onClose={() => setPlayerSeek(null)}
                    />
                  </div>
                )}
                <ScrollArea className="h-full w-full flex-1">
                  <div className="px-2">
                    <VideoBanner
                      audioMeta={currentTask?.audioMeta}
                      videoUrl={currentTask?.formData?.video_url}
                    />
                  </div>
                  <div className={'markdown-body w-full px-2'}>
                    <ReactMarkdown
                      remarkPlugins={remarkPlugins}
                      rehypePlugins={rehypePlugins}
                      components={markdownComponents}
                    >
                      {stripTrailingAsterisksAfterLinks(
                        selectedContent.replace(/^>\s*来源链接：[^\n]*\n*/m, '')
                      )}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              </div>
              {showTranscribe && (
                <div className="overflow-hidden">
                  <TranscriptViewer onSeek={handleSeek} />
                </div>
              )}
              {showChat === 'half' && currentTask && (
                <div className="overflow-hidden">
                  <ChatPanel taskId={currentTask.id} mode="half" onModeChange={setShowChat} />
                </div>
              )}
              </>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="w-[300px] flex-col justify-items-center">
                <div className="bg-primary-light mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <ArrowRight className="text-primary h-8 w-8" />
                </div>
                <p className="mb-2 text-neutral-600">输入视频链接并点击"生成笔记"按钮</p>
                <p className="text-xs text-neutral-500">支持哔哩哔哩、YouTube等视频网站</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MarkdownViewer
