export interface ModelSelectOption {
  provider_id: string
  model_name: string
  provider_name?: string
}

export const MODEL_KEY_SEPARATOR = '\u0000'

export const getModelKey = (providerId: string, modelName: string) =>
  `${providerId}${MODEL_KEY_SEPARATOR}${modelName}`

export const filterModelOptions = <T extends ModelSelectOption>(
  models: readonly T[],
  query: string,
) => {
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (keywords.length === 0) return [...models]

  return models.filter(model => {
    const target = `${model.provider_id} ${model.provider_name ?? ''} ${model.model_name}`.toLowerCase()
    return keywords.every(keyword => target.includes(keyword))
  })
}
