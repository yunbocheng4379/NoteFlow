import { motion, useReducedMotion } from 'motion/react'
import {
  Captions,
  Palette,
  ListVideo,
  MessageSquareText,
  FolderOpen,
  Puzzle,
} from 'lucide-react'
import { LANDING_COPY } from '../copy'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI']
const ICONS = [Captions, Palette, ListVideo, MessageSquareText, FolderOpen, Puzzle]

export default function FeatureGrid() {
  const reduce = useReducedMotion()
  const lang = useLandingPrefsStore(s => s.lang)
  const t = LANDING_COPY[lang].featureGrid

  return (
    <section className="bg-white py-24 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl dark:text-neutral-50">
            {t.headingPrefix}
            <span className="text-primary">{t.headingHighlight}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            {t.sub}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-neutral-800 dark:bg-neutral-800">
          {t.features.map((f, i) => {
            const Icon = ICONS[i]
            return (
              <motion.div
                key={f.title}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: (i % 3) * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-3 bg-white p-7 dark:bg-neutral-950"
              >
                <span className="font-serif text-sm text-primary italic">{ROMANS[i]}</span>
                <Icon className="h-5 w-5 text-neutral-400" strokeWidth={1.5} />
                <div>
                  <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
                    {f.title}
                  </h3>
                  <p className="text-xs text-neutral-400">{f.subtitle}</p>
                </div>
                <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
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
