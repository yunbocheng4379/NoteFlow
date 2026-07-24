import { motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BrandLogo from '@/components/BrandLogo'
import workspaceShot from '@/assets/screenshots/02-workspace.png'
import { GITHUB_URL } from '../constants'

export default function LandingHero() {
  const reduce = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-[#fbfaf7] pt-20 pb-24 md:pt-24">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 flex items-center justify-center gap-2.5"
        >
          <BrandLogo className="h-8 w-auto" />
          <span className="text-2xl font-semibold tracking-tight text-neutral-900">
            NoteFlow
          </span>
        </motion.div>

        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="text-4xl leading-tight font-semibold tracking-tight text-neutral-900 md:text-6xl"
        >
          一条视频链接，
          <br />
          <span className="text-primary">变成一份笔记。</span>
        </motion.h1>

        <motion.p
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-5 max-w-lg text-base text-neutral-500"
        >
          AI 视频笔记助手，与你的观看和学习一起工作。
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Button
            asChild
            size="lg"
            className="rounded-full bg-neutral-900 px-7 text-white hover:bg-neutral-800"
          >
            <Link to="/login">立即使用</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-full border-neutral-300 bg-white px-7 text-neutral-700 hover:bg-neutral-50"
          >
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </Button>
        </motion.div>
      </div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-16 max-w-5xl px-6"
      >
        <div className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_24px_60px_-30px_rgba(0,0,0,0.18)]">
          <div className="flex items-center gap-1.5 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-neutral-300" />
            <span className="h-3 w-3 rounded-full bg-neutral-300" />
            <span className="h-3 w-3 rounded-full bg-neutral-300" />
          </div>
          <img
            src={workspaceShot}
            alt="NoteFlow 工作台界面：粘贴视频链接后生成的结构化笔记与思维导图"
            className="w-full"
            loading="eager"
          />
        </div>
      </motion.div>
    </section>
  )
}
