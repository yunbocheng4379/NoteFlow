import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ArrowRight } from 'lucide-react'
import { GITHUB_URL } from '../constants'
import { LANDING_COPY } from '../copy'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

const ROMANS = ['I', 'II', 'III', 'IV']
const CODE_BY_INDEX: Record<number, string | null> = {
  0: null,
  1: 'docker compose up -d --build',
  2: null,
  3: null,
}
const LINK_BY_INDEX: Record<number, { href: string; internal: boolean } | null> = {
  0: { href: '/login', internal: true },
  1: null,
  2: { href: GITHUB_URL, internal: false },
  3: { href: GITHUB_URL, internal: false },
}

export default function GetStarted() {
  const [active, setActive] = useState(0)
  const lang = useLandingPrefsStore(s => s.lang)
  const t = LANDING_COPY[lang].getStarted
  const current = t.options[active]
  const code = CODE_BY_INDEX[active]
  const link = LINK_BY_INDEX[active]

  return (
    <section className="bg-[#fbfaf7] py-24 dark:bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl dark:text-neutral-50">
            {t.headingPrefix}
            <span className="text-primary">{t.headingHighlight}</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            {t.sub}
          </p>
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_48px_-28px_rgba(0,0,0,0.14)] md:grid-cols-[220px_1fr] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-[0_16px_48px_-28px_rgba(0,0,0,0.5)]">
          <div className="flex flex-row overflow-x-auto border-b border-neutral-100 md:flex-col md:overflow-visible md:border-b-0 md:border-r dark:border-neutral-800">
            {t.options.map((opt, i) => (
              <button
                key={opt.title}
                onClick={() => setActive(i)}
                className={`flex min-w-[160px] flex-1 items-center gap-3 px-5 py-4 text-left transition-colors md:min-w-0 ${
                  active === i
                    ? 'bg-neutral-50 md:border-l-2 md:border-l-neutral-900 dark:bg-neutral-800/60 dark:md:border-l-neutral-100'
                    : 'hover:bg-neutral-50/60 dark:hover:bg-neutral-800/40'
                }`}
              >
                <span className="font-serif text-sm text-primary italic">{ROMANS[i]}</span>
                <span>
                  <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {opt.title}
                  </span>
                  <span className="block text-xs text-neutral-400">{opt.subtitle}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-5 p-8">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{current.body}</p>

            {code && (
              <pre className="overflow-x-auto rounded-xl bg-neutral-900 p-5 text-sm text-neutral-100 dark:bg-neutral-800">
                <code>{code}</code>
              </pre>
            )}

            {link && current.linkLabel && (
              <div>
                {link.internal ? (
                  <Link
                    to={link.href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {current.linkLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {current.linkLabel}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
