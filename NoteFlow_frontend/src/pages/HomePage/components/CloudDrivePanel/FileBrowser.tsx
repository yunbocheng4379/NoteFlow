import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronRight, Folder, Home, Loader2, Video } from 'lucide-react'

import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { generateFromCloud, listCloudFiles, CloudFile, CloudPlatform } from '@/services/cloudDrive.ts'
import { useModelStore } from '@/store/modelStore'
import { useNoteStyleStore } from '@/store/noteStyleStore'
import { useTaskStore } from '@/store/taskStore'

const formatSize = (bytes: number): string => {
  if (!bytes) return ''
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

interface FileBrowserProps {
  platform: CloudPlatform
  onSubmitSuccess?: (taskIds: string[]) => void
}

const FileBrowser = ({ platform, onSubmitSuccess }: FileBrowserProps) => {
  const [currentPath, setCurrentPath] = useState<string>('/')
  const [files, setFiles] = useState<CloudFile[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [selectedFsIds, setSelectedFsIds] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const currentReqRef = useRef<number>(0)

  const { modelList } = useModelStore()
  const { styles: noteStyles } = useNoteStyleStore()
  const { addPendingTask } = useTaskStore()

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true)
      const seq = ++currentReqRef.current
      try {
        const result = await listCloudFiles(platform, path)
        if (seq !== currentReqRef.current) return
        setFiles(result.files)
      } catch (e: any) {
        if (seq !== currentReqRef.current) return
        toast.error(e?.message || '列文件失败')
        setFiles([])
      } finally {
        if (seq === currentReqRef.current) setLoading(false)
      }
    },
    [platform],
  )

  useEffect(() => {
    loadDir(currentPath)
    setSelectedFsIds(new Set())
    setFilter('')
  }, [currentPath, loadDir])

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    const crumbs = [{ label: '根目录', path: '/' }]
    parts.reduce((prev, p) => {
      const path = `${prev === '/' ? '' : prev}/${p}`
      crumbs.push({ label: p, path })
      return path
    }, '/')
    return crumbs
  }, [currentPath])

  const filteredFiles = useMemo(() => {
    if (!filter.trim()) return files
    const k = filter.trim().toLowerCase()
    return files.filter(f => f.name.toLowerCase().includes(k))
  }, [files, filter])

  const toggleSelect = (fs_id: number) => {
    setSelectedFsIds(prev => {
      const next = new Set(prev)
      if (next.has(fs_id)) next.delete(fs_id)
      else next.add(fs_id)
      return next
    })
  }

  const handleSubmit = async () => {
    const selected = files.filter(f => selectedFsIds.has(f.fs_id) && !f.is_dir)
    if (!selected.length) {
      toast.error('请选择至少一个视频')
      return
    }
    if (!modelList.length) {
      toast.error('请先在设置里配置至少一个模型')
      return
    }
    const model = modelList[0]
    const style = noteStyles[0]?.value || 'minimal'

    setSubmitting(true)
    try {
      const result = await generateFromCloud({
        platform,
        files: selected.map(f => ({ fs_id: f.fs_id, path: f.path, name: f.name })),
        model_name: model.model_name,
        provider_id: model.provider_id,
        quality: 'medium',
        format: [],
        style,
      })
      if (result.task_ids.length) {
        toast.success(`已提交 ${result.task_ids.length} 个任务`)
        result.task_ids.forEach(tid => {
          const f = selected[0]
          addPendingTask(
            tid,
            platform,
            {
              video_url: `cloud://${platform}/${f.fs_id}`,
              platform,
              model_name: model.model_name,
              provider_id: model.provider_id,
              quality: 'medium',
              style,
              format: [],
            } as any,
            undefined,
          )
        })
        onSubmitSuccess?.(result.task_ids)
        setSelectedFsIds(new Set())
      }
      if (result.errors.length) {
        result.errors.forEach(err =>
          toast.error(`${err.file}: ${err.msg}`, { duration: 5000 }),
        )
      }
    } catch (e: any) {
      toast.error(e?.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedCount = Array.from(selectedFsIds).filter(id =>
    files.some(f => f.fs_id === id && !f.is_dir),
  ).length

  return (
    <div className="space-y-3">
      {/* 面包屑 */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {breadcrumbs.map((c, i) => (
          <div key={c.path} className="flex items-center gap-1">
            {i === 0 ? (
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1 hover:bg-neutral-100"
                onClick={() => setCurrentPath('/')}
              >
                <Home className="h-3 w-3" />
                {c.label}
              </button>
            ) : (
              <button
                type="button"
                className="rounded px-1 hover:bg-neutral-100"
                onClick={() => setCurrentPath(c.path)}
              >
                {c.label}
              </button>
            )}
            {i < breadcrumbs.length - 1 && (
              <ChevronRight className="h-3 w-3 text-neutral-400" />
            )}
          </div>
        ))}
      </div>

      {/* 搜索框 */}
      <Input
        placeholder="过滤当前目录..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

      {/* 文件列表 */}
      <div className="max-h-[360px] overflow-y-auto rounded-md border border-neutral-200">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-neutral-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-neutral-400">
            {filter ? '没有匹配的文件' : '此目录下没有视频文件或子文件夹'}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {filteredFiles.map(f => (
              <li
                key={f.fs_id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-neutral-50"
                onClick={() => (f.is_dir ? setCurrentPath(f.path) : toggleSelect(f.fs_id))}
              >
                {!f.is_dir && (
                  <input
                    type="checkbox"
                    checked={selectedFsIds.has(f.fs_id)}
                    onChange={() => toggleSelect(f.fs_id)}
                    onClick={e => e.stopPropagation()}
                    className="h-4 w-4"
                  />
                )}
                {f.is_dir ? (
                  <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                ) : (
                  <Video className="h-4 w-4 shrink-0 text-neutral-400" />
                )}
                <span className="flex-1 truncate text-sm">{f.name}</span>
                {!f.is_dir && (
                  <span className="text-xs text-neutral-400">{formatSize(f.size)}</span>
                )}
                {f.is_dir && <ChevronRight className="h-4 w-4 text-neutral-300" />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-500">
          {selectedCount > 0 ? `已选 ${selectedCount} 个文件` : '勾选文件后生成笔记'}
        </span>
        <Button onClick={handleSubmit} disabled={submitting || selectedCount === 0}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          生成笔记 {selectedCount > 0 ? `(${selectedCount})` : ''}
        </Button>
      </div>
    </div>
  )
}

export default FileBrowser
