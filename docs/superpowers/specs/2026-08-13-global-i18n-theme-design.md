# 全局语言与主题切换设计

## 目标

为 NoteFlow 前端提供覆盖整个系统的语言和主题偏好能力：

- 语言：English、简体中文、繁體中文、日本語、한국어。
- 主题：浅色、深色、跟随系统。
- 页面组件只保留一套，通过翻译 key 和主题 token 渲染不同状态。
- 用户选择持久化，刷新页面和重新进入应用后保持不变。

本次工作只覆盖前端 UI 与偏好管理，不改变后端 API 协议。AI 笔记内容语言不在本期范围内，避免把界面语言和生成内容语言混为一谈。

## 现状与约束

- 项目是 React 19 + Vite + TypeScript + Tailwind CSS + Zustand。
- `next-themes` 已在依赖中，但目前未作为全局主题提供者使用。
- `LandingPage` 有独立的 `landingPrefsStore`，只支持 `dark/light` 和 `zh/en`；主应用没有统一的国际化入口。
- 全局 CSS 已支持 `.dark` 变体和 CSS 变量，因此主题切换应尽量复用现有变量体系。
- 当前工作区包含未提交的搜索/下载相关改动；实现时只修改本需求相关文件，保留这些现有改动。

## 方案

### 国际化

采用 `i18next + react-i18next`，新增一个全局 i18n 初始化模块和五组 JSON 资源文件。应用入口使用 `I18nextProvider` 或初始化后的单例，页面通过 `useTranslation()` 获取 `t()`：

```tsx
const { t } = useTranslation()
return <h1>{t('settings.title')}</h1>
```

翻译资源按功能域组织，例如 `common`、`navigation`、`home`、`settings`、`auth`、`tasks`、`knowledgeBase`、`dialogs`。key 使用稳定的语义名称，不以中文原文作为 key。语言选择值采用 BCP 47 风格：`en`、`zh-CN`、`zh-TW`、`ja`、`ko`。

优先迁移用户会直接看到、且在主要流程中的固定文案：全局导航、首页输入/任务状态、设置菜单、登录/注册、任务/知识库页面、常用对话框与通知。无法一次覆盖的长尾硬编码文案应保留可追踪清单，不能伪装成已完成翻译。开发环境在缺失 key 时使用简体中文作为 fallback，并在控制台给出 i18next 的缺失提示。

语言变更立即生效，不刷新页面；`document.documentElement.lang` 同步更新。浏览器初次访问没有保存偏好时使用已确认的默认值简体中文；不根据浏览器语言自动改变默认语言。

### 主题

以 `next-themes` 的 `ThemeProvider` 为全局主题上下文，`attribute="class"`、`defaultTheme="dark"`、`enableSystem` 开启三态：`light`、`dark`、`system`。偏好保存在 `localStorage`，首次使用默认深色以保持现有产品行为。

全局主题选择器通过 `useTheme()` 设置 theme；显示值使用太阳、月亮和电脑图标。`system` 状态交给 `next-themes` 根据 `prefers-color-scheme` 解析，并在系统主题变更时自动更新实际 class。所有新样式使用现有 CSS 变量或 Tailwind 的 `dark:` 变体，避免组件各自读取 `matchMedia`。

### 统一设置入口

新增全局 `AppearanceLanguageSwitcher`（名称可在实现阶段按项目约定调整），放在主布局可见的公共导航/设置入口；Landing 页面复用同一组件。语言菜单包含五个选项，主题菜单包含浅色、深色、跟随系统。选择器的当前状态有清晰文字和图标，菜单在窄屏下不溢出，保留 Radix Select 的焦点管理和 Escape 关闭行为。

`landingPrefsStore` 不再作为语言和主题的事实来源。为兼容已经存在的本地存储，初始化时可读取旧值：`zh` 映射为 `zh-CN`，`en` 保持 `en`，`dark/light` 保持对应主题；迁移完成后由全局 i18n/next-themes 负责后续读写。不得让两个 store 同时覆盖 `document.documentElement.className`。

## 组件与数据流

```text
用户选择语言 ──> i18n.changeLanguage ──> React 文案重新渲染
       │                 └──────────────> html[lang] 更新
       └──────────────> localStorage 持久化

用户选择主题 ──> next-themes.setTheme ──> html.dark/class 更新
       │                 └──────────────> CSS variables + dark: 样式生效
       └──────────────> localStorage 持久化
```

入口层负责初始化两个 Provider；偏好选择器只负责展示当前值和调用 setter；业务页面只消费翻译 hook、theme hook 和 CSS token，不直接操作 localStorage 或 `document.documentElement.classList`。

## 视觉与交互

参考用户提供的截图，采用紧凑的深色面板风格：

- 触发器保留图标 + 当前状态文字，菜单靠右对齐，宽度足以容纳五种语言。
- 当前选项使用项目主色的低饱和背景或边框强调，不使用大面积高饱和色块，确保长语言名称仍易读。
- 主题的三项使用对应图标：太阳、月亮、电脑；“跟随系统”明确表达它不是当前实际主题，而是一个偏好模式。
- 文案切换不改变页面结构；较长的德语等语言虽不在本期范围，也不应让组件依赖固定宽度。
- 具有可见的 `focus-visible` 状态；尊重 `prefers-reduced-motion`，主题切换不强制加入复杂动画。

## 错误处理与兼容性

- 翻译 key 缺失时回退到简体中文；参数插值缺失应显式显示 key/默认值，便于开发发现问题。
- 本地存储内容损坏或值不在受支持枚举内时回退到默认值，不阻塞应用启动。
- `system` 在不支持 `matchMedia` 的测试环境中回退为深色 class 行为，不让 SSR/测试初始化崩溃。
- 语言切换不重载页面、不丢失当前表单输入和任务状态。
- 不引入 RTL 适配；本期五种语言均按 LTR 布局处理。

## 测试与验收

### 单元/组件测试

- 语言选择器列出五种语言，选择后调用 `changeLanguage` 并持久化。
- 主题选择器列出 `light`、`dark`、`system`，选择后调用 `setTheme`。
- 旧 Landing 偏好迁移到 `zh-CN`/`en` 和对应主题值。
- i18n 缺失 key 回退到简体中文。

### 集成/浏览器验证

- 构建、ESLint 通过。
- 在主应用与 Landing 页面分别切换五种语言，确认导航、设置和主要流程文案即时变化。
- 分别切换浅色、深色、跟随系统，确认页面背景、卡片、文字、边框和弹层对比度正确；修改系统外观后 `system` 自动跟随。
- 刷新页面后语言和主题保持；窄屏下菜单不被裁切；键盘可打开、选择和关闭菜单。
- 只检查本需求相关 diff，不覆盖或回滚工作区已有改动。

## 非目标

- 不为每种语言复制页面组件。
- 不在本期新增西班牙语、德语、法语、意大利语。
- 不改变 AI 生成笔记的输出语言逻辑。
- 不重构与语言/主题无关的业务模块。
