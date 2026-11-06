import { useState } from 'react'
import { usePush } from '../lib/usePush'

const DISMISSED_KEY = 'freern-notify-prompt-dismissed'

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

// Offered once on Now. Asking the browser for permission only happens on a tap.
export function NotifyPrompt() {
  const { status, error, enable } = usePush()
  const [dismissed, setDismissed] = useState(wasDismissed)

  if (status !== 'off' || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch { /* it just shows again next time */ }
  }

  return (
    <section className="card stack recovery">
      <p className="note flush">Get told when a friend is free, so you don’t have to keep checking.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="secondary small" onClick={enable}>Turn on notifications</button>
        <button className="quiet" onClick={dismiss}>Not now</button>
      </div>
    </section>
  )
}
