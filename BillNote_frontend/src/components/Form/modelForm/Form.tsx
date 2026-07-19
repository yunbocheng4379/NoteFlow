import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useParams, useNavigate } from 'react-router-dom'
import { useProviderStore } from '@/store/providerStore'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { testConnection, fetchModels, deleteModelById } from '@/services/model.ts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx' // ⚡新增 fetchModels
import { ModelSelector } from '@/components/Form/modelForm/ModelSelector.tsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx'
import { Tags } from 'lucide-react'
import { X } from 'lucide-react'
import { useModelStore } from '@/store/modelStore'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useUserStore } from '@/store/userStore'

// ✅ Provider表单schema
const ProviderSchema = z.object({
  name: z.string().min(2, '名称不能少于 2 个字符'),
  apiKey: z.string().optional(),
  baseUrl: z.string().url('必须是合法 URL'),
  type: z.string(),
})

type ProviderFormValues = z.infer<typeof ProviderSchema>

// ✅ Model表单schema
const ModelSchema = z.object({
  modelName: z.string().min(1, '请选择或填写模型名称'),
})

type ModelFormValues = z.infer<typeof ModelSchema>
interface IModel {
  id: string
  created: number
  object: string
  owned_by: string
  permission: string
  root: string
}
interface IEnabledModel {
  id: string
  model_name: string
  tier?: 'normal' | 'pro'
}
const ProviderForm = ({ isCreate = false }: { isCreate?: boolean }) => {
  let { id } = useParams()
  const navigate = useNavigate()
  const isEditMode = !isCreate
  const isAdmin = !!useUserStore(state => state.user)?.is_admin

  const getProviderById = useProviderStore(state => state.getProviderById)
  const loadProviderById = useProviderStore(state => state.loadProviderById)
  const updateProvider = useProviderStore(state => state.updateProvider)
  const addNewProvider = useProviderStore(state => state.addNewProvider)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [isBuiltIn, setIsBuiltIn] = useState(false)
  const loadModelsById = useModelStore(state => state.loadModelsById)
  const selectedModel = useModelStore(state => state.selectedModel)
  const [modelOptions, setModelOptions] = useState<IModel[]>([]) // ⚡新增，保存模型列表
  const [models, setModels]= useState<IEnabledModel[]>([])
  const [modelLoading, setModelLoading] = useState(false)
  const updateModelTierInStore = useModelStore(state => state.updateModelTier)
  const [tierUpdatingId, setTierUpdatingId] = useState<string | null>(null)
  const randomColor = ()=>{
    return '#' + Math.floor(Math.random() * 16777215).toString(16)
  }

  const [search, setSearch] = useState('')
  // 待删除模型 id（用卡片式确认弹窗替代原生 window.confirm）
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const providerForm = useForm<ProviderFormValues>({
    resolver: zodResolver(ProviderSchema),
    defaultValues: {
      name: '',
      apiKey: '',
      baseUrl: '',
      type: 'custom',
    },
  })
  const filteredModelOptions = modelOptions.filter(model => {
    const keywords = search.trim().toLowerCase().split(/\s+/) // 支持多个关键词
    const target = model.id.toLowerCase()
    return keywords.every(kw => target.includes(kw))
  })

  const modelForm = useForm<ModelFormValues>({
    resolver: zodResolver(ModelSchema),
    defaultValues: {
      modelName: '',
    },
  })

  useEffect(() => {

    const load = async () => {
      if (isEditMode) {

        const data = await loadProviderById(id!)
        providerForm.reset(data)
        setIsBuiltIn(data.type === 'built-in')
      } else {
        providerForm.reset({
          name: '',
          apiKey: '',
          baseUrl: '',
          type: 'custom',
        })
        setIsBuiltIn(false)
      }
      const models = await loadModelsById(id!)
      if(models){
        console.log('🔧 模型列表:', models)
        setModels(models)

      }
      setLoading(false)
    }
    load()
  }, [id])
  const handelDelete = async () => {
    const modelId = pendingDeleteId
    if (!modelId) return
    setDeleting(true)
    try {
      await deleteModelById(modelId)
      toast.success('删除成功')
      const updated = await loadModelsById(id!)
      if (updated) setModels(updated)
    } catch (e) {
      toast.error('删除异常')
    } finally {
      setDeleting(false)
      setPendingDeleteId(null)
    }
  }
  // 切换模型等级：普通 <-> Pro
  const handleToggleTier = async (model: IEnabledModel) => {
    const nextTier = model.tier === 'pro' ? 'normal' : 'pro'
    setTierUpdatingId(model.id)
    try {
      const ok = await updateModelTierInStore(Number(model.id), nextTier)
      if (ok) {
        setModels(prev =>
          prev.map(m => (m.id === model.id ? { ...m, tier: nextTier } : m)),
        )
        toast.success(nextTier === 'pro' ? '已设为 Pro 模型' : '已设为普通模型')
      } else {
        toast.error('更新模型等级失败')
      }
    } catch (e) {
      toast.error('更新模型等级失败')
    } finally {
      setTierUpdatingId(null)
    }
  }
  // 测试连通性
  const handleTest = async () => {
    const values = providerForm.getValues()
    if (!values.baseUrl) {
      toast.error('请填写 Base URL')
      return
    }
    try {
      if (!id){
        toast.error('请先保存供应商信息')
        return
      }
      setTesting(true)
      const apiKeyToSend = values.apiKey && !values.apiKey.includes('*') ? values.apiKey : undefined
      await testConnection({
        id,
        api_key: apiKeyToSend,
        base_url: values.baseUrl,
        model: selectedModel || undefined,
      })
      toast.success('测试连通性成功 🎉')
    } catch (error) {
      // toast already shown by request interceptor
    } finally {
      setTesting(false)
    }
  }

  // 加载模型列表
  const handleModelLoad = async () => {
    const values = providerForm.getValues()
    if (!values.apiKey || !values.baseUrl) {
      toast.error('请先填写 API Key 和 Base URL')
      return
    }
    try {
      setModelLoading(true) // ✅ 开始 loading
      const res = await fetchModels(id!, { noCache: true }) // 这里稍后解释
      if (res.data.code === 0 && res.data.data.models.data.length > 0) {
        setModelOptions(res.data.data.models.data)
        console.log('🔧 模型列表:', res.data.data)
        toast.success('模型列表加载成功 🎉')
      } else {
        toast.error('未获取到模型列表')
      }
    } catch (error) {
      toast.error('加载模型列表失败')
    } finally {
      setModelLoading(false) // ✅ 结束 loading
    }
  }

  // 保存Provider信息
  const onProviderSubmit = async (values: ProviderFormValues) => {
    if (isEditMode) {
      await updateProvider({ ...values, id: id! })
      toast.success('更新供应商成功')
    } else {
       id = await addNewProvider({ ...values })

      toast.success('新增供应商成功')
    }
    // 刷新页面

  }

  // 保存Model信息
  const onModelSubmit = async (values: ModelFormValues) => {
    toast.success(`保存模型: ${values.modelName}`)
    const updated = await loadModelsById(id!)
    if (updated) setModels(updated)
  }

  if (loading) return <div className="p-4">加载中...</div>

  return (
    <div className="flex flex-col gap-8 p-4">
      {/* Provider信息表单 */}
      <Form {...providerForm}>
        <form
          onSubmit={providerForm.handleSubmit(onProviderSubmit)}
          className="flex max-w-xl flex-col gap-4"
        >
          <div className="text-lg font-bold">
            {isEditMode ? '编辑模型供应商' : '新增模型供应商'}
          </div>
          {!isBuiltIn && (
            <div className="text-sm text-red-500 italic">
              自定义模型供应商需要确保兼容 OpenAI SDK
            </div>
          )}
          <FormField
            control={providerForm.control}
            name="name"
            render={({ field }) => (
              <FormItem className="flex items-center gap-4">
                <FormLabel className="w-24 text-right">名称</FormLabel>
                <FormControl>
                  <Input {...field} disabled={isBuiltIn} className="flex-1" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={providerForm.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem className="flex items-center gap-4">
                <FormLabel className="w-24 text-right">API Key</FormLabel>
                <FormControl>
                  <Input {...field} className="flex-1" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={providerForm.control}
            name="baseUrl"
            render={({ field }) => (
              <FormItem className="flex items-center gap-4">
                <FormLabel className="w-24 text-right">API地址</FormLabel>
                <FormControl>
                  <Input {...field} className="flex-1" />
                </FormControl>
                <Button type="button" onClick={handleTest} variant="ghost" disabled={testing}>
                  {testing ? '测试中...' : '测试连通性'}
                </Button>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={providerForm.control}
            name="type"
            render={({ field }) => (
              <FormItem className="flex items-center gap-4">
                <FormLabel className="w-24 text-right">类型</FormLabel>
                <FormControl>
                  <Input {...field} disabled className="flex-1" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="pt-2">
            <Button type="submit" disabled={!providerForm.formState.isDirty}>
              {isEditMode ? '保存修改' : '保存创建'}
            </Button>
          </div>
        </form>
      </Form>

      {/* 模型信息表单 */}
      <div className="flex max-w-xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="font-bold">模型列表</span>
          <div className={'flex flex-col gap-2 rounded bg-[#FEF0F0] p-2.5'}>
            <h2 className={'font-bold'}>注意!</h2>
            <span>请确保已经保存供应商信息,以及通过测试连通性.</span>
          </div>
          {isAdmin && (
            <ModelSelector providerId={id!} apiKey={providerForm.watch('apiKey')} onSaved={async () => {
              const updated = await loadModelsById(id!)
              if (updated) setModels(updated)
            }} />
          )}

          {/*<datalist id="model-options">*/}
          {/*  {modelOptions.map(model => (*/}
          {/*    <option key={model.id + '1'} value={model.id} />*/}
          {/*  ))}*/}
          {/*</datalist>*/}
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-bold">已启用模型</span>
          <div className={'flex flex-wrap gap-2 rounded  p-2.5'}>
            {
              models && models.map(model => {
                const isPro = model.tier === 'pro'
                return (
                  <span
                    key={model.id}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm ${
                      isPro ? 'bg-amber-100 text-amber-700' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {model.model_name}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleToggleTier(model)}
                        disabled={tierUpdatingId === model.id}
                        className={`rounded px-1 text-xs font-medium ${
                          isPro ? 'bg-amber-200 hover:bg-amber-300' : 'bg-neutral-200 hover:bg-neutral-300'
                        }`}
                        title="点击切换普通/Pro"
                      >
                        {isPro ? 'Pro' : '普通'}
                      </button>
                    )}
                    {!isAdmin && isPro && (
                      <span className="rounded bg-amber-200 px-1 text-xs font-medium">Pro</span>
                    )}
                    {isAdmin && (
                      <button type="button" onClick={() => setPendingDeleteId(model.id)} className="hover:text-primary/70">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>

                )
              })
            }

          </div>
          {/*<ModelSelector providerId={id!} />*/}

          {/*<datalist id="model-options">*/}
          {/*  {modelOptions.map(model => (*/}
          {/*    <option key={model.id + '1'} value={model.id} />*/}
          {/*  ))}*/}
          {/*</datalist>*/}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={open => { if (!open) setPendingDeleteId(null) }}
        title="确认删除"
        description="确定要删除这个模型吗？此操作不可恢复。"
        confirmText="确认删除"
        loading={deleting}
        onConfirm={handelDelete}
      />
    </div>
  )
}

export default ProviderForm
