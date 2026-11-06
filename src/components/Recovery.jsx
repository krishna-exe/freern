import { useState } from 'react'

export function RecoveryPrompt({ onCreate }) {
  return (
    <section className="card stack recovery">
      <p className="note flush">If you forget your password, a recovery code is the only way back in.</p>
      <div className="form-actions">
        <button className="secondary small" onClick={onCreate}>Get a recovery code</button>
      </div>
    </section>
  )
}

// A new code is only readable once, so this stays up until it's dismissed.
export function RecoveryCode({ code, onDone }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      window.prompt('Copy your code', code)
    }
  }

  return (
    <section className="card stack recovery">
      <p className="empty-title">Save your recovery code</p>
      <code className="recovery-code">{code}</code>
      <p className="note flush">It’s how you get back in if you forget your password. It won’t be shown again, and it works once.</p>
      <div className="form-actions">
        <button className="secondary small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="primary small" onClick={onDone}>I’ve saved it</button>
      </div>
    </section>
  )
}
