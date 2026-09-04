type SiteFilingInfoProps = {
  dark?: boolean
}

const FILING_LINKS = [
  'ICP主体备案号：京ICP备2025109593号',
  '网站备案号：京ICP备2025109593号-2',
]

export default function SiteFilingInfo({ dark = false }: SiteFilingInfoProps) {
  const mutedTextClass = dark ? 'text-[rgba(255,255,255,0.28)]' : 'text-neutral-400'
  const linkClass = dark
    ? 'text-[rgba(255,255,255,0.34)] hover:text-[rgba(255,255,255,0.7)]'
    : 'text-neutral-400 hover:text-neutral-700'

  return (
    <>
      <p className={`text-xs ${mutedTextClass}`}>© {new Date().getFullYear()} NoteFlow. 保留所有权利。</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
        {FILING_LINKS.map((label) => (
          <a
            key={label}
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className={`transition-colors ${linkClass}`}
          >
            {label}
          </a>
        ))}
      </div>
    </>
  )
}
