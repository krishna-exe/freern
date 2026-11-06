import { useState } from 'react'
import * as api from '../lib/api'
import { activeNote, clock, freeState, rangeLabel, resolveWindow, toTimeInput } from '../lib/times'
import { Avatar, FriendNote, MessageLink, statusLabel } from '../components/Person'

const HOUR = 3600000
const iso = (ms) => new Date(ms).toISOString()

export function NowTab({ data, now, run, setMine, onAddFriends }) {
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

      {myState !== 'on' && data.nudges.map((person) => (
        <div key={person.id} className="card banner">
          <Avatar person={person} />
          <span className="grow">{person.name} asked if you’re free</span>
          <button className="quiet" aria-label={`Dismiss ${person.name}`} onClick={() => run(() => api.dismissNudge(person.id))}>Dismiss</button>
        </div>
      ))}

      {on && onFriends.length > 0 && <p className="both-free" role="status">{bothFreeLabel(onFriends)}</p>}

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

function bothFreeLabel(friends) {
  const [first, ...others] = friends
  if (others.length === 0) return `${first.name} is free too`
  return `${first.name} and ${others.length} ${others.length === 1 ? 'other' : 'others'} are free too`
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
      <MessageLink friend={friend} />
    </li>
  )
}
