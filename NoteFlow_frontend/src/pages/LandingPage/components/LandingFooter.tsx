import { Link } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import { GITHUB_URL } from '../constants'
import { LANDING_COPY } from '../copy'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

export default function LandingFooter() {
  const lang = useLandingPrefsStore(s => s.lang)
  const t = LANDING_COPY[lang].footer

  const COLUMNS = [
    {
      title: t.columns.product.title,
      links: [
        { label: t.columns.product.login, href: '/login', internal: true },
        { label: t.columns.product.tryOnline, href: '/login', internal: true },
      ],
    },
    {
      title: t.columns.resources.title,
      links: [
        { label: t.columns.resources.guide, href: '/guide', internal: true },
        { label: t.columns.resources.faq, href: '/login', internal: true },
      ],
    },
    {
      title: t.columns.contact.title,
      links: [
        { label: t.columns.contact.devHome, href: GITHUB_URL, internal: false },
        { label: t.columns.contact.feedback, href: GITHUB_URL, internal: false },
      ],
    },
  ]

  return (
    <footer className="border-t border-neutral-100 bg-[#fbfaf7] py-16 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex items-start gap-2 sm:col-span-1">
            <BrandLogo className="h-6 w-auto shrink-0" />
            <span className="text-base font-semibold text-neutral-800 dark:text-neutral-100">
              NoteFlow
            </span>
          </div>

          {COLUMNS.map(col => (
            <div key={col.title}>
              <h4 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                {col.title}
              </h4>
              <ul className="mt-3 space-y-2.5">
                {col.links.map(l =>
                  l.internal ? (
                    <li key={l.label}>
                      <Link
                        to={l.href}
                        className="text-sm text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
                      >
                        {l.label}
                      </a>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-neutral-200 pt-8 text-center dark:border-neutral-800">
          <p className="text-lg text-neutral-700 dark:text-neutral-300">
            {t.tagline.prefix}
            <span className="text-primary">{t.tagline.highlight}</span>
            {t.tagline.suffix}
          </p>
          <p className="mt-6 text-xs text-neutral-400 dark:text-neutral-500">
            {t.copyright(new Date().getFullYear())}
          </p>
        </div>
      </div>
    </footer>
  )
}
