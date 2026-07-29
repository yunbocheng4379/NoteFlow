import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import { getAdjacentArticles, GUIDE_ARTICLES } from '../constants'

export default function GuideLayout({
  slug,
  children,
}: {
  slug: string
  children: React.ReactNode
}) {
  const { prev, next } = getAdjacentArticles(slug)
  const current = GUIDE_ARTICLES.find(a => a.slug === slug)

  return (
    <div className="h-dvh overflow-y-auto bg-[#fbfaf7]">
      <header className="sticky top-0 z-20 border-b border-neutral-100 bg-[#fbfaf7]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link
            to="/guide"
            className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <ChevronLeft className="h-4 w-4" />
            使用指南
          </Link>
          <Link to="/welcome" className="flex items-center gap-2">
            <BrandLogo className="h-6 w-auto" />
            <span className="text-base font-semibold tracking-tight text-neutral-900">
              NoteFlow
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        {current && (
          <div className="mb-10">
            <span className="font-serif text-sm text-primary italic">{current.roman}</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
              {current.title}
            </h1>
            <p className="mt-2 text-sm text-neutral-400">{current.subtitle}</p>
          </div>
        )}

        <article className="space-y-10">{children}</article>

        <nav className="mt-16 flex items-center justify-between border-t border-neutral-200 pt-8">
          {prev ? (
            <Link
              to={`/guide/${prev.slug}`}
              className="group flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-900"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              <span>
                <span className="block text-xs text-neutral-400">上一篇</span>
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to={`/guide/${next.slug}`}
              className="group flex items-center gap-2 text-right text-sm text-neutral-500 transition-colors hover:text-neutral-900"
            >
              <span>
                <span className="block text-xs text-neutral-400">下一篇</span>
                {next.title}
              </span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </div>
  )
}
