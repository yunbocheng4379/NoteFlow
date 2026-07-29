import GuideLayout from '../components/GuideLayout'
import GuideShot from '../components/GuideShot'
import batchShot from '@/assets/guide/batch-mode.png'

export default function BatchGenerateArticle() {
  return (
    <GuideLayout slug="batch-generate">
      <section>
        <p className="leading-7 text-neutral-600">
          追一个 UP 主或者一个频道的所有更新时，一条一条粘贴链接太慢。批量模式支持一次性解析整个空间/频道，
          或者手动粘贴多条链接，勾选后统一提交生成。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">两种批量来源，可以叠加使用</h2>
        <p className="leading-7 text-neutral-600">
          在「新建笔记」弹窗切到「批量模式」Tab 后，上方是<strong className="text-neutral-900">UP主/频道/合集链接</strong>输入框
          （目前仅支持哔哩哔哩与 YouTube 的自动解析），点击解析会拉取该空间下的视频列表；
          下方是<strong className="text-neutral-900">手动粘贴多个视频链接</strong>文本域，按换行或逗号分隔，
          逐条识别标题、封面与时长后加入同一个预览列表，两种来源解析出的视频会自动按链接去重合并。
        </p>
        <GuideShot src={batchShot} alt="批量模式界面，可解析频道链接或手动粘贴多条视频链接" />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">勾选、检查，再提交</h2>
        <p className="leading-7 text-neutral-600">
          预览列表里每一项都可以单独勾选或移除，默认全部选中。批量共享同一套生成参数（模型、质量、风格、
          输出格式等），提交前会校验至少选中一个、单批不超过 30 个视频。
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-neutral-900">统一追踪进度</h2>
        <p className="leading-7 text-neutral-600">
          提交后所有任务会挂在同一个批次编号（batch_id）下，回到任务列表可以按批次查看整体进度；
          如果其中部分视频提交失败（比如链接失效），会单独提示成功与失败的数量，不影响其余任务继续生成。
        </p>
      </section>
    </GuideLayout>
  )
}
