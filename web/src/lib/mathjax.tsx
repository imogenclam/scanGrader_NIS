import { useEffect, useRef, useSyncExternalStore } from 'react'
import { hasRawMath } from './math-text'

// до загрузки скрипта здесь лежит конфиг, после — сам MathJax
interface MathJaxGlobal {
  typesetPromise?(els: HTMLElement[]): Promise<void>
  typesetClear?(els: HTMLElement[]): void
  startup?: { defaultReady?(): void } & Record<string, unknown>
  [option: string]: unknown
}

declare global {
  interface Window {
    MathJax?: MathJaxGlobal
  }
}

let loadPromise: Promise<void> | null = null

export function loadMathJax(): Promise<void> {
  if (window.MathJax?.typesetPromise) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = new Promise((resolve, reject) => {
    window.MathJax = {
      // ui/safe грузить отдельно
      loader: { load: ['ui/safe', '[tex]/mathtools'] },
      tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']],
        processEscapes: true,
        packages: { '[+]': ['mathtools'] },
        // обозначения русской школы
        macros: {
          tg: '\\operatorname{tg}',
          ctg: '\\operatorname{ctg}',
          arctg: '\\operatorname{arctg}',
          arcctg: '\\operatorname{arcctg}',
          sh: '\\operatorname{sh}',
          ch: '\\operatorname{ch}',
          th: '\\operatorname{th}',
          cth: '\\operatorname{cth}',
          abs: ['\\left\\lvert #1\\right\\rvert', 1],
          norm: ['\\left\\lVert #1\\right\\rVert', 1],
          bm: ['\\boldsymbol{#1}', 1],
        },
      },
      options: {
        // иначе каждая формула — остановка Tab, до кнопок не добраться
        enableMenu: false,
        skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        safeOptions: {
          allow: { URLs: 'safe', classes: 'safe', cssIDs: 'safe', styles: 'safe' },
          safeProtocols: { http: true, https: true, file: false, javascript: false, data: false },
        },
      },
      startup: {
        typeset: false,
        ready: () => {
          window.MathJax?.startup?.defaultReady?.()
          resolve()
        },
      },
    }
    const script = document.createElement('script')
    script.src = '/static/vendor/mathjax/es5/tex-mml-chtml.js'
    script.async = true
    script.onerror = () => {
      loadPromise = null
      script.remove()
      reject(new Error('Не удалось загрузить MathJax'))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

// typesetPromise не параллелить
const pending = new Set<HTMLElement>()
let batch: Promise<void> | null = null
let queue: Promise<void> = Promise.resolve()

// сколько пачек ещё набирается: длинной статье нужен индикатор
let inFlight = 0
// большая пачка: индикатор сразу, набор держит поток десятки секунд
let heavyFlight = 0
const busyListeners = new Set<() => void>()
function setInFlight(d: number) {
  inFlight += d
  busyListeners.forEach((l) => l())
}
function setHeavy(d: number) {
  heavyFlight += d
  busyListeners.forEach((l) => l())
}

const subscribeBusy = (cb: () => void) => {
  busyListeners.add(cb)
  return () => {
    busyListeners.delete(cb)
  }
}

export function useTypesetBusy(): boolean {
  return useSyncExternalStore(subscribeBusy, () => inFlight > 0, () => false)
}

export function useTypesetHeavy(): boolean {
  return useSyncExternalStore(subscribeBusy, () => heavyFlight > 0, () => false)
}

const HEAVY_FORMULAS = 100

export function countFormulaMarks(text: string): number {
  return (text.match(/\$\$|\$|\\\(|\\\[/g) ?? []).length / 2
}

// кадр на отрисовку индикатора до долгого набора
const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)))

// промис ждёт набора именно этой пачки
export function typeset(el?: HTMLElement): Promise<void> {
  if (el) pending.add(el)
  if (batch === null) {
    setInFlight(1)
    batch = new Promise<void>((resolve) => {
      setTimeout(() => {
        batch = null
        const els = [...pending].filter((e) => e.isConnected)
        pending.clear()
        if (els.length === 0) return resolve()
        const heavy = els.reduce((n, e) => n + countFormulaMarks(e.textContent ?? ''), 0) > HEAVY_FORMULAS
        if (heavy) setHeavy(1)
        queue = queue.then(async () => {
          try {
            await loadMathJax()
            // без очистки список формул растёт от слайда к слайду
            window.MathJax?.typesetClear?.(els)
            if (!heavy) {
              await window.MathJax?.typesetPromise?.(els)
              return
            }
            // по блоку за раз: между блоками страница отвечает
            await nextPaint()
            for (const e of els) {
              if (e.isConnected) await window.MathJax?.typesetPromise?.([e])
              await new Promise((r) => setTimeout(r, 0))
            }
          } catch {
          } finally {
            if (heavy) setHeavy(-1)
          }
        })
        void queue.then(resolve)
      }, 40)
    }).finally(() => setInFlight(-1))
  }
  return batch
}

// html только из formatText
export function setMathHtml(el: HTMLElement, html: string): Promise<void> {
  el.innerHTML = html
  return hasRawMath(el.textContent ?? '') ? typeset(el) : Promise.resolve()
}

// lazy: формулы набираются, когда блок подходит к экрану (длинные статьи на слабых телефонах)
export function MathContent({ html, className, ptrBlocks, lazy }: { html: string; className?: string; ptrBlocks?: string; lazy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!lazy || typeof IntersectionObserver === 'undefined') {
      void setMathHtml(el, html)
      return
    }
    el.innerHTML = html
    if (!hasRawMath(el.textContent ?? '')) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        void typeset(el)
      },
      { rootMargin: '1200px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [html, lazy])
  return <div ref={ref} className={`vm-content ${className ?? ''}`} data-ptr-blocks={ptrBlocks} />
}

// inline: внутри заголовка, где div недопустим
export function MathText({ text, className, inline }: { text: string; className?: string; inline?: boolean }) {
  const ref = useRef<HTMLDivElement & HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.textContent = text
    if (hasRawMath(el.textContent ?? '')) void typeset(el)
  }, [text])
  const cls = `vm-content whitespace-pre-wrap ${className ?? ''}`
  return inline ? <span ref={ref} className={`block ${cls}`} /> : <div ref={ref} className={cls} />
}
