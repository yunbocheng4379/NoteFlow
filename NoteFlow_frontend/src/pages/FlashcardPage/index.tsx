import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { getFlashcardSet, exportFlashcardsCsv, type FlashcardSetDetail } from '@/services/flashcard'

const FlashcardPage = () => {
  const { setId } = useParams<{ setId: string }>()
  const navigate = useNavigate()

  const [set, setSet] = useState<FlashcardSetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!setId) return
    setLoading(true)
    getFlashcardSet(Number(setId))
      .then(setSet)
      .catch(() => navigate(-1))
      .finally(() => setLoading(false))
  }, [setId, navigate])

  const total = set?.cards.length ?? 0

  const goTo = useCallback((next: number) => {
    if (total === 0) return
    setIndex(((next % total) + total) % total)
    setShowAnswer(false)
  }, [total])

  const restart = useCallback(() => {
    setIndex(0)
    setShowAnswer(false)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (total === 0) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        restart()
        return
      }
      switch (e.key) {
        case 'ArrowRight':
        case 'l':
          goTo(index + 1)
          break
        case 'ArrowLeft':
        case 'h':
          goTo(index - 1)
          break
        case ' ':
        case 'Enter':
          e.preventDefault()
          setShowAnswer((v) => !v)
          break
        case 'Escape':
          setShowAnswer(false)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, total, goTo, restart])

  const handleExport = async () => {
    if (!set) return
    setExporting(true)
    try {
      await exportFlashcardsCsv(set.id, set.title || `flashcards_${set.id}`)
    } catch {
      toast.error('导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#f5f5f5]">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (!set || total === 0) return null

  const card = set.cards[index]

  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-[#f5f5f5] px-6 py-8">
      <div className="mb-6 flex w-full max-w-2xl items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <h1 className="truncate text-sm font-medium text-neutral-600">{set.title || '闪记卡'}</h1>
        <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          导出 CSV
        </Button>
      </div>

      {/* 进度条 */}
      <div className="mb-6 w-full max-w-2xl">
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>第 {index + 1} / {total} 张</span>
          <span>{Math.round(((index + 1) / total) * 100)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* 卡片 */}
      <div
        onClick={() => setShowAnswer((v) => !v)}
        className="flex min-h-[280px] w-full max-w-2xl cursor-pointer flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm transition-shadow hover:shadow-md"
      >
        <span className="mb-4 text-xs font-medium uppercase tracking-wider text-neutral-400">
          {showAnswer ? '答案' : '问题'}
        </span>
        <p className="text-lg font-medium leading-relaxed text-neutral-900">
          {showAnswer ? card.answer : card.question}
        </p>
        <p className="mt-6 text-xs text-neutral-400">
          {showAnswer ? '点击卡片 / Esc 隐藏答案' : '点击卡片 / 空格 / 回车 查看答案'}
        </p>
      </div>

      {/* 操作区 */}
      <div className="mt-6 flex w-full max-w-2xl items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => goTo(index - 1)}>
          <ChevronLeft className="h-4 w-4" />
          上一张
        </Button>
        <Button variant="outline" size="sm" onClick={restart}>
          <RotateCcw className="h-3.5 w-3.5" />
          重新开始
        </Button>
        <Button variant="outline" size="sm" onClick={() => goTo(index + 1)}>
          下一张
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">
        快捷键：← / → 或 H / L 切换卡片 · 空格 / 回车 显示答案 · Esc 隐藏答案 · Ctrl+R 重新开始
      </p>
    </div>
  )
}

export default FlashcardPage
