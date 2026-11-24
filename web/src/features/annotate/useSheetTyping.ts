import { useRef, useState, type FocusEvent } from 'react'

// телефон: пока печатают в листе, низ с кнопками едет в общую прокрутку
export function useSheetTyping() {
  const [typing, setTyping] = useState(false)
  const typingOff = useRef(0)

  return {
    typing,
    onFocus: (e: FocusEvent) => {
      if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) return
      clearTimeout(typingOff.current)
      setTyping(true)
    },
    onBlur: () => {
      // не сразу: иначе кнопка под пальцем уедет до нажатия
      clearTimeout(typingOff.current)
      typingOff.current = window.setTimeout(() => setTyping(false), 300)
    },
  }
}
