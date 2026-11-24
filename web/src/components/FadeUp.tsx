import { useEffect, useState, type ComponentProps, type CSSProperties } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

// дальше пятой ступеньки элементы появляются вместе
const MAX_STEP = 5

// пути, где экран уже показался и появление отыграло
const shown = new Set<string>()

function usePath() {
  return useRouterState({ select: (s) => s.location.pathname })
}

/**
 * Экран с появлением блоков один раз. До первого рендера с ready анимируется всё,
 * что монтируется; потом новые элементы (refetch, фильтр, вкладка, поллинг)
 * показываются сразу. Уход с экрана сбрасывает. Без вызова анимируется всегда.
 */
export function useFadeScreen(ready = true) {
  const path = usePath()
  useEffect(() => () => void shown.delete(path), [path])
  useEffect(() => {
    if (ready) shown.add(path)
  }, [ready, path])
}

/** Класс и ступенька появления; решается один раз при монтировании. */
export function useFadeUp(i = 0): { className?: string; style?: CSSProperties } {
  const path = usePath()
  const [on] = useState(() => !shown.has(path))
  if (!on) return {}
  return {
    className: 'vm-fade-up',
    style: { '--i': Math.max(0, Math.min(i, MAX_STEP)) } as CSSProperties,
  }
}

type FadeUpProps = ComponentProps<'div'> & {
  /** ступенька каскада 0..5, больше считается как 5 */
  i?: number
  /** без своей обёртки: класс и стиль уходят единственному ребёнку */
  asChild?: boolean
  /** каскад по детям, для неизменного набора (плитки) */
  stagger?: boolean
}

export function FadeUp({ i = 0, asChild, stagger, className, style, ...props }: FadeUpProps) {
  const fade = useFadeUp(i)
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      className={cn(fade.className && (stagger ? 'vm-stagger' : fade.className), className)}
      style={stagger ? style : { ...fade.style, ...style }}
      {...props}
    />
  )
}
