import { type RefObject, useEffect, useRef, useState } from 'react'
import type { PdfDocument, PdfRenderTask } from './pdfjs'

// Рендер отменяется при смене страницы, масштаба или открытой работы.
export function usePdfPageRender(
  doc: PdfDocument | null,
  page: number,
  zoom: number,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  viewportRef: RefObject<HTMLDivElement | null>,
) {
  const [width, setWidth] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const renderTaskRef = useRef<PdfRenderTask | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const resize = () => {
      const css = getComputedStyle(viewport)
      setWidth(Math.max(1, viewport.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewportRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!doc || !canvas || !width) return
    let stale = false
    setState('loading')
    async function draw() {
      const pdfPage = await doc!.getPage(page)
      if (stale || !canvas) return
      // Отдельные размеры листа на экране и растра сохраняют чёткость текста
      // на Retina, ограничивая память при просмотре больших сканов.
      const unit = pdfPage.getViewport({ scale: 1 })
      const scale = Math.min(1.5, width / unit.width) * zoom
      const shown = pdfPage.getViewport({ scale })
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 8192 / Math.max(shown.width, shown.height),
        Math.sqrt(12_000_000 / (shown.width * shown.height)))
      const viewport = pdfPage.getViewport({ scale: scale * pixelRatio })
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      canvas.style.width = Math.max(1, Math.round(shown.width)) + 'px'
      canvas.style.height = Math.max(1, Math.round(shown.height)) + 'px'
      const task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport })
      renderTaskRef.current = task
      await task.promise
      if (!stale) setState('ready')
    }
    void draw().catch(() => { if (!stale) setState('error') })
    return () => {
      stale = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [doc, page, zoom, width, canvasRef])

  return state
}
