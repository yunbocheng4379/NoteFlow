import LandingNav from './components/LandingNav'
import LandingHero from './components/LandingHero'
import PlatformStrip from './components/PlatformStrip'
import FeatureGrid from './components/FeatureGrid'
import GetStarted from './components/GetStarted'
import LandingCTA from './components/LandingCTA'
import LandingFooter from './components/LandingFooter'

export default function LandingPage() {
  return (
    <div className="h-dvh overflow-y-auto bg-[#fbfaf7]">
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
