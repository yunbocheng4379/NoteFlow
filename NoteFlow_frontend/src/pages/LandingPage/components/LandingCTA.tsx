import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function LandingCTA() {
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 md:text-4xl">
          省下重看视频的时间。
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm text-neutral-500">
          把第一条视频链接粘进去，剩下的交给 NoteFlow。
        </p>
        <div className="mt-8">
          <Button
            asChild
            size="lg"
            className="rounded-full bg-neutral-900 px-8 text-white hover:bg-neutral-800"
          >
            <Link to="/login">立即使用</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
