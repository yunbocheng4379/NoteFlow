import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Globe, Lock, Trash2, Pencil, Eye, Clock3, XCircle, Shuffle } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import { noteStyleApi, type NoteStyle, type CreateStyleParams } from '@/services/note_style'
import ConfirmDialog from '@/components/ConfirmDialog'
import 'github-markdown-css/github-markdown-light.css'

type Category = 'all' | 'system' | 'user' | 'public'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'system', label: '内置' },
  { key: 'user', label: '自定义' },
  { key: 'public', label: '公开广场' },
]

// ── Icon helpers ─────────────────────────────────────────────────────────────

const PROMPT_ICONS: { key: string; label: string }[] = [
  { key: 'academic',   label: '学术' },
  { key: 'book',       label: '阅读' },
  { key: 'business',   label: '商业' },
  { key: 'detailed',   label: '详细' },
  { key: 'life',       label: '生活' },
  { key: 'meeting',    label: '会议' },
  { key: 'streamline', label: '精简' },
  { key: 'task',       label: '任务' },
  { key: 'tutorial',   label: '教程' },
]
const RANDOM_ICON = '__random__'

function resolveIcon(icon: string | null | undefined) {
  if (icon !== RANDOM_ICON) return icon ?? undefined
  return PROMPT_ICONS[Math.floor(Math.random() * PROMPT_ICONS.length)]?.key
}

function styleIconUrl(key: string) {
  return `/prompt_icon/icons/${key}.png`
}

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  maxLength: number
  placeholder: string
}

function MarkdownPreview({ value }: { value: string }) {
  return (
    <div className="markdown-body !bg-transparent text-sm [&_*]:!bg-transparent">
      {value.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      ) : (
        <p className="text-sm text-gray-400">暂无内容</p>
      )}
    </div>
  )
}

