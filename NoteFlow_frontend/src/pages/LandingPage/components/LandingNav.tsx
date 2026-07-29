import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BrandLogo from '@/components/BrandLogo'
import { GITHUB_URL } from '../constants'
import { LANDING_COPY } from '../copy'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'
import ThemeLangSwitch from './ThemeLangSwitch'

export default function LandingNav() {
  const lang = useLandingPrefsStore(s => s.lang)
  const t = LANDING_COPY[lang]

  return (
    <header className="sticky top-0 z-20 border-b border-neutral-100 bg-[#fbfaf7]/90 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/90">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <BrandLogo className="h-6 w-auto" />
          <span className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            NoteFlow
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-neutral-600 md:flex dark:text-neutral-400">
          <a
            href="#features"
            className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {t.nav.features}
          </a>
          <a
            href="#get-started"
            className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {t.nav.getStarted}
          </a>
          <Link
            to="/guide"
            className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {t.nav.guide}
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <Github className="h-4 w-4" />
            {t.nav.github}
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <ThemeLangSwitch />
          <Button
            asChild
            size="sm"
            className="rounded-full bg-neutral-900 px-5 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <Link to="/login">{t.nav.cta}</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
