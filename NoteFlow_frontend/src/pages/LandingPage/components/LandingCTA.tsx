import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { LANDING_COPY } from '../copy'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

export default function LandingCTA() {
  const lang = useLandingPrefsStore(s => s.lang)
  const t = LANDING_COPY[lang].cta

  return (
    <section className="bg-white py-24 dark:bg-neutral-950">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl dark:text-neutral-50">
          {t.heading}
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
          {t.sub}
        </p>
        <div className="mt-8">
          <Button
            asChild
            size="lg"
            className="rounded-full bg-neutral-900 px-8 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            <Link to="/login">{t.button}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
