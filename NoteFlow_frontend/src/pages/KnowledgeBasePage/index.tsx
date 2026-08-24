import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bubble, Sender } from '@ant-design/x'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import 'github-markdown-css/github-markdown-light.css'
import { toast } from 'react-hot-toast'
import {
  BookOpen,
  ArrowRight,
  FileText,
  Pin,
  PinOff,
  Plus,
  Pencil,
  LoaderCircle,
  MailPlus,
  MailOpen,
  Trash2,
  UserRound,
  Sparkles,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ConfirmDialog from '@/components/ConfirmDialog'
import MarqueeOnHover from '@/components/MarqueeOnHover'
import NoteScopeSelect from './NoteScopeSelect'
import { useKnowledgeBaseStore } from '@/store/knowledgeBaseStore'
import { useModelStore } from '@/store/modelStore'
import { useProviderStore } from '@/store/providerStore'
import { useUserStore } from '@/store/userStore'
import { askKbStream, getKbIndexStatus, type KbSource } from '@/services/knowledgeBase'
import { ModelOptionLabel } from '@/components/ModelProviderLogo'
import logo from '@/assets/icon.svg'
import { trackFeatureResult, trackFeatureSubmit } from '@/services/analytics'
import { getKnowledgeBasePanelState } from './viewState'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

const DEFAULT_QUESTIONS = [
  '总结一下我最近几篇笔记的核心内容',
  '我的笔记里提到过哪些工具或产品？',
  '帮我梳理一下这些笔记之间的共同主题',
  '有没有哪篇笔记的观点互相矛盾？',
]

const CHAT_PANEL_WIDTH = 'w-full max-w-[960px]'

function KnowledgeBrainIcon() {
  return (
    <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-[var(--primary-light)] text-primary shadow-[inset_0_0_0_1px_rgba(22,122,110,0.04)]">
      <div className="absolute inset-3 rounded-full bg-white/45 blur-md" />
      <BrainCircuit className="relative h-10 w-10 stroke-[1.8]" />
      <Sparkles className="absolute right-4 top-3.5 h-4 w-4 stroke-[2.1]" />
      <span className="absolute bottom-4 left-4 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      <span className="absolute bottom-5 right-5 h-1 w-1 rounded-full bg-current opacity-45" />
    </div>
  )
}

function SourceBadges({ sources }: { sources: KbSource[] }) {
  const [expanded, setExpanded] = useState(false)
  const uniqueSources = useMemo(() => {
    const seen = new Set<string>()
    return (sources || []).filter(source => {
      const key = source.task_id || source.title || source.text
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [sources])

  if (uniqueSources.length === 0) return null

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600"
      >
        <BookOpen className="h-3 w-3" />
        <span>引用来源 ({uniqueSources.length})</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1">
          {uniqueSources.map((s, i) => (
            <Badge key={i} variant="outline" className="text-xs font-normal">
              {s.title || '笔记'}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function ReasoningCard({ content, streaming }: { content: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(streaming)
  if (!content) return null

  return (
    <div className="mb-1.5 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-left font-medium text-neutral-500"
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        <span>{streaming ? '正在深度思考...' : '已深度思考'}</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && <div className="mt-1.5 whitespace-pre-wrap text-neutral-400">{content}</div>}
    </div>
  )
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body !bg-transparent text-sm [&_*]:!bg-transparent">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function AssistantMessage({
  content,
  reasoning,
  sources,
  streaming,
}: {
  content: string
  reasoning?: string | null
  sources?: KbSource[] | null
  streaming: boolean
}) {
  const showSources = !!sources?.length && (!!content || !streaming)

  return (
    <div className="space-y-2">
      {reasoning && <ReasoningCard content={reasoning} streaming={streaming && !content} />}
      {content ? (
        <MarkdownContent content={content} />
      ) : !reasoning ? (
        <div className="text-sm text-neutral-400">思考中...</div>
      ) : null}
      {showSources && <SourceBadges sources={sources} />}
    </div>
  )
}

export default function KnowledgeBasePage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [enableThinking, setEnableThinking] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [noteTaskIds, setNoteTaskIds] = useState<string[] | null>(null)
  const [coverage, setCoverage] = useState<{ total: number; indexed: number } | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  // 右键菜单：点击会话时记录鼠标位置和目标会话
  const [menuState, setMenuState] = useState<{ x: number; y: number; convId: number } | null>(null)
  // 重命名对话框状态：受控 Dialog + 编辑中的标题
  const [renameTargetId, setRenameTargetId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const conversations = useKnowledgeBaseStore(s => s.conversations)
  const activeConversationId = useKnowledgeBaseStore(s => s.activeConversationId)
  const messages = useKnowledgeBaseStore(s => s.messages)
  const messagesLoading = useKnowledgeBaseStore(s => s.messagesLoading)
  const loadConversations = useKnowledgeBaseStore(s => s.loadConversations)
  const newConversation = useKnowledgeBaseStore(s => s.newConversation)
  const selectConversation = useKnowledgeBaseStore(s => s.selectConversation)
  const removeConversation = useKnowledgeBaseStore(s => s.removeConversation)
  const renameConversation = useKnowledgeBaseStore(s => s.renameConversation)
  const togglePinConversation = useKnowledgeBaseStore(s => s.togglePinConversation)
  const markConversationUnread = useKnowledgeBaseStore(s => s.markConversationUnread)
  const addMessage = useKnowledgeBaseStore(s => s.addMessage)
  const processingConversationIds = useKnowledgeBaseStore(s => s.processingConversationIds)
  const startConversationStream = useKnowledgeBaseStore(s => s.startConversationStream)
  const appendConversationMessage = useKnowledgeBaseStore(s => s.appendConversationMessage)
  const appendConversationReasoning = useKnowledgeBaseStore(s => s.appendConversationReasoning)
  const setConversationSources = useKnowledgeBaseStore(s => s.setConversationSources)
  const finishConversationStream = useKnowledgeBaseStore(s => s.finishConversationStream)

  const user = useUserStore(s => s.user)
  const activeSubscription = useUserStore(s => s.activeSubscription)
  const isPro = !!activeSubscription
  const userAvatarSrc = user?.avatar
    ? user.avatar.startsWith('http')
      ? user.avatar
      : `${API_BASE}${user.avatar}`
    : null

  const modelList = useModelStore(s => s.modelList)
  const loadEnabledModels = useModelStore(s => s.loadEnabledModels)
  const providers = useProviderStore(s => s.provider)
  const fetchProviderList = useProviderStore(s => s.fetchProviderList)

  const refreshCoverage = useCallback(() => {
    getKbIndexStatus()
      .then(setCoverage)
      .catch(() => setCoverage({ total: 0, indexed: 0 }))
  }, [])

  useEffect(() => {
    loadConversations()
    if (modelList.length === 0) loadEnabledModels()
    if (providers.length === 0) fetchProviderList()
    refreshCoverage()
  }, [])

  useEffect(() => {
    if (!coverage || coverage.indexed >= coverage.total) return
    const timer = window.setInterval(refreshCoverage, 3000)
    return () => window.clearInterval(timer)
  }, [coverage, refreshCoverage])

  useEffect(() => {
    const onFocus = () => refreshCoverage()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshCoverage])

  useEffect(() => {
    if (!selectedModelKey && modelList.length > 0) {
      const first = modelList[0]
      setSelectedModelKey(`${first.provider_id}::${first.model_name}`)
    }
  }, [modelList, selectedModelKey])

  const selectedModel = useMemo(() => {
    const [providerId, modelName] = selectedModelKey.split('::')
    return modelList.find(m => m.provider_id === providerId && m.model_name === modelName)
  }, [selectedModelKey, modelList])

  useEffect(() => {
    if (!selectedModel?.supports_reasoning) setEnableThinking(false)
  }, [selectedModel])

  const handleSend = useCallback(
    async (value: string) => {
      const question = value.trim()
      if (!question || loading || !selectedModel) return

      let conversationId = activeConversationId
      if (!conversationId) {
        conversationId = await newConversation()
        if (!conversationId) {
          toast.error('创建会话失败，请重试')
          return
        }
      }

      const streamConversationId = conversationId
      trackFeatureSubmit('knowledge_base', { action: 'ask' })

      addMessage({ role: 'user', content: question })
      setInput('')
      setLoading(true)
      addMessage({ role: 'assistant', content: '', reasoning_content: '' })
      startConversationStream(streamConversationId)

      let streamFinished = false
      const finishStream = async () => {
        if (streamFinished) return
        streamFinished = true
        await finishConversationStream(streamConversationId)
      }

      try {
        let streamFailed = false
        await askKbStream(
          {
            conversation_id: streamConversationId,
            question,
            provider_id: selectedModel.provider_id,
            model_name: selectedModel.model_name,
            enable_thinking: enableThinking && !!selectedModel.supports_reasoning,
            note_task_ids: noteTaskIds ?? undefined,
          },
          {
            onSources: sources => setConversationSources(streamConversationId, sources),
            onReasoning: text => appendConversationReasoning(streamConversationId, text),
            onDelta: text => appendConversationMessage(streamConversationId, text),
            onError: msg => {
              streamFailed = true
              appendConversationMessage(streamConversationId, msg || '知识库问答失败')
              toast.error(msg || '知识库问答失败')
            },
          }
        )
        await finishStream()
        loadConversations(true)
        trackFeatureResult('knowledge_base', !streamFailed)
      } catch {
        trackFeatureResult('knowledge_base', false)
        appendConversationMessage(streamConversationId, '\n\n（请求中断）')
        toast.error('知识库问答失败')
        await finishStream()
      } finally {
        await finishStream()
        setLoading(false)
      }
    },
    [
      loading,
      selectedModel,
      activeConversationId,
      enableThinking,
      noteTaskIds,
      newConversation,
      addMessage,
      startConversationStream,
      appendConversationMessage,
      appendConversationReasoning,
      setConversationSources,
      finishConversationStream,
      loadConversations,
    ]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (deleteTargetId == null) return
    await removeConversation(deleteTargetId)
    setDeleteTargetId(null)
  }, [deleteTargetId, removeConversation])

  const handleContextMenu = useCallback((e: React.MouseEvent, convId: number) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuState({ x: e.clientX, y: e.clientY, convId })
  }, [])

  const closeMenu = useCallback(() => setMenuState(null), [])

  const menuTarget = useMemo(
    () => (menuState ? conversations.find(c => c.id === menuState.convId) ?? null : null),
    [menuState, conversations]
  )

  const handleTogglePin = useCallback(async () => {
    if (!menuTarget) return
    closeMenu()
    await togglePinConversation(menuTarget.id)
  }, [menuTarget, closeMenu, togglePinConversation])

  const handleOpenRename = useCallback(() => {
    if (!menuTarget) return
    setRenameTargetId(menuTarget.id)
    setRenameDraft(menuTarget.title || '')
    closeMenu()
  }, [menuTarget, closeMenu])

  const handleConfirmRename = useCallback(async () => {
    if (renameTargetId == null) return
    const ok = await renameConversation(renameTargetId, renameDraft)
    if (ok) setRenameTargetId(null)
    else toast.error('标题不能为空')
  }, [renameTargetId, renameDraft, renameConversation])

  const handleToggleUnread = useCallback(async () => {
    if (!menuTarget) return
    closeMenu()
    await markConversationUnread(menuTarget.id, !menuTarget.is_unread)
  }, [menuTarget, closeMenu, markConversationUnread])

  const handleAskDelete = useCallback(() => {
    if (!menuTarget) return
    setDeleteTargetId(menuTarget.id)
    closeMenu()
  }, [menuTarget, closeMenu])

  // 菜单在 Escape 或点击其他区域时关闭；点击菜单自身由内部按钮处理。
  useEffect(() => {
    if (!menuState) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    // 右键按下（button === 2）不视为“点击其他区域”，否则新开菜单时旧的关闭事件会
    // 立刻把新菜单一起关掉。左键或中键才关闭。
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) return
      closeMenu()
    }
    const onScroll = () => closeMenu()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuState, closeMenu])

  const bubbleItems = useMemo(() => {
    return messages.map((msg, i) => {
      const isLast = i === messages.length - 1
      const streaming = loading && isLast && msg.role === 'assistant'
      const pending = streaming && msg.content === '' && !msg.reasoning_content

      return {
        key: `kb-msg-${i}`,
        role: msg.role === 'user' ? ('user' as const) : ('ai' as const),
        content:
          msg.role === 'assistant' ? (
            <AssistantMessage
              content={msg.content}
              reasoning={msg.reasoning_content}
              sources={msg.sources}
              streaming={streaming}
            />
          ) : (
            msg.content
          ),
        loading: pending,
      }
    })
  }, [messages, loading])

  const roles = useMemo(
    () => ({
      user: {
        placement: 'end' as const,
        avatar: (
          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-teal-600 text-white">
            {userAvatarSrc ? (
              <img src={userAvatarSrc} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <UserRound className="h-4 w-4" />
            )}
          </div>
        ),
        variant: 'filled' as const,
        styles: { content: { background: '#167a6e', color: '#fff' } },
      },
      ai: {
        placement: 'start' as const,
        avatar: <img src={logo} alt="AI" className="h-7 w-7 object-contain" />,
        variant: 'outlined' as const,
        contentRender: (content: unknown) =>
          typeof content === 'string' ? (
            <MarkdownContent content={content} />
          ) : (
            (content as ReactNode)
          ),
      },
    }),
    [userAvatarSrc]
  )

  const panelState = getKnowledgeBasePanelState({
    messageCount: messages.length,
    questionLoading: loading,
    messagesLoading,
  })

  if (!isPro) {
    return (
      <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-[#fbfcfc]">
        <div className="flex shrink-0 items-center gap-2.5 border-b bg-white px-4 py-3">
          <div className="text-primary flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-light)]">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-800">知识库</h2>
            <p className="text-xs text-neutral-400">跨笔记检索并引用来源，帮你梳理积累的知识</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
          <div className="flex w-full max-w-[760px] flex-col items-center text-center">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Pro 专属
            </div>

            <div className="relative mb-7 h-28 w-40">
              <div className="absolute top-8 left-1 h-16 w-24 rounded-2xl border border-amber-100 bg-white shadow-sm">
                <div className="mt-4 space-y-2 px-3">
                  <div className="h-1.5 w-12 rounded-full bg-amber-50" />
                  <div className="h-1.5 w-16 rounded-full bg-neutral-100" />
                </div>
              </div>
              <div className="absolute top-1 right-1 h-20 w-28 rounded-2xl border border-teal-100 bg-white shadow-sm">
                <div className="mt-4 flex items-center gap-2 px-3">
                  <span className="bg-primary/70 h-2.5 w-2.5 rounded-full" />
                  <div className="h-1.5 flex-1 rounded-full bg-teal-50" />
                </div>
                <div className="mt-3 space-y-2 px-3">
                  <div className="h-1.5 w-20 rounded-full bg-neutral-100" />
                  <div className="h-1.5 w-14 rounded-full bg-neutral-100" />
                </div>
              </div>
              <div className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl bg-amber-50 text-amber-600 shadow-[0_18px_45px_rgba(245,158,11,0.14)]">
                <BookOpen className="h-9 w-9" />
              </div>
              <div className="text-primary absolute right-5 bottom-2 flex h-9 w-9 items-center justify-center rounded-xl border border-teal-100 bg-white shadow-sm">
                <BrainCircuit className="h-4 w-4" />
              </div>
            </div>

            <p className="text-2xl font-semibold tracking-normal text-gray-900">
              升级 Pro，开启知识库问答
            </p>
            <p className="mt-3 max-w-[560px] text-sm leading-6 text-neutral-500">
              把分散在不同视频里的笔记连接起来，按来源检索、对比观点，并在回答下方查看引用笔记。
            </p>

            <Button asChild className="mt-7 h-11 rounded-xl px-5">
              <Link to="/upgrade">
                升级 Pro
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>

            <div className="mt-8 grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
              {[
                { title: '跨笔记检索', desc: '从全部笔记中找关联内容' },
                { title: '引用来源', desc: '回答下方展示来源笔记' },
                { title: '深度思考', desc: '支持推理模型展开思路' },
              ].map(item => (
                <div
                  key={item.title}
                  className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm shadow-neutral-100/60"
                >
                  <p className="text-xs font-medium text-gray-800">{item.title}</p>
                  <p className="mt-1 text-xs leading-5 text-neutral-400">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (coverage === null) {
    return (
      <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-[#fbfcfc]">
        <div className="flex shrink-0 items-center gap-2.5 border-b bg-white px-4 py-3">
          <div className="text-primary flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-light)]">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-800">知识库</h2>
            <p className="text-xs text-neutral-400">跨笔记检索并引用来源，帮你梳理积累的知识</p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1" />
      </div>
    )
  }

  if (coverage.total === 0) {
    return (
      <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-[#fbfcfc]">
        <div className="flex shrink-0 items-center gap-2.5 border-b bg-white px-4 py-3">
          <div className="text-primary flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-light)]">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-800">知识库</h2>
            <p className="text-xs text-neutral-400">跨笔记检索并引用来源，帮你梳理积累的知识</p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10">
          <div className="flex w-full max-w-[720px] flex-col items-center text-center">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Pro 专属
            </div>

            <div className="relative mb-7 h-28 w-36">
              <div className="absolute top-7 left-0 h-16 w-24 rounded-2xl border border-amber-100 bg-white shadow-sm" />
              <div className="absolute top-2 right-0 h-20 w-28 rounded-2xl border border-amber-100 bg-white shadow-sm" />
              <div className="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl bg-amber-50 text-amber-600 shadow-[0_18px_45px_rgba(245,158,11,0.14)]">
                <Sparkles className="h-9 w-9" />
              </div>
              <div className="absolute right-4 bottom-2 flex h-9 w-9 items-center justify-center rounded-xl border border-amber-100 bg-white text-amber-600 shadow-sm">
                <FileText className="h-4 w-4" />
              </div>
            </div>

            <p className="text-2xl font-semibold tracking-normal text-gray-900">知识库还没有笔记</p>
            <p className="mt-3 max-w-[520px] text-sm leading-6 text-neutral-500">
              生成第一篇 AI 笔记后，这里会自动建立索引，你就可以按笔记范围提问、查看回答引用来源。
            </p>

            <Button asChild className="mt-7 h-11 rounded-xl px-5">
              <Link to="/">
                去工作台生成笔记
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>

            <div className="mt-8 grid w-full max-w-[560px] gap-2 sm:grid-cols-3">
              {['粘贴视频链接', '生成结构化笔记', '回到知识库提问'].map((step, index) => (
                <div
                  key={step}
                  className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs text-neutral-500"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-medium text-neutral-500">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 grid w-full max-w-[620px] gap-2 sm:grid-cols-3">
              {[
                { title: '跨笔记检索', desc: '从全部笔记中找到关联内容', Icon: BookOpen },
                { title: '引用来源', desc: '回答下方展示来源笔记', Icon: FileText },
                { title: '深度思考', desc: '支持推理模型展开思路', Icon: BrainCircuit },
              ].map(item => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm shadow-neutral-100/60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                    <item.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col">
      {/* 顶部标题条 */}
      <div className="flex shrink-0 items-center gap-2.5 border-b px-4 py-3">
        <div className="text-primary flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-light)]">
          <BookOpen className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-800">知识库</h2>
          <p className="text-xs text-neutral-400">跨笔记检索并引用来源，帮你梳理积累的知识</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧会话历史 */}
        <div className="flex w-64 shrink-0 flex-col border-r">
          <div className="p-3">
            <Button
              className="w-full justify-center gap-2"
              variant="outline"
              onClick={() => newConversation()}
            >
              <Plus className="h-4 w-4 shrink-0" />
              新对话
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {conversations.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-neutral-400">还没有历史对话</p>
            ) : (
              conversations.map(c => {
                const isActive = activeConversationId === c.id
                const isMenuOpen = menuState?.convId === c.id
                const isProcessing = !!processingConversationIds[c.id]
                return (
                  <div
                    key={c.id}
                    onClick={() => selectConversation(c.id)}
                    onContextMenu={e => handleContextMenu(e, c.id)}
                    className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : isMenuOpen
                          ? 'bg-neutral-100 text-gray-700'
                          : 'text-gray-700 hover:bg-neutral-100'
                    }`}
                  >
                    {c.is_pinned && (
                      <Pin
                        className={`h-3 w-3 shrink-0 ${isActive ? 'text-primary' : 'text-neutral-400'}`}
                      />
                    )}
                    <MarqueeOnHover className={`min-w-0 flex-1 ${c.is_unread ? 'font-semibold' : ''}`}>
                      {c.title || '新对话'}
                    </MarqueeOnHover>
                    <span className="ml-auto flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {isProcessing ? (
                        <LoaderCircle
                          className="h-3.5 w-3.5 animate-spin text-neutral-400"
                          aria-label="执行中"
                        />
                      ) : c.is_unread ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-label="未读" />
                      ) : null}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 右侧主问答区 */}
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className={`flex min-h-0 flex-1 flex-col px-5 ${CHAT_PANEL_WIDTH}`}>
            {panelState === 'empty' ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 py-6">
                <KnowledgeBrainIcon />
                <div className="text-center">
                  <h1 className="text-xl font-semibold text-gray-800">你的第二大脑，随时开问</h1>
                  <p className="mt-1.5 text-sm text-neutral-400">
                    跨笔记检索并引用来源笔记，一起梳理你积累的知识
                  </p>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {DEFAULT_QUESTIONS.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleSend(q)}
                      className="hover:border-primary/40 hover:text-primary flex h-full w-full items-center rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-[var(--primary-light)]"
                    >
                      <span className="line-clamp-2">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : panelState === 'loading' ? (
              <div className="flex flex-1 items-center justify-center text-neutral-400">
                <LoaderCircle className="h-5 w-5 animate-spin" aria-label="加载会话" />
              </div>
            ) : (
              <div className="noteflow-kb-bubble-list min-h-0 flex-1 overflow-y-auto py-4">
                <Bubble.List items={bubbleItems} role={roles} />
              </div>
            )}
          </div>

          {/* 底部输入区 */}
          <div className={`shrink-0 px-5 pb-2 ${CHAT_PANEL_WIDTH}`}>
            <div className="noteflow-kb-sender rounded-2xl border bg-white p-1.5 shadow-sm">
              <Sender
                value={input}
                onChange={setInput}
                onSubmit={handleSend}
                loading={loading}
                placeholder="问点什么..."
                suffix={false}
                footer={oriNode => (
                  <div className="flex items-center justify-between gap-2 px-1.5 pt-1.5">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <Select value={selectedModelKey} onValueChange={setSelectedModelKey}>
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue placeholder="选择模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {modelList.map(m => (
                            <SelectItem
                              key={`${m.provider_id}::${m.model_name}`}
                              value={`${m.provider_id}::${m.model_name}`}
                            >
                              <ModelOptionLabel
                                providerId={m.provider_id}
                                modelName={m.model_name}
                                providers={providers}
                                size={16}
                              />
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <NoteScopeSelect value={noteTaskIds} onChange={setNoteTaskIds} />

                      <div
                        className="flex items-center gap-1.5 text-xs text-neutral-500"
                        title={selectedModel?.supports_reasoning ? '' : '当前模型不支持深度思考'}
                      >
                        <Switch
                          checked={enableThinking}
                          onCheckedChange={setEnableThinking}
                          disabled={!selectedModel?.supports_reasoning}
                        />
                        <BrainCircuit className="h-3.5 w-3.5" />
                        <span>深度思考</span>
                      </div>

                      {coverage && (
                        <span className="text-xs text-neutral-400">
                          {coverage.indexed}/{coverage.total} 篇笔记已索引
                        </span>
                      )}
                    </div>

                    {oriNode}
                  </div>
                )}
              />
            </div>
            <p className="mt-1.5 text-center text-xs text-neutral-300">
              Enter 发送 · Shift+Enter 换行 · 每次提问将按所选模型价格消耗一定电力
            </p>
          </div>
        </div>
      </div>

      {menuState && menuTarget && (
        <div
          role="menu"
          onMouseDown={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
          style={{
            // 简单夹取到视口内，避免菜单被裁掉；菜单宽 ~176px、单项高约 32px、共 4 项 + 内边距。
            left: Math.min(menuState.x, window.innerWidth - 200),
            top: Math.min(menuState.y, window.innerHeight - 180),
          }}
          className="fixed z-50 w-44 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 text-sm text-gray-700 shadow-lg"
        >
          <button
            type="button"
            onClick={handleTogglePin}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100"
          >
            {menuTarget.is_pinned ? (
              <>
                <PinOff className="h-4 w-4 text-neutral-500" />
                <span>取消置顶</span>
              </>
            ) : (
              <>
                <Pin className="h-4 w-4 text-neutral-500" />
                <span>置顶聊天</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleOpenRename}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100"
          >
            <Pencil className="h-4 w-4 text-neutral-500" />
            <span>重命名聊天</span>
          </button>
          <button
            type="button"
            onClick={handleToggleUnread}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100"
          >
            {menuTarget.is_unread ? (
              <>
                <MailOpen className="h-4 w-4 text-neutral-500" />
                <span>标记为已读</span>
              </>
            ) : (
              <>
                <MailPlus className="h-4 w-4 text-neutral-500" />
                <span>标记为未读</span>
              </>
            )}
          </button>
          <div className="my-1 border-t border-neutral-100" />
          <button
            type="button"
            onClick={handleAskDelete}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            <span>删除聊天</span>
          </button>
        </div>
      )}

      <Dialog
        open={renameTargetId != null}
        onOpenChange={open => {
          if (!open) setRenameTargetId(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>重命名聊天</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={e => setRenameDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleConfirmRename()
              }
            }}
            maxLength={200}
            autoFocus
            placeholder="给这段聊天起个名字"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTargetId(null)}>
              取消
            </Button>
            <Button onClick={handleConfirmRename} disabled={!renameDraft.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTargetId != null}
        onOpenChange={open => !open && setDeleteTargetId(null)}
        title="删除对话"
        description="删除后该对话的所有消息将无法恢复。"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
