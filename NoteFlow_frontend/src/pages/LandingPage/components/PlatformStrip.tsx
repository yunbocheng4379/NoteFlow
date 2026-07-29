import {
  BiliBiliLogo,
  YoutubeLogo,
  DouyinLogo,
  KuaishouLogo,
  LocalLogo,
} from '@/components/Icons/platform'
import { LANDING_COPY } from '../copy'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

export default function PlatformStrip() {
  const lang = useLandingPrefsStore(s => s.lang)
  const p = LANDING_COPY[lang].platforms

  const PLATFORMS = [
    { name: p.biliBili, Logo: BiliBiliLogo },
    { name: p.youtube, Logo: YoutubeLogo },
    { name: p.douyin, Logo: DouyinLogo },
    { name: p.kuaishou, Logo: KuaishouLogo },
    { name: p.local, Logo: LocalLogo },
  ]

  return (
    <section className="border-t border-neutral-100 bg-[#fbfaf7] py-10 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6">
        {PLATFORMS.map(({ name, Logo }) => (
          <div key={name} className="flex items-center gap-2 opacity-70 grayscale-[15%] dark:opacity-80">
            <div className="h-5 w-5 shrink-0 [&_svg]:h-5 [&_svg]:w-5">
              <Logo />
            </div>
            <span className="text-sm text-neutral-500 dark:text-neutral-400">{name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
