import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, ChevronDown, ChevronUp, Loader2, Send, Sparkles, X } from 'lucide-react'
import xiaoliu from '@/assets/assistant/xiaoliu.png'
import { askAssistantStream } from '@/services/assistant'
import { useAssistantStore } from '@/store/assistantStore'

const QUICK_QUESTIONS = [
  'NoteFlow 是做什么的？',
  '怎么把视频变成笔记？',
  '知识库问答怎么用？',
  '为什么生成失败？',
]

function SourceList({
  sources,
}: {
  sources: { title: string; section_title?: string; text: string }[]
}) {
  const [expanded, setExpanded] = useState(false)
  if (!sources.length) return null

  return (
    <div className="mt-2 border-t border-[#e8efec] pt-2">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="flex items-center gap-1 text-[11px] font-medium text-[#167a6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9b8a]/70"
      >
        <BookOpen className="h-3 w-3" />
        参考产品文档 ({sources.length})
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {sources.map((source, index) => (
            <div key={`${source.title}-${source.section_title}-${index}`} className="rounded-lg bg-white/70 px-2 py-1.5 text-[11px] text-[#56716b]">
              <div className="font-medium text-[#34534d]">
                {source.title}
                {source.section_title ? ` · ${source.section_title}` : ''}
              </div>
              <div className="mt-0.5 line-clamp-2 leading-4">{source.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-markdown text-[13px] leading-5 text-[#243447]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

export default function AssistantPanel({ onClose }: { onClose: () => void }) {
  const messages = useAssistantStore(state => state.messages)
  const addMessage = useAssistantStore(state => state.addMessage)
  const appendToLastMessage = useAssistantStore(state => state.appendToLastMessage)
  const setLastMessageSources = useAssistantStore(state => state.setLastMessageSources)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, loading])

  useEffect(() => () => abortRef.current?.abort(), [])

  const handleSend = async (value = input) => {
    const question = value.trim()
    if (!question || loading) return

    const history = messages.map(({ role, content }) => ({ role, content }))
    addMessage({ role: 'user', content: question })
    addMessage({ role: 'assistant', content: '' })
    setInput('')
    setError(null)
    setLoading(true)

    const controller = new AbortController()
    let reportedError: string | null = null
    abortRef.current = controller
    try {
      await askAssistantStream(
        { question, history },
        {
          signal: controller.signal,
          onSources: sources => setLastMessageSources(sources),
          onDelta: text => appendToLastMessage(text),
          onDone: () => setLoading(false),
          onError: message => {
            reportedError = message
            appendToLastMessage(message)
            setError(message)
            setLoading(false)
          },
        },
      )
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        const message = reportedError ?? 'AI 客服暂时无法回答，请稍后重试。'
        if (!reportedError) appendToLastMessage(message)
        setError(message)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <section
      aria-label="小流 AI 客服"
      role="dialog"
      aria-modal="false"
      className="flex h-[min(520px,calc(100vh-32px))] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-[#d9ebe6] bg-[#fff9f5] shadow-[0_20px_60px_rgba(36,52,71,0.22)]"
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[#e8efec] bg-white/85 px-4 py-3 backdrop-blur-sm">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#e6f7f5]">
          <img src={xiaoliu} alt="小流" className="h-16 w-12 object-contain object-top" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#243447]">小流 · NoteFlow 向导</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#6e8d86]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#64c9a9]" />
            在线，专门解答产品问题
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭小流 AI 客服"
          className="rounded-full p-1.5 text-[#78938d] transition-colors hover:bg-[#e6f7f5] hover:text-[#167a6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9b8a]/70"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center text-center">
            <div className="relative mb-2 h-28 w-28">
              <div className="absolute inset-2 rounded-full bg-[#e6f7f5]" />
              <img src={xiaoliu} alt="小流角色" className="relative h-full w-full object-contain object-top" />
              <Sparkles className="absolute right-0 top-3 h-4 w-4 text-[#ff9b8a]" />
            </div>
            <p className="max-w-[280px] text-sm font-medium leading-5 text-[#243447]">
              嗨，我是小流。把视频变成清晰笔记、在笔记里继续追问，就是 NoteFlow 最擅长的事。
            </p>
            <p className="mt-1 text-xs text-[#78938d]">你想先了解哪一步？</p>
            <div className="mt-4 grid w-full gap-2">
              {QUICK_QUESTIONS.map(question => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void handleSend(question)}
                  disabled={loading}
                  className="rounded-xl border border-[#d9ebe6] bg-white px-3 py-2 text-left text-xs text-[#34534d] transition-colors hover:border-[#8bcabb] hover:bg-[#e6f7f5] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9b8a]/70"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[86%] rounded-2xl rounded-br-md bg-[#167a6e] px-3 py-2 text-[13px] leading-5 text-white'
                      : 'max-w-[92%] rounded-2xl rounded-bl-md border border-[#e5efeb] bg-white px-3 py-2.5'
                  }
                >
                  {message.role === 'assistant' && !message.content && loading ? (
                    <div className="flex items-center gap-1.5 text-xs text-[#78938d]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#167a6e]" />
                      正在整理产品资料…
                    </div>
                  ) : message.role === 'assistant' ? (
                    <>
                      <AssistantMarkdown content={message.content || '当前产品资料不足，我不想猜测。'} />
                      {message.sources && <SourceList sources={message.sources} />}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{message.content}</span>
                  )}
                </div>
              </div>
            ))}
            {error && <div className="text-center text-[11px] text-[#c66b5d]">可以直接重新发送问题试试。</div>}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[#e8efec] bg-white/75 p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-[#d9ebe6] bg-white px-3 py-2 transition-colors focus-within:border-[#8bcabb] focus-within:ring-2 focus-within:ring-[#e6f7f5]">
          <textarea
            aria-label="输入你想了解的问题"
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={1}
            placeholder="输入你想了解的问题…"
            className="max-h-20 min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13px] leading-5 text-[#243447] outline-none placeholder:text-[#9ab1ab] disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={loading || !input.trim()}
            aria-label="发送问题"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#167a6e] text-white transition-colors hover:bg-[#0f6b60] disabled:cursor-not-allowed disabled:bg-[#b4d8ce] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9b8a]/70"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="mt-1.5 text-center text-[10px] text-[#9ab1ab]">Enter 发送 · Shift + Enter 换行</div>
      </div>
    </section>
  )
}
