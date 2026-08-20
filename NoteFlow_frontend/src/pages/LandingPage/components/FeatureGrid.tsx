import { motion, useReducedMotion } from 'motion/react'
import {
  Captions,
  Palette,
  ListVideo,
  MessageSquareText,
  FolderOpen,
  Puzzle,
} from 'lucide-react'

const FEATURES = [
  {
    roman: 'I',
    icon: Captions,
    title: '多平台解析',
    subtitle: '一条链接即可开始',
    desc: '支持哔哩哔哩、YouTube、抖音、快手等常用视频平台。',
  },
  {
    roman: 'II',
    icon: Palette,
    title: 'AI 笔记生成',
    subtitle: '结构清晰，重点突出',
    desc: '将视频内容整理为结构化 Markdown 笔记，方便复习与沉淀。',
  },
  {
    roman: 'III',
    icon: ListVideo,
    title: '批量处理',
    subtitle: '频道内容一次整理',
    desc: '支持连续提交多个视频任务，统一查看处理进度和生成结果。',
  },
  {
    roman: 'IV',
    icon: MessageSquareText,
    title: '智能问答',
    subtitle: '围绕笔记继续追问',
    desc: '基于已生成的笔记和内容进行上下文问答，快速定位关键信息。',
  },
  {
    roman: 'V',
    icon: FolderOpen,
    title: '知识整理',
    subtitle: '内容集中管理',
    desc: '将笔记归档到知识库和合集，建立适合自己的内容工作流。',
  },
  {
    roman: 'VI',
    icon: Puzzle,
    title: '多端使用',
    subtitle: '网页、桌面与插件',
    desc: '支持网页端、桌面端和浏览器扩展，按使用场景灵活选择。',
  },
] as const

export default function FeatureGrid() {
  const reduce = useReducedMotion()
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
            六项能力，<span className="text-primary">一套工作流</span>。
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-500">
            从单条视频到整个频道，从生成笔记到追问细节，NoteFlow 陪你走完整个流程。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            return (
              <motion.div
                key={f.roman}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: (i % 3) * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-3 bg-white p-7"
              >
                <span className="font-serif text-sm text-primary italic">{f.roman}</span>
                <f.icon className="h-5 w-5 text-neutral-400" strokeWidth={1.5} />
                <div>
                  <h3 className="text-base font-semibold text-neutral-900">
                    {f.title}
                  </h3>
                  <p className="text-xs text-neutral-400">{f.subtitle}</p>
                </div>
                <p className="text-sm leading-relaxed text-neutral-500">
                  {f.desc}
                </p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
