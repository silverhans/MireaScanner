import { useState, useEffect } from 'react'

export const SHEET_ANIM_MS = 340
export const MODAL_ANIM_MS = 260

export default function useAnimatedPresence(isOpen, durationMs = SHEET_ANIM_MS) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [visible, setVisible] = useState(isOpen)

  useEffect(() => {
    let timer = null

    if (isOpen) {
      setShouldRender(true)
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
      timer = setTimeout(() => setShouldRender(false), durationMs)
    }

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [isOpen, durationMs])

  return { shouldRender, visible }
}
