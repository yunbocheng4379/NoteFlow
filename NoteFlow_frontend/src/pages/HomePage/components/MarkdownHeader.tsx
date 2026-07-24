'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Download, BrainCircuit, MessageSquare, ChevronDown, FileText, FileCode, FileType, Image, Globe, RefreshCw, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { ExportFormat } from '@/services/export'

interface VersionNote {
  ver_id: string
  model_name?: string
  style?: string
  created_at?: string
}

interface NoteHeaderProps {
  currentTask?: {
    markdown: VersionNote[] | string
  }
  isMultiVersion: boolean
  currentVerId: string
  setCurrentVerId: (id: string) => void
  modelName: string
  style: string
  noteStyles: { value: string; label: string }[]
  onCopy: () => void
  onDownload: (format: ExportFormat) => void
  createAt?: string | Date
  showTranscribe?: boolean
  setShowTranscribe: (show: boolean) => void
  showChat?: false | 'half' | 'full'
  setShowChat?: (mode: false | 'half' | 'full') => void
  viewMode?: 'map' | 'preview'
  setViewMode?: (mode: 'map' | 'preview') => void
  onRegenerate?: () => void
  isEditing?: boolean
  isSaving?: boolean
  onStartEdit?: () => void
  onSaveEdit?: () => void
  onCancelEdit?: () => void
}

const EXPORT_FORMATS: { format: ExportFormat; label: string; icon: React.ReactNode; desc: string }[] = [
  { format: 'md',   label: 'Markdown',  icon: <FileCode  className="h-4 w-4" />, desc: '.md 文件' },
  { format: 'pdf',  label: 'PDF',       icon: <FileText  className="h-4 w-4" />, desc: '.pdf 文档' },
  { format: 'docx', label: 'Word',      icon: <FileType  className="h-4 w-4" />, desc: '.docx 文件' },
  { format: 'html', label: 'HTML',      icon: <Globe     className="h-4 w-4" />, desc: '.html 网页' },
  { format: 'png',  label: '图片',      icon: <Image     className="h-4 w-4" />, desc: '.png 图片' },
]

