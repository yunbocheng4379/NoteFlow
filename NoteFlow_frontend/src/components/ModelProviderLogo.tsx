import type React from 'react'
import Anthropic from '@lobehub/icons/es/Anthropic'
import Azure from '@lobehub/icons/es/Azure'
import AzureAI from '@lobehub/icons/es/AzureAI'
import DeepSeek from '@lobehub/icons/es/DeepSeek'
import Gemini from '@lobehub/icons/es/Gemini'
import Groq from '@lobehub/icons/es/Groq'
import Minimax from '@lobehub/icons/es/Minimax'
import Moonshot from '@lobehub/icons/es/Moonshot'
import Ollama from '@lobehub/icons/es/Ollama'
import OpenAI from '@lobehub/icons/es/OpenAI'
import OpenRouter from '@lobehub/icons/es/OpenRouter'
import Qwen from '@lobehub/icons/es/Qwen'
import Zhipu from '@lobehub/icons/es/Zhipu'
import CustomLogo from '@/assets/customAI.png'
import type { IProvider } from '@/types'
import { cn } from '@/lib/utils'

const LOGO_MAP = {
  Anthropic,
  Azure,
  AzureAI,
  DeepSeek,
  Gemini,
  Groq,
  Minimax,
  Moonshot,
  Ollama,
  OpenAI,
  OpenRouter,
  Qwen,
  Zhipu,
}

const inferLogoName = (modelName?: string, providerId?: string) => {
  const text = `${providerId || ''} ${modelName || ''}`.toLowerCase()
  if (text.includes('deepseek')) return 'DeepSeek'
  if (
    text.includes('openai') ||
    text.includes('gpt-') ||
    text.includes('gpt4') ||
    text.includes('o1') ||
    text.includes('o3')
  ) {
    return 'OpenAI'
  }
  if (text.includes('claude') || text.includes('anthropic')) return 'Anthropic'
  if (text.includes('gemini') || text.includes('google')) return 'Gemini'
  if (text.includes('qwen') || text.includes('tongyi') || text.includes('aliyun')) return 'Qwen'
  if (text.includes('kimi') || text.includes('moonshot')) return 'Moonshot'
  if (text.includes('glm') || text.includes('zhipu')) return 'Zhipu'
  if (text.includes('minimax')) return 'Minimax'
  if (text.includes('openrouter')) return 'OpenRouter'
  if (text.includes('azure')) return 'AzureAI'
  if (text.includes('ollama')) return 'Ollama'
  if (text.includes('groq')) return 'Groq'
  return 'custom'
}

const normalizeLogoName = (logoName?: string) => {
  if (!logoName || logoName === 'custom') return 'custom'
  const matched = Object.keys(LOGO_MAP).find(k => k.toLowerCase() === logoName.toLowerCase())
  return matched || logoName
}

export function getModelProviderLogoName(
  providerId?: string,
  modelName?: string,
  providers: IProvider[] = []
) {
  const provider = providers.find(p => p.id === providerId)
  return normalizeLogoName(provider?.logo || inferLogoName(modelName, providerId))
}

export function ModelProviderLogo({
  providerId,
  modelName,
  providers = [],
  size = 18,
  className,
}: {
  providerId?: string
  modelName?: string
  providers?: IProvider[]
  size?: number
  className?: string
}) {
  const logoName = getModelProviderLogoName(providerId, modelName, providers)
  const Icon = LOGO_MAP[logoName as keyof typeof LOGO_MAP] as
    | (React.ComponentType<{ size?: number }> & {
        Color?: React.ComponentType<{ size?: number }>
      })
    | undefined
  // @lobehub/icons 里 Anthropic / OpenAI / Ollama / Groq / Moonshot / OpenRouter 这些
  // 单色图标默认导出没有 .Color 子组件；直接用默认导出（Mono）渲染即可，避免 undefined 崩溃。
  const ColorIcon = Icon?.Color ?? Icon

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white',
        className
      )}
      style={{ width: size, height: size }}
    >
      {ColorIcon ? (
        <ColorIcon size={size} />
      ) : (
        <img src={CustomLogo} alt="" className="h-full w-full object-contain" />
      )}
    </span>
  )
}

export function ModelOptionLabel({
  providerId,
  modelName,
  providers = [],
  size = 18,
  className,
}: {
  providerId?: string
  modelName: string
  providers?: IProvider[]
  size?: number
  className?: string
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <ModelProviderLogo
        providerId={providerId}
        modelName={modelName}
        providers={providers}
        size={size}
      />
      <span className="truncate">{modelName}</span>
    </span>
  )
}
