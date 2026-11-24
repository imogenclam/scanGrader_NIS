// не .mjs из-за nginx
const PDFJS_URL = '/static/vendor/pdfjs/pdf-4.10.38.min.js'
const WORKER_URL = '/static/vendor/pdfjs/pdf.worker-4.10.38.min.js'

// eval не включать
export const PDF_DOC_OPTIONS = { isEvalSupported: false } as const

// только то, чем пользуемся из PDF.js
export interface PdfViewport {
  width: number
  height: number
}

export interface PdfRenderTask {
  promise: Promise<void>
  cancel(): void
}

export interface PdfPage {
  view: number[]
  getViewport(opts: { scale: number }): PdfViewport
  render(opts: { canvasContext: CanvasRenderingContext2D | null; viewport: PdfViewport }): PdfRenderTask
  cleanup?(): void
}

export interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
  destroy?(): Promise<void>
}

export interface PdfLoadingTask {
  promise: Promise<PdfDocument>
  destroy?(): Promise<void>
}

interface PdfJs {
  getDocument(src: ({ url: string } | { data: Uint8Array }) & typeof PDF_DOC_OPTIONS): PdfLoadingTask
  GlobalWorkerOptions: { workerSrc: string }
}

let loadPromise: Promise<PdfJs> | null = null

export function loadPdfJs(): Promise<PdfJs> {
  if (loadPromise) return loadPromise
  // Полный same-origin URL сохраняет раздачу public-файла и в Vite dev.
  const moduleUrl = new URL(PDFJS_URL, window.location.origin).href
  loadPromise = import(/* @vite-ignore */ moduleUrl)
    .then((lib: Partial<PdfJs>) => {
      if (!lib?.getDocument || !lib.GlobalWorkerOptions) throw new Error('PDF.js загрузился, но API недоступен')
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL
      return lib as PdfJs
    })
    .catch((err) => {
      loadPromise = null
      throw err instanceof Error ? err : new Error('Не удалось загрузить PDF.js')
    })
  return loadPromise
}

// масштаб листа: кнопки и клавиши +/−
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4.0
const ZOOM_STEP = 0.25
export const zoomIn = (s: number) => Math.min(ZOOM_MAX, +(s + ZOOM_STEP).toFixed(2))
export const zoomOut = (s: number) => Math.max(ZOOM_MIN, +(s - ZOOM_STEP).toFixed(2))
// человеку не показываем адрес файла из ошибки pdf.js
export function pdfErrorText(err: unknown): string {
  const e = err as { name?: string; status?: number } | null
  if (e?.name === 'MissingPDFException' || e?.status === 404) return 'Файл работы удалён'
  return 'Не удалось открыть PDF работы, обновите страницу'
}
