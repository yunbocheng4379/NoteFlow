import { useEffect, useMemo, useState } from 'react'
import {
  Users,
  Search,
  Plus,
  Trash2,
  Loader2,
  Zap,
  Crown,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  adminApi,
  AdminUser,
  AdminUserList,
  CreateUserPayload,
} from '@/services/admin'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useUserStore } from '@/store/userStore'

const PAGE_SIZE = 20

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function UserManagement() {
  const currentUser = useUserStore((s) => s.user)
  const [data, setData] = useState<AdminUserList | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // 新增弹窗
  const [createOpen, setCreateOpen] = useState(false)

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    adminApi
      .listUsers(page, PAGE_SIZE, search)
      .then((res) => {
        setData(res)
        setSelected(new Set()) // 翻页/搜索后清空选择
      })
      .catch(() => toast.error('获取用户列表失败'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  // 可选择的行 (排除自己与其他管理员, 他们不能被删)
  const selectableIds = useMemo(
    () =>
      (data?.list ?? [])
        .filter((u) => u.id !== currentUser?.id && !u.is_admin)
        .map((u) => u.id),
    [data, currentUser],
  )

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectableIds))
    }
  }

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSearch = () => {
    setPage(1)
    setSearch(keyword.trim())
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await adminApi.deleteUser(deleteTarget.id)
      toast.success('已停用该用户')
      setDeleteTarget(null)
      load()
    } catch {
      // interceptor toast
    } finally {
      setDeleting(false)
    }
  }

  const doBatchDelete = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setDeleting(true)
    try {
      const res = await adminApi.batchDeleteUsers(ids)
      const skipped = res.skipped?.length ?? 0
      toast.success(
        skipped > 0
          ? `已停用 ${res.deleted} 个用户，跳过 ${skipped} 个（管理员/自身）`
          : `已停用 ${res.deleted} 个用户`,
      )
      setBatchDeleteOpen(false)
      load()
    } catch {
      // interceptor toast
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-neutral-50">
      <div className="mx-auto w-full max-w-6xl shrink-0 px-6 pt-6">
        {/* 标题 */}
        <div className="mb-6 flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-neutral-900">用户管理</h1>
          {data && (
            <span className="ml-2 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
              共 {data.total} 人
            </span>
          )}
        </div>

        {/* 工具栏 */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索用户名 / 邮箱"
              className="h-9 w-64 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <Button size="sm" variant="outline" onClick={handleSearch}>
            搜索
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setBatchDeleteOpen(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                批量停用 ({selected.size})
              </Button>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              新增用户
            </Button>
          </div>
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 pb-6">
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          {loading && !data ? (
            <div className="flex items-center justify-center py-16 text-sm text-neutral-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : !data || data.list.length === 0 ? (
            <div className="py-16 text-center text-sm text-neutral-500">暂无用户</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50">
                <tr className="text-left text-xs text-neutral-500">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={selectableIds.length === 0}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">用户</th>
                  <th className="px-4 py-3 font-medium">会员</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">会员到期</th>
                  <th className="px-4 py-3 text-right font-medium">剩余电力</th>
                  <th className="px-4 py-3 text-right font-medium">累计消耗</th>
                  <th className="px-4 py-3 text-right font-medium">累计充值</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">注册时间</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((u) => {
                  const isSelf = u.id === currentUser?.id
                  const protectedRow = isSelf || !!u.is_admin
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggleOne(u.id)}
                          disabled={protectedRow}
                          className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                          {u.username}
                          {!!u.is_admin && (
                            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-label="管理员" />
                          )}
                        </div>
                        <div className="text-xs text-neutral-400">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {u.is_member ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 ring-1 ring-amber-200">
                            <Crown className="h-3 w-3" />
                            {u.subscription?.plan_name || '会员'}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">免费</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                        {u.is_member && u.subscription ? (
                          <span
                            className={
                              u.subscription.days_left <= 7 ? 'font-medium text-amber-600' : ''
                            }
                          >
                            {fmtDate(u.subscription.end_at)}
                            <span className="ml-1 text-neutral-400">
                              (剩 {u.subscription.days_left} 天)
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-neutral-800">
                        <Zap className="mr-0.5 inline h-3 w-3 fill-yellow-400 text-yellow-500" />
                        {u.credits}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-red-500">
                        {u.total_consumed}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">
                        {u.total_recharged}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {fmtDate(u.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {u.is_active ? (
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600 ring-1 ring-emerald-200">
                            正常
                          </span>
                        ) : (
                          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 ring-1 ring-neutral-200">
                            已停用
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setDeleteTarget(u)}
                          disabled={protectedRow || !u.is_active}
                          title={
                            isSelf
                              ? '不能停用自己'
                              : u.is_admin
                                ? '不能停用管理员'
                                : !u.is_active
                                  ? '已停用'
                                  : '停用用户'
                          }
                          className="inline-flex items-center rounded p-1.5 text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* 分页 */}
          {data && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
              <span>
                共 {data.total} 条 · 第 {page} / {totalPages} 页
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 新增用户弹窗 */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
          setPage(1)
          load()
        }}
      />

      {/* 单个停用确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="停用用户"
        description={
          <>
            确定停用用户 <b>{deleteTarget?.username}</b> 吗？停用后该用户将无法登录，
            但其电力流水与订单记录会保留。
          </>
        }
        confirmText="停用"
        loading={deleting}
        onConfirm={doDelete}
      />

      {/* 批量停用确认 */}
      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={(o) => !o && setBatchDeleteOpen(false)}
        title="批量停用"
        description={
          <>
            确定停用选中的 <b>{selected.size}</b> 个用户吗？管理员与您自己的账号会被自动跳过。
          </>
        }
        confirmText="批量停用"
        loading={deleting}
        onConfirm={doBatchDelete}
      />
    </div>
  )
}

// ============================================================================
// 新增用户弹窗
// ============================================================================
function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<CreateUserPayload>({
    username: '',
    email: '',
    password: '',
    is_admin: false,
    initial_credits: 0,
  })
  const [submitting, setSubmitting] = useState(false)

  // 打开时重置表单
  useEffect(() => {
    if (open) {
      setForm({ username: '', email: '', password: '', is_admin: false, initial_credits: 0 })
    }
  }, [open])

  const submit = async () => {
    if (form.username.trim().length < 3) return toast.error('用户名至少 3 位')
    if (!form.email.includes('@')) return toast.error('请输入有效邮箱')
    if (form.password.length < 6) return toast.error('密码至少 6 位')

    setSubmitting(true)
    try {
      await adminApi.createUser({
        ...form,
        username: form.username.trim(),
        email: form.email.trim(),
        initial_credits: Number(form.initial_credits) || 0,
      })
      toast.success('用户创建成功')
      onCreated()
    } catch (e: any) {
      toast.error(e?.msg || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>新增用户</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Field label="用户名">
            <input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="3~32 字符"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </Field>
          <Field label="邮箱">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="user@example.com"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </Field>
          <Field label="密码">
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="至少 6 位"
              autoComplete="new-password"
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </Field>
          <Field label="初始电力">
            <input
              type="number"
              min={0}
              value={form.initial_credits}
              onChange={(e) => setForm((f) => ({ ...f, initial_credits: Number(e.target.value) }))}
              className="h-9 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
              className="h-4 w-4 accent-primary"
            />
            设为管理员
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={submitting} onClick={submit}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
      <label className="text-sm text-neutral-500">{label}</label>
      {children}
    </div>
  )
}