export function MarkdownHeader({
  currentTask,
  isMultiVersion,
  currentVerId,
  setCurrentVerId,
  modelName,
  style,
  noteStyles,
  onCopy,
  onDownload,
  createAt,
  showTranscribe,
  setShowTranscribe,
  showChat,
  setShowChat,
  viewMode,
  setViewMode,
  onRegenerate,
  isEditing,
  isSaving,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: NoteHeaderProps) {
  const [copied, setCopied] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (copied) {
      timer = setTimeout(() => setCopied(false), 2000)
    }
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleCopy = () => {
    onCopy()
    setCopied(true)
  }

  const styleName = noteStyles.find(v => v.value === style)?.label || style

  const reversedMarkdown: VersionNote[] = Array.isArray(currentTask?.markdown)
    ? [...currentTask!.markdown].reverse()
    : []

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return ''
    return d
      .toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(/\//g, '-')
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur-sm">
      {/* 左侧区域：版本 + 标签 + 创建时间 */}
      <div className="flex flex-wrap items-center gap-3">
        {isMultiVersion && (
          <Select value={currentVerId} onValueChange={setCurrentVerId}>
            <SelectTrigger className="h-8 w-[160px] text-sm">
              <div className="flex items-center">
                {(() => {
                  const currentVersion = currentTask?.markdown.find(v => v.ver_id === currentVerId)
                  if (!currentVersion) return ''
                  // 如果版本ID是 v1.0 格式，直接显示；否则显示后6位
                  const versionLabel = currentVersion.ver_id.match(/^v\d+\.\d+$/)
                    ? currentVersion.ver_id
                    : currentVersion.ver_id.slice(-6)
                  return `版本（${versionLabel}）`
                })()}
              </div>
            </SelectTrigger>

            <SelectContent>
              {(currentTask?.markdown || []).map((v, idx) => {
                // 如果版本ID是 v1.0 格式，直接显示；否则显示后6位
                const versionLabel = v.ver_id.match(/^v\d+\.\d+$/)
                  ? v.ver_id
                  : v.ver_id.slice(-6)
                return (
                  <SelectItem key={v.ver_id} value={v.ver_id}>
                    {`版本（${versionLabel}）`}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}

        <Badge variant="secondary" className="bg-pink-100 text-pink-700 hover:bg-pink-200">
          {modelName}
        </Badge>
        <Badge variant="secondary" className="bg-cyan-100 text-cyan-700 hover:bg-cyan-200">
          {styleName}
        </Badge>

        {createAt && (
          <div className="text-muted-foreground text-sm">创建时间: {formatDate(createAt)}</div>
        )}
      </div>

      {/* 右侧操作按钮 */}
      <div className="flex items-center gap-1">
        {isEditing ? (
          <>
            <Button
              onClick={onSaveEdit}
              disabled={isSaving}
              variant="ghost"
              size="sm"
              className="h-8 px-2 font-normal text-primary"
            >
              <Check className="mr-1.5 h-4 w-4" />
              <span className="text-sm">{isSaving ? '保存中…' : '保存'}</span>
            </Button>
            <Button
              onClick={onCancelEdit}
              disabled={isSaving}
              variant="ghost"
              size="sm"
              className="h-8 px-2 font-normal"
            >
              <X className="mr-1.5 h-4 w-4" />
              <span className="text-sm">取消</span>
            </Button>
          </>
        ) : (
          <>
            {onStartEdit && viewMode === 'preview' && (
              <Button
                onClick={onStartEdit}
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-normal"
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                <span className="text-sm">编辑</span>
              </Button>
            )}

            <Button
              onClick={() => {
                setViewMode?.(viewMode === 'preview' ? 'map' : 'preview')
              }}
              variant="ghost"
              size="sm"
              className="h-8 px-2 font-normal"
            >
              <BrainCircuit className="mr-1.5 h-4 w-4" />
              <span className="text-sm">{viewMode === 'preview' ? '思维导图' : 'markdown'}</span>
            </Button>

            <Button onClick={handleCopy} variant="ghost" size="sm" className="h-8 px-2 font-normal">
              <Copy className="mr-1.5 h-4 w-4" />
              <span className="text-sm">{copied ? '已复制' : '复制'}</span>
            </Button>

            {/* 导出下拉菜单 */}
            <div ref={exportRef} className="relative">
              <Button
                onClick={() => setShowExportMenu(v => !v)}
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-normal"
              >
                <Download className="mr-1.5 h-4 w-4" />
                <span className="text-sm">导出</span>
                <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
              </Button>

              {showExportMenu && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
                  {EXPORT_FORMATS.map(({ format, label, icon, desc }) => (
                    <button
                      key={format}
                      onClick={() => {
                        setShowExportMenu(false)
                        onDownload(format)
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
                    >
                      <span className="text-neutral-500">{icon}</span>
                      <span className="flex-1">
                        <span className="block text-sm font-normal text-gray-800">{label}</span>
                        <span className="block text-xs text-neutral-400">{desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={() => {
                setShowTranscribe(!showTranscribe)
                if (!showTranscribe) setShowChat?.(false)
              }}
              variant="ghost"
              size="sm"
              className={`h-8 px-2 font-normal ${showTranscribe ? 'text-primary' : ''}`}
            >
              <span className="text-sm">原文参照</span>
            </Button>

            {setShowChat && (
              <Button
                onClick={() => {
                  const next = showChat ? false : 'half'
                  setShowChat(next)
                  if (next) setShowTranscribe(false)
                }}
                variant="ghost"
                size="sm"
                className={`h-8 px-2 font-normal ${showChat ? 'text-primary' : ''}`}
              >
                <MessageSquare className="mr-1.5 h-4 w-4" />
                <span className="text-sm">AI 问答</span>
              </Button>
            )}

            {onRegenerate && (
              <Button
                onClick={onRegenerate}
                variant="ghost"
                size="sm"
                className="h-8 px-2 font-normal"
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                <span className="text-sm">重新生成</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
