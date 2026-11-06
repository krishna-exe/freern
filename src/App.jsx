import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import { clock, freeState, rangeLabel, resolveWindow, toDateTimeInput, toTimeInput, whenLabel } from './times'

// A shared link looks like #/add/aayush.
const handleFromHash = () => {
  const m = window.location.hash.match(/^#\/add\/([^/]+)$/)
  return m ? api.normalizeHandle(decodeURIComponent(m[1])) : ''
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    if (!api.supabase) return
    api.supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = api.supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!api.supabase) return <main className="page"><p className="error">Missing Supabase config. See README.</p></main>
  if (session === undefined) return null
  if (!session) return <Auth />
  return <Home key={session.user.id} myId={session.user.id} />
}

function Auth() {
  const invitedBy = handleFromHash()
  const [mode, setMode] = useState(invitedBy ? 'signup' : 'signin')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

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
      <h1>Free RN</h1>
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
        {signup && <p className="note">No email involved, so a forgotten password can’t be reset. Save it somewhere.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'One sec…' : signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="link" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError('') }}>
        {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </main>
  )
}

function Home({ myId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      setData(await api.loadAll(myId))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [myId])

  useEffect(() => {
    refresh()
    const unsubscribe = api.subscribe(refresh)
    // Live updates can drop while a phone sleeps, so catch up on return too.
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); refresh() } }
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(() => setNow(Date.now()), 15000)
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', onVisible); clearInterval(tick) }
  }, [refresh])

  const run = useCallback(async (fn) => {
    try {
      const result = await fn()
      setNow(Date.now())
      await refresh()
      return result
    } catch (e) {
      setError(e.message)
    }
  }, [refresh])

  if (!data) return <main className="page">{error ? <p className="error" role="alert">{error}</p> : <p className="note">Loading…</p>}</main>
  if (!data.me) return <main className="page"><p className="error">Account not found.</p><button className="link" onClick={api.signOut}>Sign out</button></main>

  const myState = freeState(data.me.freeFrom, data.me.freeUntil, now)
  const inState = (state) => data.friends
    .filter((f) => freeState(f.freeFrom, f.freeUntil, now) === state)
    .sort((a, b) => a.name.localeCompare(b.name))
  const friendRow = (f) => <FriendRow key={f.id} friend={f} now={now} onRemove={() => run(() => api.removeLink(myId, f.id))} />
  const onFriends = inState('on'), laterFriends = inState('later'), offFriends = inState('off')
  const plans = data.plans.filter((p) => new Date(p.startsAt).getTime() > now)

  return (
    <main className="page">
      <div className="stack-tight">
        <Switch state={myState} me={data.me} now={now} onToggle={() => run(() => api.setFree(myState !== 'on'))} />
        <TimeWindow state={myState} me={data.me} now={now} run={run} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {data.incoming.length > 0 && (
        <section>
          <h2>Requests</h2>
          <ul className="list">
            {data.incoming.map((p) => (
              <li key={p.id} className="row">
                <Person person={p} />
                <div className="actions">
                  <button className="primary small" onClick={() => run(() => api.acceptFriend(p.id))}>Accept</button>
                  <button className="quiet" onClick={() => run(() => api.removeLink(myId, p.id))}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>On now <span className="count">{onFriends.length}</span></h2>
        {onFriends.length === 0
          ? <p className="note">{data.friends.length ? 'Nobody’s on right now.' : 'Add a friend to get started.'}</p>
          : <ul className="list">{onFriends.map(friendRow)}</ul>}
      </section>

      {laterFriends.length > 0 && (
        <section>
          <h2>Free later <span className="count">{laterFriends.length}</span></h2>
          <ul className="list">{laterFriends.map(friendRow)}</ul>
        </section>
      )}

      {offFriends.length > 0 && (
        <section>
          <h2>Off <span className="count">{offFriends.length}</span></h2>
          <ul className="list">{offFriends.map(friendRow)}</ul>
        </section>
      )}

      <Plans plans={plans} myId={myId} now={now} run={run} />

      <AddFriend run={run} myHandle={data.me.handle} />

      {data.outgoing.length > 0 && (
        <section>
          <h2>Waiting on</h2>
          <ul className="list">
            {data.outgoing.map((p) => (
              <li key={p.id} className="row">
                <Person person={p} />
                <button className="quiet" onClick={() => run(() => api.removeLink(myId, p.id))}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Share handle={data.me.handle} />
      <button className="link" onClick={api.signOut}>Sign out</button>
    </main>
  )
}

function Switch({ state, me, now, onToggle }) {
  const on = state === 'on'
  const detail = on
    ? `Friends can see you’re free. Turns off at ${clock(me.freeUntil)}.`
    : state === 'later'
      ? `Friends see you’re free ${rangeLabel(me.freeFrom, me.freeUntil, now)}. Tap to go on now.`
      : 'Tap when you’re free to call or hang out.'
  return (
    <button className={on ? 'hero on' : 'hero'} role="switch" aria-checked={on} onClick={onToggle}>
      <span className="hero-text">
        <strong>{on ? 'I’m on' : 'I’m off'}</strong>
        <span>{detail}</span>
      </span>
      <span className="knob-track" aria-hidden="true"><span className="knob" /></span>
    </button>
  )
}

function TimeWindow({ state, me, now, run }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')

  function show() {
    const active = state !== 'off'
    setFrom(toTimeInput(active ? me.freeFrom ?? now : now))
    setUntil(toTimeInput(active ? me.freeUntil : now + 2 * 3600000))
    setOpen(true)
  }

  async function save(e) {
    e.preventDefault()
    const w = resolveWindow(from, until, Date.now())
    await run(() => api.setTimes(w.from, w.until))
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="time-links">
        <button className="link" onClick={show}>{state === 'off' ? 'Set times' : 'Change times'}</button>
        {state === 'later' && <button className="link" onClick={() => run(() => api.setFree(false))}>Clear</button>}
      </div>
    )
  }
  return (
    <form className="time-form" onSubmit={save}>
      <label>From<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
      <label>To<input type="time" value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
      <button className="primary small">Save</button>
      <button type="button" className="quiet" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  )
}

function Plans({ plans, myId, now, run }) {
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')

  async function post(e) {
    e.preventDefault()
    const done = await run(async () => {
      await api.createPlan(new Date(at).toISOString(), note.trim())
      return true
    })
    if (done) { setAt(''); setNote('') }
  }

  return (
    <section>
      <h2>Plans</h2>
      {plans.length > 0 && (
        <ul className="list plan-list">
          {plans.map((p) => {
            const mine = p.host.id === myId
            return (
              <li key={p.id} className="plan">
                <div className="plan-text">
                  <span className="name">{whenLabel(p.startsAt, now)}</span>
                  <span className="handle">{mine ? 'Your plan' : p.host.name}</span>
                  {p.note && <span className="plan-note">{p.note}</span>}
                  <span className="handle">{p.names.length ? `In: ${p.names.join(', ')}` : 'Nobody’s in yet'}</span>
                </div>
                {mine
                  ? <button className="quiet" onClick={() => { if (window.confirm('Delete this plan?')) run(() => api.deletePlan(p.id)) }}>Delete</button>
                  : <button className={p.imIn ? 'secondary small' : 'primary small'} onClick={() => run(() => api.respondPlan(p.id, !p.imIn))}>{p.imIn ? 'Leave' : 'I’m in'}</button>}
              </li>
            )
          })}
        </ul>
      )}
      <form className="stack plan-form" onSubmit={post}>
        <label>When<input type="datetime-local" value={at} min={toDateTimeInput(now)} onChange={(e) => setAt(e.target.value)} required /></label>
        <label>What for (optional)<input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="primary">Post plan</button>
        <p className="note">All your friends will see this.</p>
      </form>
    </section>
  )
}

function Person({ person }) {
  return (
    <span className="person">
      <span className="name">{person.name}</span>
      <span className="handle">@{person.handle}</span>
    </span>
  )
}

function FriendRow({ friend, now, onRemove }) {
  const state = freeState(friend.freeFrom, friend.freeUntil, now)
  return (
    <li className={state === 'on' ? 'row is-on' : 'row'}>
      <span className="dot" aria-hidden="true" />
      <Person person={friend} />
      {state === 'on' && <span className="left">till {clock(friend.freeUntil)}</span>}
      {state === 'later' && <span className="later">{rangeLabel(friend.freeFrom, friend.freeUntil, now)}</span>}
      <button className="quiet" aria-label={`Remove ${friend.name}`}
        onClick={() => { if (window.confirm(`Remove ${friend.name} from your friends?`)) onRemove() }}>Remove</button>
    </li>
  )
}

const ADD_MESSAGES = {
  requested: (h) => `Request sent to @${h}.`,
  accepted: (h) => `You and @${h} are now friends.`,
  already_requested: (h) => `You’ve already asked @${h}.`,
  already_friends: (h) => `You and @${h} are already friends.`,
  self: () => 'That’s your own ID.',
  not_found: (h) => `No one has the ID @${h}. Check the spelling.`,
}

function AddFriend({ run, myHandle }) {
  const [value, setValue] = useState(handleFromHash)
  const [message, setMessage] = useState('')
  const input = useRef(null)

  // Opening a friend's link fills the box, leaving the send to the user.
  useEffect(() => {
    if (!value) return
    input.current?.scrollIntoView({ block: 'center' })
    input.current?.focus()
    history.replaceState(null, '', window.location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(e) {
    e.preventDefault()
    const h = api.normalizeHandle(value)
    if (!h) return
    const result = await run(() => api.addFriend(h))
    if (!result) return
    setMessage(ADD_MESSAGES[result]?.(h) ?? '')
    if (result !== 'not_found' && result !== 'self') setValue('')
  }

  return (
    <section>
      <h2>Add a friend</h2>
      <form className="stack-tight" onSubmit={submit}>
        <label htmlFor="friend-id">Friend’s user ID</label>
        <div className="inline">
          <input id="friend-id" ref={input} value={value} onChange={(e) => { setValue(e.target.value); setMessage('') }}
            autoCapitalize="none" autoCorrect="off" spellCheck="false" />
          <button className="primary small">Add</button>
        </div>
      </form>
      {message && <p className="note" role="status">{message}</p>}
      {myHandle === api.normalizeHandle(value) && !message && <p className="note">That’s your own ID.</p>}
    </section>
  )
}

function Share({ handle }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}${window.location.pathname}#/add/${handle}`

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Free RN', text: `Add me on Free RN, my ID is @${handle}`, url: link })
      } catch { /* share sheet dismissed */ }
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy your link', link)
    }
  }

  return (
    <section className="share">
      <div>
        <h2>Your user ID</h2>
        <code>@{handle}</code>
      </div>
      <button className="secondary" onClick={share}>{copied ? 'Link copied' : 'Share link'}</button>
    </section>
  )
}
