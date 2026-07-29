import { FolderOpen, Layers, PanelRight, MessageCircleQuestion } from 'lucide-react'
import GuideLayout from '../components/GuideLayout'

const SHIPPED = [
  {
    icon: FolderOpen,
    title: '笔记合集',
    desc: '把相关笔记归类进合集，支持合集融合成一篇综合笔记，也能生成分享链接和 ZIP 打包导出。',
  },
  {
    icon: Layers,
    title: '闪卡复习',
    desc: '基于笔记内容一键生成问答闪卡，巩固记忆，是最近刚上线的能力。',
  },
]

const PLANNED = [
  {
    icon: PanelRight,
    title: '插件侧边栏挂载笔记',
    desc: '浏览器插件目前只有弹窗（popup）主入口能用；侧边栏（sidepanel）挂载思维导图正在规划中，暂未接入实际交互。',
  },
  {
    icon: MessageCircleQuestion,
    title: '划词 / 页面内 RAG 问答',
    desc: '在视频页面直接划词提问、结合已生成笔记做检索增强问答，是插件下一阶段（后续版本）要打通的方向。',
  },
]

export default function RoadmapArticle() {
  return (
    <GuideLayout slug="roadmap">
      <section>
        <p className="leading-7 text-neutral-600">
          NoteFlow 从「一条链接生成一份笔记」出发，正在往「管理和复用一整个笔记库」的方向扩展。
          以下是最近已经上线、和仍在推进中的能力，供你了解产品的走向。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">最近上线</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SHIPPED.map(item => (
            <div
              key={item.title}
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.12)]"
            >
              <item.icon className="h-5 w-5 text-primary" strokeWidth={1.5} />
              <h3 className="mt-3 text-base font-semibold text-neutral-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">仍在推进中</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLANNED.map(item => (
            <div
              key={item.title}
              className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/60 p-6"
            >
              <item.icon className="h-5 w-5 text-neutral-400" strokeWidth={1.5} />
              <h3 className="mt-3 text-base font-semibold text-neutral-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500">{item.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-400">
          以上方向以浏览器插件（NoteFlow_extension）现有代码结构为依据，实际排期可能调整。
        </p>
      </section>
    </GuideLayout>
  )
}
