import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileCode, FileText, FileType, Globe, Image, Loader2 } from 'lucide-react'
import type { ShareExportFormat } from '@/services/share.ts'

const FORMATS: { format: ShareExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
  { format: 'md',   label: 'Markdown', icon: <FileCode className="h-4 w-4" />, desc: '.md 文件' },
  { format: 'pdf',  label: 'PDF',      icon: <FileText className="h-4 w-4" />, desc: '.pdf 文档' },
  { format: 'docx', label: 'Word',     icon: <FileType className="h-4 w-4" />, desc: '.docx 文件' },
  { format: 'html', label: 'HTML',     icon: <Globe className="h-4 w-4" />,    desc: '.html 网页' },
  { format: 'png',  label: '图片',     icon: <Image className="h-4 w-4" />,    desc: '.png 图片' },
]

interface ExportMenuProps {
  onSelect: (format: ShareExportFormat) => void
  loading?: boolean
  label?: string
  size?: 'sm' | 'xs'
}

export function ExportMenu({ onSelect, loading, label = '导出', size = 'sm' }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isSmall = size === 'xs'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className={`flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 ${
          isSmall ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span>{label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
          {FORMATS.map(({ format, label: fLabel, icon, desc }) => (
            <button
              key={format}
              type="button"
              onClick={() => {
                setOpen(false)
                onSelect(format)
              }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
            >
              <span className="text-neutral-500">{icon}</span>
              <span className="flex-1">
                <span className="block text-sm font-normal text-gray-800">{fLabel}</span>
                <span className="block text-xs text-neutral-400">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
