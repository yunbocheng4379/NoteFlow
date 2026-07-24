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
    title: '视频转笔记',
    subtitle: 'Video to Notes',
    desc: '粘贴视频链接或上传本地文件，AI 自动转写语音并生成结构化 Markdown 笔记与思维导图。',
  },
  {
    roman: 'II',
    icon: Palette,
    title: '笔记风格',
    subtitle: 'Note Styles',
    desc: '精简、教程、学术、小红书体等多种风格任选，也可以自建专属模板反复使用。',
  },
  {
    roman: 'III',
    icon: ListVideo,
    title: '批量与频道解析',
    subtitle: 'Batch & Channels',
    desc: '粘贴一整个 UP 主空间或频道链接，自动拉取视频列表，勾选后一次性批量生成。',
  },
  {
    roman: 'IV',
    icon: MessageSquareText,
    title: 'AI 问答',
    subtitle: 'Chat with Notes',
    desc: '针对某篇笔记的原文内容直接提问，AI 结合视频信息作答，逐字流式输出。',
  },
  {
    roman: 'V',
    icon: FolderOpen,
    title: '合集与闪卡',
    subtitle: 'Collections & Flashcards',
    desc: '把笔记归类进合集、融合成一篇综合笔记，或一键生成问答闪卡巩固记忆。',
  },
  {
    roman: 'VI',
    icon: Puzzle,
    title: '浏览器插件',
    subtitle: 'Browser Extension',
    desc: '在视频网页里点一下插件图标，当前视频立刻开始生成笔记，无需跳转。',
  },
]

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
          {FEATURES.map((f, i) => (
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
                <h3 className="text-base font-semibold text-neutral-900">{f.title}</h3>
                <p className="text-xs text-neutral-400">{f.subtitle}</p>
              </div>
              <p className="text-sm leading-relaxed text-neutral-500">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
