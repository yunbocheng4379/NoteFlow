import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { ModelOptionLabel } from '@/components/ModelProviderLogo'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { IProvider } from '@/types'
import { filterModelOptions, getModelKey, type ModelSelectOption } from './modelSelect.utils'

export interface ModelSelectProps {
  models: readonly ModelSelectOption[]
  value: string
  onValueChange: (value: string) => void
  providers?: IProvider[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
}

export function ModelSelect({
  models,
  value,
  onValueChange,
  providers = [],
  placeholder = '请选择模型',
  searchPlaceholder = '搜索模型...',
  emptyText = '没有匹配的模型',
  disabled = false,
  triggerClassName,
  contentClassName,
}: ModelSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const selectedModel = useMemo(
    () => models.find(model => getModelKey(model.provider_id, model.model_name) === value),
    [models, value],
  )
  const filteredModels = useMemo(() => filterModelOptions(models, search), [models, search])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      searchContainerRef.current?.querySelector<HTMLInputElement>('input')?.focus({
        preventScroll: true,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, search])

  useEffect(() => {
    if (value && !models.some(model => getModelKey(model.provider_id, model.model_name) === value)) {
      onValueChange('')
    }
  }, [models, onValueChange, value])

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      onOpenChange={nextOpen => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch('')
      }}
      disabled={disabled}
    >
      <SelectTrigger className={cn('w-full', triggerClassName)}>
        {selectedModel ? (
          <ModelOptionLabel
            providerId={selectedModel.provider_id}
            providerName={selectedModel.provider_name}
            modelName={selectedModel.model_name}
            providers={providers}
          />
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </SelectTrigger>
      <SelectContent className={cn('w-[var(--radix-select-trigger-width)]', contentClassName)}>
        <div
          ref={searchContainerRef}
          className="p-2"
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Enter') event.preventDefault()
            }}
            className="h-8"
          />
        </div>
        {filteredModels.length > 0 ? (
          filteredModels.map(model => {
            const modelKey = getModelKey(model.provider_id, model.model_name)
            return (
              <SelectItem
                key={modelKey}
                value={modelKey}
                className={cn(model.configured && 'pr-24')}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <ModelOptionLabel
                      providerId={model.provider_id}
                      providerName={model.provider_name}
                      modelName={model.model_name}
                      providers={providers}
                    />
                  </span>
                  {model.configured && (
                    <span
                      className="mr-1 inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-[#167a6e]"
                      title="已在系统中配置"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>已配置</span>
                    </span>
                  )}
                </span>
              </SelectItem>
            )
          })
        ) : (
          <div className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</div>
        )}
      </SelectContent>
    </Select>
  )
}
