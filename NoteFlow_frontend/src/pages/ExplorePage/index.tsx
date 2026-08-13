import { FC, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Compass } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import ExplorePanel from '@/pages/HomePage/components/ExplorePanel'
import { useTaskStore } from '@/store/taskStore'
import { useModelStore } from '@/store/modelStore'
import { generateNote } from '@/services/note.ts'
import { useTranslation } from '@/i18n'

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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const addPendingTask = useTaskStore(s => s.addPendingTask)
  const { modelList, loadEnabledModels } = useModelStore()

  useEffect(() => {
    if (modelList.length === 0) loadEnabledModels()
  }, [])

  const submitAndGoHome = async (prefill: { video_url: string; platform: string }) => {
    const url = prefill.video_url.trim()
    if (!url) {
      toast.error(t('home.empty.selectVideo'))
      return
    }
    try {
      new URL(url)
    } catch {
      toast.error(t('home.empty.invalidUrl'))
      return
    }
    if (modelList.length === 0) {
      toast.error(t('home.empty.modelRequired'))
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
      navigate('/')
    } catch (e: any) {
      if (e?.data?.reason === 'transcriber_model_not_ready') {
        toast.error(t('home.empty.transcriberRequired'))
        navigate('/settings/transcriber')
      } else {
        toast.error(t('home.empty.submitFailed'))
      }
    }
  }

  return (
    <ScrollArea className="h-full w-full bg-gradient-to-b from-[#e6f7f5]/40 via-white to-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-10 pb-16">
        <header className="mb-6 flex items-center gap-3">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
              {t('explore.title')}
            </h1>
            <p className="mt-0.5 text-sm text-neutral-500">{t('explore.subtitle')}</p>
          </div>
        </header>

        <ExplorePanel
          onQuickGenerate={submitAndGoHome}
          onMoreSettings={submitAndGoHome}
        />
      </div>
    </ScrollArea>
  )
}

export default ExplorePage
