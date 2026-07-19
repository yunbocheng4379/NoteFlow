import React, { FC, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'

interface IProps {
  Preview: React.ReactNode
  History: React.ReactNode
  onNewNote?: () => void
}

const SIDEBAR_WIDTH = 260

const HomeLayout: FC<IProps> = ({ Preview, History, onNewNote }) => {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {!isCollapsed ? (
        <aside
          className="flex h-full shrink-0 flex-col overflow-hidden border-r border-neutral-200 bg-white"
          style={{ width: SIDEBAR_WIDTH }}
        >
          {/* 顶部标题栏 */}
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-neutral-100 px-3">
            <span className="text-sm font-semibold text-neutral-800">笔记</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsCollapsed(true)}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>收起</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </header>

          {/* 新建笔记按钮 */}
          <div className="shrink-0 px-3 pt-3 pb-2">
            <button
              onClick={onNewNote}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              新建笔记
            </button>
          </div>

          {/* 历史列表 */}
          <ScrollArea className="flex-1">
            <div className="px-2 pb-2">{History}</div>
          </ScrollArea>
        </aside>
      ) : (
        /* 折叠态 */
        <aside className="flex h-full w-12 shrink-0 flex-col items-center gap-3 border-r border-neutral-200 bg-white py-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onNewNote}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-white hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">新建笔记</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsCollapsed(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">展开</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </aside>
      )}

      {/* 主内容区 */}
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {Preview}
      </main>
    </div>
  )
}

export default HomeLayout
