import GuideLayout from '../components/GuideLayout'
import GuideShot from '../components/GuideShot'
import workspaceShot from '@/assets/guide/workspace.png'
import noteFormShot from '@/assets/guide/note-form.png'
import tasksShot from '@/assets/guide/tasks.png'

export default function QuickStartArticle() {
  return (
    <GuideLayout slug="quick-start">
      <section>
        <p className="leading-7 text-neutral-600">
          NoteFlow 的核心工作流只有一句话：<strong className="text-neutral-900">粘贴一条视频链接，等 AI
          把它变成一份可读的笔记</strong>。支持哔哩哔哩、YouTube、抖音、快手，也支持直接上传本地视频/音频文件。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">1. 新建一篇笔记</h2>
        <p className="leading-7 text-neutral-600">
          登录后进入工作台，点击左侧「新建笔记」。粘贴链接后系统会自动识别平台并预览标题、封面与时长；
          本地文件走独立的拖拽/点击上传区。
        </p>
        <GuideShot src={workspaceShot} alt="NoteFlow 工作台首页" />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">2. 选择模型与笔记风格</h2>
        <p className="leading-7 text-neutral-600">
          表单里可以选择 AI 模型、生成质量（快/中/慢）、笔记风格（精简、详细、教程、学术等内置风格，也支持自定义模板），
          以及输出格式：目录、原片跳转、原片截图、AI 总结。粘贴链接后系统会实时预估这次生成需要消耗的「电力」，
          电力不足时提交按钮会被禁用并引导前往充值。
        </p>
        <GuideShot src={noteFormShot} alt="新建笔记表单，可选择模型、风格与输出格式" />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">3. 等待生成，随时可以离开</h2>
        <p className="leading-7 text-neutral-600">
          提交后任务进入后台队列：下载视频 → 转写语音 → 调用 LLM 生成笔记。前端每 3 秒轮询一次任务状态，
          你可以切换到其他页面甚至关闭浏览器，任务列表里随时能看到进度。生成失败并提示需要 Cookie 时，
          系统会自动弹出补充窗口，填好后一键重试。
        </p>
        <GuideShot src={tasksShot} alt="任务列表页，展示多个笔记生成任务的状态" />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">4. 查看结果</h2>
        <p className="leading-7 text-neutral-600">
          生成成功后自动打开结果页，可以在「文档」和「思维导图」两种视图间切换，支持复制、下载、重新生成、
          多版本对比，以及针对笔记内容直接向 AI 提问追问细节。
        </p>
      </section>
    </GuideLayout>
  )
}
