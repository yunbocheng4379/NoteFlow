export default function GuideShot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-[0_20px_50px_-28px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 bg-neutral-50 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-neutral-300" />
        <span className="h-3 w-3 rounded-full bg-neutral-300" />
        <span className="h-3 w-3 rounded-full bg-neutral-300" />
      </div>
      <img src={src} alt={alt} className="w-full" loading="lazy" />
    </div>
  )
}
