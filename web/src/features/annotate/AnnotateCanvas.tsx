import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SubmissionPdf } from './useSubmissionPdf'

// Оригинальный лист работы. Режим проверки сканов показывает только PDF.
export function AnnotateCanvas({ pdf, url }: { pdf: SubmissionPdf; url: string }) {
  return (
    <div ref={pdf.viewportRef} className="relative flex min-h-0 min-w-0 flex-1 items-start overflow-auto bg-neutral-200 p-2 dark:bg-neutral-800 md:p-5">
      <div className="mx-auto shrink-0 rounded-xs shadow-[0_8px_40px_rgba(0,0,0,.45)]">
        <canvas ref={pdf.canvasRef} aria-label={'Скан решения, страница ' + pdf.page} role="img"
          className={(!pdf.totalPages || pdf.error ? 'hidden' : 'block') + ' bg-white'} />
      </div>
      {pdf.error ? (
        <div role="alert" className="absolute inset-x-4 top-8 mx-auto w-fit max-w-sm space-y-3 rounded-lg border bg-card p-4 text-center text-sm">
          <p>{pdf.error}</p>
          <Button variant="outline" size="sm" asChild><a href={url} target="_blank" rel="noreferrer"><FileText className="size-4" /> Открыть исходный PDF</a></Button>
        </div>
      ) : !pdf.ready && (
        <p role="status" className="pointer-events-none absolute inset-x-4 top-5 mx-auto w-fit rounded-md border bg-card/95 px-3 py-1.5 text-sm text-muted-foreground">
          Загрузка страницы…
        </p>
      )}
    </div>
  )
}
