import { useEffect, useRef, useState } from 'react'

const TRIGGER_PX = 70
// The finger travels further than the indicator, which makes the pull feel heavy.
const RESISTANCE = 0.5

// Returns how far the page is pulled and whether a refresh is running.
export function usePullToRefresh(onRefresh) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const gesture = useRef({ startY: null, distance: 0 })

  useEffect(() => {
    function onStart(e) {
      gesture.current = { startY: window.scrollY === 0 ? e.touches[0].clientY : null, distance: 0 }
    }
    function onMove(e) {
      const { startY } = gesture.current
      if (startY === null) return
      const distance = Math.max(0, (e.touches[0].clientY - startY) * RESISTANCE)
      gesture.current.distance = distance
      setPull(distance)
    }
    async function onEnd() {
      const { distance } = gesture.current
      gesture.current = { startY: null, distance: 0 }
      setPull(0)
      if (distance < TRIGGER_PX) return
      setRefreshing(true)
      await onRefresh()
      setRefreshing(false)
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [onRefresh])

  return { pull, ready: pull >= TRIGGER_PX, refreshing }
}
