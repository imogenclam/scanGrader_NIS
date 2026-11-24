import { useEffect, useRef } from 'react'

export function MathBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (reduce) draw(0)
    }

    const palette = () => {
      const dark = document.documentElement.classList.contains('dark')
      return dark
        ? { line: '96,140,245', grid: '140,160,220' }
        : { line: '37,99,235', grid: '37,99,235' }
    }

    type Curve = (x: number, t: number) => number

    const curves: { fn: Curve; alpha: number; w: number; glow: number }[] = [
      {
        fn: (x, t) =>
          height * 0.32 +
          Math.sin(x * 0.006 + t * 0.0006) * (46 + Math.sin(t * 0.0004) * 18),
        alpha: 0.34,
        w: 2.4,
        glow: 10,
      },
      {
        fn: (x, t) =>
          height * 0.55 + Math.sin(x * 0.009 - t * 0.0009 + 1.5) * 34,
        alpha: 0.26,
        w: 1.8,
        glow: 6,
      },
      {
        fn: (x, t) => {
          const cx = width * (0.5 + 0.42 * Math.sin(t * 0.00025))
          const sigma = width * 0.16
          return height * 0.78 - 120 * Math.exp(-((x - cx) ** 2) / (2 * sigma * sigma))
        },
        alpha: 0.22,
        w: 1.8,
        glow: 6,
      },
    ]

    const strokeCurve = (fn: Curve, t: number, rgb: string, alpha: number, w: number, glow: number) => {
      ctx.beginPath()
      const step = 8
      for (let x = -10; x <= width + 10; x += step) {
        const y = fn(x, t)
        if (x === -10) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = `rgba(${rgb},${alpha})`
      ctx.lineWidth = w
      ctx.lineJoin = 'round'
      ctx.shadowColor = `rgba(${rgb},${alpha})`
      ctx.shadowBlur = glow
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    const draw = (t: number) => {
      const { line, grid } = palette()
      ctx.clearRect(0, 0, width, height)

      const rg1 = ctx.createRadialGradient(
        width * 0.18, height * 0.12, 0,
        width * 0.18, height * 0.12, Math.max(width, height) * 0.85,
      )
      rg1.addColorStop(0, `rgba(${line},0.16)`)
      rg1.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = rg1
      ctx.fillRect(0, 0, width, height)
      const rg2 = ctx.createRadialGradient(
        width * 0.5, height * 0.45, 0,
        width * 0.5, height * 0.45, Math.max(width, height) * 0.55,
      )
      rg2.addColorStop(0, `rgba(${line},0.12)`)
      rg2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = rg2
      ctx.fillRect(0, 0, width, height)

      const gap = 46
      ctx.strokeStyle = `rgba(${grid},0.08)`
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = (t * 0.004) % gap; x < width; x += gap) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
      }
      for (let y = 0; y < height; y += gap) {
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
      }
      ctx.stroke()

      for (const c of curves) strokeCurve(c.fn, t, line, c.alpha, c.w, c.glow)

      const px = width * (0.5 + 0.48 * Math.sin(t * 0.0004))
      const py = curves[0].fn(px, t)
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${line},0.9)`
      ctx.shadowColor = `rgba(${line},0.8)`
      ctx.shadowBlur = 16
      ctx.fill()
      ctx.shadowBlur = 0
    }

    let raf = 0
    let running = true
    const loop = (now: number) => {
      if (!running) return
      draw(now)
      raf = requestAnimationFrame(loop)
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!reduce) {
        running = true
        raf = requestAnimationFrame(loop)
      }
    }

    resize()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)

    if (reduce) {
      draw(0)
    } else {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  )
}
