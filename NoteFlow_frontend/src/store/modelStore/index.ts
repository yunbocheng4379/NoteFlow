import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  fetchModels,
  addModel,
  fetchEnableModels,
  fetchEnableModelById,
  deleteModelById,
  updateModelTier,
  updateModelSupportsReasoning
} from '@/services/model'

interface IModel {
  id: string
  created: number
  object: string
  owned_by: string
  permission: string
  root: string
}

interface IModelListItem {
  id: string
  provider_id: string
  model_name: string
  tier?: 'normal' | 'pro'
  supports_reasoning?: boolean
  supports_vision?: boolean
  created_at?: string
}

interface ModelStore {
  models: IModel[]
  modelList: IModelListItem[]
  loading: boolean
  selectedModel: string

  loadModels: (providerId: string, apiKey?: string) => Promise<void>
  loadModelsById: (providerId: string) => Promise<IModelListItem[]>
  loadEnabledModels: () => Promise<void>
  addNewModel: (
    providerId: string,
    modelId: string,
    tier?: 'normal' | 'pro',
    supportsReasoning?: boolean,
    supportsVision?: boolean,
  ) => Promise<void>
  deleteModel: (modelId: number) => Promise<void>
  updateModelTier: (modelId: number, tier: 'normal' | 'pro') => Promise<boolean>
  updateModelSupportsReasoning: (modelId: number, enabled: boolean) => Promise<boolean>
  setSelectedModel: (modelId: string) => void
  clearModels: () => void
}

export const useModelStore = create<ModelStore>()(
  devtools((set) => ({
    models: [],
    modelList: [],
    loading: false,
    selectedModel: '',

    //  获取所有可用模型 (全局可用模型列表)
    loadEnabledModels: async () => {
      try {
        set({ loading: true })
        const list = await fetchEnableModels()
        set({ modelList: list })
      } catch (error) {
        set({ modelList: [] })
        console.error('加载可用模型失败', error)
      } finally {
        set({ loading: false })
      }
    },

    //  通过 provider 获取该供应商的模型列表
    loadModels: async (providerId: string, apiKey?: string) => {
      try {
        set({ loading: true })
        const res = await fetchModels(providerId, apiKey)

        let models: IModel[] = []

        // 兼容 SyncPage 分页对象与普通数组两种格式
        if (Array.isArray(res.models)) {
          models = res.models
        } else if (res.models?.data && Array.isArray(res.models.data)) {
          models = res.models.data
        }

        set({ models })
      } catch (error) {
        set({ models: [] })
        console.error('加载模型列表失败', error)
      } finally {
        set({ loading: false })
      }
    },

    //  单独获取某个供应商下已启用模型
    loadModelsById: async (providerId: string) => {
      try {
        const models = await fetchEnableModelById(providerId)
        console.log('获取供应商模型成功:', models)
        return models
      } catch (error) {
        console.error('加载供应商模型失败', error)
        return []
      }
    },

    //  新增模型逻辑；请求失败时向上抛出，让调用方决定如何提示用户（避免与全局 toast 拦截器重复提示）
    addNewModel: async (
      providerId: string,
      modelId: string,
      tier: 'normal' | 'pro' = 'normal',
      supportsReasoning = false,
      supportsVision = false,
    ) => {
      await addModel(
        {
          provider_id: providerId,
          model_name: modelId,
          tier,
          supports_reasoning: supportsReasoning,
          supports_vision: supportsVision,
        },
        { silent: true },
      )
      // “选择模型”下拉列表里的 models 来自供应商原始模型列表（fetchModels），本身已经包含这条模型，
      // 保存（无论新增还是修改已有模型）时不应该再重复塞一条，否则会在刷新前看到一个重复项
      set((state) =>
        state.models.some((m) => m.id === modelId)
          ? state
          : {
              models: [
                ...state.models,
                {
                  id: modelId,
                  created: Date.now(),
                  object: 'model',
                  owned_by: '',
                  permission: '',
                  root: '',
                },
              ],
            },
      )
    },

    //  删除模型
    deleteModel: async (modelId: number) => {
      try {
        await deleteModelById(modelId)
        //  删除后更新本地状态（可选）
        set((state) => ({
          models: state.models.filter((model) => model.id !== modelId.toString())
        }))
      } catch (error) {
        console.error('删除模型失败', error)
      }
    },

    //  更新模型等级 (普通/Pro)
    updateModelTier: async (modelId: number, tier: 'normal' | 'pro') => {
      try {
        const res = await updateModelTier(modelId, tier)
        return res.code === 0
      } catch (error) {
        console.error('更新模型等级失败', error)
        return false
      }
    },

    //  更新模型是否支持深度思考
    updateModelSupportsReasoning: async (modelId: number, enabled: boolean) => {
      try {
        const res = await updateModelSupportsReasoning(modelId, enabled)
        return res.code === 0
      } catch (error) {
        console.error('更新深度思考支持状态失败', error)
        return false
      }
    },

    //  切换选中模型
    setSelectedModel: (modelId: string) => set({ selectedModel: modelId }),

    //  清空
    clearModels: () => set({ models: [], selectedModel: '', modelList: [] }),
  }))
)