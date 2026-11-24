import { ChevronLeft, ChevronRight, Download, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SubmissionPdf } from './useSubmissionPdf'

export function AnnotateToolbar({ pdf: p, url }: { pdf: SubmissionPdf; url: string }) {
  return (
    <div role="toolbar" aria-label="Просмотр PDF" className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-card px-2 py-1.5 md:gap-2.5 md:px-4 md:py-2">
      <Button size="sm" variant="secondary" className="h-10 px-2.5 md:h-8" asChild>
        <a href={url} download="Работа.pdf" aria-label="Скачать PDF"><Download className="size-3.5" /><span className="hidden sm:inline">Скачать PDF</span></a>
      </Button>
      <div className="ml-auto flex shrink-0 items-center gap-1 text-[13px] md:gap-2">
        <Button size="sm" variant="secondary" className="h-10 px-2.5 font-bold md:h-8" aria-label="Предыдущая страница"
          disabled={p.page <= 1} onClick={p.prevPage}><ChevronLeft className="size-4" /></Button>
        <span aria-live="polite"><span className="hidden sm:inline">Стр. </span><strong>{p.page}</strong> / <strong>{p.totalPages || '?'}</strong></span>
        <Button size="sm" variant="secondary" className="h-10 px-2.5 font-bold md:h-8" aria-label="Следующая страница"
          disabled={!p.totalPages || p.page >= p.totalPages} onClick={p.nextPage}><ChevronRight className="size-4" /></Button>
        <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />
        <Button size="sm" variant="secondary" className="h-10 px-2.5 md:h-8" disabled={!p.totalPages || p.scale <= 0.5}
          title="Уменьшить (-)" aria-label="Уменьшить масштаб" onClick={p.zoomOut}><Minus className="size-3.5" /></Button>
        <span className="min-w-9 text-center text-xs text-muted-foreground" title="Масштаб относительно размера листа в окне">{Math.round(p.scale * 100)}%</span>
        <Button size="sm" variant="secondary" className="h-10 px-2.5 md:h-8" disabled={!p.totalPages || p.scale >= 4}
          title="Увеличить (+)" aria-label="Увеличить масштаб" onClick={p.zoomIn}><Plus className="size-3.5" /></Button>
      </div>
    </div>
  )
}
