import { FC, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Search } from 'lucide-react'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import {
  searchVideos,
  VideoSearchItem,
  VideoSearchResponse,
} from '@/services/videoSearch.ts'
import ResultCard from './ResultCard'

/**
 * ExplorePanel
 * ---
 * 视频搜索面板：输入关键词后 300ms 防抖自动触发聚合搜索（B站 + YouTube），
 * 展示骨架/结果/空态/初始态；当仅一个平台失败时给出提示 toast。
 *
 * 网络层要点：
 * - 使用 `AbortController` 在关键词变化或组件卸载时取消旧请求。
 * - axios 遇到 abort 会抛 `CanceledError`；`utils/request.ts` 的拦截器可能把它
 *   转成 `{ code: -1 }`，因此这里同时用 `axios.isCancel` 和错误名/字段兜底判断，
 *   把「取消」和「真实失败」区分开，避免误报 toast 或误清空结果。
 */
interface ExplorePanelProps {
  onQuickGenerate: (prefill: { video_url: string; platform: string }) => void
  onMoreSettings: (prefill: { video_url: string; platform: string }) => void
}

const platformDisplay: Record<string, string> = {
  bilibili: 'B站',
  youtube: 'YouTube',
}

const DEBOUNCE_MS = 300
const MAX_KEYWORD_LEN = 50

const exploreTips = [
  {
    title: '跨平台搜索',
    desc: '同时搜索 B站与 YouTube，少来回切平台。',
    icon: '/home_icon/comparison.png',
  },
  {
    title: '先找素材',
    desc: '先用关键词定位合适视频，再决定是否生成笔记。',
    icon: '/home_icon/video.png',
  },
  {
    title: '一键生成笔记',
    desc: '点选搜索结果后，直接进入 AI 笔记生成流程。',
    icon: '/home_icon/notes.png',
  },
]

// 判定一个错误对象是否来自 AbortController.abort()（含拦截器改写后的形态）
const isAbortError = (e: unknown): boolean => {
  if (axios.isCancel(e)) return true
  const err = e as { name?: string; code?: string } | null
  return (
    err?.name === 'CanceledError' ||
    err?.name === 'AbortError' ||
    err?.code === 'ERR_CANCELED'
  )
}

const ExplorePanel: FC<ExplorePanelProps> = ({
  onQuickGenerate,
  onMoreSettings,
}) => {
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<VideoSearchItem[]>([])
  // 标记当前展示的数据对应的关键词（仅在成功后写入），用于空态文案与「是否搜过」判定
  const [searchedKeyword, setSearchedKeyword] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 300ms 防抖：关键词变化 → 计时 → 触发搜索；组件卸载/新输入时清理计时器 + 取消旧请求。
  useEffect(() => {
    const kw = keyword.trim()
    // 清空输入：立即取消旧请求并清空结果，不发起新请求
    if (!kw) {
      abortRef.current?.abort()
      setLoading(false)
      setItems([])
      setSearchedKeyword(null)
      return
    }
    if (kw.length > MAX_KEYWORD_LEN) return

    const timer = window.setTimeout(() => {
      // 取消上一次请求（如果还没完成）
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)

      searchVideos(kw, ctrl.signal)
        .then((resp: VideoSearchResponse) => {
          if (ctrl.signal.aborted) return
          setItems(resp.items || [])
          setSearchedKeyword(kw)
          // 部分平台失败：给一个提示，但仍展示可用结果
          const failed = Object.entries(resp.platform_status || {})
            .filter(([, s]) => s === 'failed')
            .map(([p]) => platformDisplay[p] || p)
          const totalPlatforms = Object.keys(resp.platform_status || {}).length
          if (failed.length > 0 && failed.length < totalPlatforms) {
            toast.error(`${failed.join('、')} 搜索暂不可用，已显示其他结果`)
          } else if (failed.length > 0 && failed.length === totalPlatforms) {
            toast.error('搜索服务暂不可用，请稍后再试')
          }
        })
        .catch(e => {
          // Abort 静默忽略；真实失败清空结果（拦截器已弹过 toast，若被 suppress 也无需重复）
          if (isAbortError(e)) return
          setItems([])
          setSearchedKeyword(kw)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [keyword])

  const handleClear = () => {
    abortRef.current?.abort()
    setKeyword('')
    setItems([])
    setSearchedKeyword(null)
    setLoading(false)
  }

  const trimmed = keyword.trim()
  const showInitial = !trimmed && !loading
  const showEmpty =
    !loading && searchedKeyword !== null && items.length === 0 && trimmed.length > 0

  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* Search box */}
      <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-lg shadow-[#167a6e]/10">
        <div className="relative flex flex-1 items-center gap-2 overflow-hidden px-3 before:absolute before:inset-y-0 before:left-0 before:w-1/4 before:-skew-x-[20deg] before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent before:content-[''] before:pointer-events-none before:animate-[sweep_1.5s_linear_infinite]">
          <Search className="h-4 w-4 shrink-0 text-neutral-400" />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜索视频主题，例如 AI 入门、效率工具、课程笔记"
            className="h-10 flex-1 border-none bg-transparent shadow-none focus-visible:ring-0"
            maxLength={MAX_KEYWORD_LEN}
            aria-label="视频搜索关键词"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleClear}
          disabled={!keyword && items.length === 0}
        >
          清除
        </Button>
      </div>

      {/* Results area */}
      <div className="mt-5">
        {loading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white"
              >
                <div className="aspect-[16/9] w-full animate-pulse bg-neutral-100" />
                <div className="space-y-2 px-2.5 py-2">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-neutral-100" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        )}

        {showEmpty && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-neutral-500">
            <p>未找到与「{searchedKeyword}」相关的视频，请换个关键词试试</p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <p className="mb-3 text-sm text-neutral-500">
              找到 {items.length} 个与「{searchedKeyword ?? trimmed}」相关的视频
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {items.map(item => (
                <ResultCard
                  key={`${item.platform}:${item.video_url}`}
                  item={item}
                  onSelect={i =>
                    onQuickGenerate({ video_url: i.video_url, platform: i.platform })
                  }
                  onMoreSettings={i =>
                    onMoreSettings({ video_url: i.video_url, platform: i.platform })
                  }
                />
              ))}
            </div>
          </>
        )}

        {showInitial && items.length === 0 && (
          <div className="mx-auto flex max-w-4xl flex-col items-center justify-center px-4 pt-9 text-center">
            <div className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1 text-xs font-medium text-emerald-700">
              探索模式
            </div>
            <h3 className="mt-4 text-lg font-semibold text-neutral-800">先找到视频，再生成笔记</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
              输入主题或关键词，同时搜索 B站与 YouTube，选中合适的视频后可直接生成
              AI 笔记。
            </p>
            <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
              {exploreTips.map(({ title, desc, icon }) => (
                <div
                  key={title}
                  className="group flex gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm shadow-neutral-200/50 transition-all hover:-translate-y-0.5 hover:border-[#167a6e]/30 hover:shadow-md hover:shadow-[#167a6e]/10"
                >
                  <img src={icon} alt={title} className="h-14 w-14 shrink-0 object-contain" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-800">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ExplorePanel
