import { useState } from 'react'
import * as api from '../lib/api'
import { handleFromHash } from '../lib/invite'

export function Auth() {
  const invitedBy = handleFromHash()
  const [mode, setMode] = useState(invitedBy ? 'signup' : 'signin')
  const [notice, setNotice] = useState('')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

  if (mode === 'forgot') {
    return (
      <ResetPassword
        onBack={() => setMode('signin')}
        onDone={() => { setNotice('Password changed. Sign in with the new one.'); setPassword(''); setMode('signin') }}
      />
    )
  }

  async function submit(e) {
    e.preventDefault()
    const h = api.normalizeHandle(handle)
    if (!api.HANDLE_RE.test(h)) return setError('User ID must be 3–20 letters, numbers or underscores.')
    setBusy(true)
    setError('')
    const { error } = signup
      ? await api.signUp({ handle: h, name: name.trim(), password })
      : await api.signIn({ handle: h, password })
    setBusy(false)
    if (!error) return
    if (/already registered/i.test(error.message)) setError('That user ID is taken. Try another.')
    else if (/invalid login/i.test(error.message)) setError('Wrong user ID or password.')
    else setError(error.message)
  }

  return (
    <main className="page auth">
      <h1 className="wordmark">Free RN</h1>
      <p className="lede">
        {invitedBy
          ? <>@{invitedBy} wants to add you. Make an account to see when they’re free.</>
          : 'Flip a switch when you’re free. See which friends are too.'}
      </p>
      <form className="stack" onSubmit={submit}>
        <label>
          User ID
          <input value={handle} onChange={(e) => setHandle(e.target.value)} required
            autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="username" />
        </label>
        {signup && (
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" />
          </label>
        )}
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            autoComplete={signup ? 'new-password' : 'current-password'} />
        </label>
        {notice && !signup && <p className="note flush" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'One sec…' : signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="link" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError('') }}>
        {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
      {!signup && <button className="link" onClick={() => { setMode('forgot'); setError('') }}>Forgot password?</button>}
    </main>
  )
}

function ResetPassword({ onBack, onDone }) {
  const [handle, setHandle] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const problem = await api.resetPassword({ handle: api.normalizeHandle(handle), code, password })
    setBusy(false)
    if (problem) setError(problem)
    else onDone()
  }

  return (
    <main className="page auth">
      <h1>Reset password</h1>
      <p className="note flush">You’ll need the recovery code you saved. Without it, the account can’t be recovered.</p>
      <form className="stack" onSubmit={submit}>
        <label>
          User ID
          <input value={handle} onChange={(e) => setHandle(e.target.value)} required
            autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="username" />
        </label>
        <label>
          Recovery code
          <input value={code} onChange={(e) => setCode(e.target.value)} required
            autoCapitalize="characters" autoCorrect="off" spellCheck="false" autoComplete="off" />
        </label>
        <label>
          New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'One sec…' : 'Change password'}</button>
      </form>
      <button className="link" onClick={onBack}>Back to sign in</button>
    </main>
  )
}
