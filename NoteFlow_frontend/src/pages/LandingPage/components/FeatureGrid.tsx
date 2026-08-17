import { motion, useReducedMotion } from 'motion/react'
import {
  Captions,
  Palette,
  ListVideo,
  MessageSquareText,
  FolderOpen,
  Puzzle,
} from 'lucide-react'

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI']
const ICONS = [Captions, Palette, ListVideo, MessageSquareText, FolderOpen, Puzzle]

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
                <span className="font-serif text-sm text-primary italic">{ROMANS[i]}</span>
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
