import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { GradeSummary } from '@/classroom/GradeSummary'
import type { Grade, Task } from '@/api'

export function AIReviewDialog({ draft, tasks }: { draft: Grade[]; tasks: Task[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" className="h-10 shrink-0 bg-violet-600 px-2.5 text-white hover:bg-violet-700 sm:h-8">
          <Sparkles className="size-4" /><span className="hidden sm:inline">Черновик ИИ</span><span className="sm:hidden">ИИ</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet-600" /> ИИ-проверка работы (черновик)
          </DialogTitle>
          <DialogDescription>Исходные предложения ИИ по каждой задаче.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4"><GradeSummary grades={draft} tasks={tasks} /></div>
      </DialogContent>
    </Dialog>
  )
}
