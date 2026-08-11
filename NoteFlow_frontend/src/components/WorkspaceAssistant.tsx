import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import xiaoliu from '@/assets/assistant/xiaoliu.png'
import AssistantPanel from '@/components/AssistantPanel'

export default function WorkspaceAssistant() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <div className="fixed right-5 bottom-5 z-50 flex flex-col items-end gap-3 max-sm:right-3 max-sm:bottom-3">
      {open && <AssistantPanel onClose={() => setOpen(false)} />}
      {!open && (
        <button
          type="button"
          aria-label="打开小流 AI 客服"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="group relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-[#e6f7f5] shadow-[0_10px_28px_rgba(22,122,110,0.24)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ff9b8a]/45 max-sm:h-14 max-sm:w-14"
        >
          <span className="absolute inset-0 rounded-full bg-[#e6f7f5] opacity-70 assistant-launcher-pulse" />
          <img src={xiaoliu} alt="小流" className="relative h-[120%] w-[120%] object-contain object-top" />
          <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#ff9b8a] text-white shadow-sm transition-transform group-hover:rotate-12">
            <MessageCircle className="h-3.5 w-3.5 fill-current" />
          </span>
        </button>
      )}
    </div>
  )
}
