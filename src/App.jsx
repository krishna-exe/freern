import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import { AVATARS } from './avatars'
import { activeNote, clock, freeState, rangeLabel, resolveWindow, toDateTimeInput, toTimeInput, whenLabel } from './times'

const HOUR = 3600000
const iso = (ms) => new Date(ms).toISOString()

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

// Which plans this device has shown, for the badge on the Plans tab.
function readSeenPlans(myId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`freern-seen-plans-${myId}`)) ?? [])
  } catch {
    return new Set()
  }
}
function writeSeenPlans(myId, ids) {
  try {
    localStorage.setItem(`freern-seen-plans-${myId}`, JSON.stringify(ids))
  } catch { /* the badge just won't clear across reloads */ }
}

function Home({ myId }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [invite, setInvite] = useState(handleFromHash)
  const [tab, setTab] = useState(() => (handleFromHash() ? 'friends' : 'now'))
  const [seenPlans, setSeenPlans] = useState(() => readSeenPlans(myId))
  const writes = useRef(0)

  const refresh = useCallback(async () => {
    const startedAt = writes.current
    try {
      const next = await api.loadAll(myId)
      // A load that began before a write finished would undo the optimistic switch.
      if (startedAt !== writes.current) return
      // Keep the clock current so fresh data isn't judged against a stale time.
      setNow(Date.now())
      setData(next)
      setLoadError('')
    } catch (e) {
      setLoadError(e.message)
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

  // Opening a friend's link lands on Friends with their ID filled in.
  useEffect(() => {
    function takeInvite() {
      const h = handleFromHash()
      if (!h) return
      setInvite(h)
      setTab('friends')
      history.replaceState(null, '', window.location.pathname)
    }
    takeInvite()
    window.addEventListener('hashchange', takeInvite)
    return () => window.removeEventListener('hashchange', takeInvite)
  }, [])

  const run = useCallback(async (fn) => {
    setActionError('')
    try {
      const result = await fn()
      setNow(Date.now())
      await refresh()
      return result
    } catch (e) {
      setActionError(e.message)
    }
  }, [refresh])

  // The switch changes on screen right away; a failed write restores the real state.
  const setMine = useCallback(async (freeFrom, freeUntil, write) => {
    writes.current++
    setActionError('')
    setNow(Date.now())
    setData((d) => ({ ...d, me: { ...d.me, freeFrom, freeUntil } }))
    try {
      await write()
    } catch (e) {
      setActionError(e.message)
    }
    writes.current++
    await refresh()
  }, [refresh])

  const plans = (data?.plans ?? []).filter((p) => new Date(p.startsAt).getTime() > now)
  const planIds = plans.map((p) => p.id).join()

  useEffect(() => {
    if (tab !== 'plans' || !planIds) return
    const ids = planIds.split(',')
    writeSeenPlans(myId, ids)
    setSeenPlans(new Set(ids))
  }, [tab, planIds, myId])

  function openTab(next) {
    setTab(next)
    setActionError('')
    window.scrollTo(0, 0)
  }

  const error = actionError || loadError
  if (!data) return <main className="page">{error ? <p className="error" role="alert">{error}</p> : <p className="note">Loading…</p>}</main>
  if (!data.me) return <main className="page"><p className="error">Account not found.</p><button className="link" onClick={api.signOut}>Sign out</button></main>

  const newPlans = tab === 'plans' ? 0 : plans.filter((p) => p.host.id !== myId && !p.imIn && !seenPlans.has(p.id)).length

  return (
    <>
      <main className="page">
        {error && <p className="error" role="alert">{error}</p>}
        {tab === 'now' && <NowTab data={data} now={now} run={run} setMine={setMine} onAddFriends={() => openTab('friends')} />}
        {tab === 'plans' && <PlansTab plans={plans} myId={myId} now={now} run={run} />}
        {tab === 'friends' && (
          <FriendsTab data={data} myId={myId} now={now} run={run}
            invite={invite} onInviteUsed={() => setInvite('')} />
        )}
      </main>
      <nav className="tabs" aria-label="Main">
        <TabButton id="now" label="Now" tab={tab} onOpen={openTab} icon={<IconNow />} />
        <TabButton id="plans" label="Plans" tab={tab} onOpen={openTab} badge={newPlans} icon={<IconPlans />} />
        <TabButton id="friends" label="Friends" tab={tab} onOpen={openTab} badge={data.incoming.length} icon={<IconFriends />} />
      </nav>
    </>
  )
}

function TabButton({ id, label, tab, onOpen, badge = 0, icon }) {
  return (
    <button className="tab" aria-current={tab === id ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge} new` : label} onClick={() => onOpen(id)}>
      <span className="tab-icon">
        {icon}
        {badge > 0 && <span className="badge">{badge}</span>}
      </span>
      {label}
    </button>
  )
}

const iconProps = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}
const IconNow = () => (
  <svg {...iconProps}><rect x="2" y="7" width="20" height="10" rx="5" /><circle cx="16.5" cy="12" r="2" /></svg>
)
const IconPlans = () => (
  <svg {...iconProps}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
)
const IconFriends = () => (
  <svg {...iconProps}><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4.5a4 4 0 0 1 0 7M18.5 15.5c2.2.7 3.5 2.6 3.5 5.5" /></svg>
)

function Avatar({ person, large }) {
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase()
  let hue = 0
  for (const c of person.handle) hue = (hue * 31 + c.charCodeAt(0)) % 360
  const className = `avatar${large ? ' large' : ''}${person.avatar ? ' picture' : ''}`
  return <span className={className} style={{ '--hue': hue }} aria-hidden="true">{person.avatar ?? initials}</span>
}

function NowTab({ data, now, run, setMine, onAddFriends }) {
  const inState = (state) => data.friends
    .filter((f) => freeState(f.freeFrom, f.freeUntil, now) === state)
    .sort((a, b) => a.name.localeCompare(b.name))
  const onFriends = inState('on'), laterFriends = inState('later')
  const myState = freeState(data.me.freeFrom, data.me.freeUntil, now)
  const on = myState === 'on'

  return (
    <>
      <h1 className="sr-only">Free RN</h1>
      <div className="stack-tight">
        <Switch state={myState} me={data.me} now={now}
          onToggle={() => setMine(null, on ? null : iso(Date.now() + 2 * HOUR), () => api.setFree(!on))} />
        <TimeControls state={myState} me={data.me} now={now} setMine={setMine} />
        <MyNote note={activeNote(data.me, now)} run={run} />
      </div>

      {data.friends.length === 0
        ? (
          <section className="empty">
            <p className="empty-title">See who’s free</p>
            <p className="note">Add a friend and they’ll show up here when they’re on.</p>
            <button className="primary" onClick={onAddFriends}>Add friends</button>
          </section>
        )
        : (
          <section>
            <h2>Free now</h2>
            {onFriends.length === 0
              ? <p className="note">Nobody’s free right now.</p>
              : <ul className="list">{onFriends.map((f) => <FreeRow key={f.id} friend={f} now={now} />)}</ul>}
          </section>
        )}

      {laterFriends.length > 0 && (
        <section>
          <h2>Free later</h2>
          <ul className="list">{laterFriends.map((f) => <FreeRow key={f.id} friend={f} now={now} />)}</ul>
        </section>
      )}
    </>
  )
}

function Switch({ state, me, now, onToggle }) {
  const on = state === 'on'
  const detail = on
    ? `Friends can see you’re free. Turns off at ${clock(me.freeUntil)}.`
    : state === 'later'
      ? `Free ${rangeLabel(me.freeFrom, me.freeUntil, now)}. Tap to go on now.`
      : 'Tap to go on for 2 hours.'
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

function TimeControls({ state, me, now, setMine }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const midnight = new Date(now).setHours(24, 0, 0, 0)

  function goFor(untilMs) {
    const at = iso(untilMs)
    setOpen(false)
    setMine(null, at, () => api.setTimes(null, at))
  }

  function showCustom() {
    const active = state !== 'off'
    setFrom(toTimeInput(active ? me.freeFrom ?? now : now))
    setUntil(toTimeInput(active ? me.freeUntil : now + 2 * HOUR))
    setOpen(true)
  }

  function save(e) {
    e.preventDefault()
    const w = resolveWindow(from, until, Date.now())
    setOpen(false)
    setMine(w.from, w.until, () => api.setTimes(w.from, w.until))
  }

  if (open) {
    return (
      <form className="time-form card" onSubmit={save}>
        <label>From<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required /></label>
        <label>To<input type="time" value={until} onChange={(e) => setUntil(e.target.value)} required /></label>
        <div className="form-actions">
          <button className="primary small">Save</button>
          <button type="button" className="quiet" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    )
  }
  return (
    <div className="chips" role="group" aria-label="Free for">
      <button className="chip" onClick={() => goFor(Date.now() + HOUR)}>1 hr</button>
      <button className="chip" onClick={() => goFor(Date.now() + 2 * HOUR)}>2 hrs</button>
      {midnight - now > 2 * HOUR && <button className="chip" onClick={() => goFor(midnight)}>Till midnight</button>}
      <button className="chip" onClick={showCustom}>Custom</button>
      {state === 'later' && (
        <button className="chip" onClick={() => setMine(null, null, () => api.setFree(false))}>Clear</button>
      )}
    </div>
  )
}

function MyNote({ note, run }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  async function save(e) {
    e.preventDefault()
    await run(() => api.setNote(value))
    setEditing(false)
  }

  if (editing) {
    return (
      <form className="stack card note-form" onSubmit={save}>
        <label>
          <span className="label-row">Your note <span className="muted">{value.length}/60</span></span>
          <input value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} required autoFocus />
        </label>
        <p className="note flush">Friends see this for 24 hours.</p>
        <div className="form-actions">
          <button className="primary small">Save</button>
          <button type="button" className="quiet" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    )
  }
  if (!note) {
    return <button className="link" onClick={() => { setValue(''); setEditing(true) }}>Add a note</button>
  }
  return (
    <div className="card my-note">
      <span className="my-note-text">{note}</span>
      <button className="quiet" onClick={() => { setValue(note); setEditing(true) }}>Edit</button>
      <button className="quiet" onClick={() => run(() => api.setNote(''))}>Clear</button>
    </div>
  )
}

function statusLabel(friend, now) {
  const state = freeState(friend.freeFrom, friend.freeUntil, now)
  if (state === 'on') return `till ${clock(friend.freeUntil)}`
  if (state === 'later') return rangeLabel(friend.freeFrom, friend.freeUntil, now)
  return ''
}

function FriendNote({ friend, now }) {
  const note = activeNote(friend, now)
  return note ? <span className="friend-note">{note}</span> : null
}

function FreeRow({ friend, now }) {
  const on = freeState(friend.freeFrom, friend.freeUntil, now) === 'on'
  return (
    <li className={on ? 'row is-on' : 'row'}>
      <Avatar person={friend} />
      <span className="person">
        <span className="name">{friend.name}</span>
        <FriendNote friend={friend} now={now} />
      </span>
      <span className="when">{statusLabel(friend, now)}</span>
    </li>
  )
}

function PlansTab({ plans, myId, now, run }) {
  const [creating, setCreating] = useState(false)
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')

  async function post(e) {
    e.preventDefault()
    const done = await run(async () => {
      await api.createPlan(new Date(at).toISOString(), note.trim())
      return true
    })
    if (done) { setAt(''); setNote(''); setCreating(false) }
  }

  return (
    <>
      <header className="tab-header">
        <h1>Plans</h1>
        {!creating && <button className="primary small" onClick={() => setCreating(true)}>New plan</button>}
      </header>

      {creating && (
        <form className="stack card" onSubmit={post}>
          <label>When<input type="datetime-local" value={at} min={toDateTimeInput(now)} onChange={(e) => setAt(e.target.value)} required autoFocus /></label>
          <label>What for (optional)<input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="note flush">All your friends will see this.</p>
          <div className="form-actions">
            <button className="primary small">Post plan</button>
            <button type="button" className="quiet" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {plans.length === 0 && !creating && (
        <section className="empty">
          <p className="empty-title">No plans yet</p>
          <p className="note">Pick a day and time, and see which friends are in.</p>
        </section>
      )}

      {plans.length > 0 && (
        <ul className="plans">
          {plans.map((p) => <PlanCard key={p.id} plan={p} mine={p.host.id === myId} now={now} run={run} />)}
        </ul>
      )}
    </>
  )
}

function PlanCard({ plan, mine, now, run }) {
  return (
    <li className="card plan">
      <div className="plan-text">
        <span className="plan-when">{whenLabel(plan.startsAt, now)}</span>
        {plan.note && <span className="plan-note">{plan.note}</span>}
        <span className="muted">{mine ? 'Your plan' : plan.host.name}</span>
        <span className="muted">{plan.names.length ? `In: ${plan.names.join(', ')}` : 'Nobody’s in yet'}</span>
      </div>
      {mine
        ? <button className="quiet" onClick={() => { if (window.confirm('Delete this plan?')) run(() => api.deletePlan(plan.id)) }}>Delete</button>
        : <button className={plan.imIn ? 'secondary small' : 'primary small'} onClick={() => run(() => api.respondPlan(plan.id, !plan.imIn))}>{plan.imIn ? 'Leave' : 'I’m in'}</button>}
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

function FriendsTab({ data, myId, now, run, invite, onInviteUsed }) {
  const [adding, setAdding] = useState(Boolean(invite))
  const [value, setValue] = useState(invite)
  const [message, setMessage] = useState('')
  const friends = [...data.friends].sort((a, b) => a.name.localeCompare(b.name))

  useEffect(() => {
    if (!invite) return
    setValue(invite)
    setAdding(true)
    setMessage('')
  }, [invite])

  async function submit(e) {
    e.preventDefault()
    const h = api.normalizeHandle(value)
    if (!h) return
    const result = await run(() => api.addFriend(h))
    if (!result) return
    setMessage(ADD_MESSAGES[result]?.(h) ?? '')
    onInviteUsed()
    if (result !== 'not_found' && result !== 'self') {
      setValue('')
      setAdding(false)
    }
  }

  function cancel() {
    setAdding(false)
    setValue('')
    setMessage('')
    onInviteUsed()
  }

  return (
    <>
      <header className="tab-header">
        <h1>Friends</h1>
        {!adding && <button className="primary small" onClick={() => { setAdding(true); setMessage('') }}>Add friend</button>}
      </header>

      {adding && (
        <form className="stack card" onSubmit={submit}>
          <label>
            Friend’s user ID
            <input value={value} onChange={(e) => { setValue(e.target.value); setMessage('') }} required autoFocus
              autoCapitalize="none" autoCorrect="off" spellCheck="false" />
          </label>
          <div className="form-actions">
            <button className="primary small">Add</button>
            <button type="button" className="quiet" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}
      {message && <p className="note flush" role="status">{message}</p>}

      {data.incoming.length > 0 && (
        <section>
          <h2>Requests</h2>
          <ul className="list">
            {data.incoming.map((p) => (
              <li key={p.id} className="row">
                <Avatar person={p} />
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

      {friends.length > 0
        ? <ul className="list">{friends.map((f) => <FriendRow key={f.id} friend={f} now={now} onRemove={() => run(() => api.removeLink(myId, f.id))} />)}</ul>
        : data.incoming.length === 0 && !adding && (
          <section className="empty">
            <p className="empty-title">No friends yet</p>
            <p className="note">Send them your link below, or add their user ID.</p>
          </section>
        )}

      {data.outgoing.length > 0 && (
        <section>
          <h2>Waiting on</h2>
          <ul className="list">
            {data.outgoing.map((p) => (
              <li key={p.id} className="row">
                <Avatar person={p} />
                <Person person={p} />
                <button className="quiet" onClick={() => run(() => api.removeLink(myId, p.id))}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Profile me={data.me} run={run} />
      <button className="link" onClick={api.signOut}>Sign out</button>
    </>
  )
}

function Person({ person, children }) {
  return (
    <span className="person">
      <span className="name">{person.name}</span>
      <span className="handle">@{person.handle}</span>
      {children}
    </span>
  )
}

// Remove stays out of the way until you tap a person.
function FriendRow({ friend, now, onRemove }) {
  const [open, setOpen] = useState(false)
  const state = freeState(friend.freeFrom, friend.freeUntil, now)
  return (
    <li className={state === 'on' ? 'friend is-on' : 'friend'}>
      <button className="row row-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar person={friend} />
        <Person person={friend}><FriendNote friend={friend} now={now} /></Person>
        <span className="when">{statusLabel(friend, now)}</span>
      </button>
      {open && (
        <div className="row-extra">
          <button className="danger-link" aria-label={`Remove ${friend.name}`}
            onClick={() => { if (window.confirm(`Remove ${friend.name} from your friends?`)) onRemove() }}>Remove friend</button>
        </div>
      )}
    </li>
  )
}

function Profile({ me, run }) {
  const [picking, setPicking] = useState(false)
  const [copied, setCopied] = useState(false)
  const handle = me.handle
  const link = `${window.location.origin}${window.location.pathname}#/add/${handle}`

  function pick(avatar) {
    setPicking(false)
    run(() => api.setAvatar(me.id, avatar))
  }

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
    <section className="profile card">
      <div className="share">
        <Avatar person={me} large />
        <div className="share-id">
          <span className="name">{me.name}</span>
          <code>@{handle}</code>
        </div>
        <button className="secondary small" onClick={share}>{copied ? 'Link copied' : 'Share link'}</button>
      </div>
      <button className="link" aria-expanded={picking} onClick={() => setPicking(!picking)}>
        {picking ? 'Close' : 'Change picture'}
      </button>
      {picking && (
        <div className="avatar-grid" role="group" aria-label="Profile picture">
          {AVATARS.map(([emoji, label]) => (
            <button key={emoji} className="avatar-option" aria-label={label} aria-pressed={me.avatar === emoji} onClick={() => pick(emoji)}>{emoji}</button>
          ))}
          <button className="avatar-option initials" aria-pressed={!me.avatar} onClick={() => pick(null)}>Initials</button>
        </div>
      )}
    </section>
  )
}