function MarkdownEditor({ value, onChange, maxLength, placeholder }: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-2 py-1">
        <div className="flex items-center gap-1">
          {(['edit', 'preview'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                mode === item
                  ? 'bg-white font-medium text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {item === 'edit' ? '编辑 Markdown' : '预览'}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-400">{value.length}/{maxLength}</span>
      </div>

      {mode === 'edit' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          rows={9}
          placeholder={placeholder}
          className="block min-h-[220px] w-full resize-y border-0 px-3 py-2 text-sm leading-6 outline-none focus:ring-0"
        />
      ) : (
        <div className="min-h-[220px] max-h-[320px] overflow-y-auto px-3 py-2">
          <MarkdownPreview value={value} />
        </div>
      )}
    </div>
  )
}

// 首字母头像兜底
function avatarChar(name: string) {
  return name.charAt(0).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-primary', 'bg-teal-500', 'bg-pink-500', 'bg-blue-500',
  'bg-lime-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
]

function avatarColor(name: string) {
  const code = name.charCodeAt(0) || 0
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

function showReviewPendingToast() {
  return toast.custom(
    (t) => (
      <div
        className={`flex max-w-[380px] items-center gap-3 rounded-xl border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 shadow-lg transition-opacity ${
          t.visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Clock3 className="h-5 w-5 shrink-0 text-amber-500" />
        <span>已提交审核，等待管理员审核</span>
      </div>
    ),
    { duration: 3000 },
  )
}

// ── Icon Picker ──────────────────────────────────────────────────────────────

interface IconPickerProps {
  value: string | null
  onChange: (key: string | null) => void
}

function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="space-y-1">
      <label className="text-[13px] font-medium text-gray-600">
        风格图标
        <span className="ml-1 text-[11px] text-gray-400 font-normal">(默认随机分配，也可手动选择)</span>
      </label>
      <div className="grid grid-cols-5 gap-2">
        {/* random option: resolve to a concrete icon only when saving */}
        <button
          type="button"
          aria-label="随机选择风格图标"
          title="保存时从 9 个风格图标中随机选择一个"
          onClick={() => onChange(RANDOM_ICON)}
          className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] transition-colors ${
            value === RANDOM_ICON
              ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/40'
              : 'border-neutral-200 text-gray-400 hover:border-neutral-300'
          }`}
        >
          <Shuffle className="h-8 w-8 p-1 text-primary" />
          <span>随机</span>
        </button>
        {PROMPT_ICONS.map((ic) => (
          <button
            key={ic.key}
            type="button"
            onClick={() => onChange(ic.key)}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
              value === ic.key
                ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                : 'border-neutral-200 hover:border-neutral-300'
            }`}
          >
            <img
              src={styleIconUrl(ic.key)}
              alt={ic.label}
              className="w-8 h-8 object-cover rounded"
            />
            <span className="text-[11px] text-gray-500">{ic.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Create / Edit Modal ──────────────────────────────────────────────────────

interface StyleModalProps {
  initial?: Partial<NoteStyle>
  onClose: () => void
  onSaved: (style: NoteStyle) => void
}

function StyleModal({ initial, onClose, onSaved }: StyleModalProps) {
  const isEdit = !!initial?.id

  const [form, setForm] = useState({
    name: initial?.name ?? '',
    value: initial?.value ?? '',
    description: initial?.description ?? '',
    prompt: initial?.prompt ?? '',
    is_public: initial?.is_public || initial?.moderation_status === 'PENDING_REVIEW' || initial?.moderation_status === 'PUBLISHED',
    icon: (initial?.icon ?? RANDOM_ICON) as string,
  })
  const [saving, setSaving] = useState(false)

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('请填写风格名称')
    if (!isEdit && !form.value.trim()) return toast.error('请填写唯一标识')
    if (!form.prompt.trim()) return toast.error('请填写风格提示词')

    setSaving(true)
    try {
      const selectedIcon = resolveIcon(form.icon)
      let result: NoteStyle
      if (isEdit && initial?.id) {
        result = await noteStyleApi.update(initial.id, {
          name: form.name,
          description: form.description || undefined,
          prompt: form.prompt,
          is_public: form.is_public,
          icon: selectedIcon,
        })
      } else {
        const payload: CreateStyleParams = {
          name: form.name,
          value: form.value,
          prompt: form.prompt,
          description: form.description || undefined,
          is_public: form.is_public,
          icon: selectedIcon,
        }
        result = await noteStyleApi.create(payload)
      }
      toast.success(form.is_public ? '已提交审核，审核通过后将公开展示' : (isEdit ? '已更新' : '已创建'))
      onSaved(result)
    } catch {
      // request interceptor shows error
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg max-h-[90vh] p-0 flex flex-col [&>button[data-slot=dialog-close]]:top-[7px]"
      >
        {/* 固定标题栏 */}
        <DialogHeader className="shrink-0 border-b border-neutral-200 px-6 py-4">
          <DialogTitle>{isEdit ? '编辑风格' : '新建风格'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* 可滚动内容区 */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-1">
              <label className="text-[13px] font-medium text-gray-600">
                风格名称 <span className="text-red-400">*</span>
              </label>
              <Input
                value={form.name}
                onChange={set('name')}
                maxLength={50}
                placeholder="最多 50 字"
                className="h-9 text-sm"
              />
            </div>

            {!isEdit && (
              <div className="space-y-1">
                <label className="text-[13px] font-medium text-gray-600">
                  唯一标识 <span className="text-red-400">*</span>
                  <span className="ml-1 text-[11px] text-gray-400 font-normal">
                    (英文 + 下划线，生成后不可修改)
                  </span>
                </label>
                <Input
                  value={form.value}
                  onChange={set('value')}
                  maxLength={64}
                  placeholder="my_custom_style"
                  className="h-9 text-sm font-mono"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[13px] font-medium text-gray-600">
                简介
                <span className="ml-1 text-[11px] text-gray-400 font-normal">(可选，最多 200 字)</span>
              </label>
              <Input
                value={form.description}
                onChange={set('description')}
                maxLength={200}
                placeholder="一句话描述这个风格"
                className="h-9 text-sm"
              />
            </div>

            {/* Icon picker */}
            <IconPicker
              value={form.icon}
              onChange={(key) => setForm((p) => ({ ...p, icon: key }))}
            />

            <div className="space-y-1">
              <label className="text-[13px] font-medium text-gray-600">
                风格提示词 <span className="text-red-400">*</span>
                <span className="ml-1 text-[11px] text-gray-400 font-normal">(最多 2000 字)</span>
              </label>
              <MarkdownEditor
                value={form.prompt}
                onChange={(prompt) => setForm((p) => ({ ...p, prompt }))}
                maxLength={2000}
                placeholder="使用 Markdown 描述你希望 LLM 以什么风格生成笔记..."
              />
            </div>

            {/* Public toggle */}
            <div
              className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 cursor-pointer select-none"
              onClick={() => setForm((p) => ({ ...p, is_public: !p.is_public }))}
            >
              <div>
                <div className="text-[13px] font-medium text-gray-700">公开给所有人使用</div>
                <div className="text-[11px] text-gray-400">开启后，其他用户可在公开广场发现此风格</div>
              </div>
              <div
                className={`w-10 h-5.5 rounded-full transition-colors relative flex-shrink-0 ${
                  form.is_public ? 'bg-primary' : 'bg-gray-200'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${
                    form.is_public ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* 固定底部按钮 */}
          <div className="shrink-0 flex justify-end gap-2 border-t border-neutral-200 px-6 py-4">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              {saving ? '保存中...' : isEdit ? '保存更改' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Style Details Modal ─────────────────────────────────────────────────────

interface StyleDetailsModalProps {
  style: NoteStyle
  onClose: () => void
}

function StyleDetailsModal({ style, onClose }: StyleDetailsModalProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {style.name}
            {style.source === 'system' && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20"
              >
                内置
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>查看该笔记风格的简介和风格提示词。</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">简介</h3>
            <p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm leading-6 text-gray-700">
              {style.description || '暂无简介'}
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">风格提示词</h3>
            <div className="max-h-[420px] overflow-y-auto rounded-lg border border-neutral-200 bg-white px-4 py-3">
              <MarkdownPreview value={style.prompt || ''} />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Style Card ───────────────────────────────────────────────────────────────

interface StyleCardProps {
  style: NoteStyle
  currentUserId?: number | null
  isAdmin: boolean
  onView: (s: NoteStyle) => void
  onEdit: (s: NoteStyle) => void
  onDelete: (id: number) => void
  onTogglePublic: (id: number, val: boolean) => void
}

function StyleCard({
  style,
  currentUserId,
  isAdmin,
  onView,
  onEdit,
  onDelete,
  onTogglePublic,
}: StyleCardProps) {
  const isOwner = style.source === 'user' && style.user_id === currentUserId
  const isSystemStyle = style.source === 'system'
  const canViewDetails = isSystemStyle || (style.source === 'user' && style.is_public)
  const canManageSystemStyle = isSystemStyle && isAdmin
  const isPending = style.moderation_status === 'PENDING_REVIEW'

  return (
    <div
      className="group relative rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-primary/30 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        {/* Icon / Avatar */}
        {style.icon ? (
          <img
            src={styleIconUrl(style.icon)}
            alt={style.name}
            className="w-[50px] h-[50px] rounded-lg object-cover flex-shrink-0"
          />
        ) : (
          <div
            className={`w-[50px] h-[50px] rounded-lg flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${avatarColor(style.name)}`}
          >
            {avatarChar(style.name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{style.name}</span>
            {style.source === 'system' && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20"
              >
                内置
              </Badge>
            )}
            {style.is_public && style.source === 'user' && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 bg-primary/10 text-primary border-primary/20"
              >
                公开
              </Badge>
            )}
            {style.source === 'user' && style.moderation_status === 'PENDING_REVIEW' && (
              <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-200">
                <Clock3 size={10} /> 待审核
              </Badge>
            )}
            {style.source === 'user' && style.moderation_status === 'REJECTED' && (
              <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 h-4 bg-red-50 text-red-700 border-red-200">
                <XCircle size={10} /> 已驳回
              </Badge>
            )}
            {style.source === 'user' && style.moderation_status === 'UNPUBLISHED' && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-neutral-100 text-neutral-600 border-neutral-200">
                已下架
              </Badge>
            )}
          </div>

          {style.description && (
            <p className="mt-1 text-[12px] text-gray-500 line-clamp-2 leading-relaxed">
              {style.description}
            </p>
          )}
        </div>
      </div>

      {/* Built-in and public style details: visible only when hovering/focusing the card. */}
      {canViewDetails && (
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`查看${style.name}详情`}
            title="查看详情"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            onClick={(event) => {
              event.stopPropagation()
              onView(style)
            }}
          >
            <Eye size={15} />
          </button>

          {canManageSystemStyle && (
            <>
              <button
                type="button"
                aria-label={`编辑${style.name}`}
                title="编辑"
                className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                onClick={(event) => {
                  event.stopPropagation()
                  onEdit(style)
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                aria-label={`删除${style.name}`}
                title="删除"
                className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                onClick={(event) => {
                  event.stopPropagation()
                  onDelete(style.id)
                }}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Owner actions */}
      {isOwner && (
        <div className="mt-3 flex items-center gap-2 pt-3 border-t border-neutral-100">
          <button
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-primary transition-colors"
            onClick={() => !isPending && onTogglePublic(style.id, !style.is_public)}
            disabled={isPending}
            title={isPending ? '等待管理员审核' : (style.is_public ? '设为私有' : '公开分享')}
          >
            {isPending ? (
              <><Clock3 size={12} /> 等待审核</>
            ) : style.is_public ? (
              <><Lock size={12} /> 设为私有</>
            ) : (
              <><Globe size={12} /> 公开分享</>
            )}
          </button>

          <button
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-primary transition-colors ml-auto"
            onClick={() => onEdit(style)}
          >
            <Pencil size={12} /> 编辑
          </button>

          <button
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500 transition-colors"
            onClick={() => onDelete(style.id)}
          >
            <Trash2 size={12} /> 删除
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

import { useUserStore } from '@/store/userStore'

export default function NoteStylePage() {
  const user = useUserStore((s) => s.user)
  const isAdmin = !!user?.is_admin
  const [allStyles, setAllStyles] = useState<NoteStyle[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<Category>('all')
  const [keyword, setKeyword] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<NoteStyle | undefined>(undefined)
  const [detailTarget, setDetailTarget] = useState<NoteStyle | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const counts = {
    all: allStyles.length,
    system: allStyles.filter((s) => s.source === 'system').length,
    user: allStyles.filter((s) => s.source === 'user' && s.user_id === user?.id).length,
    public: allStyles.filter((s) => s.is_public && s.source === 'user').length,
  }

  const styles = allStyles.filter((s) => {
    const matchesCategory =
      category === 'all' ||
      (category === 'system' && s.source === 'system') ||
      (category === 'user' && s.source === 'user' && s.user_id === user?.id) ||
      (category === 'public' && s.is_public && s.source === 'user')
    const matchesKeyword =
      !keyword ||
      s.name.toLowerCase().includes(keyword.toLowerCase()) ||
      (s.description ?? '').toLowerCase().includes(keyword.toLowerCase())
    return matchesCategory && matchesKeyword
  })

  const fetchStyles = useCallback(async () => {
    setLoading(true)
    try {
      const data = await noteStyleApi.list({})
      setAllStyles(data ?? [])
    } catch {
      // error toast shown by interceptor
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStyles()
  }, [fetchStyles])

  const handleDelete = async () => {
    if (pendingDeleteId === null) return
    setDeleting(true)
    try {
      await noteStyleApi.remove(pendingDeleteId)
      toast.success('已删除')
      fetchStyles()
    } finally {
      setDeleting(false)
      setPendingDeleteId(null)
    }
  }

  const handleTogglePublic = async (id: number, val: boolean) => {
    const pendingToastId = val ? showReviewPendingToast() : undefined
    try {
      await noteStyleApi.togglePublic(id, val)
      if (!val) toast.success('已设为私有')
      fetchStyles()
    } catch {
      if (pendingToastId) toast.dismiss(pendingToastId)
    }
  }

  const handleSaved = () => {
    setShowModal(false)
    setEditTarget(undefined)
    fetchStyles()
  }

  const openCreate = () => {
    setEditTarget(undefined)
    setShowModal(true)
  }

  const openEdit = (s: NoteStyle) => {
    setEditTarget(s)
    setShowModal(true)
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-[#f5f5f5]">
      {/* Top: category tabs */}
      <div className="flex items-center gap-2 border-b border-neutral-100 px-6 py-3">
        <span className="mr-1 text-xs font-medium text-gray-400 uppercase tracking-widest">
          分类
        </span>
        {CATEGORIES.map((c) => {
          const active = category === c.key
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition-colors ${
                active
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-neutral-200 bg-white text-gray-600 hover:border-primary/40 hover:text-primary'
              }`}
            >
              <span>{c.label}</span>
              <span
                className={`min-w-[20px] rounded-full px-1.5 py-0 text-center text-[11px] leading-[1.4] ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {counts[c.key]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-neutral-100 px-6 py-3">
        <div className="relative max-w-sm flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索名称或描述..."
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-neutral-200 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>

        <div className="ml-auto">
          <Button
            onClick={openCreate}
            size="sm"
            className="h-8 bg-primary hover:bg-primary/90 text-white gap-1.5"
          >
            <Plus size={14} />
            新建风格
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : styles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <Search size={32} className="opacity-30" />
            <p className="text-sm">
              {keyword ? `没有找到 "${keyword}" 相关的风格` : '暂无风格'}
            </p>
            {!keyword && category === 'user' && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={openCreate}
              >
                创建第一个
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {styles.map((s) => (
              <StyleCard
                key={s.id}
                style={s}
                currentUserId={user?.id ?? null}
                isAdmin={isAdmin}
                onView={setDetailTarget}
                onEdit={openEdit}
                onDelete={setPendingDeleteId}
                onTogglePublic={handleTogglePublic}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <StyleModal
          initial={editTarget}
          onClose={() => { setShowModal(false); setEditTarget(undefined) }}
          onSaved={handleSaved}
        />
      )}

      {detailTarget && (
        <StyleDetailsModal
          style={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={open => { if (!open) setPendingDeleteId(null) }}
        title="确认删除"
        description="确定删除这个风格吗？此操作不可恢复。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
