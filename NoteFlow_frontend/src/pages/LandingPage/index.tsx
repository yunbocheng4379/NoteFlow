import { useEffect } from 'react'
import LandingNav from './components/LandingNav'
import LandingHero from './components/LandingHero'
import PlatformStrip from './components/PlatformStrip'
import FeatureGrid from './components/FeatureGrid'
import GetStarted from './components/GetStarted'
import LandingCTA from './components/LandingCTA'
import LandingFooter from './components/LandingFooter'
import { useLandingPrefsStore } from '@/store/landingPrefsStore'

export default function LandingPage() {
  const theme = useLandingPrefsStore(s => s.theme)

  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    root.classList.toggle('dark', theme === 'dark')
    return () => {
      root.classList.toggle('dark', hadDark)
    }
  }, [theme])

  return (
    <div className="h-dvh overflow-y-auto bg-[#fbfaf7] dark:bg-neutral-950">
      <LandingNav />
      <LandingHero />
      <PlatformStrip />
      <div id="features">
        <FeatureGrid />
      </div>
      <div id="get-started">
        <GetStarted />
      </div>
      <LandingCTA />
      <LandingFooter />
    </div>
  )
}
