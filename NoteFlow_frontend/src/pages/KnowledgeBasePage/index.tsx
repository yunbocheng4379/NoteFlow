import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Plus,
  Trash2,
  UserRound,
  Sparkles,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useKnowledgeBaseStore } from '@/store/knowledgeBaseStore'
import { useModelStore } from '@/store/modelStore'
import { useUserStore } from '@/store/userStore'
import { askKbStream, getKbIndexStatus, type KbSource } from '@/services/knowledgeBase'
import logo from '@/assets/icon.svg'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace('/api', '')

const DEFAULT_QUESTIONS = [
  '总结一下我最近几篇笔记的核心内容',
  '我的笔记里提到过哪些工具或产品？',
  '帮我梳理一下这些笔记之间的共同主题',
  '有没有哪篇笔记的观点互相矛盾？',
]

function SourceBadges({ sources }: { sources: KbSource[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600"
      >
        <BookOpen className="h-3 w-3" />
        <span>引用来源 ({sources.length})</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1">
          {sources.map((s, i) => (
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

export default function KnowledgeBasePage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [enableThinking, setEnableThinking] = useState(false)
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [coverage, setCoverage] = useState<{ total: number; indexed: number } | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)

  const conversations = useKnowledgeBaseStore((s) => s.conversations)
  const activeConversationId = useKnowledgeBaseStore((s) => s.activeConversationId)
  const messages = useKnowledgeBaseStore((s) => s.messages)
  const loadConversations = useKnowledgeBaseStore((s) => s.loadConversations)
  const newConversation = useKnowledgeBaseStore((s) => s.newConversation)
  const selectConversation = useKnowledgeBaseStore((s) => s.selectConversation)
  const removeConversation = useKnowledgeBaseStore((s) => s.removeConversation)
  const addMessage = useKnowledgeBaseStore((s) => s.addMessage)
  const appendToLastMessage = useKnowledgeBaseStore((s) => s.appendToLastMessage)
  const appendToLastReasoning = useKnowledgeBaseStore((s) => s.appendToLastReasoning)
  const setLastMessageSources = useKnowledgeBaseStore((s) => s.setLastMessageSources)

  const user = useUserStore((s) => s.user)
  const activeSubscription = useUserStore((s) => s.activeSubscription)
  const isPro = !!activeSubscription
  const userAvatarSrc = user?.avatar
    ? user.avatar.startsWith('http') ? user.avatar : `${API_BASE}${user.avatar}`
    : null

  const modelList = useModelStore((s) => s.modelList)
  const loadEnabledModels = useModelStore((s) => s.loadEnabledModels)

  useEffect(() => {
    loadConversations()
    if (modelList.length === 0) loadEnabledModels()
    getKbIndexStatus()
      .then(setCoverage)
      .catch(() => setCoverage({ total: 0, indexed: 0 }))
  }, [])

  useEffect(() => {
    if (!selectedModelKey && modelList.length > 0) {
      const first = modelList[0]
      setSelectedModelKey(`${first.provider_id}::${first.model_name}`)
    }
  }, [modelList, selectedModelKey])

  const selectedModel = useMemo(() => {
    const [providerId, modelName] = selectedModelKey.split('::')
    return modelList.find((m) => m.provider_id === providerId && m.model_name === modelName)
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

      addMessage({ role: 'user', content: question })
      setInput('')
      setLoading(true)
      addMessage({ role: 'assistant', content: '', reasoning_content: '' })

      try {
        await askKbStream(
          {
            conversation_id: conversationId,
            question,
            provider_id: selectedModel.provider_id,
            model_name: selectedModel.model_name,
            enable_thinking: enableThinking && !!selectedModel.supports_reasoning,
          },
          {
            onSources: (sources) => setLastMessageSources(sources),
            onReasoning: (text) => appendToLastReasoning(text),
            onDelta: (text) => appendToLastMessage(text),
            onError: (msg) => {
              appendToLastMessage(msg || '知识库问答失败')
              toast.error(msg || '知识库问答失败')
            },
          },
        )
        loadConversations(true)
      } catch {
        appendToLastMessage('\n\n（请求中断）')
        toast.error('知识库问答失败')
      } finally {
        setLoading(false)
      }
    },
    [
      loading,
      selectedModel,
      activeConversationId,
      enableThinking,
      newConversation,
      addMessage,
      appendToLastMessage,
      appendToLastReasoning,
      setLastMessageSources,
      loadConversations,
    ],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (deleteTargetId == null) return
    await removeConversation(deleteTargetId)
    setDeleteTargetId(null)
  }, [deleteTargetId, removeConversation])

  const bubbleItems = useMemo(() => {
    return messages.map((msg, i) => {
      const isLast = i === messages.length - 1
      const pending =
        loading && isLast && msg.role === 'assistant' && msg.content === '' && !msg.reasoning_content
      return {
        key: `kb-msg-${i}`,
        role: msg.role === 'user' ? ('user' as const) : ('ai' as const),
        content: pending ? '思考中...' : msg.content,
        loading: pending,
        footer:
          msg.role === 'assistant' ? (
            <>
              {msg.reasoning_content && (
                <ReasoningCard
                  content={msg.reasoning_content}
                  streaming={loading && isLast && msg.content === ''}
                />
              )}
              {msg.sources && <SourceBadges sources={msg.sources} />}
            </>
          ) : undefined,
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
        contentRender: (content: unknown) => (
          <div className="markdown-body !bg-transparent text-sm [&_*]:!bg-transparent">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {typeof content === 'string' ? content : String(content)}
            </ReactMarkdown>
          </div>
        ),
      },
    }),
    [userAvatarSrc],
  )

  if (!isPro) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <BookOpen className="h-6 w-6" />
        </div>
        <div>
          <p className="text-base font-medium text-gray-800">知识库为会员专属功能</p>
          <p className="mt-1 text-sm text-neutral-400">升级 Pro 即可对全部笔记进行跨笔记 AI 问答</p>
        </div>
        <Button asChild>
          <Link to="/upgrade">升级 Pro →</Link>
        </Button>
      </div>
    )
  }

  if (coverage && coverage.total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-light)] text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <p className="text-base font-medium text-gray-800">还没有笔记</p>
          <p className="mt-1 text-sm text-neutral-400">先去工作台生成第一篇笔记，再回来开始知识库问答</p>
        </div>
        <Button asChild>
          <Link to="/">去工作台 →</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* 左侧会话历史 */}
      <div className="flex w-64 shrink-0 flex-col border-r">
        <div className="p-3">
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            onClick={() => newConversation()}
          >
            <Plus className="h-4 w-4" />
            新对话
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-neutral-400">还没有历史对话</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  activeConversationId === c.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-700 hover:bg-neutral-100'
                }`}
              >
                <span className="truncate">{c.title || '新对话'}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTargetId(c.id)
                  }}
                  className="shrink-0 text-neutral-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧主问答区 */}
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-hidden">
          {messages.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-5 py-6">
              <div className="text-center">
                <h1 className="text-xl font-semibold text-gray-800">你的第二大脑，随时开问</h1>
                <p className="mt-1.5 text-sm text-neutral-400">
                  跨笔记检索并引用来源笔记，一起梳理你积累的知识
                </p>
              </div>
              <div className="w-full max-w-md space-y-2">
                {DEFAULT_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSend(q)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-primary/40 hover:bg-[var(--primary-light)] hover:text-primary"
                  >
                    <span className="flex-1 truncate">{q}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 transition-colors group-hover:text-primary" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Bubble.List items={bubbleItems} role={roles} style={{ height: '100%' }} />
          )}
        </div>

        {/* 底部输入区 */}
        <div className="border-t px-3 py-2">
          <div className="mb-2 flex items-center gap-2">
            <Select value={selectedModelKey} onValueChange={setSelectedModelKey}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {modelList.map((m) => (
                  <SelectItem
                    key={`${m.provider_id}::${m.model_name}`}
                    value={`${m.provider_id}::${m.model_name}`}
                  >
                    {m.model_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              className="flex items-center gap-1.5 text-xs text-neutral-500"
              title={selectedModel?.supports_reasoning ? '' : '当前模型不支持深度思考'}
            >
              <Switch
                checked={enableThinking}
                onCheckedChange={setEnableThinking}
                disabled={!selectedModel?.supports_reasoning}
              />
              <span>深度思考</span>
            </div>

            {coverage && coverage.indexed < coverage.total && (
              <span className="text-xs text-neutral-400">
                {coverage.indexed}/{coverage.total} 篇笔记已索引，其余正在后台处理
              </span>
            )}
          </div>

          <Sender
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            loading={loading}
            placeholder="输入你的问题..."
          />
          <p className="mt-1.5 text-center text-xs text-neutral-300">知识库为会员功能</p>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTargetId != null}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
        title="删除对话"
        description="删除后该对话的所有消息将无法恢复。"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

