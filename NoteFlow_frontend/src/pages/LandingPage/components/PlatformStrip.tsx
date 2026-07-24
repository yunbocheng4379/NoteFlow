import {
  BiliBiliLogo,
  YoutubeLogo,
  DouyinLogo,
  KuaishouLogo,
  LocalLogo,
} from '@/components/Icons/platform'

const PLATFORMS = [
  { name: '哔哩哔哩', Logo: BiliBiliLogo },
  { name: 'YouTube', Logo: YoutubeLogo },
  { name: '抖音', Logo: DouyinLogo },
  { name: '快手', Logo: KuaishouLogo },
  { name: '本地文件', Logo: LocalLogo },
]

export default function PlatformStrip() {
  return (
    <section className="border-t border-neutral-100 bg-[#fbfaf7] py-10">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6">
        {PLATFORMS.map(({ name, Logo }) => (
          <div key={name} className="flex items-center gap-2 opacity-70 grayscale-[15%]">
            <div className="h-5 w-5 shrink-0 [&_svg]:h-5 [&_svg]:w-5">
              <Logo />
            </div>
            <span className="text-sm text-neutral-500">{name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
