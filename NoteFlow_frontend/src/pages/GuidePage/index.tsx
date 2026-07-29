import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import { GUIDE_ARTICLES } from './constants'

export default function GuidePage() {
  const reduce = useReducedMotion()

  return (
    <div className="h-dvh overflow-y-auto bg-[#fbfaf7]">
      <header className="sticky top-0 z-20 border-b border-neutral-100 bg-[#fbfaf7]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link
            to="/welcome"
            className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ChevronLeft className="h-4 w-4" />
            返回首页
          </Link>
          <Link to="/welcome" className="flex items-center gap-2">
            <BrandLogo className="h-6 w-auto" />
            <span className="text-base font-semibold tracking-tight text-neutral-900">
              NoteFlow
            </span>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-14 text-center"
        >
          <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 md:text-5xl">
            使用<span className="text-primary">指南</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-neutral-500">
            从粘贴第一条链接到管理整个笔记库，四篇图文教程带你摸清 NoteFlow 的每一步。
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2">
          {GUIDE_ARTICLES.map((a, i) => (
            <motion.div
              key={a.slug}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: (i % 2) * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white"
            >
              <Link
                to={`/guide/${a.slug}`}
                className="group flex h-full flex-col gap-4 p-8 transition-colors hover:bg-neutral-50/60"
              >
                <div className="flex items-center justify-between">
                  <span className="font-serif text-sm text-primary italic">{a.roman}</span>
                  <a.icon className="h-5 w-5 text-neutral-400" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900">{a.title}</h2>
                  <p className="text-xs text-neutral-400">{a.subtitle}</p>
                </div>
                <p className="flex-1 text-sm leading-relaxed text-neutral-500">{a.summary}</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  阅读全文
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  )
}
