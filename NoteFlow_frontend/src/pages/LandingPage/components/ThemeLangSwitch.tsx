import { Moon, Sun, Globe } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

export default function ThemeLangSwitch() {
  const theme = useLandingPrefsStore(s => s.theme)
  const lang = useLandingPrefsStore(s => s.lang)
  const setTheme = useLandingPrefsStore(s => s.setTheme)
  const setLang = useLandingPrefsStore(s => s.setLang)

  return (
    <div className="flex items-center gap-1 text-sm">
      <Select value={theme} onValueChange={v => setTheme(v as 'dark' | 'light')}>
        <SelectTrigger
          size="sm"
          className="h-8 gap-1.5 border-none bg-transparent px-2 text-neutral-500 shadow-none hover:bg-neutral-900/5 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          {theme === 'dark' ? (
            <Moon className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <Sun className="h-4 w-4" strokeWidth={1.5} />
          )}
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="dark">深色</SelectItem>
          <SelectItem value="light">浅色</SelectItem>
        </SelectContent>
      </Select>

      <span className="h-4 w-px bg-neutral-300 dark:bg-neutral-700" />

      <Select value={lang} onValueChange={v => setLang(v as 'zh' | 'en')}>
        <SelectTrigger
          size="sm"
          className="h-8 gap-1.5 border-none bg-transparent px-2 text-neutral-500 shadow-none hover:bg-neutral-900/5 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          <Globe className="h-4 w-4" strokeWidth={1.5} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="zh">简体中文</SelectItem>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
