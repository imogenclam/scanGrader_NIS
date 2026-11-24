import { useEffect, useRef, useState } from 'react'
import { zoomIn, zoomOut } from './pdfjs'
import { usePdfDocument } from './usePdfDocument'
import { usePdfPageRender } from './usePdfPageRender'

export function useSubmissionPdf(pdfUrl: string) {
  const { doc, error } = usePdfDocument(pdfUrl)
  const totalPages = doc?.numPages ?? 0
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stage = usePdfPageRender(doc, page, scale, canvasRef, viewportRef)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !doc) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setScale(zoomIn) }
      if (e.key === '-') { e.preventDefault(); setScale(zoomOut) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [doc])

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, left: 0 })
  }, [page])

  return {
    error: error || (stage === 'error' ? 'Не удалось показать эту страницу PDF.' : ''),
    ready: stage === 'ready', canvasRef, viewportRef, page, totalPages, scale,
    prevPage: () => setPage((n) => Math.max(1, n - 1)),
    nextPage: () => setPage((n) => Math.max(1, Math.min(totalPages, n + 1))),
    zoomIn: () => setScale(zoomIn), zoomOut: () => setScale(zoomOut),
  }
}

export type SubmissionPdf = ReturnType<typeof useSubmissionPdf>
