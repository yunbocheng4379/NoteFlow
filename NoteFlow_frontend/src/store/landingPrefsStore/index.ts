import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LandingTheme = 'dark' | 'light'
export type LandingLang = 'zh' | 'en'

interface LandingPrefsState {
  theme: LandingTheme
  lang: LandingLang
  setTheme: (theme: LandingTheme) => void
  setLang: (lang: LandingLang) => void
}

export const useLandingPrefsStore = create<LandingPrefsState>()(
  persist(
    set => ({
      theme: 'dark',
      lang: 'zh',
      setTheme: theme => set({ theme }),
      setLang: lang => set({ lang }),
    }),
    {
      name: 'landing-prefs-store',
    }
  )
)
