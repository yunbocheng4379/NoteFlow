import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BrandLogo from '@/components/BrandLogo'
import { GITHUB_URL } from '../constants'

export default function LandingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-100 bg-[#fbfaf7]/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <BrandLogo className="h-6 w-auto" />
          <span className="text-base font-semibold tracking-tight text-neutral-900">
            NoteFlow
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-neutral-600 md:flex">
          <a href="#features" className="transition-colors hover:text-neutral-900">
            功能
          </a>
          <a href="#get-started" className="transition-colors hover:text-neutral-900">
            开始使用
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-neutral-900"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
        </nav>

        <Button
          asChild
          size="sm"
          className="rounded-full bg-neutral-900 px-5 text-white hover:bg-neutral-800"
        >
          <Link to="/login">立即使用</Link>
        </Button>
      </div>
    </header>
  )
}
