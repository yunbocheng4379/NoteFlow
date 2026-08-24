# 统一模型选择器设计

## 背景

当前前端的模型选择入口实现不一致：后台 AI 模型设置已经有搜索和厂商 Logo，生成笔记使用自定义 Portal 下拉，其他功能使用普通 Select，部分入口还只用 `model_name` 作为值，无法可靠区分不同厂商的同名模型。

## 目标

- 抽出通用 `ModelSelect` 组件。
- 下拉列表支持关键词搜索。
- 每个模型展示厂商 Logo和模型名称。
- 选择值使用 `provider_id + model_name` 的复合 key，避免同名模型冲突。
- 后台 AI 模型设置保留拉取模型、保存模型、等级和能力配置等业务逻辑，只复用选择 UI。
- 统一替换已查到的交互式模型选择入口：生成笔记、笔记风格安全检测、闪记卡生成、合集融合、知识库问答和后台模型设置。

## 设计

### 通用组件

新建 `src/components/ModelSelect.tsx`，组件接收模型选项、复合选中值、选择回调、供应商列表、占位文案和尺寸样式。内部负责过滤搜索、Radix Select 展开/关闭、空结果提示和 `ModelOptionLabel` 渲染；不负责加载模型、保存模型或转换业务请求。

复合 key 使用不可见分隔符拼接：

```ts
getModelKey(providerId, modelName) => `${providerId}\u0000${modelName}`
```

调用方通过 key 在自己的模型列表中查找完整对象，再按原接口发送字段。

### 业务接入

- 生成笔记：移除现有自定义 Portal 下拉和相关开关/定位逻辑，表单仍保存 `model_name`，同时根据 ModelSelect 选中的完整模型计算 `provider_id`。
- 安全检测：直接使用配置接口返回的模型选项，保留现有保存逻辑。
- 闪记卡、合集融合、知识库：改用复合 key 保存本地选择，提交时查找完整模型对象。
- 后台模型设置：保留单供应商模型拉取和 `addNewModel` 调用，将原 Select + 搜索框替换为 ModelSelect；其他等级、推理、视觉能力 Select 不变。

## 测试与验证

- 添加纯函数 contract，覆盖复合 key 的构造、同名模型区分和搜索过滤。
- 运行通用组件及所有改动文件的 ESLint。
- 运行 contract、TypeScript 辅助检查和前端生产构建。
- 用 `git diff --check` 检查格式，并确认不修改后端协议。
