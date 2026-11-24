import { useEffect, useState } from 'react'
import { loadPdfJs, PDF_DOC_OPTIONS, pdfErrorText, type PdfDocument, type PdfLoadingTask } from './pdfjs'

// doc null, пока документ грузится или не загрузился; error — текст для человека
export function usePdfDocument(url: string): { doc: PdfDocument | null; error: string } {
  const [state, setState] = useState<{ url: string; doc: PdfDocument | null; error: string }>({
    url,
    doc: null,
    error: '',
  })
  useEffect(() => {
    let cancelled = false
    let task: PdfLoadingTask | undefined
    let doc: PdfDocument | undefined
    let taskDestroyed = false
    loadPdfJs()
      .then((pdfjs) => {
        if (cancelled) return
        task = pdfjs.getDocument({ url, ...PDF_DOC_OPTIONS })
        return task.promise
      })
      .then((d) => {
        if (!d) return
        doc = d
        if (!cancelled) setState({ url, doc: d, error: '' })
        else if (!taskDestroyed) void d.destroy?.().catch(() => {})
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ url, doc: null, error: pdfErrorText(err) })
      })
    return () => {
      cancelled = true
      if (task?.destroy) {
        taskDestroyed = true
        void task.destroy().catch(() => {})
      } else {
        void doc?.destroy?.().catch(() => {})
      }
    }
  }, [url])
  // при смене адреса старый документ не показываем
  return state.url === url ? { doc: state.doc, error: state.error } : { doc: null, error: '' }
}
