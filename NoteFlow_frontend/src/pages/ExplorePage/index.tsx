import { FC, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Compass } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import ExplorePanel from '@/pages/HomePage/components/ExplorePanel'
import { useTaskStore } from '@/store/taskStore'
import { useModelStore } from '@/store/modelStore'
import { generateNote } from '@/services/note.ts'
import { trackFeatureResult, trackFeatureSubmit } from '@/services/analytics'

/**
 * ExplorePage
 * ---
 * 独立的一级路由 `/explore`,收纳 ExplorePanel。用户在工作台内已经打开了某篇
 * 笔记时（HomePage 会被 MarkdownViewer 占据），依然可以从侧边栏进入这里继续
 * 搜索新视频。
 *
 * 与首页空态里那份 ExplorePanel 的关键区别：
 * - 点卡片 = 后台提交生成任务后自动跳回 `/`,让用户马上看到进度/结果；
 * - "更多设置" 目前也走同一条快速生成路径（预填 NoteForm 弹窗需要 HomePage
 *   的本地状态,跨页面弹窗成本较高,先与快速生成保持一致；未来若真有需求再
 *   考虑把 NoteForm 抽到全局)。
 */
const ExplorePage: FC = () => {
  const navigate = useNavigate()
  const addPendingTask = useTaskStore(s => s.addPendingTask)
  const { modelList, loadEnabledModels } = useModelStore()

  useEffect(() => {
    if (modelList.length === 0) loadEnabledModels()
  }, [])

  const submitAndGoHome = async (prefill: { video_url: string; platform: string }) => {
    const url = prefill.video_url.trim()
    if (!url) {
      toast.error('请选择一个视频')
      return
    }
    try {
      trackFeatureSubmit('explore_search', { platform: prefill.platform })
      new URL(url)
    } catch {
      toast.error('视频链接格式不正确')
      return
    }
    if (modelList.length === 0) {
      toast.error('请先配置 AI 模型')
      navigate('/settings/model')
      return
    }

    const model = modelList[0]
    const payload = {
      video_url: url,
      platform: prefill.platform,
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
    try {
      const data: any = await generateNote(payload as any)
      // 探索页没有 URL 输入框，也没有 info 预解析，pending 卡片会退化为纯 URL
      // 展示；任务开始跑之后 loadHistory 会补回封面/标题。
      addPendingTask(data.task_id, prefill.platform, payload, undefined)
      trackFeatureResult('explore_search', true, { platform: prefill.platform })
      navigate('/')
    } catch (e: any) {
      trackFeatureResult('explore_search', false, { platform: prefill.platform })
      if (e?.data?.reason === 'transcriber_model_not_ready') {
        toast.error('请先配置转写模型')
        navigate('/settings/transcriber')
      } else {
        toast.error('提交失败，请稍后重试')
      }
    }
  }

  return (
    <ScrollArea className="h-full w-full bg-gradient-to-b from-[#e6f7f5]/40 via-white to-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-16 pt-20">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-1.5 text-sm text-amber-800 shadow-sm">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow">
            <Compass className="h-3 w-3" />
          </span>
          <span className="font-medium">热爱奔赴未知，探索即是天性</span>
        </div>

        <h1 className="mb-3 text-center text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
          搜索视频主题，发现可生成的 AI 笔记
        </h1>
        <p className="mb-8 max-w-xl text-center text-sm text-neutral-500">
          输入关键词同时查找多平台视频，先筛选合适素材，再一键沉淀为结构化笔记。
        </p>

        <ExplorePanel
          onQuickGenerate={submitAndGoHome}
          onMoreSettings={submitAndGoHome}
        />
      </div>
    </ScrollArea>
  )
}

export default ExplorePage
