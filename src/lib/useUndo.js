import { useCallback, useEffect, useRef, useState } from 'react'

const UNDO_WINDOW_MS = 5000

// Holds a destructive action back for a few seconds so it can be undone. While
// waiting, `pending.hiddenId` tells the screen what to hide. Starting another
// action, leaving the page or signing out carries out the waiting one right away.
export function useUndo() {
  const [pending, setPending] = useState(null)
  const waiting = useRef(null)

  const flush = useCallback(async () => {
    const action = waiting.current
    if (!action) return
    waiting.current = null
    clearTimeout(action.timer)
    setPending(null)
    await action.apply()
  }, [])

  const schedule = useCallback(({ message, hiddenId, apply }) => {
    flush()
    const timer = setTimeout(flush, UNDO_WINDOW_MS)
    waiting.current = { apply, timer }
    setPending({ message, hiddenId })
  }, [flush])

  const undo = useCallback(() => {
    clearTimeout(waiting.current?.timer)
    waiting.current = null
    setPending(null)
  }, [])

  useEffect(() => {
    const onHide = () => { if (document.hidden) flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [flush])

  return { pending, schedule, undo, flush }
}
