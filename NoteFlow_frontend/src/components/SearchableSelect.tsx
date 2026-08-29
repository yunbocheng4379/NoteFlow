import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface SearchableSelectOption {
  value: string
  label: string
  description?: string
  searchText?: string
}

interface SearchableSelectProps {
  options: readonly SearchableSelectOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  onClear?: () => void
  triggerClassName?: string
  contentClassName?: string
}

function filterOptions(options: readonly SearchableSelectOption[], search: string) {
  const keywords = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!keywords.length) return options
  return options.filter(option => {
    const haystack = `${option.label} ${option.description || ''} ${option.searchText || ''}`.toLocaleLowerCase()
    return keywords.every(keyword => haystack.includes(keyword))
  })
}

export default function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder = '搜索...',
  emptyText = '没有匹配的选项',
  disabled = false,
  onClear,
  triggerClassName,
  contentClassName,
}: SearchableSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const selectedOption = useMemo(() => options.find(option => option.value === value), [options, value])
  const filteredOptions = useMemo(() => filterOptions(options, search), [options, search])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      searchContainerRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  return (
    <div className="relative w-full">
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      disabled={disabled}
    >
      <SelectTrigger className={cn('w-full rounded-xl border-[#d9ebe6] bg-white px-3 py-2 text-xs shadow-none', value ? '[&>svg]:mr-7' : '', triggerClassName)}>
        <span className={cn('min-w-0 truncate text-left', selectedOption ? 'text-[#34534d]' : 'text-[#b0c1bd')}>
          {selectedOption?.label || value || placeholder}
        </span>
      </SelectTrigger>
      <SelectContent className={cn('w-[var(--radix-select-trigger-width)] rounded-2xl border-[#d9ebe6] bg-white p-1 shadow-[0_12px_32px_rgba(36,52,71,0.14)]', contentClassName)}>
        <div
          ref={searchContainerRef}
          className="p-1"
          onPointerDown={event => event.stopPropagation()}
          onKeyDownCapture={event => event.stopPropagation()}
          onKeyUpCapture={event => event.stopPropagation()}
        >
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Enter') event.preventDefault()
            }}
            onKeyDownCapture={event => event.stopPropagation()}
            onKeyUpCapture={event => event.stopPropagation()}
            className="h-9 rounded-xl border-[#e5efeb] bg-[#f7faf9] text-xs shadow-none focus-visible:ring-[#b9ddd5]"
          />
        </div>
        {filteredOptions.length ? filteredOptions.map(option => (
          <SelectItem key={option.value} value={option.value} className="rounded-xl py-2.5 text-xs text-[#34534d] focus:bg-[#e8f5f2] focus:text-[#167a6e]">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate">{option.label}</span>
              {option.description && <span className="truncate text-[10px] text-[#9ab1ab] group-focus:text-[#5f8e84]">{option.description}</span>}
            </span>
          </SelectItem>
        )) : <div className="px-2 py-4 text-center text-xs text-[#9ab1ab]">{emptyText}</div>}
      </SelectContent>
    </Select>
    {value && <button type="button" aria-label="清除本项筛选" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); (onClear || (() => onValueChange('')))() }} className="absolute right-2 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[#9ab1ab] hover:bg-[#edf6f3] hover:text-[#167a6e]"><X className="h-3.5 w-3.5" /></button>}
    </div>
  )
}
